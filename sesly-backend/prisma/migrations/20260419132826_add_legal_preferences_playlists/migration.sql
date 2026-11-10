-- CreateEnum
CREATE TYPE "LegalDocumentStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "legal_documents" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentMd" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "status" "LegalDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_document_versions" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "contentMd" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedBy" TEXT,

    CONSTRAINT "legal_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "userId" TEXT NOT NULL,
    "sleepTimerFadeOut" BOOLEAN NOT NULL DEFAULT true,
    "sleepTimerPauseWhenAsleep" BOOLEAN NOT NULL DEFAULT false,
    "sleepTimerLastDuration" INTEGER,
    "voiceReadyNotifications" BOOLEAN NOT NULL DEFAULT true,
    "narrationReadyNotifications" BOOLEAN NOT NULL DEFAULT true,
    "promoNotifications" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "playlists" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlist_items" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "narrationId" TEXT,
    "storyId" TEXT,
    "voiceProfileId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "playlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "legal_documents_slug_key" ON "legal_documents"("slug");

-- CreateIndex
CREATE INDEX "legal_documents_status_idx" ON "legal_documents"("status");

-- CreateIndex
CREATE INDEX "legal_document_versions_slug_version_idx" ON "legal_document_versions"("slug", "version");

-- CreateIndex
CREATE UNIQUE INDEX "legal_document_versions_documentId_version_key" ON "legal_document_versions"("documentId", "version");

-- CreateIndex
CREATE INDEX "playlists_userId_idx" ON "playlists"("userId");

-- CreateIndex
CREATE INDEX "playlist_items_playlistId_position_idx" ON "playlist_items"("playlistId", "position");

-- AddForeignKey
ALTER TABLE "legal_document_versions" ADD CONSTRAINT "legal_document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_narrationId_fkey" FOREIGN KEY ("narrationId") REFERENCES "story_narrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_voiceProfileId_fkey" FOREIGN KEY ("voiceProfileId") REFERENCES "voice_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
