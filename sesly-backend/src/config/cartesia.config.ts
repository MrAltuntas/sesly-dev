import { registerAs } from '@nestjs/config';

// Cartesia API 2026-08-14 is the only version the current docs support for
// /voices/clone (clip + name + language; `mode`/`enhance` are gone) and
// /tts/bytes. Model `sonic-3.6` is the moving alias; pin a dated snapshot
// (e.g. `sonic-3.6-2026-08-27`) via CARTESIA_MODEL if a regression shows up.
// Sonic 3.6 learns from up to 60 s of reference audio and speaks with
// clones created on older models.
//
// Only the key, the host and the API version live here (environment only).
// Model, default speed / volume / emotion are runtime settings
// (tts.cartesia.* in src/modules/settings/settings.registry.ts) with
// CARTESIA_MODEL / CARTESIA_DEFAULT_* as their environment fallback.
export default registerAs('cartesia', () => ({
  apiKey: process.env.CARTESIA_API_KEY,
  apiUrl: process.env.CARTESIA_API_URL || 'https://api.cartesia.ai',
  version: process.env.CARTESIA_VERSION || '2026-08-14',
}));
