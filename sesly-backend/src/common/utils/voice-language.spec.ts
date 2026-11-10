import {
  describeNarrationLanguage,
  isLanguageBoundVoice,
  resolveSynthesisVoiceId,
  voiceContentLanguage,
  voiceLanguageCode,
} from './voice-language';
import {
  CONTENT_LANGUAGE_CODES,
  CONTENT_LANGUAGE_TURKISH_NAMES,
  turkishLanguageName,
} from '../constants/content-languages';
import { PRESET_VOICE_LANGUAGES, PRESET_VOICE_LOCALES } from '../constants/google-preset-voices';

const preset = (over: Record<string, any> = {}) => ({
  provider: 'GOOGLE',
  kind: 'PRESET',
  voiceId: 'tr-TR-Chirp3-HD-Achernar',
  language: 'tr-TR',
  ...over,
});

const clone = (over: Record<string, any> = {}) => ({
  provider: 'CARTESIA',
  kind: 'CLONE',
  voiceId: 'a0e99841-438c-4a64-b679-ae501e7d6091',
  language: 'tr-TR',
  ...over,
});

describe('voice language helpers', () => {
  it('every content language has a Turkish name', () => {
    for (const code of CONTENT_LANGUAGE_CODES) {
      expect(CONTENT_LANGUAGE_TURKISH_NAMES[code]).toBeTruthy();
    }
    expect(turkishLanguageName('en')).toBe('İngilizce');
    expect(turkishLanguageName('xx')).toBe('"xx"');
  });

  it('only a Google preset is bound to a language', () => {
    expect(isLanguageBoundVoice(preset())).toBe(true);
    expect(isLanguageBoundVoice(preset({ kind: undefined }))).toBe(true);
    expect(isLanguageBoundVoice(preset({ kind: 'CLONE' }))).toBe(false);
    expect(isLanguageBoundVoice(clone())).toBe(false);
    expect(isLanguageBoundVoice(clone({ kind: 'PRESET' }))).toBe(false);
  });

  it.each([
    ['tr-TR-Wavenet-A', 'xx-XX', 'tr'],
    ['en-US-Chirp3-HD-Aoede', 'tr-TR', 'en'],
    ['cmn-CN-Wavenet-A', 'tr-TR', 'cmn'],
    ['some-opaque-id', 'de-DE', 'de'],
    ['', 'EN', 'en'],
    [null, 'fr_FR', 'fr'],
  ])('voice id %p with profile language %p speaks %p', (voiceId, language, expected) => {
    expect(voiceLanguageCode({ voiceId, language })).toBe(expected);
  });

  it('the language is unknown when neither the id nor the profile says', () => {
    expect(voiceLanguageCode({ voiceId: 'opaque', language: '' })).toBeNull();
    expect(voiceLanguageCode({})).toBeNull();
  });

  describe('voiceContentLanguage (the contentLanguage of every profile response)', () => {
    it('a ready-made voice: the language of the voice id wins over the stored locale', () => {
      expect(voiceContentLanguage(preset())).toBe('tr');
      expect(voiceContentLanguage(preset({ voiceId: 'en-US-Chirp3-HD-Aoede', language: 'tr-TR' }))).toBe('en');
      expect(voiceContentLanguage(preset({ voiceId: 'opaque', language: 'de-DE' }))).toBe('de');
    });

    it('a clone: the language the user chose, never the opaque provider id', () => {
      expect(voiceContentLanguage(clone())).toBe('tr');
      expect(voiceContentLanguage(clone({ language: 'en-US' }))).toBe('en');
      // Rows written by app builds that sent the bare code.
      expect(voiceContentLanguage(clone({ language: 'tr' }))).toBe('tr');
      // A provider id that happens to look like a locale is not read.
      expect(voiceContentLanguage(clone({ voiceId: 'de-DE-looks-like-a-locale', language: 'en-US' }))).toBe('en');
    });

    it('a profile that says nothing is Turkish', () => {
      expect(voiceContentLanguage(clone({ language: '' }))).toBe('tr');
      expect(voiceContentLanguage(preset({ voiceId: 'opaque', language: null }))).toBe('tr');
      expect(voiceContentLanguage({})).toBe('tr');
    });
  });

  describe('resolveSynthesisVoiceId', () => {
    it('a ready-made voice reads a story of another language with the voice of the same name', () => {
      expect(resolveSynthesisVoiceId(preset(), 'en')).toBe('en-US-Chirp3-HD-Achernar');
      expect(resolveSynthesisVoiceId(preset({ voiceId: 'en-US-Chirp3-HD-Puck' }), 'tr')).toBe(
        'tr-TR-Chirp3-HD-Puck',
      );
    });

    it('every language with ready-made voices has the sibling', () => {
      for (const language of PRESET_VOICE_LANGUAGES) {
        expect(resolveSynthesisVoiceId(preset(), language)).toBe(
          `${PRESET_VOICE_LOCALES[language]}-Chirp3-HD-Achernar`,
        );
      }
    });

    it('keeps the own voice for its own language, in any spelling', () => {
      expect(resolveSynthesisVoiceId(preset(), 'tr')).toBe('tr-TR-Chirp3-HD-Achernar');
      expect(resolveSynthesisVoiceId(preset(), 'TR')).toBe('tr-TR-Chirp3-HD-Achernar');
      expect(resolveSynthesisVoiceId(preset(), 'tr-TR')).toBe('tr-TR-Chirp3-HD-Achernar');
    });

    it('falls back to the own voice when the language has no ready-made voices or is unknown', () => {
      expect(resolveSynthesisVoiceId(preset(), 'ru')).toBe('tr-TR-Chirp3-HD-Achernar');
      expect(resolveSynthesisVoiceId(preset(), undefined)).toBe('tr-TR-Chirp3-HD-Achernar');
      expect(resolveSynthesisVoiceId(preset(), null)).toBe('tr-TR-Chirp3-HD-Achernar');
      expect(resolveSynthesisVoiceId(preset(), '')).toBe('tr-TR-Chirp3-HD-Achernar');
    });

    it('a Google voice outside the catalogue is never swapped', () => {
      expect(resolveSynthesisVoiceId(preset({ voiceId: 'tr-TR-Wavenet-A' }), 'en')).toBe('tr-TR-Wavenet-A');
    });

    it('a clone always keeps its own id', () => {
      for (const language of CONTENT_LANGUAGE_CODES) {
        expect(resolveSynthesisVoiceId(clone(), language)).toBe('a0e99841-438c-4a64-b679-ae501e7d6091');
      }
    });
  });

  describe('describeNarrationLanguage', () => {
    it('same language: no mismatch', () => {
      expect(describeNarrationLanguage(preset(), { language: 'tr' })).toEqual({
        voiceLanguage: 'tr',
        storyLanguage: 'tr',
        languageMismatch: false,
        nativeVoiceUsed: false,
      });
      expect(describeNarrationLanguage(clone({ language: 'en-US' }), { language: 'EN' })).toEqual({
        voiceLanguage: 'en',
        storyLanguage: 'en',
        languageMismatch: false,
        nativeVoiceUsed: false,
      });
    });

    it('a ready-made voice of another language: mismatch, read natively by its sibling', () => {
      expect(describeNarrationLanguage(preset(), { language: 'en' })).toEqual({
        voiceLanguage: 'tr',
        storyLanguage: 'en',
        languageMismatch: true,
        nativeVoiceUsed: true,
      });
    });

    it('a ready-made voice on a language without ready-made voices: mismatch, own voice', () => {
      expect(describeNarrationLanguage(preset(), { language: 'ru' })).toEqual({
        voiceLanguage: 'tr',
        storyLanguage: 'ru',
        languageMismatch: true,
        nativeVoiceUsed: false,
      });
    });

    it('a clone of another language: mismatch, accented (never a native voice)', () => {
      for (const language of CONTENT_LANGUAGE_CODES.filter((code) => code !== 'tr')) {
        expect(describeNarrationLanguage(clone(), { language })).toEqual({
          voiceLanguage: 'tr',
          storyLanguage: language,
          languageMismatch: true,
          nativeVoiceUsed: false,
        });
      }
    });

    it('a story without a language is Turkish, as every story once was', () => {
      expect(describeNarrationLanguage(preset(), {})).toMatchObject({
        storyLanguage: 'tr',
        languageMismatch: false,
      });
      expect(describeNarrationLanguage(clone({ language: 'en-US' }), { language: null })).toMatchObject({
        storyLanguage: 'tr',
        languageMismatch: true,
      });
    });
  });
});
