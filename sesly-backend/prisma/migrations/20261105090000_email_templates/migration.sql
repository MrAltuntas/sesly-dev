-- Service email texts per kind and language (admin panel overrides of the
-- code defaults). The legacy token columns of the removed email-change
-- verification and the old token-based password reset go: Firebase owns
-- both flows now.

-- AlterTable
ALTER TABLE "users" DROP COLUMN "emailVerificationToken",
DROP COLUMN "passwordResetExpires",
DROP COLUMN "passwordResetToken";

-- CreateTable
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "preheader" TEXT NOT NULL DEFAULT '',
    "heading" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "buttonLabel" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "footer" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByAdminId" TEXT,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_templates_kind_language_key" ON "email_templates"("kind", "language");
