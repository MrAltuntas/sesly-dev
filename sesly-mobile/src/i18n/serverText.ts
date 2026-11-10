/**
 * Sentences the backend writes itself (a slot limit, a quota): it sends the
 * request's Accept-Language (the UI language) and is moving to localised
 * sentences, but older builds and some paths answer in Turkish whatever was
 * asked. A sentence is shown only when it is in the UI language; otherwise
 * the caller's own copy is used.
 *
 * Only the two UI languages exist, so "in the UI language" is decided by
 * the Turkish letters: a Turkish UI shows any sentence (the backend's own
 * language), an English UI only one without ç ğ ı İ ö ş ü.
 *
 * Not for raw error bodies (validation messages are English and technical):
 * ApiError keeps its own rule.
 */

import i18n from './index';
import { resolveUiLanguage } from './language';

const TURKISH_LETTERS = /[çğıİöşüÇĞÖŞÜ]/;

/** Whether a sentence is written in Turkish (it carries a Turkish letter). */
export function looksTurkish(text: string): boolean {
  return TURKISH_LETTERS.test(text);
}

/** The backend's sentence when it is in the UI language, else null. */
export function serverTextInUiLanguage(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  if (resolveUiLanguage(i18n.language) === 'tr') return trimmed;
  return looksTurkish(trimmed) ? null : trimmed;
}
