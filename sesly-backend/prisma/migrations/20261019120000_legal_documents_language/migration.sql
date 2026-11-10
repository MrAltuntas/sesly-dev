-- Per-language legal documents. Existing rows become Turkish (default 'tr').
-- The document unique moves from slug to (slug, language); versions are
-- looked up by (slug, language, version).

-- DropIndex
DROP INDEX "legal_document_versions_slug_version_idx";

-- DropIndex
DROP INDEX "legal_documents_slug_key";

-- AlterTable
ALTER TABLE "legal_document_versions" ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'tr';

-- AlterTable
ALTER TABLE "legal_documents" ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'tr';

-- CreateIndex
CREATE INDEX "legal_document_versions_slug_language_version_idx" ON "legal_document_versions"("slug", "language", "version");

-- CreateIndex
CREATE UNIQUE INDEX "legal_documents_slug_language_key" ON "legal_documents"("slug", "language");

