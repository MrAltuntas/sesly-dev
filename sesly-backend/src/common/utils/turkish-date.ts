const TURKISH_MONTHS = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];

/**
 * "1 Kasım" style date for user-facing Turkish messages (renewal dates of
 * the monthly allowances). Uses the same server-local calendar the usage
 * counters use, so the date shown is the date the counter flips.
 */
export function formatTurkishDate(date: Date): string {
  return `${date.getDate()} ${TURKISH_MONTHS[date.getMonth()]}`;
}

const ENGLISH_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "November 1" style date, same server-local calendar as formatTurkishDate. */
export function formatEnglishDate(date: Date): string {
  return `${ENGLISH_MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** Day and month in the given UI language ("1 Kasım" / "November 1"); Turkish for any other. */
export function formatUiDate(date: Date, language: string): string {
  return language === 'en' ? formatEnglishDate(date) : formatTurkishDate(date);
}
