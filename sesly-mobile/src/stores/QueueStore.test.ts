/**
 * QueueStore (src/stores/QueueStore.ts): the local, per-account queue.
 *
 * Runs on the global AsyncStorage mock (an in-memory map); the real-length
 * memory (utils/narrationDurations) and the narration meta cache are real.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { autorun } from 'mobx';
import {
  QUEUE_MAX,
  QUEUE_STORAGE_PREFIX,
  QueueStore,
  keepQueueMetaCurrent,
  parseQueueSnapshot,
  preferredEstimateMs,
  queueStorageKey,
} from './QueueStore';
import {
  rememberNarrationMeta,
  resetNarrationMetaForTests,
  type NarrationMeta,
} from './narrationMeta';
import {
  rememberNarrationDuration,
  resetNarrationDurationsForTests,
} from '../utils/narrationDurations';
import { parseVoiceProfileFromJSON } from '../models/VoiceProfile';
import { mockVoiceProfileJSON } from '../test-utils/mock-data';

const setItem = AsyncStorage.setItem as jest.Mock;

function meta(
  narrationId: string,
  overrides: Partial<Omit<NarrationMeta, 'story'>> & { title?: string } = {},
): NarrationMeta {
  const { title, ...rest } = overrides;
  const storyId = rest.storyId ?? `story-${narrationId}`;
  return {
    narrationId,
    storyId,
    voiceProfileId: 'voice-1',
    story: {
      id: storyId,
      title: title ?? `Masal ${narrationId}`,
      coverImageUrl: null,
      translationGroupId: null,
      category: 'BEDTIME',
    },
    voiceProfile: null,
    narratorName: 'Kerem',
    ownVoice: false,
    estimateMs: 600000,
    ...rest,
  };
}

const ids = (store: QueueStore) => store.entries.map(e => e.narrationId);

async function stored(userId: string): Promise<unknown> {
  const raw = await AsyncStorage.getItem(queueStorageKey(userId));
  return raw ? JSON.parse(raw) : null;
}

/** A store hydrated for `userId` with entries a, b, c (or the given ids). */
async function storeWith(names: string[] = ['a', 'b', 'c'], userId = 'u-1') {
  const store = new QueueStore();
  await store.hydrate(userId);
  names.forEach(name => store.add(meta(name)));
  setItem.mockClear();
  return store;
}

beforeEach(async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  await AsyncStorage.clear();
  setItem.mockClear();
  resetNarrationDurationsForTests();
  resetNarrationMetaForTests();
});

describe('add', () => {
  it('adds at the end, reports exists for the same narration and full at 50', async () => {
    const store = await storeWith([]);

    expect(store.add(meta('a'))).toBe('added');
    expect(store.add(meta('b'))).toBe('added');
    expect(store.add(meta('a'))).toBe('exists');
    expect(ids(store)).toEqual(['a', 'b']);

    for (let i = 0; store.entries.length < QUEUE_MAX; i++) store.add(meta(`n${i}`));
    expect(store.entries).toHaveLength(50);
    expect(store.add(meta('one-more'))).toBe('full');
    expect(store.entries).toHaveLength(50);
    expect(store.has('one-more')).toBe(false);
  });

  it('dedupes by narration id; another narrator of the same story is a new entry', async () => {
    const store = await storeWith([]);

    store.add(meta('kerem', { storyId: 'parmak-kiz', voiceProfileId: 'v-kerem' }));
    expect(store.add(meta('kerem', { storyId: 'parmak-kiz', voiceProfileId: 'v-kerem' }))).toBe(
      'exists',
    );
    expect(store.add(meta('elif', { storyId: 'parmak-kiz', voiceProfileId: 'v-elif' }))).toBe(
      'added',
    );

    expect(ids(store)).toEqual(['kerem', 'elif']);
    expect(store.entries.every(e => e.storyId === 'parmak-kiz')).toBe(true);
  });

  it('keeps only the meta fields and stamps addedAt', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const store = await storeWith([]);
    const record = { ...meta('a'), userId: 'u-1', savedAt: 5 } as NarrationMeta;

    store.add(record);

    expect(store.entries[0]).toEqual({ ...meta('a'), addedAt: 1_700_000_000_000 });
    expect(store.entries[0]).not.toHaveProperty('userId');
    (Date.now as jest.Mock).mockRestore();
  });
});

describe('order and undo', () => {
  it('moves an entry, clamped to the list', async () => {
    const store = await storeWith(['a', 'b', 'c', 'd']);

    store.move(0, 2);
    expect(ids(store)).toEqual(['b', 'c', 'a', 'd']);
    store.move(3, 0);
    expect(ids(store)).toEqual(['d', 'b', 'c', 'a']);
    store.move(1, 99);
    expect(ids(store)).toEqual(['d', 'c', 'a', 'b']);

    setItem.mockClear();
    store.move(2, 2);
    store.move(-1, 0);
    store.move(7, 0);
    expect(ids(store)).toEqual(['d', 'c', 'a', 'b']);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('remove returns the entry and its index; restore puts it back at that index', async () => {
    const store = await storeWith(['a', 'b', 'c']);
    const before = store.entries[1];

    const removed = store.remove('b');

    expect(removed).toEqual({ entry: before, index: 1, wasCurrent: false });
    expect(ids(store)).toEqual(['a', 'c']);
    expect(store.remove('b')).toBeNull();

    store.restore(removed!);
    expect(ids(store)).toEqual(['a', 'b', 'c']);
    expect(store.entries[1]).toBe(before);

    // Restoring twice does not duplicate it.
    store.restore(removed!);
    expect(ids(store)).toEqual(['a', 'b', 'c']);
  });

  it('restore after the list shrank lands at the end', async () => {
    const store = await storeWith(['a', 'b', 'c']);
    const removed = store.remove('c')!;
    store.remove('b');

    store.restore(removed);

    expect(ids(store)).toEqual(['a', 'c']);
  });

  it('clear empties the queue and the context; restoreSnapshot brings both back', async () => {
    const store = await storeWith(['a', 'b', 'c']);
    store.startAt('b');

    const snapshot = store.clear();

    expect(store.entries).toEqual([]);
    expect(store.currentId).toBeNull();
    expect(snapshot.currentId).toBe('b');
    expect(snapshot.entries.map(e => e.narrationId)).toEqual(['a', 'b', 'c']);

    store.restoreSnapshot(snapshot);
    expect(ids(store)).toEqual(['a', 'b', 'c']);
    expect(store.currentId).toBe('b');
  });

  it('replaceAll replaces the queue without context, deduped and capped; undo restores it', async () => {
    const store = await storeWith(['a', 'b']);
    store.startAt('a');
    const many = Array.from({ length: 60 }, (_, i) => meta(`x${i}`));

    const previous = store.replaceAll([meta('x0'), ...many]);

    expect(store.entries).toHaveLength(QUEUE_MAX);
    expect(store.entries[0].narrationId).toBe('x0');
    expect(store.entries[1].narrationId).toBe('x1');
    expect(store.currentId).toBeNull();

    store.restoreSnapshot(previous);
    expect(ids(store)).toEqual(['a', 'b']);
    expect(store.currentId).toBe('a');
  });

  it('a snapshot whose current entry is gone restores without context', async () => {
    const store = await storeWith(['a', 'b']);

    store.restoreSnapshot({ entries: store.entries.slice(0, 1), currentId: 'b' });

    expect(ids(store)).toEqual(['a']);
    expect(store.currentId).toBeNull();
  });
});

describe('context', () => {
  it('startAt sets the context; an unknown narration sets nothing', async () => {
    const store = await storeWith(['a', 'b', 'c']);

    expect(store.startAt('zzz')).toBeNull();
    expect(store.currentId).toBeNull();

    expect(store.startAt('b')?.narrationId).toBe('b');
    expect(store.currentId).toBe('b');
    expect(store.index).toBe(1);
    expect(store.current?.narrationId).toBe('b');
    expect(store.previous?.narrationId).toBe('a');
    expect(store.next?.narrationId).toBe('c');
    expect(store.upcoming.map(e => e.narrationId)).toEqual(['c']);
  });

  it('advance follows currentId after a reorder', async () => {
    const store = await storeWith(['a', 'b', 'c', 'd']);
    store.startAt('a');

    // "a" moves to the third place: what follows it is now "d".
    store.move(0, 2);
    expect(ids(store)).toEqual(['b', 'c', 'a', 'd']);

    expect(store.advance()?.narrationId).toBe('d');
    expect(store.currentId).toBe('d');
  });

  it('next is null at the end and advance leaves the context on the last entry', async () => {
    const store = await storeWith(['a', 'b']);
    store.startAt('b');

    expect(store.next).toBeNull();
    expect(store.upcoming).toEqual([]);
    expect(store.advance()).toBeNull();
    expect(store.currentId).toBe('b');
  });

  it('without context there is no current, next, previous or upcoming', async () => {
    const store = await storeWith(['a', 'b', 'c']);

    expect(store.index).toBe(-1);
    expect(store.current).toBeNull();
    expect(store.next).toBeNull();
    expect(store.previous).toBeNull();
    expect(store.upcoming).toEqual([]);
    expect(store.advance()).toBeNull();
  });

  it('removing the current entry clears the context; undo brings it back', async () => {
    const store = await storeWith(['a', 'b', 'c']);
    store.startAt('b');

    const removed = store.remove('b')!;

    expect(removed.wasCurrent).toBe(true);
    expect(store.currentId).toBeNull();
    expect(store.next).toBeNull();

    store.restore(removed);
    expect(store.currentId).toBe('b');
    expect(store.next?.narrationId).toBe('c');
  });

  it('removing another entry keeps the context', async () => {
    const store = await storeWith(['a', 'b', 'c']);
    store.startAt('a');

    store.remove('b');

    expect(store.currentId).toBe('a');
    expect(store.next?.narrationId).toBe('c');
  });

  it('leaveQueue clears the context and keeps the entries', async () => {
    const store = await storeWith(['a', 'b']);
    store.startAt('a');

    store.leaveQueue();

    expect(store.currentId).toBeNull();
    expect(ids(store)).toEqual(['a', 'b']);
  });

  it('the getters are observable', async () => {
    const store = await storeWith(['a', 'b', 'c']);
    const seen: (string | null)[] = [];
    const dispose = autorun(() => {
      seen.push(store.next?.narrationId ?? null);
    });

    store.startAt('a');
    store.advance();
    store.advance();
    dispose();

    expect(seen).toEqual([null, 'b', 'c', null]);
  });
});

describe('housekeeping', () => {
  it('replaceNarration keeps the position, addedAt and the context', async () => {
    const store = await storeWith([]);
    store.add(meta('a'));
    store.add(meta('old', { storyId: 's-1', voiceProfileId: 'v-1' }));
    store.add(meta('c'));
    store.startAt('old');
    const addedAt = store.entries[1].addedAt;

    store.replaceNarration('s-1', 'v-1', meta('new', { storyId: 's-1', voiceProfileId: 'v-1' }));

    expect(ids(store)).toEqual(['a', 'new', 'c']);
    expect(store.entries[1].addedAt).toBe(addedAt);
    expect(store.currentId).toBe('new');
    expect(store.next?.narrationId).toBe('c');
  });

  it('replaceNarration leaves one copy when the new narration is already queued', async () => {
    const store = await storeWith([]);
    store.add(meta('old', { storyId: 's-1', voiceProfileId: 'v-1' }));
    store.add(meta('b'));
    store.add(meta('new', { storyId: 's-1', voiceProfileId: 'v-1' }));

    store.replaceNarration('s-1', 'v-1', meta('new', { storyId: 's-1', voiceProfileId: 'v-1' }));

    expect(ids(store)).toEqual(['new', 'b']);
  });

  it('replaceNarration of another voice changes nothing', async () => {
    const store = await storeWith([]);
    store.add(meta('a', { storyId: 's-1', voiceProfileId: 'v-1' }));
    setItem.mockClear();

    store.replaceNarration('s-1', 'v-2', meta('x', { storyId: 's-1', voiceProfileId: 'v-2' }));

    expect(ids(store)).toEqual(['a']);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('removeByVoice drops that voice and clears the context it held', async () => {
    const store = await storeWith([]);
    store.add(meta('a', { voiceProfileId: 'v-1' }));
    store.add(meta('b', { voiceProfileId: 'v-2' }));
    store.add(meta('c', { voiceProfileId: 'v-1' }));
    store.startAt('c');

    store.removeByVoice('v-1');

    expect(ids(store)).toEqual(['b']);
    expect(store.currentId).toBeNull();
  });

  it('updateMeta refreshes the fields and keeps addedAt and order', async () => {
    const store = await storeWith(['a', 'b']);
    const addedAt = store.entries[0].addedAt;

    store.updateMeta(meta('a', { title: 'Yeni ad', estimateMs: 420000 }));

    expect(ids(store)).toEqual(['a', 'b']);
    expect(store.entries[0].story.title).toBe('Yeni ad');
    expect(store.entries[0].estimateMs).toBe(420000);
    expect(store.entries[0].addedAt).toBe(addedAt);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('updateMeta keeps what a meta without its story or voice does not know', async () => {
    const store = await storeWith(['a']);
    const voice = parseVoiceProfileFromJSON(mockVoiceProfileJSON);
    store.updateMeta(meta('a', { voiceProfile: voice }));
    setItem.mockClear();

    // The narrations of a story page come without the story (no title, no cover).
    store.updateMeta(
      meta('a', {
        storyId: '',
        title: '',
        voiceProfile: null,
        voiceProfileId: null,
        narratorName: null,
        ownVoice: false,
        estimateMs: 0,
      }),
    );

    expect(store.entries[0]).toMatchObject({
      storyId: 'story-a',
      story: { id: 'story-a', title: 'Masal a' },
      voiceProfileId: 'voice-1',
      narratorName: 'Kerem',
      estimateMs: 600000,
    });
    expect(store.entries[0].voiceProfile).toBe(voice);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('updateMeta takes a fresh story and voice when the meta knows them', async () => {
    const store = await storeWith([]);
    store.add(meta('a', { ownVoice: false, narratorName: null, voiceProfileId: null }));

    store.updateMeta(meta('a', { title: 'Yeni ad', ownVoice: true, narratorName: 'Annem' }));

    expect(store.entries[0]).toMatchObject({
      story: { title: 'Yeni ad' },
      ownVoice: true,
      narratorName: 'Annem',
      voiceProfileId: 'voice-1',
    });
  });

  it('updateMeta of an unchanged or unknown narration writes nothing', async () => {
    const store = await storeWith(['a']);

    store.updateMeta(meta('a'));
    store.updateMeta(meta('zzz'));

    expect(setItem).not.toHaveBeenCalled();
    expect(ids(store)).toEqual(['a']);
  });

  it("a story page's longer backend estimate never replaces the story's minutes (NL-04)", async () => {
    const store = await storeWith([]);
    // Added before this fix, or from a story page: the backend's 13 minutes.
    store.add(meta('a', { estimateMs: 13 * 60000 }));

    // A Library page knows the story: its 4 minutes, as the Library row reads.
    store.updateMeta(meta('a', { estimateMs: 4 * 60000 }));
    expect(store.entries[0].estimateMs).toBe(4 * 60000);

    // A story page later: the narration comes without its story, so its
    // estimate is the backend's again. The row keeps 4 minutes.
    store.updateMeta(meta('a', { estimateMs: 12 * 60000 }));
    expect(store.entries[0].estimateMs).toBe(4 * 60000);
  });

  it('preferredEstimateMs takes the shorter known estimate, else the one that is known', () => {
    expect(preferredEstimateMs(13 * 60000, 4 * 60000)).toBe(4 * 60000);
    expect(preferredEstimateMs(4 * 60000, 12 * 60000)).toBe(4 * 60000);
    expect(preferredEstimateMs(0, 5 * 60000)).toBe(5 * 60000);
    expect(preferredEstimateMs(5 * 60000, 0)).toBe(5 * 60000);
    expect(preferredEstimateMs(0, 0)).toBe(0);
    expect(preferredEstimateMs(Number.NaN, -1)).toBe(0);
  });

  it('keepQueueMetaCurrent updates queued rows from every remembered meta', async () => {
    const store = await storeWith(['a']);
    const unsubscribe = keepQueueMetaCurrent(store);

    rememberNarrationMeta(meta('a', { title: 'Uyuyan Güzel' }));
    expect(store.entries[0].story.title).toBe('Uyuyan Güzel');

    unsubscribe();
    rememberNarrationMeta(meta('a', { title: 'Başka' }));
    expect(store.entries[0].story.title).toBe('Uyuyan Güzel');
  });
});

describe('totalMinutes', () => {
  it('is null while any length is unknown, real lengths only', async () => {
    const store = await storeWith(['a', 'b']);
    rememberNarrationDuration('a', 7 * 60000);

    // b has an estimate but no real length.
    expect(store.totalMinutes).toBeNull();

    rememberNarrationDuration('b', 11 * 60000 + 20000);
    expect(store.totalMinutes).toBe(18);
  });

  it('is 0 for an empty queue', async () => {
    const store = await storeWith([]);
    expect(store.totalMinutes).toBe(0);
  });
});

describe('persistence', () => {
  it('every mutation writes the whole snapshot once, without the voice model', async () => {
    const store = await storeWith([]);
    const voice = parseVoiceProfileFromJSON(mockVoiceProfileJSON);

    store.add(meta('a', { voiceProfile: voice }));
    expect(setItem).toHaveBeenCalledTimes(1);
    store.add(meta('b'));
    store.startAt('a');
    store.move(1, 0);
    store.remove('b');
    expect(setItem).toHaveBeenCalledTimes(5);

    const last = setItem.mock.calls[4];
    expect(last[0]).toBe(`${QUEUE_STORAGE_PREFIX}u-1`);
    const data = JSON.parse(last[1]);
    expect(data.version).toBe(1);
    expect(data.currentId).toBe('a');
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].narrationId).toBe('a');
    expect(data.entries[0].voiceProfile).toBeNull();
    // In memory the voice stays for the player.
    expect(store.entries[0].voiceProfile).toBe(voice);
  });

  it('hydrates per user: the queue and the context come back', async () => {
    const first = await storeWith(['a', 'b', 'c'], 'u-1');
    first.startAt('b');
    await Promise.resolve();

    const second = new QueueStore();
    await second.hydrate('u-1');

    expect(second.hydrated).toBe(true);
    expect(ids(second)).toEqual(['a', 'b', 'c']);
    expect(second.currentId).toBe('b');
    expect(second.entries[1].story.title).toBe('Masal b');
    expect(second.entries[1].voiceProfile).toBeNull();
  });

  it("another user's key is never read and never written", async () => {
    await storeWith(['a', 'b'], 'u-1');
    const getItem = AsyncStorage.getItem as jest.Mock;
    getItem.mockClear();

    const store = new QueueStore();
    await store.hydrate('u-2');

    expect(getItem.mock.calls.map(call => call[0])).toEqual([`${QUEUE_STORAGE_PREFIX}u-2`]);
    expect(store.entries).toEqual([]);

    store.add(meta('z'));
    expect(setItem).toHaveBeenLastCalledWith(`${QUEUE_STORAGE_PREFIX}u-2`, expect.any(String));
    expect((await stored('u-1')) as { entries: unknown[] }).toMatchObject({
      entries: [{ narrationId: 'a' }, { narrationId: 'b' }],
    });
  });

  it('switching users empties the queue at once, before the read lands', async () => {
    const store = await storeWith(['a'], 'u-1');

    const pending = store.hydrate('u-2');
    expect(store.entries).toEqual([]);
    expect(store.hydrated).toBe(false);
    await pending;

    expect(store.hydrated).toBe(true);
    expect(store.entries).toEqual([]);
  });

  it('a slower read for an earlier user is dropped', async () => {
    await AsyncStorage.setItem(
      queueStorageKey('u-1'),
      JSON.stringify({ version: 1, entries: [meta('old')], currentId: null }),
    );
    const getItem = AsyncStorage.getItem as jest.Mock;
    let releaseFirst: (value: string | null) => void = () => undefined;
    getItem.mockImplementationOnce(
      () => new Promise<string | null>(resolve => {
        releaseFirst = resolve;
      }),
    );
    const store = new QueueStore();

    const first = store.hydrate('u-1');
    await store.hydrate('u-2');
    releaseFirst(JSON.stringify({ version: 1, entries: [meta('old')], currentId: null }));
    await first;

    expect(store.entries).toEqual([]);
  });

  it('an entry added while the stored queue is read lands after it, and both are stored', async () => {
    await AsyncStorage.setItem(
      queueStorageKey('u-1'),
      JSON.stringify({ version: 1, entries: [meta('s1'), meta('s2')], currentId: 's1' }),
    );
    setItem.mockClear();
    const store = new QueueStore();

    const pending = store.hydrate('u-1');
    store.add(meta('fresh'));
    store.add(meta('s2'));
    // Nothing is written before the read: it would replace the stored queue.
    expect(setItem).not.toHaveBeenCalled();
    await pending;

    expect(ids(store)).toEqual(['s1', 's2', 'fresh']);
    expect(store.currentId).toBe('s1');
    expect(store.hydrated).toBe(true);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(await stored('u-1')).toMatchObject({
      entries: [{ narrationId: 's1' }, { narrationId: 's2' }, { narrationId: 'fresh' }],
      currentId: 's1',
    });
  });

  it('a queue started while the stored one is read keeps its context', async () => {
    await AsyncStorage.setItem(
      queueStorageKey('u-1'),
      JSON.stringify({ version: 1, entries: [meta('s1')], currentId: 's1' }),
    );
    const store = new QueueStore();

    const pending = store.hydrate('u-1');
    store.add(meta('fresh'));
    store.startAt('fresh');
    await pending;

    expect(ids(store)).toEqual(['s1', 'fresh']);
    expect(store.currentId).toBe('fresh');
  });

  it('"Hepsini çal" while the stored queue is read replaces it', async () => {
    await AsyncStorage.setItem(
      queueStorageKey('u-1'),
      JSON.stringify({ version: 1, entries: [meta('s1')], currentId: 's1' }),
    );
    const store = new QueueStore();

    const pending = store.hydrate('u-1');
    store.replaceAll([meta('x'), meta('y')]);
    await pending;

    expect(ids(store)).toEqual(['x', 'y']);
    expect(store.currentId).toBeNull();
    expect(await stored('u-1')).toMatchObject({
      entries: [{ narrationId: 'x' }, { narrationId: 'y' }],
    });
  });

  it('an add between two overlapping reads for the same account is kept', async () => {
    await AsyncStorage.setItem(
      queueStorageKey('u-1'),
      JSON.stringify({ version: 1, entries: [meta('s1')], currentId: null }),
    );
    const store = new QueueStore();

    const first = store.hydrate('u-1');
    store.add(meta('fresh'));
    const second = store.hydrate('u-1');
    await Promise.all([first, second]);

    expect(ids(store)).toEqual(['s1', 'fresh']);
    expect(await stored('u-1')).toMatchObject({
      entries: [{ narrationId: 's1' }, { narrationId: 'fresh' }],
    });
  });

  it('a re-read of a hydrated queue never undoes a change made while it ran', async () => {
    const store = await storeWith(['a'], 'u-1');

    const pending = store.hydrate('u-1');
    store.add(meta('b'));
    await pending;

    expect(ids(store)).toEqual(['a', 'b']);
    expect(await stored('u-1')).toMatchObject({
      entries: [{ narrationId: 'a' }, { narrationId: 'b' }],
    });
  });

  it('a failing re-read keeps the queue in memory', async () => {
    const store = await storeWith(['a', 'b'], 'u-1');
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));

    await store.hydrate('u-1');

    expect(ids(store)).toEqual(['a', 'b']);
    expect(store.hydrated).toBe(true);
  });

  it('malformed storage reads as an empty queue', async () => {
    const bad = [
      'not json',
      'null',
      '42',
      JSON.stringify({ version: 2, entries: [meta('a')], currentId: null }),
      JSON.stringify({ version: 1, entries: 'nope', currentId: null }),
    ];
    for (const raw of bad) {
      await AsyncStorage.setItem(queueStorageKey('u-1'), raw);
      const store = new QueueStore();
      await store.hydrate('u-1');
      expect(store.entries).toEqual([]);
      expect(store.currentId).toBeNull();
      expect(store.hydrated).toBe(true);
    }
  });

  it('bad entries are skipped, duplicates dropped and a dangling context cleared', () => {
    const snapshot = parseQueueSnapshot(
      JSON.stringify({
        version: 1,
        entries: [meta('a'), { story: { id: 's' } }, 'x', meta('a'), { ...meta('b'), addedAt: 'x' }],
        currentId: 'gone',
      }),
    );

    expect(snapshot.entries.map(e => e.narrationId)).toEqual(['a', 'b']);
    expect(snapshot.entries[1].addedAt).toBe(0);
    expect(snapshot.currentId).toBeNull();
  });

  it('a failing read leaves an empty, hydrated queue', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
    const store = new QueueStore();

    await store.hydrate('u-1');

    expect(store.entries).toEqual([]);
    expect(store.hydrated).toBe(true);
  });

  it('signed out (null user): an empty queue that is kept in memory only', async () => {
    const store = new QueueStore();
    await store.hydrate(null);

    expect(store.hydrated).toBe(true);
    store.add(meta('a'));
    expect(ids(store)).toEqual(['a']);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('reset forgets the queue in memory and keeps it in storage', async () => {
    const store = await storeWith(['a', 'b'], 'u-1');
    store.startAt('a');
    setItem.mockClear();

    store.reset();

    expect(store.entries).toEqual([]);
    expect(store.currentId).toBeNull();
    expect(store.hydrated).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
    expect(await stored('u-1')).toMatchObject({ currentId: 'a' });

    // Nothing written for the signed-out state.
    store.add(meta('c'));
    expect(setItem).not.toHaveBeenCalled();
  });

  it('a read still running when reset is called is dropped', async () => {
    await AsyncStorage.setItem(
      queueStorageKey('u-1'),
      JSON.stringify({ version: 1, entries: [meta('a')], currentId: null }),
    );
    const store = new QueueStore();

    const pending = store.hydrate('u-1');
    store.reset();
    await pending;

    expect(store.entries).toEqual([]);
  });
});
