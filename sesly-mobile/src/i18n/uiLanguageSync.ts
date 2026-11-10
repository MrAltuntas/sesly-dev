/**
 * Tells the backend the UI language of the signed-in account, so its push
 * notifications and e-mails are written in it.
 *
 * Sent once per account and language: when a session starts (sign-in, or a
 * returning user at launch) and whenever the UI language changes while
 * signed in. Always its own PATCH (`UserPreferencesService.syncUiLanguage`):
 * a backend that does not know the field refuses the body with 400, and a
 * failure is ignored without a message or a retry loop (the next launch, the
 * next sign-in or the next language change sends it again).
 *
 * BootStore starts it once the stored UI language is applied, so a launch
 * never sends the device language first and the stored one right after.
 */

import i18n from './index';
import { resolveUiLanguage } from './language';
import userPreferencesService from '../services/UserPreferencesService';
import { getSessionUserId, onSessionUserChange } from '../stores/session';

let stop: (() => void) | null = null;
/** `${userId}:${language}` of the last send, so nothing is sent twice. */
let lastSent: string | null = null;

/** Send the UI language for the signed-in account unless it already was. */
export function syncUiLanguageNow(): void {
  const userId = getSessionUserId();
  if (!userId) return;
  const language = resolveUiLanguage(i18n.language);
  const key = `${userId}:${language}`;
  if (key === lastSent) return;
  lastSent = key;
  void Promise.resolve()
    .then(() => userPreferencesService.syncUiLanguage(language))
    .catch(() => undefined);
}

/** Start following the session and the UI language (idempotent). Returns the stop. */
export function startUiLanguageSync(): () => void {
  if (stop) return stop;
  const onLanguage = () => syncUiLanguageNow();
  i18n.on('languageChanged', onLanguage);
  const offSession = onSessionUserChange(userId => {
    // A new session (or another account) is told again.
    if (!userId) lastSent = null;
    else syncUiLanguageNow();
  });
  syncUiLanguageNow();
  stop = () => {
    i18n.off('languageChanged', onLanguage);
    offSession();
    stop = null;
    lastSent = null;
  };
  return stop;
}
