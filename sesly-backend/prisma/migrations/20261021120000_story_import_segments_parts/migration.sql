-- Bulk story import (importKey, tags, edition / licence / attribution),
-- versioned segmentation with a first-request claim, multi-part tales,
-- the segmentation version of an audio and free regeneration of a
-- narration whose audio an admin removed. Additive only.

-- AlterTable
ALTER TABLE "audio" ADD COLUMN     "segmentationVersion" INTEGER;

-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "attribution" TEXT,
ADD COLUMN     "importKey" TEXT,
ADD COLUMN     "importedAt" TIMESTAMP(3),
ADD COLUMN     "licenseName" TEXT,
ADD COLUMN     "partGroupId" TEXT,
ADD COLUMN     "partNumber" INTEGER,
ADD COLUMN     "segmentationLockedUntil" TIMESTAMP(3),
ADD COLUMN     "segmentationVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceEdition" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "story_narrations" ADD COLUMN     "freeRegeneration" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "stories_importKey_key" ON "stories"("importKey");

-- CreateIndex
CREATE UNIQUE INDEX "stories_partGroupId_partNumber_key" ON "stories"("partGroupId", "partNumber");


-- Stories that already carry segments start at version 1.
UPDATE "stories" SET "segmentationVersion" = 1
WHERE "preprocessedSegments" IS NOT NULL AND "preprocessedSegments" <> 'null'::jsonb;
