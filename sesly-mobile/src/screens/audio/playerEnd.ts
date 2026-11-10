/**
 * What the player offers once a story has ended and nothing followed it
 * (NP-18): the next story of the queue, else the next tale of the finished
 * story's home shelf. Pure, so the choice is tested without a screen.
 *
 * A queue entry plays at once (it has a narration); a shelf tale opens its
 * page, where a narrator is picked.
 */

import type { QueueEntry } from '../../stores/QueueStore';

/** The fields of a story the choice reads (a player story or a catalogue story). */
export interface EndStory {
  readonly id?: string | null;
  readonly title?: string | null;
  readonly translationGroupId?: string | null;
  readonly category?: string | null;
  readonly isPremium?: boolean | null;
}

export type NextUp =
  | { readonly kind: 'queue'; readonly entry: QueueEntry; readonly title: string }
  | { readonly kind: 'shelf'; readonly storyId: string; readonly title: string };

export interface NextUpInput {
  /** The narration that ended. */
  readonly narrationId: string;
  /** Its story. */
  readonly story: EndStory | null;
  /** The ended story is the queue's current entry. */
  readonly inQueue: boolean;
  /** The entry after it in the queue context (null at the end). */
  readonly queueNext: QueueEntry | null;
  readonly queueEntries: readonly QueueEntry[];
  /** The home shelf of the story's category, when the home screen loaded it. */
  readonly shelf: readonly EndStory[] | null | undefined;
  /**
   * The plan has no premium stories: a premium shelf tale is skipped, its
   * page would only show the lock (a queued story was already allowed).
   */
  readonly locksPremium?: boolean;
}

/** One key per tale: every language version of a story shares it. */
function taleKey(story: EndStory | null | undefined): string {
  return story?.translationGroupId || story?.id || '';
}

/**
 * The queue first: in the queue context the entry after the ended one (a
 * sleep timer stopped the advance), else the first queued story that is not
 * the ended one. Then the shelf: the tale after the ended one, wrapping
 * around, never the same tale in another language, nor a premium tale the
 * plan cannot open.
 */
export function nextAfterStory(input: NextUpInput): NextUp | null {
  const { narrationId, story, inQueue, queueNext, queueEntries, shelf, locksPremium = false } = input;
  const queued = inQueue ? queueNext : queueEntries.find(entry => entry.narrationId !== narrationId) ?? null;
  if (queued && queued.narrationId !== narrationId) {
    return { kind: 'queue', entry: queued, title: queued.story?.title || '' };
  }

  if (!shelf || shelf.length === 0) return null;
  const ended = taleKey(story);
  const at = shelf.findIndex(item => !!ended && taleKey(item) === ended);
  const ordered = at >= 0 ? [...shelf.slice(at + 1), ...shelf.slice(0, at)] : [...shelf];
  const pick = ordered.find(
    item => !!item.id && taleKey(item) !== ended && !(locksPremium && item.isPremium),
  );
  return pick?.id ? { kind: 'shelf', storyId: pick.id, title: pick.title || '' } : null;
}
