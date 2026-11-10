-- Phase 2A: per-story / per-audio / per-segment emotion + speed + volume
-- metadata for Cartesia Sonic 3. All columns are nullable so existing rows
-- keep working unchanged; the TTS provider falls back to env defaults
-- when these are null.

ALTER TABLE "stories"
  ADD COLUMN "defaultEmotion" TEXT,
  ADD COLUMN "defaultSpeed" DOUBLE PRECISION,
  ADD COLUMN "cartesiaPronunciationDictId" TEXT,
  ADD COLUMN "preprocessedSegments" JSONB,
  ADD COLUMN "preprocessedAt" TIMESTAMP(3),
  ADD COLUMN "preprocessedModel" TEXT;

ALTER TABLE "audio"
  ADD COLUMN "globalEmotion" TEXT,
  ADD COLUMN "globalSpeed" DOUBLE PRECISION,
  ADD COLUMN "globalVolume" DOUBLE PRECISION,
  ADD COLUMN "cartesiaPronunciationDictId" TEXT;

ALTER TABLE "audio_segments"
  ADD COLUMN "emotion" TEXT,
  ADD COLUMN "speed" DOUBLE PRECISION,
  ADD COLUMN "volume" DOUBLE PRECISION;
