-- Plans, limits and store purchases (2026-10-16).
-- Additive only: new enum value MINI, new enums, nullable columns, three new
-- tables. Existing rows keep their meaning; two backfills below make sure
-- nobody gets a fresh allowance or loses an admin grant because of the deploy.
-- The new enum value MINI is not used anywhere in this migration (PostgreSQL
-- 12+ allows ADD VALUE inside a transaction as long as it is not used there).

-- CreateEnum
CREATE TYPE "StorePlatform" AS ENUM ('APPLE', 'GOOGLE');

-- CreateEnum
CREATE TYPE "StoreBillingPeriod" AS ENUM ('MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "StorePurchaseState" AS ENUM ('PENDING', 'ACTIVE', 'CANCELED', 'GRACE', 'ON_HOLD', 'PAUSED', 'EXPIRED', 'REVOKED', 'REPLACED');

-- CreateEnum
CREATE TYPE "StoreEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- AlterEnum
ALTER TYPE "SubscriptionPlan" ADD VALUE 'MINI';

-- AlterTable
ALTER TABLE "voice_profiles" ADD COLUMN     "creationChargedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "grantEndsAt" TIMESTAMP(3),
ADD COLUMN     "grantPlan" "SubscriptionPlan",
ADD COLUMN     "storePurchaseId" TEXT;

-- CreateTable
CREATE TABLE "usage_lifetime" (
    "userId" TEXT NOT NULL,
    "cloneNarrations" INTEGER NOT NULL DEFAULT 0,
    "clonesCreated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_lifetime_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "store_purchases" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "StorePlatform" NOT NULL,
    "purchaseKey" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL,
    "billingPeriod" "StoreBillingPeriod" NOT NULL,
    "state" "StorePurchaseState" NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "latestTransactionId" TEXT,
    "linkedPurchaseKey" TEXT,
    "environment" TEXT,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "storeUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_events" (
    "id" TEXT NOT NULL,
    "platform" "StorePlatform" NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "purchaseKey" TEXT,
    "productId" TEXT,
    "userId" TEXT,
    "status" "StoreEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "note" TEXT,
    "payload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "store_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_purchases_userId_idx" ON "store_purchases"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "store_purchases_platform_purchaseKey_key" ON "store_purchases"("platform", "purchaseKey");

-- CreateIndex
CREATE INDEX "store_events_purchaseKey_idx" ON "store_events"("purchaseKey");

-- CreateIndex
CREATE INDEX "store_events_userId_idx" ON "store_events"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "store_events_platform_externalId_key" ON "store_events"("platform", "externalId");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_storePurchaseId_fkey" FOREIGN KEY ("storePurchaseId") REFERENCES "store_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_lifetime" ADD CONSTRAINT "usage_lifetime_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_purchases" ADD CONSTRAINT "store_purchases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_events" ADD CONSTRAINT "store_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill 1: existing admin grants (a paid plan on a row without any store
-- or Stripe id) are copied into the grant columns, so a later store write
-- cannot shorten them. plan / currentPeriodEnd stay as they are.
UPDATE "subscriptions"
SET "grantPlan" = "plan",
    "grantEndsAt" = "currentPeriodEnd"
WHERE "plan" IN ('PRO', 'CREATOR')
  AND "status" <> 'EXPIRED'
  AND "stripeSubscriptionId" IS NULL
  AND "appleTransactionId" IS NULL
  AND "appleOriginalTransactionId" IS NULL
  AND "googlePurchaseToken" IS NULL;

-- Backfill 2: lifetime counters from the history we have, so the FREE
-- allowances that never renew (1 cloned-voice narration, 1 clone creation)
-- already count what each user did before this deploy. Each counter takes
-- the larger of the monthly counters summed and the rows that still exist.
INSERT INTO "usage_lifetime" ("userId", "cloneNarrations", "clonesCreated", "createdAt", "updatedAt")
SELECT u."id",
       GREATEST(
         COALESCE((SELECT SUM(ul."premiumStoriesGenerated") FROM "usage_limits" ul WHERE ul."userId" = u."id"), 0),
         (SELECT COUNT(*) FROM "story_narrations" sn
            JOIN "voice_profiles" vp ON vp."id" = sn."voiceProfileId"
           WHERE sn."userId" = u."id" AND vp."kind" = 'CLONE' AND sn."status" IN ('READY', 'GENERATING'))
       )::INTEGER,
       GREATEST(
         COALESCE((SELECT SUM(ul."clonesCreated") FROM "usage_limits" ul WHERE ul."userId" = u."id"), 0),
         (SELECT COUNT(*) FROM "voice_profiles" vp
           WHERE vp."userId" = u."id" AND vp."kind" = 'CLONE' AND vp."status" NOT IN ('PENDING', 'FAILED'))
       )::INTEGER,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM "users" u
WHERE EXISTS (SELECT 1 FROM "usage_limits" ul WHERE ul."userId" = u."id")
   OR EXISTS (SELECT 1 FROM "voice_profiles" vp WHERE vp."userId" = u."id" AND vp."kind" = 'CLONE')
ON CONFLICT ("userId") DO NOTHING;
