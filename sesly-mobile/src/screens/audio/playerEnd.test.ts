/**
 * nextAfterStory: what the player's end card offers after a story ended
 * with nothing after it (NP-18).
 */

import type { QueueEntry } from '../../stores/QueueStore';
import { EndStory, NextUpInput, nextAfterStory } from './playerEnd';

function entry(id: string, title: string, storyId = `s-${id}`): QueueEntry {
  return {
    narrationId: id,
    storyId,
    voiceProfileId: 'v-1',
    story: { id: storyId, title, coverImageUrl: null, translationGroupId: null, category: 'BEDTIME' },
    voiceProfile: null,
    narratorName: 'Deniz',
    ownVoice: false,
    estimateMs: 0,
    addedAt: 0,
  };
}

const tale = (id: string, title: string, translationGroupId: string | null = null): EndStory => ({
  id,
  title,
  translationGroupId,
  category: 'BEDTIME',
});

const ENDED: EndStory = tale('s-1', 'Uykulu Ay', 'g-ay');

const input = (patch: Partial<NextUpInput> = {}): NextUpInput => ({
  narrationId: 'n-1',
  story: ENDED,
  inQueue: false,
  queueNext: null,
  queueEntries: [],
  shelf: null,
  ...patch,
});

describe('nextAfterStory', () => {
  it('nothing queued and no shelf: nothing to offer', () => {
    expect(nextAfterStory(input())).toBeNull();
    expect(nextAfterStory(input({ shelf: [] }))).toBeNull();
  });

  it('in the queue context it offers the entry after the ended one', () => {
    const queue = [entry('n-1', 'Uykulu Ay'), entry('n-2', 'Ay Dede'), entry('n-3', 'Deniz Feneri')];
    const next = nextAfterStory(input({ inQueue: true, queueNext: queue[1], queueEntries: queue }));
    expect(next).toEqual({ kind: 'queue', entry: queue[1], title: 'Ay Dede' });
  });

  it('at the end of the queue it falls back to the shelf, never to an earlier entry', () => {
    const queue = [entry('n-0', 'Önceki'), entry('n-1', 'Uykulu Ay')];
    const shelf = [ENDED, tale('s-2', 'Yıldız Toplayan Kız')];
    const next = nextAfterStory(input({ inQueue: true, queueNext: null, queueEntries: queue, shelf }));
    expect(next).toEqual({ kind: 'shelf', storyId: 's-2', title: 'Yıldız Toplayan Kız' });
  });

  it('outside the queue context it offers the first queued story that is not the ended one', () => {
    const queue = [entry('n-1', 'Uykulu Ay'), entry('n-5', 'Kırmızı Balık')];
    expect(nextAfterStory(input({ queueEntries: queue }))).toEqual({
      kind: 'queue',
      entry: queue[1],
      title: 'Kırmızı Balık',
    });
    // A queue that holds only the ended story offers nothing from it.
    expect(nextAfterStory(input({ queueEntries: [entry('n-1', 'Uykulu Ay')] }))).toBeNull();
  });

  it('the queue wins over the shelf', () => {
    const next = nextAfterStory(
      input({ queueEntries: [entry('n-2', 'Ay Dede')], shelf: [ENDED, tale('s-2', 'Başka')] }),
    );
    expect(next?.kind).toBe('queue');
  });

  it('on the shelf it takes the tale after the ended one and wraps around', () => {
    const shelf = [tale('s-a', 'A'), tale('s-b', 'B'), ENDED, tale('s-c', 'C')];
    expect(nextAfterStory(input({ shelf }))).toEqual({ kind: 'shelf', storyId: 's-c', title: 'C' });
    const last = [tale('s-a', 'A'), tale('s-b', 'B'), ENDED];
    expect(nextAfterStory(input({ shelf: last }))).toEqual({ kind: 'shelf', storyId: 's-a', title: 'A' });
  });

  it('never offers the same tale in another language', () => {
    const shelf = [ENDED, tale('s-1-en', 'Sleepy Moon', 'g-ay'), tale('s-9', 'Kurbağa Prens')];
    expect(nextAfterStory(input({ shelf }))).toEqual({ kind: 'shelf', storyId: 's-9', title: 'Kurbağa Prens' });
    // Only versions of the ended tale: nothing.
    expect(nextAfterStory(input({ shelf: [ENDED, tale('s-1-en', 'Sleepy Moon', 'g-ay')] }))).toBeNull();
  });

  it('a story missing from the shelf gets the shelf\'s first other tale', () => {
    const shelf = [tale('s-x', 'X'), tale('s-y', 'Y')];
    expect(nextAfterStory(input({ shelf }))).toEqual({ kind: 'shelf', storyId: 's-x', title: 'X' });
  });

  it('without a story of its own, any tale of the shelf is next', () => {
    expect(nextAfterStory(input({ story: null, shelf: [tale('s-x', 'X')] }))).toEqual({
      kind: 'shelf',
      storyId: 's-x',
      title: 'X',
    });
  });

  it('keeps an empty title empty (the card shows its fallback)', () => {
    const untitled = entry('n-2', '');
    expect(nextAfterStory(input({ queueEntries: [untitled] }))?.title).toBe('');
  });

  it('skips a premium shelf tale the plan cannot open, and offers it to a paid plan', () => {
    const premium: EndStory = { ...tale('s-p', 'Altın Kuş'), isPremium: true };
    const shelf = [ENDED, premium, tale('s-c', 'C')];
    // Free plan: the lock would be a dead end, the next open tale is offered.
    expect(nextAfterStory(input({ shelf, locksPremium: true }))).toEqual({ kind: 'shelf', storyId: 's-c', title: 'C' });
    // Mini and Premium open it.
    expect(nextAfterStory(input({ shelf, locksPremium: false }))).toEqual({
      kind: 'shelf',
      storyId: 's-p',
      title: 'Altın Kuş',
    });
    // A shelf of premium tales only: nothing for the free plan.
    expect(nextAfterStory(input({ shelf: [ENDED, premium], locksPremium: true }))).toBeNull();
    // A queued story was allowed when it was queued: never filtered.
    const queued = entry('n-2', 'Ay Dede');
    expect(nextAfterStory(input({ queueEntries: [queued], shelf, locksPremium: true }))?.kind).toBe('queue');
  });
});
