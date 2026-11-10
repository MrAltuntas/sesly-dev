-- Multi-language story catalogue: status, slug, attribution, rights audit,
-- translation groups and CEFR language level. Additive only: every new
-- column is nullable or has a default, existing rows stay PUBLISHED.

-- CreateEnum
CREATE TYPE "StoryStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StoryOrigin" AS ENUM ('PUBLIC_DOMAIN', 'FOLK_ANONYMOUS', 'LICENSED', 'ORIGINAL_HUMAN', 'AI_GENERATED');

-- CreateEnum
CREATE TYPE "StoryTextFidelity" AS ENUM ('VERBATIM', 'SPELLING_MODERNISED', 'ABRIDGED', 'RETOLD', 'TRANSLATED');

-- CreateEnum
CREATE TYPE "StoryRightsBasis" AS ENUM ('AUTHOR_LIFE_PLUS_70', 'ANONYMOUS_PUBLICATION_PLUS_70', 'FOLK_NO_AUTHOR', 'CC0', 'CC_BY', 'LICENCE_GRANTED', 'OWNED');

-- CreateEnum
CREATE TYPE "LanguageLevel" AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1', 'C2');

-- CreateEnum
CREATE TYPE "LanguageLevelSource" AS ENUM ('AI', 'MANUAL');

-- CreateEnum
CREATE TYPE "TranslationMethod" AS ENUM ('HUMAN', 'MACHINE');

-- DropIndex
DROP INDEX "collections_slug_key";

-- AlterTable
ALTER TABLE "collections" ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'tr';

-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "adaptedBy" TEXT,
ADD COLUMN     "authorDeathYear" INTEGER,
ADD COLUMN     "authorName" TEXT,
ADD COLUMN     "collectorDeathYear" INTEGER,
ADD COLUMN     "collectorName" TEXT,
ADD COLUMN     "editionYear" INTEGER,
ADD COLUMN     "firstPublishedYear" INTEGER,
ADD COLUMN     "languageLevel" "LanguageLevel",
ADD COLUMN     "languageLevelAssessedAt" TIMESTAMP(3),
ADD COLUMN     "languageLevelNote" TEXT,
ADD COLUMN     "languageLevelSource" "LanguageLevelSource",
ADD COLUMN     "licenseUrl" TEXT,
ADD COLUMN     "origin" "StoryOrigin",
ADD COLUMN     "originalLanguage" TEXT,
ADD COLUMN     "originalTitle" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "rightsBasis" "StoryRightsBasis",
ADD COLUMN     "rightsNote" TEXT,
ADD COLUMN     "rightsVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "rightsVerifiedBy" TEXT,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "sourceName" TEXT,
ADD COLUMN     "sourceRetrievedAt" TIMESTAMP(3),
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "status" "StoryStatus" NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "textFidelity" "StoryTextFidelity",
ADD COLUMN     "translatedFromId" TEXT,
ADD COLUMN     "translationGroupId" TEXT,
ADD COLUMN     "translationMethod" "TranslationMethod",
ADD COLUMN     "translatorDeathYear" INTEGER,
ADD COLUMN     "translatorName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "collections_slug_language_key" ON "collections"("slug", "language");

-- CreateIndex
CREATE INDEX "stories_language_status_category_ageGroup_idx" ON "stories"("language", "status", "category", "ageGroup");

-- CreateIndex
CREATE INDEX "stories_language_languageLevel_idx" ON "stories"("language", "languageLevel");

-- CreateIndex
CREATE INDEX "stories_translatedFromId_idx" ON "stories"("translatedFromId");

-- CreateIndex
CREATE UNIQUE INDEX "stories_slug_language_key" ON "stories"("slug", "language");

-- CreateIndex
CREATE UNIQUE INDEX "stories_translationGroupId_language_key" ON "stories"("translationGroupId", "language");

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_translatedFromId_fkey" FOREIGN KEY ("translatedFromId") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------
-- Backfill of existing rows
-- ---------------------------------------------------------------------

-- Language: empty values become Turkish, common spellings of Turkish and
-- regional forms ("tr-TR", "TR_tr", "en-US") collapse to the bare lower-case
-- code. Every existing row has slug and translationGroupId NULL, so the
-- unique indexes created above cannot be violated by this.
UPDATE "stories"
SET "language" = 'tr'
WHERE "language" IS NULL
   OR btrim("language") = ''
   OR lower(btrim("language")) IN ('tur', 'turkish', 'turkce', 'türkçe');

UPDATE "stories"
SET "language" = lower(substring(btrim("language") from '^[A-Za-z]{2}'))
WHERE btrim("language") ~ '^[A-Za-z]{2}([-_].*)?$'
  AND "language" <> lower(substring(btrim("language") from '^[A-Za-z]{2}'));

-- Every story that exists today is a machine-written retelling.
UPDATE "stories" SET "origin" = 'AI_GENERATED' WHERE "origin" IS NULL;
UPDATE "stories" SET "textFidelity" = 'RETOLD' WHERE "textFidelity" IS NULL;

-- Existing rows stay live (the column default already made them PUBLISHED;
-- stated explicitly so the intent survives a later default change).
UPDATE "stories" SET "status" = 'PUBLISHED' WHERE "status" IS DISTINCT FROM 'PUBLISHED';
UPDATE "stories" SET "publishedAt" = "createdAt" WHERE "publishedAt" IS NULL;
