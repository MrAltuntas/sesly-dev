/**
 * Text helpers that depend on the UI language.
 */

import i18n from './index';
import type { UiLanguage } from './language';

/**
 * Uppercase for labels (React Native's `textTransform: 'uppercase'` and
 * `String.prototype.toUpperCase` are not locale aware on Hermes).
 *
 * Turkish: "i" becomes "İ" and "ı" becomes "I" ("bildirimler" becomes
 * "BİLDİRİMLER"). Every other language uses the plain mapping, so English
 * is not corrupted ("library" becomes "LIBRARY", never "LİBRARY").
 */
export function upperCaseFor(language: string, value: string): string {
  if (language === 'tr') {
    return value.replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase();
  }
  return value.toUpperCase();
}

export function currentLanguage(): UiLanguage {
  return i18n.language === 'en' ? 'en' : 'tr';
}

/** `upperCaseFor` with the current UI language. */
export function upper(value: string): string {
  return upperCaseFor(currentLanguage(), value);
}

/** First letter of a name for an avatar, uppercased for the UI language. */
export function initialOf(name: string | null | undefined, fallback = 'S'): string {
  const first = name?.trim()?.[0];
  return first ? upper(first) : fallback;
}

/**
 * Two-letter marker for a content language as the language codes marker
 * shows it ("tr" becomes "TR"). Codes are ASCII identifiers, not words, so
 * no Turkish casing here ("it" must be "IT").
 */
export function languageCodeLabel(code: string): string {
  return code.trim().slice(0, 2).toUpperCase();
}
