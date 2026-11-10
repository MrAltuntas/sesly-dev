/**
 * Single source of truth for "is this a premium voice?".
 *
 * Used by:
 *   - narration quota (premium vs standard monthly buckets)
 *   - GET /usage/current (same split)
 *   - GET /voice-profiles/available-voices and the voice profile mapper
 *     (`isPremium`)
 *
 * Rule: only cloned voices are premium. A profile is a clone when its
 * `kind` is CLONE; a Cartesia profile or one that carries a cloning key is
 * treated as a clone too (Cartesia is clone-only, and rows written before
 * `kind` existed have no other marker).
 *
 * Ready-made voices are free for everyone: a Google voice is never premium,
 * whatever its family, and a narration with one counts against the standard
 * allowance.
 */
export interface VoiceTierInput {
  provider: string;
  voiceId?: string | null;
  voiceCloningKey?: string | null;
  kind?: string | null;
}

export function isPremiumVoice(voice: VoiceTierInput): boolean {
  if (voice.kind === 'CLONE') {
    return true;
  }
  const provider = (voice.provider || '').toUpperCase();
  return provider === 'CARTESIA' || !!voice.voiceCloningKey;
}
