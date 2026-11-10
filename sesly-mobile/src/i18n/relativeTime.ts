/**
 * Relative time for lists ("5 dk önce", "2 sa önce", "1 gün önce",
 * "1 hafta önce"). Pure: the caller passes both dates. No Intl (Hermes does
 * not ship RelativeTimeFormat); the words live in `notifications:time.*`.
 */

import i18n from './index';

export type RelativeTimeUnit = 'now' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years';

export interface RelativeTimeParts {
  unit: RelativeTimeUnit;
  /** Whole units elapsed; 0 for 'now'. */
  value: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Which unit and how many. A date in the future (clock skew between the
 * phone and the server) reads as "now". Null for an invalid date.
 */
export function relativeTimeParts(date: Date, now: Date): RelativeTimeParts | null {
  const then = date.getTime();
  const reference = now.getTime();
  if (Number.isNaN(then) || Number.isNaN(reference)) return null;
  const diff = Math.max(0, reference - then);

  const minutes = Math.floor(diff / MINUTE);
  if (minutes < 1) return { unit: 'now', value: 0 };
  if (minutes < 60) return { unit: 'minutes', value: minutes };
  const hours = Math.floor(diff / HOUR);
  if (hours < 24) return { unit: 'hours', value: hours };
  const days = Math.floor(diff / DAY);
  if (days < 7) return { unit: 'days', value: days };
  if (days < 30) return { unit: 'weeks', value: Math.floor(days / 7) };
  if (days < 365) return { unit: 'months', value: Math.floor(days / 30) };
  return { unit: 'years', value: Math.floor(days / 365) };
}

/** Translation key (inside `notifications:time`) for the parts. */
export function relativeTimeKey(parts: RelativeTimeParts): string {
  switch (parts.unit) {
    case 'now':
      return 'now';
    case 'minutes':
      return 'minutes';
    case 'hours':
      return 'hours';
    case 'days':
      return parts.value === 1 ? 'day' : 'days';
    case 'weeks':
      return parts.value === 1 ? 'week' : 'weeks';
    case 'months':
      return parts.value === 1 ? 'month' : 'months';
    case 'years':
    default:
      return parts.value === 1 ? 'year' : 'years';
  }
}

/** The label in the current UI language; '' for an invalid date. */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const parts = relativeTimeParts(date, now);
  if (!parts) return '';
  return i18n.t(`notifications:time.${relativeTimeKey(parts)}`, { value: parts.value });
}
