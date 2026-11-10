/**
 * Session revocation through a per-account generation counter.
 *
 * Every user and admin token carries the account's `tokenVersion` column as
 * the `tv` claim. Bumping the column (logout, deactivation) makes every token
 * issued before unusable: the JWT strategies, the refresh endpoints and the
 * WebSocket handshake compare the claim with the stored value.
 *
 * Tokens minted before the claim existed have no `tv` and count as version 0,
 * so those sessions keep working until the account's first bump.
 */
export function tokenVersionOf(payload: { tv?: unknown } | null | undefined): number {
  const tv = payload?.tv;
  return typeof tv === 'number' && Number.isInteger(tv) ? tv : 0;
}

/** True when the token belongs to the account's current session generation. */
export function isTokenVersionCurrent(
  payload: { tv?: unknown } | null | undefined,
  current: number | null | undefined,
): boolean {
  return tokenVersionOf(payload) === (current ?? 0);
}

/** Prisma update data that revokes every token of the account. */
export function bumpTokenVersion(): { tokenVersion: { increment: number } } {
  return { tokenVersion: { increment: 1 } };
}

/** Copy of a loaded row without the internal `tokenVersion` column. */
export function withoutTokenVersion<T extends object>(row: T): Omit<T, 'tokenVersion'> {
  const rest = { ...row } as Record<string, unknown>;
  delete rest.tokenVersion;
  return rest as Omit<T, 'tokenVersion'>;
}
