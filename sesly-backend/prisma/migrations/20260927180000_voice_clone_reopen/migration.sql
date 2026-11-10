-- CreateEnum
CREATE TYPE "VoiceProfileKind" AS ENUM ('PRESET', 'CLONE');

-- AlterTable
ALTER TABLE "voice_profiles" ADD COLUMN "kind" "VoiceProfileKind" NOT NULL DEFAULT 'PRESET',
ADD COLUMN "consentAt" TIMESTAMP(3),
ADD COLUMN "consentVersion" TEXT;

-- Backfill: user clones are the Cartesia rows that went through the cloning
-- pipeline (placeholder voiceId "pending-..." or a stored cloning key).
-- A Cartesia stock voice picked as a ready-made narrator stays PRESET so its
-- deletion never calls the upstream voice delete API.
UPDATE "voice_profiles"
SET "kind" = 'CLONE'
WHERE "provider" = 'CARTESIA'
  AND ("voiceCloningKey" IS NOT NULL OR "voiceId" LIKE 'pending-%');

-- AlterTable
ALTER TABLE "usage_limits" ADD COLUMN "clonesCreated" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "voice_profiles_userId_kind_idx" ON "voice_profiles"("userId", "kind");

-- CreateIndex
CREATE INDEX "voice_profiles_status_updatedAt_idx" ON "voice_profiles"("status", "updatedAt");
