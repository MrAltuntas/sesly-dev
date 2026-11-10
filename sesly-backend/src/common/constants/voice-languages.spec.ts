import { serverText } from '../i18n/server-text';
import {
  DEFAULT_VOICE_LANGUAGE,
  VOICE_LANGUAGES,
  VOICE_LANGUAGE_CODES,
  VOICE_LANGUAGE_MESSAGE,
  findVoiceLanguage,
  isVoiceLanguage,
  languageCodeOf,
} from './voice-languages';
import { isContentLanguage } from './content-languages';

describe('voice languages', () => {
  it('offers Turkish and English, Turkish first and as the default', () => {
    expect(VOICE_LANGUAGE_CODES).toEqual(['tr', 'en']);
    expect(DEFAULT_VOICE_LANGUAGE).toBe('tr');
    expect(VOICE_LANGUAGES.map((l) => l.nativeName)).toEqual(['Türkçe', 'English']);
    expect(VOICE_LANGUAGES.map((l) => l.locale)).toEqual(['tr-TR', 'en-US']);
  });

  it('every voice language is a content language with a locale of its own code', () => {
    for (const language of VOICE_LANGUAGES) {
      expect(isContentLanguage(language.code)).toBe(true);
      expect(language.locale.startsWith(`${language.code}-`)).toBe(true);
      expect(language.englishName.length).toBeGreaterThan(0);
      expect(language.turkishName.length).toBeGreaterThan(0);
    }
  });

  it('carries the accent label Cartesia files each language under', () => {
    expect(findVoiceLanguage('tr')?.cartesiaAccent).toBe('istanbul');
    expect(findVoiceLanguage('en')?.cartesiaAccent).toBe('general-american');
    for (const language of VOICE_LANGUAGES) {
      // Cartesia accent ids are lower-case words joined by hyphens.
      expect(language.cartesiaAccent).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it.each([
    ['tr', 'tr'],
    ['TR', 'tr'],
    ['tr-TR', 'tr'],
    ['tr_TR', 'tr'],
    [' en-US ', 'en'],
    ['en-GB', 'en'],
    ['cmn-CN', 'cmn'],
  ])('languageCodeOf(%p) is %p', (value, expected) => {
    expect(languageCodeOf(value)).toBe(expected);
  });

  it.each(['', 'turkish', 'a0e99841-438c', '12', null, undefined, 42, {}])(
    'languageCodeOf(%p) is null',
    (value) => {
      expect(languageCodeOf(value)).toBeNull();
    },
  );

  it('finds a voice language by code or locale and rejects everything else', () => {
    expect(findVoiceLanguage('en-GB')?.code).toBe('en');
    expect(findVoiceLanguage('tr-TR')?.locale).toBe('tr-TR');
    expect(findVoiceLanguage('de')).toBeNull();
    expect(findVoiceLanguage(undefined)).toBeNull();
    expect(isVoiceLanguage('EN')).toBe(true);
    expect(isVoiceLanguage('de-DE')).toBe(false);
    expect(isVoiceLanguage(null)).toBe(false);
  });

  it('the validation message is an i18n key whose texts name the codes', () => {
    expect(VOICE_LANGUAGE_MESSAGE).toBe('errors.validation.voiceLanguage');
    expect(serverText(VOICE_LANGUAGE_MESSAGE, 'tr')).toBe(
      `Geçersiz ses dili. Geçerli diller: ${VOICE_LANGUAGE_CODES.join(', ')}.`,
    );
    expect(serverText(VOICE_LANGUAGE_MESSAGE, 'en')).toBe(
      `Invalid voice language. Valid languages: ${VOICE_LANGUAGE_CODES.join(', ')}.`,
    );
  });
});
