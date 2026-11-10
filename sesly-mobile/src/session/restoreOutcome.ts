/**
 * How the launch restore of a stored session ended. Kept apart from
 * AuthService (Firebase) so the boot route decision and the screens can
 * import it as a plain type.
 *
 * - restored     GET /users/me answered with the user
 * - none         no stored tokens
 * - rejected     the backend refused the session (401, 403, 404): tokens cleared
 * - offline      no response (no connection, DNS, the 8 s timeout)
 * - server       5xx, 429 or a failure inside the app (tokens kept)
 * - maintenance  503
 */
export type RestoreOutcome =
  | 'restored'
  | 'none'
  | 'rejected'
  | 'offline'
  | 'server'
  | 'maintenance';

/** The outcomes that keep the stored tokens for a later retry. */
export type TransientRestoreOutcome = Extract<
  RestoreOutcome,
  'offline' | 'server' | 'maintenance'
>;

export function isTransientRestoreOutcome(
  outcome: RestoreOutcome | 'pending',
): outcome is TransientRestoreOutcome {
  return outcome === 'offline' || outcome === 'server' || outcome === 'maintenance';
}
