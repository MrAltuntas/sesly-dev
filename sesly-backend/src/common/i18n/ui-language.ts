/**
 * UI language of the app: the language of every text the server writes for
 * a user (error messages, push notifications, stored failure messages).
 * Not the content language of the story catalogue (see content-languages.ts).
 *
 * No imports on purpose, so constants and pure helpers can use it freely.
 */
export const UI_LANGUAGES = ['tr', 'en'] as const;

export type UiLanguage = (typeof UI_LANGUAGES)[number];

/** Language of server-initiated text when nothing better is known. */
export const DEFAULT_UI_LANGUAGE: UiLanguage = 'tr';

/**
 * A UI language from a code or locale: "en", "EN", "en-US", "en_GB" are all
 * "en". Null for anything else (unknown language, empty, not a string).
 */
export function parseUiLanguage(value: unknown): UiLanguage | null {
  if (typeof value !== 'string') return null;
  const match = /^([A-Za-z]{2,3})(?:[-_][A-Za-z0-9-_]*)?$/.exec(value.trim());
  if (!match) return null;
  const code = match[1].toLowerCase();
  return (UI_LANGUAGES as readonly string[]).includes(code) ? (code as UiLanguage) : null;
}

/**
 * UI language named by an Accept-Language header: its first entry only
 * ("en-US,en;q=0.9" is "en"). The app sends a single tag, its UI language.
 * Null when the header is missing, "*" or a language without UI texts.
 */
export function uiLanguageFromAcceptLanguage(header: unknown): UiLanguage | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string') return null;
  const first = raw.split(',')[0]?.split(';')[0]?.trim();
  return parseUiLanguage(first);
}

/** Stored language, else the default (Turkish). */
export function uiLanguageOrDefault(value: unknown): UiLanguage {
  return parseUiLanguage(value) ?? DEFAULT_UI_LANGUAGE;
}
