import { normaliseLanguageParam } from '../stories/story-query.util';
import { parseUiLanguage } from '../../common/i18n/ui-language';

/**
 * Value of `contentLanguage` in PATCH /users/me/preferences: null (and a
 * blank string) clears the preference, "tr-TR" / " EN " become "tr" / "en".
 * Anything else is left for the validator. Kept out of the DTO file so it is
 * unit tested (DTO files are excluded from coverage).
 */
export function normaliseContentLanguagePreference(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return normaliseLanguageParam(value);
}

/**
 * Value of `uiLanguage` in PATCH /users/me/preferences: null (and a blank
 * string) clears it (server text falls back to Turkish), "EN", "en-US" and
 * "tr_TR" become "en" / "tr". Anything else is left for the validator.
 */
export function normaliseUiLanguagePreference(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return parseUiLanguage(value) ?? value;
}
