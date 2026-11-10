/**
 * Small helpers shared by the profile and the account deletion screen.
 */

/** Where "Bize ulaşın" and the manual deletion request write to. */
export const SUPPORT_EMAIL = 'info@sesly.io';

export function supportMailUrl(subject?: string): string {
  return subject
    ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
    : `mailto:${SUPPORT_EMAIL}`;
}

/**
 * A byte count for the cache row ("0 B", "12,4 MB"). The decimal mark
 * follows the UI language.
 */
export function formatBytes(bytes: number, language: string): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  const fixed = value.toFixed(index === 0 ? 0 : 1);
  return `${language === 'en' ? fixed : fixed.replace('.', ',')} ${units[index]}`;
}
