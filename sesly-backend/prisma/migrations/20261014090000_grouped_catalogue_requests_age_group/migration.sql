-- Additive only: new enum, new enum value, nullable columns, one new table.
-- Safe on existing rows (no backfill, no rewrite, no NOT NULL without default).

-- CreateEnum
CREATE TYPE "AgeGroupSource" AS ENUM ('AI', 'MANUAL');

-- AlterEnum
ALTER TYPE "StoryLlmTaskType" ADD VALUE 'ASSESS_AGE_GROUP';

-- AlterTable
ALTER TABLE "stories" ADD COLUMN     "ageGroupAssessedAt" TIMESTAMP(3),
ADD COLUMN     "ageGroupNote" TEXT,
ADD COLUMN     "ageGroupSource" "AgeGroupSource";

-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "contentLanguage" TEXT;

-- CreateTable
CREATE TABLE "story_translation_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "fulfilledAt" TIMESTAMP(3),
    "fulfilledStoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_translation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "story_translation_requests_storyId_language_idx" ON "story_translation_requests"("storyId", "language");

-- CreateIndex
CREATE INDEX "story_translation_requests_fulfilledAt_idx" ON "story_translation_requests"("fulfilledAt");

-- CreateIndex
CREATE UNIQUE INDEX "story_translation_requests_userId_storyId_language_key" ON "story_translation_requests"("userId", "storyId", "language");

-- AddForeignKey
ALTER TABLE "story_translation_requests" ADD CONSTRAINT "story_translation_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_translation_requests" ADD CONSTRAINT "story_translation_requests_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
