
/**
 * Query helpers shared by the public catalogue (GET /stories) and the admin
 * story list (GET /admin/stories). Kept out of the *.dto.ts files so they
 * are unit tested (DTO files are excluded from coverage).
 */

/** Sort orders of a story list. Absent means newest first. */
export const STORY_SORTS = ['newest', 'oldest', 'title', 'duration', 'level'] as const;
export type StorySort = (typeof STORY_SORTS)[number];

/**
 * Validation messages: i18n keys, served per Accept-Language by
 * HttpExceptionFilter. The texts list the valid values (a spec keeps them in
 * step with LanguageLevel and STORY_SORTS).
 */
export const LANGUAGE_LEVEL_MESSAGE = 'errors.validation.languageLevel';
export const STORY_SORT_MESSAGE = 'errors.validation.storySort';

/** "tr-TR" / " TR " become "tr". A blank value means "not sent". Non-strings are left for the validator. */
export function normaliseLanguageParam(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  return trimmed.toLowerCase().split(/[-_]/)[0];
}

/**
 * One or several content languages: `?language=tr`, `?language=tr,en` or
 * `?language=tr&language=en`. Each code is normalised like a single one,
 * duplicates are removed. Returns undefined when nothing usable was sent.
 */
export function parseLanguageList(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  const parts = (Array.isArray(value) ? value : [value]).flatMap((item) =>
    typeof item === 'string' ? item.split(',') : [item],
  );
  const cleaned = parts.map((item) => normaliseLanguageParam(item)).filter((item) => item !== undefined);
  if (cleaned.length === 0) return undefined;
  return [...new Set(cleaned)];
}

/** "true" / "false" of a query string as booleans; anything else is left for the validator. */
export function parseBooleanParam(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const cleaned = value.trim().toLowerCase();
  if (cleaned === '') return undefined;
  if (cleaned === 'true') return true;
  if (cleaned === 'false') return false;
  return value;
}

/**
 * One or several levels: `?languageLevel=A1`, `?languageLevel=A1,A2` or
 * `?languageLevel=A1&languageLevel=A2`. Case-insensitive, duplicates removed.
 * Returns undefined when nothing usable was sent.
 */
export function parseLanguageLevels(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  const parts = (Array.isArray(value) ? value : [value]).flatMap((item) =>
    typeof item === 'string' ? item.split(',') : [item],
  );
  const cleaned = parts
    .map((item) => (typeof item === 'string' ? item.trim().toUpperCase() : item))
    .filter((item) => item !== '');
  if (cleaned.length === 0) return undefined;
  return [...new Set(cleaned)];
}

type SortDirection = 'asc' | 'desc';
export type StoryOrderBy = Array<Record<string, SortDirection | { sort: SortDirection; nulls: 'first' | 'last' }>>;

/**
 * Prisma orderBy for a sort key. Absent keeps the order every list had
 * before sorting existed (newest first), so old clients see no change.
 * Every other order ends with createdAt so pages are stable.
 */
export function storyOrderBy(sort?: StorySort): StoryOrderBy {
  switch (sort) {
    case 'oldest':
      return [{ createdAt: 'asc' }];
    case 'title':
      return [{ title: 'asc' }, { createdAt: 'desc' }];
    case 'duration':
      return [{ estimatedDuration: 'asc' }, { createdAt: 'desc' }];
    case 'level':
      // Enum order in PostgreSQL is declaration order (A1..C2); stories
      // without a level go last.
      return [{ languageLevel: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }];
    case 'newest':
    default:
      return [{ createdAt: 'desc' }];
  }
}
