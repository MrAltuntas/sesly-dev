-- Review before publishing and cover credit (docs/story-pipeline.md).
-- Additive: existing stories get no batch, are not reviewed and have no
-- cover credit.
--   importBatch  label of the import a story came from (review view filter)
--   reviewedAt / reviewedBy  "İncelendi" in the panel (workflow, never public)
--   coverCredit  { illustrator, licenseName, licenseUrl, source, attribution }
--                of the cover picture; public as the plain line credit.coverCredit

-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "coverCredit" JSONB,
ADD COLUMN     "importBatch" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT;

-- CreateIndex
CREATE INDEX "stories_importBatch_idx" ON "stories"("importBatch");
