-- CreateEnum
CREATE TYPE "VoiceDeletionRequestStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'NO_OP');

-- CreateTable
CREATE TABLE "voice_deletion_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "voiceProfileId" TEXT NOT NULL,
    "voiceProfileName" TEXT NOT NULL,
    "provider" "TTSProvider" NOT NULL,
    "providerVoiceId" TEXT NOT NULL,
    "status" "VoiceDeletionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "voice_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voice_deletion_requests_status_idx" ON "voice_deletion_requests"("status");

-- CreateIndex
CREATE INDEX "voice_deletion_requests_userId_idx" ON "voice_deletion_requests"("userId");

-- CreateIndex
CREATE INDEX "voice_deletion_requests_requestedAt_idx" ON "voice_deletion_requests"("requestedAt");
