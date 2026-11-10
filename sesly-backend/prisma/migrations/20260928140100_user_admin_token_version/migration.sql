-- Session generation carried as the `tv` JWT claim. Bumping it revokes every
-- access/refresh token issued before (logout, deactivation). Existing tokens
-- have no claim and count as version 0, so current sessions stay valid.
-- AlterTable
ALTER TABLE "users" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "admins" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
