import { CONTENT_LANGUAGES, DEFAULT_CONTENT_LANGUAGE } from './content-languages';

/**
 * The ready-made narrator catalogue: Google Chirp 3 HD voices only.
 *
 * Static on purpose. The list used to come from a live `listVoices` call
 * with a hard-coded fallback, so a slow or failing Google answer changed the
 * catalogue (and made every Chirp voice id fail validation). The 30 voice
 * names and their genders are the same in every locale Chirp 3 HD serves in
 * full; a voice id is `<locale>-Chirp3-HD-<Name>`.
 *
 * Standard and WaveNet voices are no longer offered. Profiles that pointed
 * at them were remapped by migration 20261014120000_chirp3_hd_preset_voices.
 *
 * Relative import only: prisma/seed.ts loads this file through ts-node.
 */
export type PresetVoiceGender = 'female' | 'male';

export const CHIRP3_HD_VOICES: ReadonlyArray<{ name: string; gender: PresetVoiceGender }> = [
  { name: 'Achernar', gender: 'female' },
  { name: 'Achird', gender: 'male' },
  { name: 'Algenib', gender: 'male' },
  { name: 'Algieba', gender: 'male' },
  { name: 'Alnilam', gender: 'male' },
  { name: 'Aoede', gender: 'female' },
  { name: 'Autonoe', gender: 'female' },
  { name: 'Callirrhoe', gender: 'female' },
  { name: 'Charon', gender: 'male' },
  { name: 'Despina', gender: 'female' },
  { name: 'Enceladus', gender: 'male' },
  { name: 'Erinome', gender: 'female' },
  { name: 'Fenrir', gender: 'male' },
  { name: 'Gacrux', gender: 'female' },
  { name: 'Iapetus', gender: 'male' },
  { name: 'Kore', gender: 'female' },
  { name: 'Laomedeia', gender: 'female' },
  { name: 'Leda', gender: 'female' },
  { name: 'Orus', gender: 'male' },
  { name: 'Puck', gender: 'male' },
  { name: 'Pulcherrima', gender: 'female' },
  { name: 'Rasalgethi', gender: 'male' },
  { name: 'Sadachbia', gender: 'male' },
  { name: 'Sadaltager', gender: 'male' },
  { name: 'Schedar', gender: 'male' },
  { name: 'Sulafat', gender: 'female' },
  { name: 'Umbriel', gender: 'male' },
  { name: 'Vindemiatrix', gender: 'female' },
  { name: 'Zephyr', gender: 'female' },
  { name: 'Zubenelgenubi', gender: 'male' },
];

/**
 * Content language code -> the Google locale its ready-made voices use.
 * Every locale here was checked against Google's voice list on 2026-10-13
 * and serves all 30 Chirp 3 HD voices. Russian (ru-RU) is left out: Google
 * serves only 8 of the 30 there.
 */
export const PRESET_VOICE_LOCALES: Readonly<Record<string, string>> = {
  tr: 'tr-TR',
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  it: 'it-IT',
  nl: 'nl-NL',
  pt: 'pt-BR',
  ar: 'ar-XA',
};

/** Short line a ready-made voice reads as its preview, in its own language. */
export const PRESET_PREVIEW_TEXTS: Readonly<Record<string, string>> = {
  tr: 'Merhaba, ben senin ses profilin. Böyle konuşuyorum.',
  en: 'Hello, I am your narrator. This is how I sound when I read a story.',
  de: 'Hallo, ich bin deine Erzählstimme. So klinge ich, wenn ich eine Geschichte vorlese.',
  fr: 'Bonjour, je suis ta voix de narration. Voici comment je lis une histoire.',
  es: 'Hola, soy tu voz narradora. Así sueno cuando leo un cuento.',
  it: 'Ciao, sono la tua voce narrante. Ecco come suono quando leggo una storia.',
  nl: 'Hallo, ik ben je vertelstem. Zo klink ik als ik een verhaal voorlees.',
  pt: 'Olá, eu sou a sua voz narradora. É assim que eu soo quando leio uma história.',
  ar: 'مرحباً، أنا الراوي. هكذا يبدو صوتي عندما أقرأ قصة.',
};

const GENDER_DESCRIPTIONS_TR: Record<PresetVoiceGender, string> = {
  female: 'Kadın anlatıcı sesi',
  male: 'Erkek anlatıcı sesi',
};

export interface PresetVoice {
  /** Provider voice id, "tr-TR-Chirp3-HD-Achernar". */
  id: string;
  /** Display name: the bare voice name, "Achernar". */
  name: string;
  /** English name of the language ("Turkish"), kept for older app builds. */
  language: string;
  /** Google locale, "tr-TR". */
  languageCode: string;
  /** Content language code the voice can narrate, "tr". Matches `story.language`. */
  contentLanguage: string;
  gender: PresetVoiceGender;
  description: string;
}

const CHIRP3_HD_MARKER = '-Chirp3-HD-';
const ENGLISH_NAMES = new Map(CONTENT_LANGUAGES.map((l) => [l.code, l.englishName]));
const LANGUAGE_BY_LOCALE = new Map(
  Object.entries(PRESET_VOICE_LOCALES).map(([code, locale]) => [locale, code]),
);
const VOICE_BY_NAME = new Map(CHIRP3_HD_VOICES.map((v) => [v.name, v]));

function buildVoice(
  contentLanguage: string,
  locale: string,
  voice: { name: string; gender: PresetVoiceGender },
): PresetVoice {
  return {
    id: `${locale}${CHIRP3_HD_MARKER}${voice.name}`,
    name: voice.name,
    language: ENGLISH_NAMES.get(contentLanguage) as string,
    languageCode: locale,
    contentLanguage,
    gender: voice.gender,
    description: GENDER_DESCRIPTIONS_TR[voice.gender],
  };
}

/** Content languages that have ready-made voices, in catalogue order. */
export const PRESET_VOICE_LANGUAGES: readonly string[] = CONTENT_LANGUAGES.map((l) => l.code).filter(
  (code) => code in PRESET_VOICE_LOCALES,
);

/** True when the content language has ready-made voices. */
export function hasPresetVoices(contentLanguage: string): boolean {
  return PRESET_VOICE_LANGUAGES.includes(contentLanguage);
}

/**
 * The 30 ready-made voices of one content language ("tr"), in catalogue
 * order. Empty for a language without Chirp 3 HD voices.
 */
export function listPresetVoices(contentLanguage: string = DEFAULT_CONTENT_LANGUAGE): PresetVoice[] {
  if (!hasPresetVoices(contentLanguage)) return [];
  const locale = PRESET_VOICE_LOCALES[contentLanguage];
  return CHIRP3_HD_VOICES.map((voice) => buildVoice(contentLanguage, locale, voice));
}

/**
 * Looks a voice id up in the catalogue. Null for anything that is not a
 * Chirp 3 HD voice of a supported locale (Standard, WaveNet, another
 * provider's id, an unknown name).
 */
export function findPresetVoice(voiceId: string | null | undefined): PresetVoice | null {
  if (typeof voiceId !== 'string') return null;
  const at = voiceId.indexOf(CHIRP3_HD_MARKER);
  if (at <= 0) return null;
  const locale = voiceId.slice(0, at);
  const contentLanguage = LANGUAGE_BY_LOCALE.get(locale);
  const voice = VOICE_BY_NAME.get(voiceId.slice(at + CHIRP3_HD_MARKER.length));
  if (!contentLanguage || !voice) return null;
  return buildVoice(contentLanguage, locale, voice);
}

/**
 * The voice of the SAME NAME in another content language:
 * ("tr-TR-Chirp3-HD-Achernar", "en") is "en-US-Chirp3-HD-Achernar".
 *
 * A Google voice id is bound to its locale: the Turkish Achernar reads an
 * English text with Turkish pronunciation rules. The 30 Chirp 3 HD names
 * exist in every catalogue locale, so the narrator the user picked can read
 * a story of another language natively through its sibling.
 *
 * Null when the id is not a catalogue voice or the language has no
 * ready-made voices (Russian); the voice itself when the language is its own.
 */
export function presetVoiceInLanguage(
  voiceId: string | null | undefined,
  contentLanguage: string | null | undefined,
): PresetVoice | null {
  const voice = findPresetVoice(voiceId);
  if (!voice || !contentLanguage) return null;
  if (voice.contentLanguage === contentLanguage) return voice;
  if (!hasPresetVoices(contentLanguage)) return null;
  return buildVoice(contentLanguage, PRESET_VOICE_LOCALES[contentLanguage], {
    name: voice.name,
    gender: voice.gender,
  });
}

/** Preview line for a ready-made voice, in the language the voice speaks. */
export function presetPreviewText(voiceId: string): string {
  const language = findPresetVoice(voiceId)?.contentLanguage ?? DEFAULT_CONTENT_LANGUAGE;
  return PRESET_PREVIEW_TEXTS[language];
}
