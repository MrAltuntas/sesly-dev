/**
 * Adding to and removing from the queue with the feedback every entry point
 * shares (SPEC-audio 6.4): the story page (a ready narration of the chosen
 * narrator) and the Library row's own "Sıraya ekle" button. Only narrations
 * that exist are queued: a story card offers no queueing (owner feedback).
 *
 *   added   "Sıraya eklendi"  with "Sırayı aç"
 *   exists  "Zaten sırada"    with "Sırayı aç"
 *   full    "Sıra dolu, en fazla 50 masal"
 *
 * Adding never starts playback; while the queue plays the new entry plays
 * in its turn.
 */

import i18n from '../i18n';
import { showToast, type ToastAction } from '../utils/toast';
import { getStoryStore } from '../hooks/useStory';
import { isNarrationReady, type StoryNarration } from '../models/Narration';
import { getNarrationMeta, playerStoryOf, type NarrationMeta } from './narrationMeta';
import { QUEUE_MAX, queueStore, type QueueAddResult } from './QueueStore';
import { queueSheet } from './queueSheet';

const openQueueAction = (): ToastAction => ({
  label: i18n.t('player:queue.open'),
  onPress: () => queueSheet.open('toast'),
});

/**
 * The narrations of a story page come without their story (GET
 * /narrations/story/:id sends no title or cover). The queue row and the
 * player draw it, so it is taken from what the app already holds: the
 * remembered meta of that narration, else the story store's copy.
 */
export function withKnownStory(meta: NarrationMeta): NarrationMeta {
  if (meta.story?.title) return meta;
  const remembered = getNarrationMeta(meta.narrationId);
  if (remembered?.story.title) {
    return { ...meta, storyId: meta.storyId || remembered.storyId, story: remembered.story };
  }
  const story = meta.storyId ? getStoryStore()?.peekStory?.(meta.storyId) : null;
  return story ? { ...meta, story: playerStoryOf(story) } : meta;
}

/** Add one narration and say what happened. */
export function addToQueueWithFeedback(meta: NarrationMeta): QueueAddResult {
  const result = queueStore.add(withKnownStory(meta));
  if (result === 'added') {
    showToast.success(i18n.t('player:queue.added'), undefined, openQueueAction());
  } else if (result === 'exists') {
    showToast.info(i18n.t('player:queue.exists'), undefined, openQueueAction());
  } else {
    showToast.error(i18n.t('player:queue.full', { max: QUEUE_MAX }));
  }
  return result;
}

/** "Sıradan çıkar", with "Geri al" putting it back at its place. */
export function removeFromQueueWithFeedback(narrationId: string): boolean {
  const removed = queueStore.remove(narrationId);
  if (!removed) return false;
  showToast.info(i18n.t('player:queue.removed'), undefined, {
    label: i18n.t('common:undo'),
    onPress: () => queueStore.restore(removed),
  });
  return true;
}

export function isQueued(narrationId: string): boolean {
  return queueStore.has(narrationId);
}

const timeOf = (narration: StoryNarration): number => {
  const time = (narration.completedAt ?? narration.createdAt)?.getTime?.();
  return typeof time === 'number' && Number.isFinite(time) ? time : 0;
};

/** The newest READY narration of a list, or null. */
export function newestReadyNarration(
  narrations: readonly StoryNarration[],
): StoryNarration | null {
  let best: StoryNarration | null = null;
  for (const narration of narrations) {
    if (!isNarrationReady(narration)) continue;
    if (!best || timeOf(narration) > timeOf(best)) best = narration;
  }
  return best;
}
