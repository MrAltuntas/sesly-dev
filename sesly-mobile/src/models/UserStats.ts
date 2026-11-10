/**
 * User Stats Model with Strict TypeScript Typing
 *
 * Mirrors the backend `UserStatsDto` surfaced by:
 *   - GET /users/me/stats
 *
 * Fields:
 *   - storiesCompleted: number of narrations completed
 *     (`StoryNarration.completedAt != null`).
 *   - hoursListened: approximate total hours of narrated audio the user
 *     owns. Decimal — backend computes it as a rough proxy from
 *     `Audio.duration` across READY narrations. This is NOT real playback
 *     tracking, just a friendly "you've made this much audio" number for
 *     the Profile stats strip.
 *   - voicesTrained: number of voice profiles successfully trained
 *     (`VoiceProfile.status == READY`).
 */

// ============================================================================
// User Stats Model
// ============================================================================

export interface UserStats {
  readonly storiesCompleted: number;
  readonly hoursListened: number;
  readonly voicesTrained: number;
}

// ============================================================================
// Parser
// ============================================================================

function asFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function parseUserStatsFromJSON(raw: unknown): UserStats {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid user stats data: expected object');
  }

  const data = raw as Record<string, unknown>;

  return {
    storiesCompleted: Math.max(0, Math.round(asFiniteNumber(data.storiesCompleted))),
    hoursListened: Math.max(0, asFiniteNumber(data.hoursListened)),
    voicesTrained: Math.max(0, Math.round(asFiniteNumber(data.voicesTrained))),
  };
}

// ============================================================================
// Display helpers
// ============================================================================

/**
 * Turn the decimal `hoursListened` into something the Profile stats strip
 * can show without looking weird. For < 1 hour we surface a single decimal
 * (e.g. "0.4"). For >= 1 hour we round to the nearest whole hour.
 */
export function formatHoursListened(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return '0';
  if (hours < 1) {
    // Keep one decimal but strip trailing ".0" for cleanliness.
    const rounded = Math.round(hours * 10) / 10;
    return rounded.toString();
  }
  return Math.round(hours).toString();
}
