/**
 * Pure time / duration formatting for the audio player and library cards.
 *
 * Units: positions and narration durations are SECONDS (expo-audio status,
 * backend `totalDuration` / `Audio.duration`); `Story.estimatedDuration` is
 * MINUTES (seed estimate, not the real audio length).
 */

import { getStoryDurationLabel } from '../models/Story';

/** Finite, positive seconds; anything else (NaN, Infinity, <= 0) is 0. */
const safeSeconds = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * "m:ss" clock for a position in seconds (whole seconds, floored). Minutes are
 * not folded into hours ("75:00"), bedtime stories are far shorter than that.
 * Negative / non-finite input renders "0:00".
 */
export function formatClock(seconds: number): string {
  const total = Math.floor(safeSeconds(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Right-hand player label while the track length is still unknown. */
export const UNKNOWN_REMAINING_LABEL = '-:--';

/**
 * Remaining-time label for the player's right-hand clock: "-m:ss" with a
 * plain hyphen-minus, so it no longer reads like the total length.
 *
 * - Computed as floor(duration) - floor(position): the left label (floored
 *   position) plus the right label always add up to the whole-second total.
 * - Clamped at 0: a position at or past the end shows "-0:00".
 * - Unknown duration (0, negative, NaN, e.g. metadata not loaded yet) shows
 *   the "-:--" placeholder instead of "-0:00", which would read as finished.
 */
export function formatRemaining(positionSec: number, durationSec: number): string {
  const duration = safeSeconds(durationSec);
  if (duration <= 0) return UNKNOWN_REMAINING_LABEL;
  const remaining = Math.max(
    0,
    Math.floor(duration) - Math.floor(safeSeconds(positionSec)),
  );
  return `-${formatClock(remaining)}`;
}

/**
 * Real narration length in whole minutes: rounded to the nearest minute with a
 * minimum of 1 (5:53 -> 6, 0:20 -> 1). `null` when unknown (0 / null / NaN),
 * which is how the backend reports a narration whose audio is not merged yet.
 */
export function narrationDurationMinutes(
  totalDurationSec: number | null | undefined,
): number | null {
  const seconds = safeSeconds(totalDurationSec);
  if (seconds <= 0) return null;
  return Math.max(1, Math.round(seconds / 60));
}

/**
 * Duration label for a card that represents a NARRATION. Prefers the real
 * audio length (seconds) over the story's seed `estimatedDuration` (minutes)
 * and uses the same wording as `getStoryDurationLabel` ("6 dakika",
 * "1 saat 5 dakika"). Returns '' when neither value is known so callers can
 * drop the segment instead of rendering "0 dakika".
 */
export function getNarrationDurationLabel(
  totalDurationSec: number | null | undefined,
  estimatedDurationMin: number | null | undefined,
): string {
  const minutes = narrationDurationMinutes(totalDurationSec);
  if (minutes !== null) return getStoryDurationLabel(minutes);
  const estimate = safeSeconds(estimatedDurationMin);
  if (estimate > 0) return getStoryDurationLabel(Math.round(estimate));
  return '';
}
