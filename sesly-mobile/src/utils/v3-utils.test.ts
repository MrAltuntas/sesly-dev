/**
 * Pure helpers added with design v3: the remembered last played story and
 * translated story labels. The auth form checks are in authValidation.test.ts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import i18n from '../i18n';
import {
  LAST_PLAYED_STORAGE_KEY,
  LastPlayedV1,
  parseLastPlayed,
  readLastPlayed,
  readSavedPositionMs,
  writeLastPlayed,
} from './lastPlayed';
import {
  storyAgeLabel,
  storyCategoryLabel,
  storyDurationLabel,
  storyMetaLine,
  storyShelfLabel,
} from './storyLabels';

describe('lastPlayed', () => {
  const record: LastPlayedV1 = {
    userId: 'u-1',
    narrationId: 'nar-1',
    storyId: 's-1',
    title: 'Bremen Mızıkacıları',
    coverImageUrl: null,
    translationGroupId: null,
    narratorName: 'Zeynep',
    durationMs: 362000,
  };

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('round-trips a record for the same account', async () => {
    await writeLastPlayed(record);
    await expect(readLastPlayed('u-1')).resolves.toMatchObject(record);
  });

  it('does not show one account the story of another', async () => {
    await writeLastPlayed(record);
    await expect(readLastPlayed('u-2')).resolves.toBeNull();
    await expect(readLastPlayed(null)).resolves.toBeNull();
  });

  it('treats missing, malformed and incomplete data as absent', async () => {
    await expect(readLastPlayed('u-1')).resolves.toBeNull();
    await AsyncStorage.setItem(LAST_PLAYED_STORAGE_KEY, '{not json');
    await expect(readLastPlayed('u-1')).resolves.toBeNull();
    expect(parseLastPlayed(null)).toBeNull();
    expect(parseLastPlayed({ narrationId: 'n', storyId: 's' })).toBeNull();
    expect(parseLastPlayed({ narrationId: 'n', storyId: 's', title: 'T', durationMs: 'x' })).toMatchObject({
      userId: null,
      narrationId: 'n',
      storyId: 's',
      title: 'T',
      coverImageUrl: null,
      translationGroupId: null,
      narratorName: null,
      durationMs: 0,
    });
  });

  it('reads the position the player saved', async () => {
    await expect(readSavedPositionMs('nar-1')).resolves.toBe(0);
    await AsyncStorage.setItem('narration_position:nar-1', '134000');
    await expect(readSavedPositionMs('nar-1')).resolves.toBe(134000);
    await AsyncStorage.setItem('narration_position:nar-1', 'abc');
    await expect(readSavedPositionMs('nar-1')).resolves.toBe(0);
  });

  it('storage errors do not throw', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk'));
    await expect(writeLastPlayed(record)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    await expect(readSavedPositionMs('nar-1')).resolves.toBe(0);
  });
});

describe('storyLabels', () => {
  it('Turkish labels match the mockup copy', () => {
    expect(storyAgeLabel('THREE_TO_SIX')).toBe('3-6 yaş');
    expect(storyAgeLabel('ALL_AGES')).toBe('Her yaş');
    expect(storyCategoryLabel('BEDTIME')).toBe('Uyku masalı');
    expect(storyCategoryLabel('WORLD_CLASSICS')).toBe('Dünya klasiği');
    expect(storyShelfLabel('TURKISH_CLASSICS')).toBe('Türk masalları');
    expect(storyDurationLabel(5)).toBe('5 dk');
    expect(
      storyMetaLine({ category: 'BEDTIME', ageGroup: 'THREE_TO_SIX', estimatedDuration: 5 }, { withCategory: true }),
    ).toBe('Uyku masalı, 3-6 yaş, 5 dk');
    expect(storyMetaLine({ category: 'BEDTIME', ageGroup: 'SIX_TO_TEN', estimatedDuration: 4 })).toBe(
      '6-10 yaş, 4 dk',
    );
  });

  it('English labels are real English', async () => {
    await i18n.changeLanguage('en');
    expect(storyAgeLabel('THREE_TO_SIX')).toBe('Ages 3-6');
    expect(storyCategoryLabel('BEDTIME')).toBe('Bedtime story');
    expect(storyShelfLabel('WORLD_CLASSICS')).toBe('World classics');
    expect(
      storyMetaLine({ category: 'BEDTIME', ageGroup: 'ALL_AGES', estimatedDuration: 12 }, { withCategory: true }),
    ).toBe('Bedtime story, All ages, 12 min');
  });

  it('degrades for unknown or missing values', () => {
    expect(storyAgeLabel('SOMETHING_NEW')).toBe('');
    expect(storyAgeLabel(null)).toBe('');
    expect(storyCategoryLabel('ANATOLIAN_TALES')).toBe('Anatolian tales');
    expect(storyShelfLabel(undefined)).toBe('');
    expect(storyDurationLabel(0)).toBe('');
    expect(storyDurationLabel(NaN)).toBe('');
    expect(storyMetaLine({})).toBe('');
    expect(storyMetaLine({ ageGroup: 'TEN_PLUS' })).toBe('10+ yaş');
  });
});
