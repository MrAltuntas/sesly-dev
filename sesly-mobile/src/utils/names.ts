/**
 * Name helpers shared by the auth flows.
 */

export interface SplitName {
  firstName?: string;
  lastName?: string;
}

/**
 * Split a full name into first name (first token) and last name (the rest).
 * "Ayşe Nur Yılmaz" -> { firstName: "Ayşe", lastName: "Nur Yılmaz" }.
 */
export function splitFullName(fullName: string | null | undefined): SplitName {
  const tokens = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return {};
  if (tokens.length === 1) return { firstName: tokens[0] };
  return { firstName: tokens[0], lastName: tokens.slice(1).join(' ') };
}

/**
 * Normalize registration names. When both parts are given they are sent as
 * is; when only one field holds a full name it is split first token / rest.
 */
export function normalizeRegistrationName(
  firstName?: string | null,
  lastName?: string | null,
): SplitName {
  const first = (firstName ?? '').trim();
  const last = (lastName ?? '').trim();
  if (first && last) return { firstName: first, lastName: last };
  return splitFullName(first || last);
}
