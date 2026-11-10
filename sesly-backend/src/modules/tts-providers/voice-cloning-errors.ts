/**
 * Shared voice-cloning error types. Lives outside any provider folder so
 * the voice-training processor (and other consumers) can import without
 * depending on a specific provider implementation.
 */

/**
 * Thrown when a cloning attempt fails in a way that retrying will not fix:
 *   - audio too short / no speech detected
 *   - unsupported format / corrupt file
 *   - audio quality too low
 *   - upstream API rejected the input as invalid
 *
 * The voice-training processor uses this as a signal NOT to re-queue the job.
 */
export class PermanentVoiceCloningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentVoiceCloningError';
  }
}

/**
 * Regex patterns that indicate a cloning attempt is permanently doomed and
 * should not be retried. Keep in sync with provider error messages.
 */
const PERMANENT_FAILURE_PATTERNS: readonly RegExp[] = [
  /voice duration too short/i,
  /audio.*too short/i,
  /clip.*too short/i,
  /invalid.*audio/i,
  /unsupported.*format/i,
  /file.*corrupt/i,
  /no speech detected/i,
  /no valid audio/i,
  /audio quality.*too low/i,
];

export function isPermanentCloningFailure(errorMessage: string): boolean {
  if (!errorMessage) return false;
  return PERMANENT_FAILURE_PATTERNS.some((p) => p.test(errorMessage));
}
