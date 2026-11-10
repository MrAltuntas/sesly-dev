/**
 * Remote commands of the Android media session (modules/sesly-media).
 *
 * The notification, the lock screen, headset keys and Bluetooth controls
 * reach the native session, which routes every command here instead of
 * touching the player itself. The audio store executes them like taps in
 * the app, so audio focus, the saved position, the sleep timer and the
 * premium rules all apply, and the session then follows expo-audio's state.
 *
 * iOS keeps expo-audio's own Now Playing support (see utils/lockScreen.ts);
 * there the remote commands act on the player natively.
 */

import { Platform } from 'react-native';
import SeslyMedia from '../../modules/sesly-media';
import type {
  MediaSessionCommandEvent,
  MediaSessionMetadata,
  MediaSessionOptions,
  SeslyMediaModule,
  SleepTimerFiredEvent,
} from '../../modules/sesly-media';

export type {
  MediaSessionCommandEvent,
  MediaSessionMetadata,
  MediaSessionOptions,
  SeslyMediaModule,
  SleepTimerFiredEvent,
};

/** Back and forward buttons of the lock screen, like the player screen's. */
export const MEDIA_SESSION_SKIP_SECONDS = 15;

export const MEDIA_SESSION_OPTIONS: MediaSessionOptions = {
  skipBackwardMs: MEDIA_SESSION_SKIP_SECONDS * 1000,
  skipForwardMs: MEDIA_SESSION_SKIP_SECONDS * 1000,
};

/** The native session module on Android builds that have it, else null. */
export function getAndroidMediaSession(): SeslyMediaModule | null {
  return Platform.OS === 'android' ? (SeslyMedia ?? null) : null;
}

/** What the remote commands drive. AudioPlayerStore satisfies it. */
export interface MediaSessionCommandTarget {
  /** Play, or start over when the story has finished. */
  remotePlay(): Promise<void> | void;
  pause(): Promise<void> | void;
  /** Seconds. */
  seek(seconds: number): Promise<void> | void;
  skipBackward(seconds?: number): Promise<void> | void;
  skipForward(seconds?: number): Promise<void> | void;
  /** The session is gone or must go (stop, dismissed notification). */
  releaseLockScreen(): void;
}

/** A skip interval in seconds; a missing, zero, negative or broken one is the fallback. */
function seconds(ms: number | undefined, fallback: number): number {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms / 1000 : fallback;
}

function run(action: () => Promise<void> | void): void {
  try {
    const result = action();
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch(err => console.warn('[MediaSession] Command failed:', err));
    }
  } catch (err) {
    console.warn('[MediaSession] Command failed:', err);
  }
}

/** Execute one remote command on the store. */
export function routeMediaSessionCommand(
  target: MediaSessionCommandTarget,
  event: MediaSessionCommandEvent,
): void {
  switch (event?.command) {
    case 'play':
      run(() => target.remotePlay());
      return;
    case 'pause':
      run(() => target.pause());
      return;
    case 'stop':
      // A dismissed notification or a stop key: pause, keep the position,
      // and leave the lock screen until the next play in the app.
      run(() => target.pause());
      target.releaseLockScreen();
      return;
    case 'seekTo':
      if (typeof event.positionMs !== 'number' || !Number.isFinite(event.positionMs)) return;
      run(() => target.seek(Math.max(0, event.positionMs! / 1000)));
      return;
    case 'skipBackward':
      run(() => target.skipBackward(seconds(event.intervalMs, MEDIA_SESSION_SKIP_SECONDS)));
      return;
    case 'skipForward':
      run(() => target.skipForward(seconds(event.intervalMs, MEDIA_SESSION_SKIP_SECONDS)));
      return;
    default:
      return;
  }
}

/**
 * Listen to the native session for the app's lifetime. Returns the
 * unsubscribe function; a no-op where there is no native session.
 */
export function bindMediaSessionCommands(
  target: MediaSessionCommandTarget,
  module: SeslyMediaModule | null = getAndroidMediaSession(),
): () => void {
  if (!module) return () => {};
  const subscriptions = [
    module.addListener('onCommand', event => routeMediaSessionCommand(target, event)),
    // Headphones unplugged or Bluetooth audio gone: never go on through the
    // speaker. Native pauses a lock-screen story at once; this covers every
    // other case and saves the position.
    module.addListener('onBecomingNoisy', () => run(() => target.pause())),
    // The system ended the session (the app was swiped away while paused).
    module.addListener('onSessionEnded', () => target.releaseLockScreen()),
  ];
  return () => subscriptions.forEach(subscription => subscription.remove());
}
