/**
 * URL slug helpers for stories. No imports on purpose (also loaded by the
 * CLI seeder through ts-node).
 */

/** Letters that Unicode decomposition does not reduce to a plain ASCII letter. */
const SPECIAL_LETTERS: Record<string, string> = {
  ı: 'i',
  İ: 'i',
  ß: 'ss',
  æ: 'ae',
  Æ: 'ae',
  œ: 'oe',
  Œ: 'oe',
  ø: 'o',
  Ø: 'o',
  đ: 'd',
  Đ: 'd',
  ł: 'l',
  Ł: 'l',
  þ: 'th',
  Þ: 'th',
};

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 80;
/** Slug of a title that has no Latin letter or digit at all (Arabic, Cyrillic). */
export const SLUG_FALLBACK = 'masal';

/**
 * Turkish-aware slug: "Çğ İIıiöşü" becomes "cg-iiiiosu". The dotted and
 * dotless i are mapped before lower-casing, because the default lower-case
 * of "İ" is "i" + a combining dot and of "I" is "i" (wrong for Turkish, but
 * the ASCII result is the same, which is what a slug needs).
 */
export function slugify(input: string, maxLength: number = SLUG_MAX_LENGTH): string {
  const mapped = Array.from(input ?? '')
    .map((ch) => SPECIAL_LETTERS[ch] ?? ch)
    .join('');

  const slug = mapped
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) return SLUG_FALLBACK;
  return slug.length > maxLength ? slug.slice(0, maxLength).replace(/-+$/g, '') : slug;
}

/**
 * First free slug among `base`, `base-2`, `base-3`, ... `isTaken` answers for
 * one candidate.
 */
export async function findFreeSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  if (!(await isTaken(base))) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
}
