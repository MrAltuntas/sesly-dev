/**
 * Cartesia takes ISO 639-1 language codes (`tr`, `en`, ...) for both
 * /voices/clone and /tts/bytes. Sesly stores BCP-47 tags (`tr-TR`) on voice
 * profiles and bare codes (`tr`) on stories, so normalize here.
 */
export const CARTESIA_DEFAULT_LANGUAGE = 'tr';

export function toCartesiaLanguage(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const base = String(candidate).trim().toLowerCase().split(/[-_]/)[0];
    if (/^[a-z]{2}$/.test(base)) {
      return base;
    }
  }
  return CARTESIA_DEFAULT_LANGUAGE;
}
