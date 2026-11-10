-- Phase 3: Remove MINIMAX from TTSProvider enum.
--
-- Postgres does not support DROP VALUE on an enum, so the only way to remove
-- a value is to recreate the type and re-cast every column that referenced
-- the old type. We also wipe any rows that still reference MINIMAX so the
-- USING cast cannot fail. Production has 0 users at the time of cut, so the
-- DELETE is a true no-op against real data.

-- 1. Wipe any MINIMAX rows so the USING cast below cannot throw.
DELETE FROM "voice_profiles" WHERE "provider" = 'MINIMAX';
DELETE FROM "voice_deletion_requests" WHERE "provider" = 'MINIMAX';

-- 2. Rename the existing enum out of the way and create a fresh one.
ALTER TYPE "TTSProvider" RENAME TO "TTSProvider_old";
CREATE TYPE "TTSProvider" AS ENUM ('GOOGLE', 'CARTESIA');

-- 3. Re-point every column that used the old type to the new type.
ALTER TABLE "voice_profiles"
  ALTER COLUMN "provider" DROP DEFAULT,
  ALTER COLUMN "provider" TYPE "TTSProvider" USING "provider"::text::"TTSProvider",
  ALTER COLUMN "provider" SET DEFAULT 'GOOGLE';

ALTER TABLE "voice_deletion_requests"
  ALTER COLUMN "provider" TYPE "TTSProvider" USING "provider"::text::"TTSProvider";

-- 4. Drop the old enum.
DROP TYPE "TTSProvider_old";
