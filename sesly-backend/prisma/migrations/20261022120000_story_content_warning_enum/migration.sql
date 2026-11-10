-- Story content warnings become an English enum (like every other story
-- enum); the app and the panel show translated labels. Safe on a table with
-- data: every stored value is converted with the mapping below (an old
-- Turkish key, or already the new name), repeats are dropped and the order
-- follows the enum. A value outside the mapping stops the migration with an
-- error naming it (nothing is dropped silently); fix those rows first.
--
-- Check before deploying (must return no rows):
--   SELECT DISTINCT v FROM "stories", unnest("contentWarnings") AS v
--   WHERE v IS NULL OR v NOT IN ('korkutucu', 'siddet', 'olum', 'uzucu-son',
--     'kotu-ornek', 'eski-dil', 'yalniz-ayrilik', 'SCARY', 'VIOLENCE', 'DEATH',
--     'SAD_ENDING', 'BAD_EXAMPLE', 'OLD_LANGUAGE', 'LONELINESS');
--
-- Mapping: korkutucu SCARY, siddet VIOLENCE, olum DEATH, uzucu-son SAD_ENDING,
-- kotu-ornek BAD_EXAMPLE, eski-dil OLD_LANGUAGE, yalniz-ayrilik LONELINESS.
-- Covered by test/content-warning-migration.e2e-spec.ts.

-- CreateEnum
CREATE TYPE "ContentWarning" AS ENUM ('SCARY', 'VIOLENCE', 'DEATH', 'SAD_ENDING', 'BAD_EXAMPLE', 'OLD_LANGUAGE', 'LONELINESS');

-- Refuse values outside the mapping.
DO $$
DECLARE
  unknown_values TEXT;
BEGIN
  SELECT string_agg(DISTINCT COALESCE(quote_literal(v), 'NULL'), ', ')
  INTO unknown_values
  FROM "stories", unnest("contentWarnings") AS v
  WHERE v IS NULL OR v NOT IN (
    'korkutucu', 'siddet', 'olum', 'uzucu-son', 'kotu-ornek', 'eski-dil', 'yalniz-ayrilik',
    'SCARY', 'VIOLENCE', 'DEATH', 'SAD_ENDING', 'BAD_EXAMPLE', 'OLD_LANGUAGE', 'LONELINESS'
  );
  IF unknown_values IS NOT NULL THEN
    RAISE EXCEPTION 'stories.contentWarnings holds values outside the content warning mapping: %', unknown_values;
  END IF;
END $$;

-- Convert the stored values.
UPDATE "stories" AS s
SET "contentWarnings" = ARRAY(
  SELECT m."value"
  FROM (
    VALUES
      ('korkutucu', 'SCARY', 1), ('SCARY', 'SCARY', 1),
      ('siddet', 'VIOLENCE', 2), ('VIOLENCE', 'VIOLENCE', 2),
      ('olum', 'DEATH', 3), ('DEATH', 'DEATH', 3),
      ('uzucu-son', 'SAD_ENDING', 4), ('SAD_ENDING', 'SAD_ENDING', 4),
      ('kotu-ornek', 'BAD_EXAMPLE', 5), ('BAD_EXAMPLE', 'BAD_EXAMPLE', 5),
      ('eski-dil', 'OLD_LANGUAGE', 6), ('OLD_LANGUAGE', 'OLD_LANGUAGE', 6),
      ('yalniz-ayrilik', 'LONELINESS', 7), ('LONELINESS', 'LONELINESS', 7)
  ) AS m("old", "value", "position")
  WHERE m."old" = ANY (s."contentWarnings")
  GROUP BY m."value", m."position"
  ORDER BY m."position"
)
WHERE cardinality(s."contentWarnings") > 0;

UPDATE "stories" SET "contentWarnings" = ARRAY[]::TEXT[] WHERE "contentWarnings" IS NULL;

-- AlterTable
ALTER TABLE "stories" ALTER COLUMN "contentWarnings" DROP DEFAULT;
ALTER TABLE "stories" ALTER COLUMN "contentWarnings" SET DATA TYPE "ContentWarning"[] USING ("contentWarnings"::TEXT::"ContentWarning"[]);
ALTER TABLE "stories" ALTER COLUMN "contentWarnings" SET DEFAULT ARRAY[]::"ContentWarning"[];
