/**
 * Content warnings: the values of the backend enum, the labels next to the
 * age group and the note before listening (both UI languages), plus the
 * story fields that carry them and the tale's placeholder key.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '../i18n';
import {
  CONTENT_WARNINGS,
  contentNoteText,
  contentWarningLabel,
  parseContentWarnings,
} from './contentWarnings';
import { parseStoryDetailFromJSON, parseStoryFromJSON } from './Story';
import { coverSeedKey } from '../components/design/covers';
import { parseNarrationMeta, playerStoryOf, storableMeta } from '../stores/narrationMeta';
import {
  CONTENT_NOTICE_LIMIT,
  CONTENT_NOTICE_STORAGE_KEY,
  resetContentNoticeForTests,
  takeContentNotice,
} from '../utils/contentNotice';

const base = {
  id: 's-1',
  title: 'Kurt ile Yedi Keçi',
  ageGroup: 'THREE_TO_SIX',
  category: 'WORLD_CLASSICS',
  estimatedDuration: 6,
  isPremium: false,
  isFavorite: false,
};

afterEach(async () => {
  await i18n.changeLanguage('tr');
});

describe('content warnings', () => {
  it('the values match the backend enum and every value has a label and a sentence in both languages', async () => {
    expect(CONTENT_WARNINGS).toEqual(['SCARY', 'VIOLENCE', 'DEATH', 'SAD_ENDING', 'BAD_EXAMPLE', 'OLD_LANGUAGE', 'LONELINESS']);
    for (const lang of ['tr', 'en']) {
      await i18n.changeLanguage(lang);
      for (const key of CONTENT_WARNINGS) {
        expect(i18n.exists(`story:contentWarning.label.${key}`)).toBe(true);
        expect(i18n.exists(`story:contentWarning.sentence.${key}`)).toBe(true);
      }
    }
    await i18n.changeLanguage('tr');
    expect(contentWarningLabel('OLD_LANGUAGE')).toBe('Eski dil / ağır anlatım');
  });

  it('parse keeps known values once, in enum order, and ignores anything else', () => {
    expect(parseContentWarnings(['DEATH', 'SCARY', 'DEATH', 'zombi', 3])).toEqual(['SCARY', 'DEATH']);
    // The old Turkish keys and other spellings are unknown values now.
    expect(parseContentWarnings(['korkutucu', 'uzucu-son', 'scary', 'LONELINESS'])).toEqual(['LONELINESS']);
    expect(contentNoteText('SIX_TO_TEN', ['korkutucu'])).toBe('');
    expect(parseContentWarnings('SCARY')).toEqual([]);
    expect(parseContentWarnings(undefined)).toEqual([]);
  });

  it('the note before listening: the age group, then one sentence per warning', async () => {
    expect(contentNoteText('SIX_TO_TEN', ['SCARY'])).toBe('6-10 yaş için. Korkutucu bir sahne içeriyor.');
    expect(contentNoteText('ALL_AGES', ['SAD_ENDING', 'DEATH'])).toBe(
      'Her yaş için. Ölümden söz ediyor. Üzücü bir sonu var.',
    );
    expect(contentNoteText(null, ['VIOLENCE'])).toBe('Şiddet içeriyor.');
    expect(contentNoteText('THREE_TO_SIX', [])).toBe('');
    expect(contentNoteText('THREE_TO_SIX', null)).toBe('');
    await i18n.changeLanguage('en');
    expect(contentNoteText('SIX_TO_TEN', ['SCARY'])).toBe('For ages 6-10. It has a scary scene.');
  });

  it('stories carry the warnings and the cover key; an older backend sends neither', () => {
    const story = parseStoryFromJSON({ ...base, contentWarnings: ['SAD_ENDING', 'SCARY'], coverKey: 'abc123' });
    expect(story.contentWarnings).toEqual(['SCARY', 'SAD_ENDING']);
    expect(story.coverKey).toBe('abc123');
    const older = parseStoryFromJSON(base);
    expect(older.contentWarnings).toEqual([]);
    expect(older.coverKey).toBeNull();
    expect(parseStoryDetailFromJSON({ ...base, contentWarnings: ['DEATH'] }).contentWarnings).toEqual(['DEATH']);
  });

  it('the placeholder key: the tale key of the API first, then the translation group, then the story', () => {
    expect(coverSeedKey({ id: 's', translationGroupId: 'g', coverKey: 'k' })).toBe('k');
    expect(coverSeedKey({ id: 's', translationGroupId: 'g', coverKey: null })).toBe('g');
    expect(coverSeedKey({ id: 's' })).toBe('s');
  });

  it('the player story keeps warnings, age group and cover key only when there are any, and they survive storage', () => {
    expect(playerStoryOf({ id: 's', title: 'T' })).toEqual({
      id: 's',
      title: 'T',
      coverImageUrl: null,
      translationGroupId: null,
      category: null,
    });
    const story = playerStoryOf({
      id: 's',
      title: 'T',
      ageGroup: 'THREE_TO_SIX',
      contentWarnings: ['SCARY', 'x'],
      coverKey: 'k',
    });
    expect(story).toMatchObject({ ageGroup: 'THREE_TO_SIX', contentWarnings: ['SCARY'], coverKey: 'k' });
    expect(playerStoryOf({ id: 's', ageGroup: 'THREE_TO_SIX', contentWarnings: [] })).not.toHaveProperty('ageGroup');

    const stored = JSON.parse(
      JSON.stringify(
        storableMeta({
          narrationId: 'n',
          storyId: 's',
          voiceProfileId: null,
          story,
          voiceProfile: null,
          narratorName: null,
          ownVoice: false,
          estimateMs: 0,
        }),
      ),
    );
    expect(parseNarrationMeta(stored)?.story).toEqual(story);
  });
});

/** Lets the fire-and-forget storage write land (the suite may run on fake timers). */
async function flushStorage() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('content notice (once per narration)', () => {
  beforeEach(async () => {
    resetContentNoticeForTests();
    await AsyncStorage.clear();
  });

  it('is taken the first time only, also after a restart', async () => {
    await expect(takeContentNotice('n-1')).resolves.toBe(true);
    await expect(takeContentNotice('n-1')).resolves.toBe(false);
    await expect(takeContentNotice('n-2')).resolves.toBe(true);
    await expect(takeContentNotice('')).resolves.toBe(false);
    await flushStorage();
    resetContentNoticeForTests();
    await expect(takeContentNotice('n-1')).resolves.toBe(false);
  });

  it('keeps the newest entries; broken storage only means the note may show again', async () => {
    await AsyncStorage.setItem(
      CONTENT_NOTICE_STORAGE_KEY,
      JSON.stringify(Array.from({ length: CONTENT_NOTICE_LIMIT }, (_, i) => `old-${i}`)),
    );
    await takeContentNotice('fresh');
    await flushStorage();
    const kept = JSON.parse((await AsyncStorage.getItem(CONTENT_NOTICE_STORAGE_KEY)) ?? '[]');
    expect(kept).toHaveLength(CONTENT_NOTICE_LIMIT);
    expect(kept[kept.length - 1]).toBe('fresh');
    expect(kept).not.toContain('old-0');

    resetContentNoticeForTests();
    await AsyncStorage.setItem(CONTENT_NOTICE_STORAGE_KEY, '{not json');
    await expect(takeContentNotice('n-x')).resolves.toBe(true);
    resetContentNoticeForTests();
    await AsyncStorage.setItem(CONTENT_NOTICE_STORAGE_KEY, '{"a":1}');
    await expect(takeContentNotice('n-y')).resolves.toBe(true);
  });
});
