import {
  CHIRP3_HD_VOICES,
  findPresetVoice,
  hasPresetVoices,
  listPresetVoices,
  PRESET_PREVIEW_TEXTS,
  PRESET_VOICE_LANGUAGES,
  PRESET_VOICE_LOCALES,
  presetPreviewText,
} from './google-preset-voices';
import { CONTENT_LANGUAGE_CODES } from './content-languages';
import { isPremiumVoice } from '../utils/voice-tier';
import { voiceLanguageCode } from '../utils/voice-language';

const FEMALE = [
  'Achernar', 'Aoede', 'Autonoe', 'Callirrhoe', 'Despina', 'Erinome', 'Gacrux',
  'Kore', 'Laomedeia', 'Leda', 'Pulcherrima', 'Sulafat', 'Vindemiatrix', 'Zephyr',
];
const ALL = [
  'Achernar', 'Achird', 'Algenib', 'Algieba', 'Alnilam', 'Aoede', 'Autonoe', 'Callirrhoe',
  'Charon', 'Despina', 'Enceladus', 'Erinome', 'Fenrir', 'Gacrux', 'Iapetus', 'Kore',
  'Laomedeia', 'Leda', 'Orus', 'Puck', 'Pulcherrima', 'Rasalgethi', 'Sadachbia', 'Sadaltager',
  'Schedar', 'Sulafat', 'Umbriel', 'Vindemiatrix', 'Zephyr', 'Zubenelgenubi',
];

// Characters banned from user-facing copy (CLAUDE.md UI text rules).
const FORBIDDEN_UI_CHARS = /[\u2014\u2013\u2026\u2192\u2190\u2022\u00b7\u2605\u2713\u203a\u26a1]|\p{Extended_Pictographic}/u;

describe('google preset voice catalogue', () => {
  it('is exactly the 30 Chirp 3 HD voices with the agreed genders', () => {
    expect(CHIRP3_HD_VOICES.map((v) => v.name)).toEqual(ALL);
    expect(new Set(ALL).size).toBe(30);
    expect(CHIRP3_HD_VOICES.filter((v) => v.gender === 'female').map((v) => v.name)).toEqual(FEMALE);
    expect(CHIRP3_HD_VOICES.filter((v) => v.gender === 'male')).toHaveLength(16);
  });

  it('maps content languages to locales; Russian is left out', () => {
    expect(PRESET_VOICE_LOCALES).toEqual({
      tr: 'tr-TR',
      en: 'en-US',
      de: 'de-DE',
      fr: 'fr-FR',
      es: 'es-ES',
      it: 'it-IT',
      nl: 'nl-NL',
      pt: 'pt-BR',
      ar: 'ar-XA',
    });
    expect(PRESET_VOICE_LANGUAGES).toEqual(['tr', 'en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'ar']);
    expect(PRESET_VOICE_LANGUAGES.every((code) => CONTENT_LANGUAGE_CODES.includes(code))).toBe(true);
    expect(hasPresetVoices('ru')).toBe(false);
    expect(hasPresetVoices('tr')).toBe(true);
  });

  it('lists Turkish by default: id <locale>-Chirp3-HD-<Name>, bare display name', () => {
    const voices = listPresetVoices();
    expect(voices).toHaveLength(30);
    expect(voices[0]).toEqual({
      id: 'tr-TR-Chirp3-HD-Achernar',
      name: 'Achernar',
      language: 'Turkish',
      languageCode: 'tr-TR',
      contentLanguage: 'tr',
      gender: 'female',
      description: 'Kadın anlatıcı sesi',
    });
    for (const voice of voices) {
      expect(voice.id).toBe(`tr-TR-Chirp3-HD-${voice.name}`);
      expect(voice.name).not.toMatch(/Chirp|HD|\(/);
      expect(voice.description).not.toMatch(FORBIDDEN_UI_CHARS);
    }
  });

  it.each(Object.entries(PRESET_VOICE_LOCALES))(
    'language %s lists 30 voices of locale %s that the narration language guard reads back',
    (language, locale) => {
      const voices = listPresetVoices(language);
      expect(voices).toHaveLength(30);
      for (const voice of voices) {
        expect(voice.id.startsWith(`${locale}-Chirp3-HD-`)).toBe(true);
        expect(voice.contentLanguage).toBe(language);
        expect(voiceLanguageCode({ voiceId: voice.id })).toBe(language);
        expect(findPresetVoice(voice.id)).toEqual(voice);
        // Ready-made voices are free for everyone.
        expect(isPremiumVoice({ provider: 'GOOGLE', kind: 'PRESET', voiceId: voice.id })).toBe(false);
      }
    },
  );

  it('a language without ready-made voices lists none', () => {
    expect(listPresetVoices('ru')).toEqual([]);
    expect(listPresetVoices('xx')).toEqual([]);
  });

  it.each([
    'tr-TR-Wavenet-A',
    'tr-TR-Standard-E',
    'tr-TR-Chirp3-HD-Nobody',
    'tr-TR-Chirp3-HD-achernar',
    'tr-TR-Chirp3-HD-',
    'ru-RU-Chirp3-HD-Kore',
    'en-GB-Chirp3-HD-Kore',
    '-Chirp3-HD-Kore',
    'tr-TR-Chirp-HD-F',
    'cartesia-voice-id',
    '',
    null,
    undefined,
  ])('findPresetVoice(%p) is null', (voiceId) => {
    expect(findPresetVoice(voiceId as string)).toBeNull();
  });

  it('previews in the language of the voice, Turkish for anything unknown', () => {
    expect(Object.keys(PRESET_PREVIEW_TEXTS).sort()).toEqual([...PRESET_VOICE_LANGUAGES].sort());
    expect(presetPreviewText('tr-TR-Chirp3-HD-Kore')).toBe(PRESET_PREVIEW_TEXTS.tr);
    expect(presetPreviewText('de-DE-Chirp3-HD-Kore')).toBe(PRESET_PREVIEW_TEXTS.de);
    expect(presetPreviewText('tr-TR-Wavenet-A')).toBe(PRESET_PREVIEW_TEXTS.tr);
    for (const text of Object.values(PRESET_PREVIEW_TEXTS)) {
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(FORBIDDEN_UI_CHARS);
    }
  });
});
