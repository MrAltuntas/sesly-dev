-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('EMAIL', 'GOOGLE', 'APPLE');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MODERATOR');

-- CreateEnum
CREATE TYPE "VoiceProfileStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "AgeGroup" AS ENUM ('ZERO_TO_THREE', 'THREE_TO_SIX', 'SIX_TO_TEN', 'TEN_PLUS');

-- CreateEnum
CREATE TYPE "StoryCategory" AS ENUM ('TURKISH_CLASSICS', 'WORLD_CLASSICS', 'EDUCATIONAL', 'BEDTIME');

-- CreateEnum
CREATE TYPE "AudioStatus" AS ENUM ('PENDING', 'GENERATING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "NarrationStatus" AS ENUM ('PENDING', 'GENERATING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'PRO', 'CREATOR');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'EXPIRED', 'PAST_DUE');

-- CreateEnum
CREATE TYPE "TTSProvider" AS ENUM ('GOOGLE', 'MINIMAX');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "avatarUrl" TEXT,
    "provider" "AuthProvider" NOT NULL DEFAULT 'EMAIL',
    "providerId" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerificationToken" TEXT,
    "passwordResetToken" TEXT,
    "passwordResetExpires" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "profileIcon" TEXT,
    "provider" "TTSProvider" NOT NULL DEFAULT 'GOOGLE',
    "voiceId" TEXT NOT NULL,
    "voiceCloningKey" TEXT,
    "language" TEXT NOT NULL DEFAULT 'tr-TR',
    "status" "VoiceProfileStatus" NOT NULL DEFAULT 'READY',
    "consentAudioUrl" TEXT,
    "sampleAudioUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stories" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "ageGroup" "AgeGroup" NOT NULL,
    "category" "StoryCategory" NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'tr',
    "estimatedDuration" INTEGER NOT NULL,
    "coverImageUrl" TEXT,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "hasPreGeneratedNarration" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_chunks" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "startTime" INTEGER,
    "endTime" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audio" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "voiceProfileId" TEXT NOT NULL,
    "status" "AudioStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT,
    "originalText" TEXT NOT NULL,
    "duration" INTEGER,
    "audioUrl" TEXT,
    "totalSegments" INTEGER NOT NULL DEFAULT 0,
    "readySegments" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "audio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audio_segments" (
    "id" TEXT NOT NULL,
    "audioId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "audioUrl" TEXT,
    "status" "AudioStatus" NOT NULL DEFAULT 'PENDING',
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audio_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_story_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "voiceProfileId" TEXT NOT NULL,
    "lastChunkIndex" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_story_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "extraVoiceSlots" INTEGER NOT NULL DEFAULT 0,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "appleTransactionId" TEXT,
    "appleOriginalTransactionId" TEXT,
    "googlePurchaseToken" TEXT,
    "googleProductId" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_limits" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "storiesGenerated" INTEGER NOT NULL DEFAULT 0,
    "textToSpeechCount" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceToken" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "voiceReady" BOOLEAN NOT NULL DEFAULT true,
    "audioReady" BOOLEAN NOT NULL DEFAULT true,
    "subscriptionUpdates" BOOLEAN NOT NULL DEFAULT true,
    "newContent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorite_stories" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_narrations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "voiceProfileId" TEXT NOT NULL,
    "title" TEXT,
    "audioId" TEXT,
    "status" "NarrationStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "story_narrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "voice_profiles_userId_idx" ON "voice_profiles"("userId");

-- CreateIndex
CREATE INDEX "voice_profiles_provider_idx" ON "voice_profiles"("provider");

-- CreateIndex
CREATE INDEX "stories_category_ageGroup_idx" ON "stories"("category", "ageGroup");

-- CreateIndex
CREATE INDEX "story_chunks_storyId_idx" ON "story_chunks"("storyId");

-- CreateIndex
CREATE UNIQUE INDEX "story_chunks_storyId_chunkIndex_key" ON "story_chunks"("storyId", "chunkIndex");

-- CreateIndex
CREATE INDEX "audio_userId_idx" ON "audio"("userId");

-- CreateIndex
CREATE INDEX "audio_status_idx" ON "audio"("status");

-- CreateIndex
CREATE INDEX "audio_voiceProfileId_idx" ON "audio"("voiceProfileId");

-- CreateIndex
CREATE INDEX "audio_segments_audioId_idx" ON "audio_segments"("audioId");

-- CreateIndex
CREATE UNIQUE INDEX "audio_segments_audioId_index_key" ON "audio_segments"("audioId", "index");

-- CreateIndex
CREATE INDEX "user_story_progress_userId_idx" ON "user_story_progress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_story_progress_userId_storyId_voiceProfileId_key" ON "user_story_progress"("userId", "storyId", "voiceProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_userId_key" ON "subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeCustomerId_key" ON "subscriptions"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeSubscriptionId_key" ON "subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_appleTransactionId_key" ON "subscriptions"("appleTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_googlePurchaseToken_key" ON "subscriptions"("googlePurchaseToken");

-- CreateIndex
CREATE INDEX "subscriptions_stripeCustomerId_idx" ON "subscriptions"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "subscriptions_appleTransactionId_idx" ON "subscriptions"("appleTransactionId");

-- CreateIndex
CREATE INDEX "subscriptions_googlePurchaseToken_idx" ON "subscriptions"("googlePurchaseToken");

-- CreateIndex
CREATE INDEX "usage_limits_userId_idx" ON "usage_limits"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "usage_limits_userId_month_year_key" ON "usage_limits"("userId", "month", "year");

-- CreateIndex
CREATE INDEX "user_devices_userId_idx" ON "user_devices"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_userId_deviceToken_key" ON "user_devices"("userId", "deviceToken");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_key" ON "notification_preferences"("userId");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "notifications_userId_read_idx" ON "notifications"("userId", "read");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "favorite_stories_userId_idx" ON "favorite_stories"("userId");

-- CreateIndex
CREATE INDEX "favorite_stories_storyId_idx" ON "favorite_stories"("storyId");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_stories_userId_storyId_key" ON "favorite_stories"("userId", "storyId");

-- CreateIndex
CREATE UNIQUE INDEX "story_narrations_audioId_key" ON "story_narrations"("audioId");

-- CreateIndex
CREATE INDEX "story_narrations_userId_idx" ON "story_narrations"("userId");

-- CreateIndex
CREATE INDEX "story_narrations_storyId_idx" ON "story_narrations"("storyId");

-- CreateIndex
CREATE INDEX "story_narrations_status_idx" ON "story_narrations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "story_narrations_userId_storyId_voiceProfileId_key" ON "story_narrations"("userId", "storyId", "voiceProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "admins_email_idx" ON "admins"("email");

-- CreateIndex
CREATE INDEX "admins_role_idx" ON "admins"("role");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE INDEX "promo_codes_code_idx" ON "promo_codes"("code");

-- AddForeignKey
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_chunks" ADD CONSTRAINT "story_chunks_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio" ADD CONSTRAINT "audio_voiceProfileId_fkey" FOREIGN KEY ("voiceProfileId") REFERENCES "voice_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_segments" ADD CONSTRAINT "audio_segments_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "audio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_story_progress" ADD CONSTRAINT "user_story_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_story_progress" ADD CONSTRAINT "user_story_progress_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_story_progress" ADD CONSTRAINT "user_story_progress_voiceProfileId_fkey" FOREIGN KEY ("voiceProfileId") REFERENCES "voice_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_limits" ADD CONSTRAINT "usage_limits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_stories" ADD CONSTRAINT "favorite_stories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_stories" ADD CONSTRAINT "favorite_stories_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_narrations" ADD CONSTRAINT "story_narrations_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_narrations" ADD CONSTRAINT "story_narrations_voiceProfileId_fkey" FOREIGN KEY ("voiceProfileId") REFERENCES "voice_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_narrations" ADD CONSTRAINT "story_narrations_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "audio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
