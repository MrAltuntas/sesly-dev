/**
 * Relative time labels of the notification list, in Turkish and English.
 */

import i18n from './index';
import { formatRelativeTime, relativeTimeKey, relativeTimeParts } from './relativeTime';

const NOW = new Date('2026-10-13T21:42:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('relativeTimeParts', () => {
  it('picks the largest whole unit', () => {
    expect(relativeTimeParts(ago(20_000), NOW)).toEqual({ unit: 'now', value: 0 });
    expect(relativeTimeParts(ago(5 * MIN + 30_000), NOW)).toEqual({ unit: 'minutes', value: 5 });
    expect(relativeTimeParts(ago(59 * MIN), NOW)).toEqual({ unit: 'minutes', value: 59 });
    expect(relativeTimeParts(ago(2 * HOUR), NOW)).toEqual({ unit: 'hours', value: 2 });
    expect(relativeTimeParts(ago(23 * HOUR), NOW)).toEqual({ unit: 'hours', value: 23 });
    expect(relativeTimeParts(ago(DAY), NOW)).toEqual({ unit: 'days', value: 1 });
    expect(relativeTimeParts(ago(6 * DAY), NOW)).toEqual({ unit: 'days', value: 6 });
    expect(relativeTimeParts(ago(7 * DAY), NOW)).toEqual({ unit: 'weeks', value: 1 });
    expect(relativeTimeParts(ago(29 * DAY), NOW)).toEqual({ unit: 'weeks', value: 4 });
    expect(relativeTimeParts(ago(30 * DAY), NOW)).toEqual({ unit: 'months', value: 1 });
    expect(relativeTimeParts(ago(200 * DAY), NOW)).toEqual({ unit: 'months', value: 6 });
    expect(relativeTimeParts(ago(365 * DAY), NOW)).toEqual({ unit: 'years', value: 1 });
    expect(relativeTimeParts(ago(800 * DAY), NOW)).toEqual({ unit: 'years', value: 2 });
  });

  it('reads a future date as now and rejects an invalid one', () => {
    expect(relativeTimeParts(ago(-5 * MIN), NOW)).toEqual({ unit: 'now', value: 0 });
    expect(relativeTimeParts(new Date('nope'), NOW)).toBeNull();
    expect(relativeTimeParts(NOW, new Date('nope'))).toBeNull();
  });

  it('uses the singular key for one day, week, month and year', () => {
    expect(relativeTimeKey({ unit: 'days', value: 1 })).toBe('day');
    expect(relativeTimeKey({ unit: 'days', value: 3 })).toBe('days');
    expect(relativeTimeKey({ unit: 'weeks', value: 1 })).toBe('week');
    expect(relativeTimeKey({ unit: 'weeks', value: 2 })).toBe('weeks');
    expect(relativeTimeKey({ unit: 'months', value: 1 })).toBe('month');
    expect(relativeTimeKey({ unit: 'months', value: 4 })).toBe('months');
    expect(relativeTimeKey({ unit: 'years', value: 1 })).toBe('year');
    expect(relativeTimeKey({ unit: 'years', value: 2 })).toBe('years');
    expect(relativeTimeKey({ unit: 'now', value: 0 })).toBe('now');
    expect(relativeTimeKey({ unit: 'minutes', value: 1 })).toBe('minutes');
    expect(relativeTimeKey({ unit: 'hours', value: 1 })).toBe('hours');
  });
});

describe('formatRelativeTime', () => {
  it('writes the mockup labels in Turkish', () => {
    expect(formatRelativeTime(ago(10_000), NOW)).toBe('şimdi');
    expect(formatRelativeTime(ago(5 * MIN), NOW)).toBe('5 dk önce');
    expect(formatRelativeTime(ago(2 * HOUR), NOW)).toBe('2 sa önce');
    expect(formatRelativeTime(ago(DAY), NOW)).toBe('1 gün önce');
    expect(formatRelativeTime(ago(3 * DAY), NOW)).toBe('3 gün önce');
    expect(formatRelativeTime(ago(7 * DAY), NOW)).toBe('1 hafta önce');
    expect(formatRelativeTime(ago(21 * DAY), NOW)).toBe('3 hafta önce');
    expect(formatRelativeTime(ago(40 * DAY), NOW)).toBe('1 ay önce');
    expect(formatRelativeTime(ago(400 * DAY), NOW)).toBe('1 yıl önce');
  });

  it('writes English labels', async () => {
    await i18n.changeLanguage('en');
    expect(formatRelativeTime(ago(10_000), NOW)).toBe('now');
    expect(formatRelativeTime(ago(5 * MIN), NOW)).toBe('5 min ago');
    expect(formatRelativeTime(ago(2 * HOUR), NOW)).toBe('2 hr ago');
    expect(formatRelativeTime(ago(DAY), NOW)).toBe('1 day ago');
    expect(formatRelativeTime(ago(3 * DAY), NOW)).toBe('3 days ago');
    expect(formatRelativeTime(ago(7 * DAY), NOW)).toBe('1 week ago');
    expect(formatRelativeTime(ago(70 * DAY), NOW)).toBe('2 months ago');
    expect(formatRelativeTime(ago(800 * DAY), NOW)).toBe('2 years ago');
  });

  it('returns an empty label for an invalid date and defaults to the current time', () => {
    expect(formatRelativeTime(new Date('nope'), NOW)).toBe('');
    expect(formatRelativeTime(new Date())).toBe('şimdi');
  });
});
