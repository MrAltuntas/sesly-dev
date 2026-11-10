-- Read-only look at the catalogue per content language: how many stories each
-- language has in each status, which Turkish tales have no English version,
-- English stories without a cover or segments, collections per language, and
-- the content.* settings. Writes nothing. Run on the server:
--   docker exec -i <postgres container> psql -U <db user> -d <db name> < content-languages.sql
\pset pager off
\set ON_ERROR_STOP on

\echo '== 1. Stories per language and status'
SELECT language, status, count(*) AS stories
FROM stories
GROUP BY language, status
ORDER BY language, status;

\echo '== 2. content.* settings overridden in the panel (no row = the env / code default: only tr)'
SELECT key, value, "updatedAt"
FROM system_settings
WHERE key LIKE 'content.%' OR key LIKE 'tts.clone%'
ORDER BY key;

\echo '== 3. Published Turkish stories with no English version in any status'
SELECT t.title, t."partNumber"
FROM stories t
WHERE t.language = 'tr'
  AND t.status = 'PUBLISHED'
  AND NOT EXISTS (
    SELECT 1 FROM stories e
    WHERE e.language = 'en'
      AND t."translationGroupId" IS NOT NULL
      AND e."translationGroupId" = t."translationGroupId"
  )
ORDER BY t.title;

\echo '== 4. English stories whose Turkish pair is published but which are not'
SELECT e.title, e.status, e."partNumber"
FROM stories e
JOIN stories t
  ON t."translationGroupId" = e."translationGroupId"
 AND t.language = 'tr'
 AND t.status = 'PUBLISHED'
WHERE e.language = 'en'
  AND e.status <> 'PUBLISHED'
ORDER BY e.title;

\echo '== 5. English stories without their own cover (they borrow the Turkish one when grouped)'
SELECT status, count(*) AS stories
FROM stories
WHERE language = 'en' AND "coverImageUrl" IS NULL
GROUP BY status;

\echo '== 6. Collections per language'
SELECT language, count(*) AS collections
FROM collections
GROUP BY language
ORDER BY language;
