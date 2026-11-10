import { serverText } from '../i18n/server-text';
import {
  CONTENT_LANGUAGES,
  CONTENT_LANGUAGE_CODES,
  CONTENT_LANGUAGE_MESSAGE,
  DEFAULT_CONTENT_LANGUAGE,
  DEFAULT_WORDS_PER_MINUTE,
  estimateDurationMinutes,
  getContentLanguage,
  isContentLanguage,
  localizedLanguageName,
} from './content-languages';
import {
  AGE_GROUP_LABELS,
  LANGUAGE_LEVEL_LABELS,
  LANGUAGE_LEVEL_SOURCE_LABELS,
  STORY_CATEGORY_LABELS,
  STORY_ORIGIN_LABELS,
  STORY_RIGHTS_BASIS_LABELS,
  STORY_SORT_LABELS,
  STORY_STATUS_LABELS,
  STORY_TEXT_FIDELITY_LABELS,
  TRANSLATION_METHOD_LABELS,
  toEnumOptions,
} from './story-labels';
import {
  AgeGroup,
  LanguageLevel,
  LanguageLevelSource,
  StoryCategory,
  StoryOrigin,
  StoryRightsBasis,
  StoryStatus,
  StoryTextFidelity,
  TranslationMethod,
} from '../enums/prisma.enums';
import * as client from '@prisma/client';

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

describe('CONTENT_LANGUAGES', () => {
  it('lists the ten languages both TTS providers support, Turkish first', () => {
    expect(CONTENT_LANGUAGE_CODES).toEqual(['tr', 'en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'ar', 'ru']);
    expect(DEFAULT_CONTENT_LANGUAGE).toBe('tr');
  });

  it('every language has a native name, an English name and a narration pace', () => {
    for (const language of CONTENT_LANGUAGES) {
      expect(language.code).toMatch(/^[a-z]{2}$/);
      expect(language.nativeName.length).toBeGreaterThan(0);
      expect(language.englishName.length).toBeGreaterThan(0);
      expect(language.wordsPerMinute).toBeGreaterThanOrEqual(100);
      expect(language.wordsPerMinute).toBeLessThanOrEqual(200);
    }
    expect(getContentLanguage('tr')).toMatchObject({ nativeName: 'Türkçe', englishName: 'Turkish' });
    expect(getContentLanguage('de')).toMatchObject({ nativeName: 'Deutsch', englishName: 'German' });
    expect(getContentLanguage('xx')).toBeUndefined();
  });

  it('isContentLanguage accepts only listed codes', () => {
    expect(isContentLanguage('tr')).toBe(true);
    expect(isContentLanguage('ru')).toBe(true);
    expect(isContentLanguage('TR')).toBe(false);
    expect(isContentLanguage('tr-TR')).toBe(false);
    expect(isContentLanguage('da')).toBe(false);
    expect(isContentLanguage(undefined)).toBe(false);
    expect(isContentLanguage(5)).toBe(false);
  });

  it('the validation message is an i18n key whose texts name every valid code', () => {
    expect(CONTENT_LANGUAGE_MESSAGE).toBe('errors.validation.contentLanguage');
    expect(serverText(CONTENT_LANGUAGE_MESSAGE, 'tr')).toBe(
      `Geçersiz içerik dili. Geçerli diller: ${CONTENT_LANGUAGE_CODES.join(', ')}.`,
    );
    expect(serverText(CONTENT_LANGUAGE_MESSAGE, 'en')).toBe(
      `Invalid content language. Valid languages: ${CONTENT_LANGUAGE_CODES.join(', ')}.`,
    );
  });

  it('localizedLanguageName names a language in every UI language', () => {
    expect(localizedLanguageName('en')).toEqual({ tr: 'İngilizce', en: 'English' });
    expect(localizedLanguageName('xx')).toEqual({ tr: '"xx"', en: '"xx"' });
  });
});

describe('estimateDurationMinutes', () => {
  it('keeps the historic Turkish figure (150 words per minute)', () => {
    expect(estimateDurationMinutes(words(150), 'tr')).toBe(1);
    expect(estimateDurationMinutes(words(151), 'tr')).toBe(2);
    expect(estimateDurationMinutes(words(450), 'tr')).toBe(3);
  });

  it('uses the pace of the language: the same text is shorter in English, longer in Arabic', () => {
    const text = words(1650);
    expect(estimateDurationMinutes(text, 'tr')).toBe(11);
    expect(estimateDurationMinutes(text, 'en')).toBe(10);
    expect(estimateDurationMinutes(text, 'ar')).toBe(13);
    expect(estimateDurationMinutes(text, 'de')).toBe(12);
  });

  it('is at least one minute and ignores extra whitespace', () => {
    expect(estimateDurationMinutes('', 'tr')).toBe(1);
    expect(estimateDurationMinutes('   tek   kelime \n ', 'en')).toBe(1);
  });

  it('falls back to the default pace for a missing or unknown language', () => {
    expect(DEFAULT_WORDS_PER_MINUTE).toBe(150);
    expect(estimateDurationMinutes(words(300))).toBe(2);
    expect(estimateDurationMinutes(words(300), null)).toBe(2);
    expect(estimateDurationMinutes(words(300), 'xx')).toBe(2);
  });
});

describe('story enum mirrors and labels', () => {
  const NO_GLYPH = /^[\p{L}\p{N} ,.()\-]+$/u;

  it.each([
    ['StoryStatus', StoryStatus, STORY_STATUS_LABELS],
    ['StoryOrigin', StoryOrigin, STORY_ORIGIN_LABELS],
    ['StoryTextFidelity', StoryTextFidelity, STORY_TEXT_FIDELITY_LABELS],
    ['StoryRightsBasis', StoryRightsBasis, STORY_RIGHTS_BASIS_LABELS],
    ['LanguageLevel', LanguageLevel, LANGUAGE_LEVEL_LABELS],
    ['LanguageLevelSource', LanguageLevelSource, LANGUAGE_LEVEL_SOURCE_LABELS],
    ['TranslationMethod', TranslationMethod, TRANSLATION_METHOD_LABELS],
    ['StoryCategory', StoryCategory, STORY_CATEGORY_LABELS],
    ['AgeGroup', AgeGroup, AGE_GROUP_LABELS],
  ])('%s: the const mirror equals the Prisma enum and every value has a clean Turkish label', (name, mirror, labels) => {
    expect(Object.keys(mirror)).toEqual(Object.values(mirror));
    expect(Object.keys(labels)).toEqual(Object.values(mirror));
    for (const label of Object.values(labels)) {
      expect(label).toMatch(NO_GLYPH);
    }
    expect(name.length).toBeGreaterThan(0);
  });

  it('the const mirrors match the generated Prisma client enums', () => {
    expect(Object.values(StoryStatus)).toEqual(Object.values(client.StoryStatus));
    expect(Object.values(StoryOrigin)).toEqual(Object.values(client.StoryOrigin));
    expect(Object.values(StoryTextFidelity)).toEqual(Object.values(client.StoryTextFidelity));
    expect(Object.values(StoryRightsBasis)).toEqual(Object.values(client.StoryRightsBasis));
    expect(Object.values(LanguageLevel)).toEqual(Object.values(client.LanguageLevel));
    expect(Object.values(LanguageLevelSource)).toEqual(Object.values(client.LanguageLevelSource));
    expect(Object.values(TranslationMethod)).toEqual(Object.values(client.TranslationMethod));
  });

  it('CEFR levels are in order, easiest first', () => {
    expect(Object.values(LanguageLevel)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
  });

  it('toEnumOptions keeps declaration order', () => {
    expect(toEnumOptions(STORY_STATUS_LABELS)).toEqual([
      { value: 'DRAFT', label: 'Taslak' },
      { value: 'PUBLISHED', label: 'Yayında' },
      { value: 'ARCHIVED', label: 'Arşivlendi' },
    ]);
    expect(toEnumOptions(STORY_SORT_LABELS).map((o) => o.value)).toEqual([
      'newest',
      'oldest',
      'title',
      'duration',
      'level',
    ]);
  });
});
