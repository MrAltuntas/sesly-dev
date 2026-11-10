-- Data only, no schema change. Hand-written.
--
-- The ready-made narrator catalogue is now Google Chirp 3 HD only and a voice
-- is shown by its bare name ("Achernar"). This brings existing ready-made
-- voice profiles in line. Only rows with provider GOOGLE and kind PRESET are
-- touched; cloned voices are never matched. Narrations and their audio files
-- are not touched: a narration points at the profile row (whose id does not
-- change) and keeps playing the audio that was already generated.
--
-- Safe to run more than once: after the first run no row matches any more.

-- 1. Profiles that point at a removed Standard / WaveNet voice move to a
--    Chirp 3 HD voice of the same gender (A, C, D female; B, E male). The ten
--    old voices map to ten different new ones, so a user who had both
--    "Standard A" and "Wavenet A" still has two different narrators.
--    The name is replaced only when it is still the auto-generated one
--    ("Standard A", "Wavenet B"); a name the user typed is kept.
UPDATE "voice_profiles" AS vp
SET
    "voiceId"   = 'tr-TR-Chirp3-HD-' || m.new_name,
    "name"      = CASE WHEN btrim(vp."name") = m.old_name THEN m.new_name ELSE vp."name" END,
    "language"  = 'tr-TR',
    "updatedAt" = CURRENT_TIMESTAMP
FROM (
    VALUES
        ('tr-TR-Standard-A', 'Standard A', 'Aoede'),
        ('tr-TR-Standard-B', 'Standard B', 'Charon'),
        ('tr-TR-Standard-C', 'Standard C', 'Kore'),
        ('tr-TR-Standard-D', 'Standard D', 'Leda'),
        ('tr-TR-Standard-E', 'Standard E', 'Puck'),
        ('tr-TR-Wavenet-A',  'Wavenet A',  'Achernar'),
        ('tr-TR-Wavenet-B',  'Wavenet B',  'Orus'),
        ('tr-TR-Wavenet-C',  'Wavenet C',  'Callirrhoe'),
        ('tr-TR-Wavenet-D',  'Wavenet D',  'Despina'),
        ('tr-TR-Wavenet-E',  'Wavenet E',  'Fenrir')
) AS m(old_voice_id, old_name, new_name)
WHERE vp."provider" = 'GOOGLE'
  AND vp."kind" = 'PRESET'
  AND vp."voiceId" = m.old_voice_id;

-- 2. Chirp 3 HD profiles still carrying the old auto-generated name
--    ("Chirp3 Achernar (HD)") get the bare voice name ("Achernar"). The name
--    must match the profile's own voice exactly, so a typed name is kept.
UPDATE "voice_profiles"
SET
    "name"      = split_part("voiceId", '-Chirp3-HD-', 2),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "provider" = 'GOOGLE'
  AND "kind" = 'PRESET'
  AND "voiceId" LIKE '%-Chirp3-HD-%'
  AND btrim("name") = 'Chirp3 ' || split_part("voiceId", '-Chirp3-HD-', 2) || ' (HD)';
