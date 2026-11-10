-- UI language of the app for server-written text (push notifications,
-- stored failure messages). Nullable: null means Turkish.

-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "uiLanguage" TEXT;
