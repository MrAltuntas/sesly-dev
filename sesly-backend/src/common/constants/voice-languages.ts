/**
 * Languages a user can clone a voice in ("the language I will speak in the
 * recording"). The reading script, the consent text, the Cartesia clone
 * language and the accent label all follow this choice.
 *
 * Adding a language:
 *   1. add an entry here (code, locale, names, Cartesia accent label),
 *   2. add its texts to CLONE_LANGUAGE_CONTENT in
 *      modules/voice-profiles/clone-config.constants.ts (does not compile
 *      without them),
 *   3. have the consent text reviewed, then switch the language on in the
 *      `tts.cloneLanguages` runtime setting.
 *
 * No imports on purpose, same as content-languages.ts.
 */
export const VOICE_LANGUAGES = [
  {
    code: 'tr',
    locale: 'tr-TR',
    nativeName: 'Türkçe',
    englishName: 'Turkish',
    turkishName: 'Türkçe',
    cartesiaAccent: 'istanbul',
  },
  {
    code: 'en',
    locale: 'en-US',
    nativeName: 'English',
    englishName: 'English',
    turkishName: 'İngilizce',
    cartesiaAccent: 'general-american',
  },
] as const;

export type VoiceLanguageCode = (typeof VOICE_LANGUAGES)[number]['code'];

export interface VoiceLanguage {
  /** ISO 639-1 code, the same vocabulary as `story.language`. */
  code: VoiceLanguageCode;
  /** BCP-47 tag stored on `VoiceProfile.language` for a clone. */
  locale: string;
  nativeName: string;
  englishName: string;
  turkishName: string;
  /**
   * Accent id Cartesia's POST /voices/clone accepts as optional `accent`
   * metadata for this language (GET /accents). Cartesia requires it on the
   * clone before further accents can be added to the voice.
   */
  cartesiaAccent: string;
}

export const VOICE_LANGUAGE_CODES: readonly VoiceLanguageCode[] = VOICE_LANGUAGES.map((l) => l.code);

/** Language of every clone made before the language became a choice. */
export const DEFAULT_VOICE_LANGUAGE: VoiceLanguageCode = 'tr';

const BY_CODE = new Map<string, VoiceLanguage>(VOICE_LANGUAGES.map((l) => [l.code, l]));

/**
 * Lower-case ISO 639 code of a language value: "tr-TR", "tr_TR", "TR" and
 * "tr" are all "tr". Null when the value does not start with a language code.
 */
export function languageCodeOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^([A-Za-z]{2,3})(?:[-_]|$)/.exec(value.trim());
  return match ? match[1].toLowerCase() : null;
}

/** The voice language a code or locale ("en", "en-US", "en-GB") belongs to, or null. */
export function findVoiceLanguage(value: unknown): VoiceLanguage | null {
  const code = languageCodeOf(value);
  return (code && BY_CODE.get(code)) || null;
}

export function isVoiceLanguage(value: unknown): boolean {
  return findVoiceLanguage(value) !== null;
}

/**
 * Validation message of the create DTOs: an i18n key, served per
 * Accept-Language by HttpExceptionFilter. The text lists VOICE_LANGUAGE_CODES
 * (a spec keeps it in step).
 */
export const VOICE_LANGUAGE_MESSAGE = 'errors.validation.voiceLanguage';
