-- Dedupe device tokens before making them globally unique: keep the most
-- recently updated row per token (ties broken by id).
DELETE FROM "user_devices" AS d
USING "user_devices" AS newer
WHERE d."deviceToken" = newer."deviceToken"
  AND d."id" <> newer."id"
  AND (
    d."updatedAt" < newer."updatedAt"
    OR (d."updatedAt" = newer."updatedAt" AND d."id" < newer."id")
  );

-- DropIndex
DROP INDEX "user_devices_userId_deviceToken_key";

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_deviceToken_key" ON "user_devices"("deviceToken");

-- DropForeignKey
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_userId_fkey";

-- DropTable (push preferences now live in user_preferences)
DROP TABLE "notification_preferences";
