import { Prisma } from '@prisma/client';

/**
 * Turkish-aware, accent- and case-insensitive text search.
 *
 * Postgres ILIKE (Prisma `mode: 'insensitive'`) does not fold ı/İ, ş, ğ, ü,
 * ö or ç, so "yildiz", "YILDIZ" and "kucuk" never found "Küçük Yıldız".
 * Both sides of every comparison go through the SQL function
 * `sesly_search_fold()` (migration 20261020120000_story_search_fold): NFD,
 * combining accents removed, ı and I mapped to i, lower-cased. Doing it in
 * SQL for the term as well keeps one definition of the fold.
 *
 * `stories."searchText"` is a generated column holding the folded title and
 * content, so the catalogue search reads it instead of folding every story
 * on every request. Narration search folds the (short) titles inline; it is
 * always scoped to one user.
 *
 * The term is always a bound parameter, never spliced into the SQL text.
 */

/** Trimmed search term, or null when nothing is left to search for. */
export function normalizeSearchTerm(raw: string | null | undefined): string | null {
  const term = (raw ?? '').trim();
  return term.length > 0 ? term : null;
}

/**
 * Escapes the LIKE wildcards (and the escape character itself) so the
 * user's text is matched literally: "100%" must not match "100 masal".
 * Postgres uses backslash as the default LIKE escape character.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** `'%' || sesly_search_fold($term) || '%'`: a folded "contains" pattern. */
export function foldedContainsPattern(term: string): Prisma.Sql {
  return Prisma.sql`('%' || sesly_search_fold(${escapeLikePattern(term)}) || '%')`;
}

/**
 * Ids of the published stories whose title or content contains the term.
 * The caller intersects them with its own scope (language, chosen version,
 * level, plan), so pagination and filters stay in the Prisma query.
 */
export function storySearchIdsQuery(term: string): Prisma.Sql {
  return Prisma.sql`
    SELECT s."id"
    FROM "stories" s
    WHERE s."status" = 'PUBLISHED'
      AND s."searchText" LIKE ${foldedContainsPattern(term)}`;
}

/**
 * Ids of the user's narrations whose own title or story title contains the
 * term. A narration without a title (null) is matched by its story title.
 */
export function narrationSearchIdsQuery(userId: string, term: string): Prisma.Sql {
  const pattern = foldedContainsPattern(term);
  return Prisma.sql`
    SELECT n."id"
    FROM "story_narrations" n
    JOIN "stories" s ON s."id" = n."storyId"
    WHERE n."userId" = ${userId}
      AND (sesly_search_fold(n."title") LIKE ${pattern}
        OR sesly_search_fold(s."title") LIKE ${pattern})`;
}
