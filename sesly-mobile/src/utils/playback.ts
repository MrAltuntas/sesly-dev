/**
 * Playback helpers (pure, unit-tested).
 */

/**
 * Decide whether a saved playback position should be restored.
 * `totalDurationSec` of 0 means the duration is unknown (older payloads);
 * we still resume then, the player clamps to the real length.
 * Positions within the last 2 s count as "finished" and start over.
 */
export function shouldResumeFrom(
  savedPositionMs: number,
  totalDurationSec: number,
): boolean {
  if (!Number.isFinite(savedPositionMs) || savedPositionMs <= 0) return false;
  const totalMs = (totalDurationSec || 0) * 1000;
  if (totalMs <= 0) return true;
  return savedPositionMs < totalMs - 2000;
}
