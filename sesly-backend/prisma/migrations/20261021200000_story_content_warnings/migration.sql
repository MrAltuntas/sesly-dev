-- Content warnings of a story (controlled vocabulary, see
-- src/common/constants/content-warnings.ts), shown next to the age group in
-- the app. Additive: every existing story starts with none.

-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "contentWarnings" TEXT[] DEFAULT ARRAY[]::TEXT[];
