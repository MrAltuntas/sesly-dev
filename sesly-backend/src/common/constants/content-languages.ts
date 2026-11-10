/**
 * Languages a story (or collection) can be written in. Content language is
 * independent of the UI / error-message language (i18n.* settings): clients
 * pass it as an explicit `language` query parameter, never Accept-Language.
 *
 * Every language here is supported by both TTS providers (Google Cloud TTS
 * and Cartesia Sonic 3). Which of them are offered to clients is the
 * `content.enabledLanguages` runtime setting.
 *
 * No imports on purpose: prisma/seed-stories.ts loads this through ts-node.
 */
export interface ContentLanguage {
  /** ISO 639-1 code, lower case. */
  code: string;
  nativeName: string;
  englishName: string;
  /**
   * Narration pace in words per minute, used to estimate a story's duration
   * from its word count. Agglutinative languages (Turkish) and languages
   * with long compounds (German, Russian) carry more per word, so fewer
   * words fit in a minute at the same calm storytelling pace.
   */
  wordsPerMinute: number;
}

export const CONTENT_LANGUAGES: readonly ContentLanguage[] = [
  { code: 'tr', nativeName: 'Türkçe', englishName: 'Turkish', wordsPerMinute: 150 },
  { code: 'en', nativeName: 'English', englishName: 'English', wordsPerMinute: 165 },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German', wordsPerMinute: 140 },
  { code: 'fr', nativeName: 'Français', englishName: 'French', wordsPerMinute: 170 },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish', wordsPerMinute: 170 },
  { code: 'it', nativeName: 'Italiano', englishName: 'Italian', wordsPerMinute: 160 },
  { code: 'nl', nativeName: 'Nederlands', englishName: 'Dutch', wordsPerMinute: 160 },
  { code: 'pt', nativeName: 'Português', englishName: 'Portuguese', wordsPerMinute: 160 },
  { code: 'ar', nativeName: 'العربية', englishName: 'Arabic', wordsPerMinute: 130 },
  { code: 'ru', nativeName: 'Русский', englishName: 'Russian', wordsPerMinute: 140 },
];

export const CONTENT_LANGUAGE_CODES: readonly string[] = CONTENT_LANGUAGES.map((l) => l.code);

/** Language of every story that existed before the catalogue became multi-language. */
export const DEFAULT_CONTENT_LANGUAGE = 'tr';

/** Pace used for a language that is not in the table (should not happen). */
export const DEFAULT_WORDS_PER_MINUTE = 150;

const BY_CODE = new Map<string, ContentLanguage>(CONTENT_LANGUAGES.map((l) => [l.code, l]));

export function isContentLanguage(value: unknown): value is string {
  return typeof value === 'string' && BY_CODE.has(value);
}

export function getContentLanguage(code: string): ContentLanguage | undefined {
  return BY_CODE.get(code);
}

/**
 * Estimated narration length in whole minutes (minimum 1) for a text in the
 * given language.
 */
export function estimateDurationMinutes(content: string, language?: string | null): number {
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
  const wpm = (language && BY_CODE.get(language)?.wordsPerMinute) || DEFAULT_WORDS_PER_MINUTE;
  return Math.max(1, Math.ceil(wordCount / wpm));
}

/** Validation message shared by every DTO that takes a content language. */
/**
 * i18n key, served per Accept-Language by HttpExceptionFilter. The text lists
 * CONTENT_LANGUAGE_CODES (a spec keeps it in step).
 */
export const CONTENT_LANGUAGE_MESSAGE = 'errors.validation.contentLanguage';

/**
 * Turkish names of the content languages, for Turkish user-facing messages
 * ("Bu masal İngilizce."). Kept out of ContentLanguage so the shapes served
 * to clients do not change.
 */
export const CONTENT_LANGUAGE_TURKISH_NAMES: Readonly<Record<string, string>> = {
  tr: 'Türkçe',
  en: 'İngilizce',
  de: 'Almanca',
  fr: 'Fransızca',
  es: 'İspanyolca',
  it: 'İtalyanca',
  nl: 'Felemenkçe',
  pt: 'Portekizce',
  ar: 'Arapça',
  ru: 'Rusça',
};

/** Turkish name of a language code; the code itself (in quotes) when unknown. */
export function turkishLanguageName(code: string): string {
  return CONTENT_LANGUAGE_TURKISH_NAMES[code] ?? `"${code}"`;
}

/**
 * Name of a language code in every UI language (`{ tr: 'İngilizce', en:
 * 'English' }`), for message placeholders. Unknown code: the code in quotes.
 */
export function localizedLanguageName(code: string): { tr: string; en: string } {
  const english = getContentLanguage(code)?.englishName;
  return { tr: turkishLanguageName(code), en: english ?? `"${code}"` };
}
