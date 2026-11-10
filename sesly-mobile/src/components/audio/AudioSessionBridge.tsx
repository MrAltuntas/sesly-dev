/**
 * The app-wide audio wiring, mounted once (RootHosts, inside the navigation
 * container from the first route on), so it exists before anything can
 * play. It renders nothing. Living here and not in `useAudioPlayer()` keeps
 * every hook caller free of effects (one audio mode call, one AppState
 * listener however many screens use the player) and keeps the audio store
 * free of an import cycle with the queue.
 *
 * On mount:
 *   - the queue's start listener and story end handler (`bindStoryEnd`), and
 *     the queued rows kept current with every remembered narration meta;
 *   - the sleep timer's player;
 *   - the sign-out / session expiry cleanup (session.ts end handler): the
 *     player unloads (positions kept), the timer turns off, the queue is
 *     forgotten in memory;
 *   - the queue of the signed-in user, read again whenever that user changes.
 *
 * Plan effects (`canPlayInBackground`: every paid plan, Mini included, or
 * what GET /usage says the plan offers):
 *   - The audio mode follows the plan (background playback is paid) and the
 *     lock screen is converged with it.
 *   - Free plan, the app goes to the background while a story plays or is
 *     starting (the screen turned off): the story pauses, or loads paused,
 *     silently (nobody would see a message), at volume 0. expo-audio pauses
 *     natively too and calls play()
 *     again when the app returns; the store pauses that resume again
 *     (`pausedByBackground`), and at volume 0 it is never heard. Back in the
 *     app one snackbar says why and offers "Devam et"; play() puts the
 *     volume back.
 */

import type React from 'react';
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { setAudioModeAsync } from 'expo-audio';
import {
  getAudioPlayerStore,
  getAudioPlayerStoreIfCreated,
  playbackAudioMode,
} from '../../hooks/useAudioPlayer';
import { getSubscriptionStore, useSubscription } from '../../hooks/useSubscription';
import sleepTimerService from '../../services/SleepTimerService';
import { keepQueueMetaCurrent, queueStore } from '../../stores/QueueStore';
import { bindStoryEnd } from '../../stores/queuePlayback';
import {
  getSessionUserId,
  onSessionUserChange,
  registerSessionEndHandler,
} from '../../stores/session';
import { showToast } from '../../utils/toast';
import { msg } from '../../i18n/messages';

/**
 * expo-audio's own background pause reports `playing: false` at once, and
 * that status can reach the store before the AppState event (the store then
 * reads it as a pause made outside it). A story that stopped this shortly
 * before the app went to the background was playing when it did.
 */
export const BACKGROUND_PAUSE_WINDOW_MS = 1500;

export const AudioSessionBridge: React.FC = observer(() => {
  const subscription = useSubscription();
  // Mini is paid: background playback and the lock screen, like Premium.
  const background = subscription.canPlayInBackground;

  // The wiring, once.
  useEffect(() => {
    const store = getAudioPlayerStore();
    const unbindStoryEnd = bindStoryEnd(store, queueStore, sleepTimerService);
    const unbindQueueMeta = keepQueueMetaCurrent(queueStore);
    sleepTimerService.attachPlayer(store);
    const unregisterSessionEnd = registerSessionEndHandler(async () => {
      try {
        await getAudioPlayerStoreIfCreated()?.unloadForSignOut();
      } finally {
        // Never left to the next account, even if the player failed to unload.
        sleepTimerService.turnOff();
        queueStore.reset();
      }
    });
    const unsubscribeUser = onSessionUserChange(userId => {
      void queueStore.hydrate(userId);
    });
    // The session may have been restored before this mounted.
    const userId = getSessionUserId();
    if (userId) void queueStore.hydrate(userId);
    return () => {
      unbindStoryEnd();
      unbindQueueMeta();
      unregisterSessionEnd();
      unsubscribeUser();
      sleepTimerService.attachPlayer(null);
    };
  }, []);

  // The audio mode and the lock screen follow the plan.
  useEffect(() => {
    setAudioModeAsync(playbackAudioMode(background)).catch(error => {
      console.warn('[AudioSessionBridge] Applying the audio mode failed:', error);
    });
    const store = getAudioPlayerStore();
    store.syncLockScreen(store.isPlaying);
  }, [background]);

  // Free plan in the background: one listener for the whole app.
  useEffect(() => {
    const store = getAudioPlayerStore();
    let stoppedAt = 0;
    // A background pause happened that the user has not been told about.
    let announce = false;
    const disposeStopWatch = reaction(
      () => store.isPlaying,
      playing => {
        if (playing) return;
        // A loaded story stopped sounding (the user, or expo-audio itself);
        // a new start that loads paused, an end or a failure is no pause.
        const paused = store.isStoryLoaded && store.loadPhase === 'ready' && !store.storyEnded;
        stoppedAt = paused ? Date.now() : 0;
      },
    );
    const subscriptionHandle = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background') {
        if (getSubscriptionStore().canPlayInBackground) return;
        // A start in flight that would sound once loaded (a tap just before
        // the screen went off, the queue's next story): it loads paused.
        const starting = store.loadPhase === 'loading' && store.isPlaying;
        const sounding =
          store.isStoryLoaded &&
          !store.storyEnded &&
          (store.isPlaying || Date.now() - stoppedAt < BACKGROUND_PAUSE_WINDOW_MS);
        if (!starting && !sounding) return;
        if (store.isPlaying) void store.pause();
        // Silences expo-audio's native resume on the way back.
        store.setVolume(0);
        store.setPausedByBackground(true);
        announce = true;
      } else if (next === 'active') {
        const show = announce && store.pausedByBackground;
        announce = false;
        if (show) {
          showToast.info(msg('player.pausedOnLock'), msg('player.pausedOnLockTitle'), {
            label: msg('player.resume'),
            onPress: () => void store.play(),
          });
        }
      }
    });
    return () => {
      subscriptionHandle.remove();
      disposeStopWatch();
    };
  }, []);

  return null;
});

export default AudioSessionBridge;
