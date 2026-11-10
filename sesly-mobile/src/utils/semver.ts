/**
 * Minimal semver helpers for the force-update check (GET /app/config).
 *
 * Accepts "MAJOR.MINOR.PATCH" with optional missing parts ("1.2" = "1.2.0"),
 * an optional leading "v" and an ignored pre-release/build suffix
 * ("1.0.8-beta.1+42" compares as 1.0.8). Anything else is invalid (null), and
 * callers must treat invalid input as "do not block".
 */

export type SemverTuple = readonly [number, number, number];

const SEMVER_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/;

export function parseSemver(value: unknown): SemverTuple | null {
  if (typeof value !== 'string') return null;
  const match = SEMVER_RE.exec(value.trim());
  if (!match) return null;
  const parts = [match[1], match[2] ?? '0', match[3] ?? '0'].map(p => Number(p));
  if (parts.some(n => !Number.isSafeInteger(n))) return null;
  return [parts[0], parts[1], parts[2]] as const;
}

/** -1 when a < b, 0 when equal, 1 when a > b; null when either is invalid. */
export function compareSemver(a: unknown, b: unknown): -1 | 0 | 1 | null {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

/**
 * True only when both versions are valid and `current` is strictly older
 * than `minimum`. Invalid or missing data never forces an update.
 */
export function isVersionBelow(current: unknown, minimum: unknown): boolean {
  return compareSemver(current, minimum) === -1;
}
