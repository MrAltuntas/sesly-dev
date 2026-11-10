/**
 * lastPlayed: the record behind the Library's continue card. The current
 * shape is a narration meta plus the account and the time it was written;
 * version 1 records (the old mini player's flat shape) still read.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LAST_PLAYED_STORAGE_KEY,
  clearLastPlayed,
  lastPlayedFrom,
  parseLastPlayed,
  readLastPlayed,
  writeLastPlayed,
} from './lastPlayed';
import { metaFromNarration } from '../stores/narrationMeta';
import { parseStoryNarrationFromJSON } from '../models/Narration';
import { mockNarrationJSON } from '../test-utils/mock-data';

const meta = metaFromNarration(
  parseStoryNarrationFromJSON({ ...mockNarrationJSON, id: 'narr-1', totalDuration: 240 }),
);

const V1 = {
  userId: 'u-1',
  narrationId: 'nar-9',
  storyId: 's-9',
  title: 'Karga ile Testi',
  coverImageUrl: null,
  translationGroupId: 'tg-9',
  narratorName: 'Kerem',
  durationMs: 240000,
};

const stored = async () => JSON.parse((await AsyncStorage.getItem(LAST_PLAYED_STORAGE_KEY)) ?? 'null');

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('lastPlayed', () => {
  it('a record of a started story round-trips with its meta, account and time, without the voice model', async () => {
    const record = lastPlayedFrom(meta, 'u-1', 1_700_000_000_000);

    await writeLastPlayed(record);
    const back = await readLastPlayed('u-1');

    expect(back).toMatchObject({
      narrationId: 'narr-1',
      storyId: 'story-123',
      voiceProfileId: 'voice-123',
      story: meta.story,
      narratorName: 'Babamın Sesi',
      ownVoice: true,
      // The story's 5 minutes win over the backend's stored 240 s (NL-04).
      estimateMs: 300000,
      userId: 'u-1',
      updatedAt: 1_700_000_000_000,
    });
    expect(back?.voiceProfile).toBeNull();
    expect((await stored()).voiceProfile).toBeNull();
    // The card can hand it straight to startNarration as a meta.
    expect(back?.story.title).toBe(meta.story.title);
  });

  it('a v1 record parses into the current shape with updatedAt 0', async () => {
    await AsyncStorage.setItem(LAST_PLAYED_STORAGE_KEY, JSON.stringify(V1));

    const back = await readLastPlayed('u-1');

    expect(back).toEqual({
      narrationId: 'nar-9',
      storyId: 's-9',
      voiceProfileId: null,
      story: {
        id: 's-9',
        title: 'Karga ile Testi',
        coverImageUrl: null,
        translationGroupId: 'tg-9',
        category: null,
      },
      voiceProfile: null,
      narratorName: 'Kerem',
      ownVoice: false,
      estimateMs: 240000,
      userId: 'u-1',
      updatedAt: 0,
      // The v1 mirrors the old mini player still reads.
      title: 'Karga ile Testi',
      coverImageUrl: null,
      translationGroupId: 'tg-9',
      durationMs: 240000,
    });
  });

  it('a v1 record written by the old mini player is stored in the current shape', async () => {
    jest.setSystemTime(new Date('2026-10-19T20:00:00Z'));

    await writeLastPlayed(V1);

    const raw = await stored();
    expect(raw.story).toEqual(expect.objectContaining({ id: 's-9', title: 'Karga ile Testi' }));
    expect(raw.updatedAt).toBe(Date.parse('2026-10-19T20:00:00Z'));
    expect(raw).toMatchObject(V1);
  });

  it('does not show one account the record of another', async () => {
    await writeLastPlayed(lastPlayedFrom(meta, 'u-1'));

    await expect(readLastPlayed('u-2')).resolves.toBeNull();
    await expect(readLastPlayed(null)).resolves.toBeNull();
  });

  it('treats malformed and incomplete records as absent', async () => {
    await expect(readLastPlayed('u-1')).resolves.toBeNull();
    await AsyncStorage.setItem(LAST_PLAYED_STORAGE_KEY, '{not json');
    await expect(readLastPlayed('u-1')).resolves.toBeNull();

    expect(parseLastPlayed(null)).toBeNull();
    expect(parseLastPlayed({ narrationId: 'n', storyId: 's' })).toBeNull();
    // A current-shape record without a title is nothing a card could show.
    expect(parseLastPlayed({ narrationId: 'n', storyId: 's', story: { id: 's' } })).toBeNull();
    expect(parseLastPlayed({ ...V1, updatedAt: 'later', durationMs: 'x' })).toMatchObject({
      updatedAt: 0,
      estimateMs: 0,
    });
  });

  it('clearLastPlayed removes the key', async () => {
    await writeLastPlayed(lastPlayedFrom(meta, 'u-1'));
    expect(await AsyncStorage.getItem(LAST_PLAYED_STORAGE_KEY)).not.toBeNull();

    await clearLastPlayed();

    expect(await AsyncStorage.getItem(LAST_PLAYED_STORAGE_KEY)).toBeNull();
    await expect(readLastPlayed('u-1')).resolves.toBeNull();
  });

  it('storage errors never throw', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk'));
    jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValueOnce(new Error('disk'));

    await expect(writeLastPlayed(lastPlayedFrom(meta, 'u-1'))).resolves.toBeUndefined();
    await expect(clearLastPlayed()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(2);
  });
});
