-- Shared audio of ready-made (Google) voice narrations: one Audio row per
-- story + segmentation version + content + synthesis voice + language +
-- Google settings (shareKey), no user and no voice profile; every narration
-- with that key points at it. Additive: existing rows stay owned audio
-- (shared = false), nothing is backfilled.

-- A shared audio is pointed at by many narrations.
-- DropIndex
DROP INDEX "story_narrations_audioId_key";

-- AlterTable
ALTER TABLE "audio" ADD COLUMN     "shareKey" TEXT,
ADD COLUMN     "shareParams" JSONB,
ADD COLUMN     "shared" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "storyId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL,
ALTER COLUMN "voiceProfileId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "audio_shareKey_key" ON "audio"("shareKey");

-- CreateIndex
CREATE INDEX "audio_storyId_idx" ON "audio"("storyId");

-- CreateIndex
CREATE INDEX "story_narrations_audioId_idx" ON "story_narrations"("audioId");

-- AddForeignKey
ALTER TABLE "audio" ADD CONSTRAINT "audio_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Owned audio keeps its user and voice profile; a shared one has neither
-- (Prisma does not model CHECK constraints, so this causes no drift).
ALTER TABLE "audio" ADD CONSTRAINT "audio_owner_check" CHECK (
  ("shared" = false AND "userId" IS NOT NULL AND "voiceProfileId" IS NOT NULL)
  OR ("shared" = true AND "userId" IS NULL AND "voiceProfileId" IS NULL)
);
