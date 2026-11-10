/**
 * Messages that stores, services and helpers produce outside React
 * (snackbars, dialog texts, error messages kept on a store).
 *
 * They live in the `messages` namespace. Resolve a message at the moment it
 * is shown, never at module scope: a constant would freeze the language the
 * app started in.
 */

import i18n from './index';

export function msg(key: string, params?: Record<string, unknown>): string {
  return i18n.t(`messages:${key}`, params);
}
