/**
 * Playback from the queue (SPEC-audio 6.3).
 *
 * The queue advances inside the audio store, synchronously in the status
 * event that reports the end of a story, through the handler `bindStoryEnd`
 * installs. No screen takes part: the next story starts with the player
 * closed and with the screen off, and nothing on that path waits on a JS
 * timer (they do not fire on Android while the screen is off).
 *
 * The rules at the end of a story:
 *   1. A stories-mode sleep timer whose count is used up stops there (it
 *      turned itself off; the story rests at its end).
 *   2. The story was started from the queue (`currentId` is the narration
 *      that ended) and an entry follows: that one starts, with autoplay.
 *   3. Otherwise nothing follows; a stories-mode timer still on is turned off.
 *
 * `bindStoryEnd` is called once by AudioSessionBridge with the store, the
 * queue and the timer; the play functions below reach the audio store
 * singleton lazily, at call time.
 */

import { reaction } from 'mobx';
import i18n from '../i18n';
import { showToast } from '../utils/toast';
import {
  getAudioPlayerStore,
  type AudioPlayerStore,
  type StartOptions,
  type StoryEndDecision,
} from '../hooks/useAudioPlayer';
import { queueStore, type QueueEntry, type QueueStore } from './QueueStore';
import { isUnplayableLoadError } from '../utils/loadErrors';

/** "Önceki" past this point starts the story over instead of going back. */
export const PREVIOUS_RESTART_MS = 5000;

/** What the queue needs from the audio store. */
export type QueueAudio = Pick<
  AudioPlayerStore,
  | 'audioId'
  | 'source'
  | 'loadError'
  | 'loadErrorNarrationId'
  | 'loadPhase'
  | 'pendingNarrationId'
  | 'currentPositionMs'
  | 'isStoryLoaded'
  | 'startNarration'
  | 'seek'
  | 'setStartListener'
  | 'setStoryEndHandler'
>;

/** What the queue needs from the sleep timer (SleepTimerService satisfies it). */
export interface QueueSleepTimer {
  /** A story ended: 'stop' when a stories-mode count is used up (it turned off). */
  handleStoryFinished(): 'stop' | 'continue';
  turnOff(): void;
  readonly store: { readonly active: boolean; readonly mode: string };
}

const QUEUE_START: StartOptions = { autoplay: true, fromQueue: true };

function startEntry(audio: QueueAudio, entry: QueueEntry): Promise<boolean> {
  return audio.startNarration({ narrationId: entry.narrationId, meta: entry }, QUEUE_START);
}

/** Start playing the queue at `narrationId` (default: the first entry). */
export async function playQueueFrom(narrationId?: string): Promise<boolean> {
  const id = narrationId ?? queueStore.entries[0]?.narrationId;
  if (!id) return false;
  const entry = queueStore.startAt(id);
  if (!entry) return false;
  return startEntry(getAudioPlayerStore(), entry);
}

/** The next entry of the queue context; false at the end or without context. */
export async function playNext(): Promise<boolean> {
  const next = queueStore.advance();
  if (!next) return false;
  return startEntry(getAudioPlayerStore(), next);
}

/** A story start is running: the store still holds the outgoing story's position. */
function isStarting(audio: QueueAudio): boolean {
  return audio.loadPhase === 'loading' && !!audio.pendingNarrationId;
}

/**
 * More than 5 s in: the story starts over. Otherwise the previous entry of
 * the queue context starts; without one the story starts over as well.
 *
 * While a start is pending the incoming story has not played yet, so it
 * counts as at its start: the position in the store is the outgoing story's,
 * and a seek would move the outgoing story.
 */
export async function playPrevious(): Promise<boolean> {
  const audio = getAudioPlayerStore();
  const previous = queueStore.previous;
  const starting = isStarting(audio);
  const positionMs = starting ? 0 : audio.currentPositionMs;
  if (positionMs > PREVIOUS_RESTART_MS || !previous) {
    if (audio.isStoryLoaded && !starting) await audio.seek(0);
    return false;
  }
  queueStore.startAt(previous.narrationId);
  return startEntry(audio, previous);
}

/**
 * A queued start whose narration is gone (deleted, or replaced by a
 * regenerate: the background refresh answered 404). The entry leaves the
 * queue and the one after it plays, once.
 */
function skipMissing(audio: QueueAudio, queue: QueueStore, narrationId: string): void {
  if (queue.currentId !== narrationId) return;
  const index = queue.index;
  queue.remove(narrationId);
  showToast.info(i18n.t('player:queue.skippedMissing'));
  const next = queue.entries[index];
  if (!next) return;
  queue.startAt(next.narrationId);
  void startEntry(audio, next);
}

/**
 * Install the queue's start listener and story end handler on the audio
 * store, and the missing-narration skip. Returns the uninstall.
 */
export function bindStoryEnd(
  audio: QueueAudio,
  queue: QueueStore,
  timer: QueueSleepTimer,
): () => void {
  // A start from outside the queue for another narration leaves the context.
  audio.setStartListener((narrationId, options) => {
    if (!options.fromQueue && queue.currentId !== narrationId) queue.leaveQueue();
  });

  audio.setStoryEndHandler((finishedId): StoryEndDecision => {
    // Only a story counts (a sample never ends a story or a timer story).
    if (audio.source !== 'story' || audio.audioId !== finishedId) return 'stop';
    if (timer.handleStoryFinished() === 'stop') return 'stop';
    if (queue.currentId === finishedId) {
      const next = queue.advance();
      if (next) {
        // Synchronous up to its first await: the intent and the pending id
        // are set before this returns, so the mini player never drops.
        void startEntry(audio, next);
        return 'advance';
      }
    }
    if (timer.store.active && timer.store.mode === 'stories') timer.turnOff();
    return 'stop';
  });

  // The narration the 404 (or the removed audio) is about, named by the store: a queued start that
  // failed before it took the player leaves the previous story loaded.
  const disposeMissing = reaction(
    () => (isUnplayableLoadError(audio.loadError) ? audio.loadErrorNarrationId : null),
    narrationId => {
      if (narrationId) skipMissing(audio, queue, narrationId);
    },
  );

  return () => {
    audio.setStartListener(null);
    audio.setStoryEndHandler(null);
    disposeMissing();
  };
}
