/**
 * User Models with Strict TypeScript Typing
 */

import {
  AuthProvider,
  SubscriptionTier,
  isPaidTier,
  parseSubscriptionTier,
} from '../types/enums';

// ============================================================================
// User Model (Core User Data)
// ============================================================================

export interface User {
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly profileImageUrl: string | null;
  readonly provider: AuthProvider;
  readonly emailVerified: boolean;
  readonly subscriptionTier: SubscriptionTier;
  readonly subscriptionExpiresAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UserJSON {
  readonly id: string;
  readonly email: string;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly profileImageUrl?: string | null;
  readonly provider: string;
  readonly emailVerified: boolean;
  readonly subscriptionTier: string;
  readonly subscriptionExpiresAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ============================================================================
// User Helper Functions
// ============================================================================

/**
 * First and last name as the user gave them; null when there is neither.
 * Never the e-mail's local part: an Apple private relay address is a random
 * id, so the caller falls back to the sign-in name or a neutral one.
 */
export function getUserFullName(user: User): string | null {
  const first = user.firstName?.trim();
  const last = user.lastName?.trim();
  if (first && last) {
    return `${first} ${last}`;
  }
  return first || last || null;
}

export function getUserInitials(user: User): string {
  if (user.firstName && user.lastName) {
    return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
  }
  if (user.firstName) {
    return user.firstName[0]?.toUpperCase() || '';
  }
  return user.email[0]?.toUpperCase() || 'U';
}

/** A paid plan (Mini, Premium, Creator) whose period has not ended. */
export function hasActiveSubscription(user: User): boolean {
  if (!isPaidTier(user.subscriptionTier)) {
    return false;
  }
  if (!user.subscriptionExpiresAt) {
    return false;
  }
  return user.subscriptionExpiresAt > new Date();
}

// ============================================================================
// User JSON Parsers (Type-Safe with Validation)
// ============================================================================

export function parseUserFromJSON(json: unknown): User {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid user data: expected object');
  }

  const data = json as Record<string, unknown>;

  // Required fields validation
  if (typeof data.id !== 'string' || !data.id) {
    throw new Error('Invalid user data: missing or invalid id');
  }
  if (typeof data.email !== 'string' || !data.email) {
    throw new Error('Invalid user data: missing or invalid email');
  }
  if (typeof data.provider !== 'string') {
    throw new Error('Invalid user data: missing or invalid provider');
  }

  // Use defaults for optional fields if not provided
  const subscriptionTier: SubscriptionTier = parseSubscriptionTier(
    data.subscriptionTier,
  );

  // GET /users/me exposes the avatar as `profileImageUrl` (and `avatarUrl`
  // for older clients); the DB column is `avatarUrl`.
  const profileImageUrl =
    typeof data.profileImageUrl === 'string' && data.profileImageUrl
      ? data.profileImageUrl
      : typeof data.avatarUrl === 'string' && data.avatarUrl
        ? data.avatarUrl
        : null;

  const createdAt =
    typeof data.createdAt === 'string' ? new Date(data.createdAt) : new Date();

  const updatedAt =
    typeof data.updatedAt === 'string' ? new Date(data.updatedAt) : new Date();

  return {
    id: data.id,
    email: data.email,
    firstName:
      typeof data.firstName === 'string' && data.firstName
        ? data.firstName
        : null,
    lastName:
      typeof data.lastName === 'string' && data.lastName ? data.lastName : null,
    profileImageUrl,
    provider: data.provider.toUpperCase() as AuthProvider,
    emailVerified: Boolean(data.emailVerified),
    subscriptionTier,
    subscriptionExpiresAt:
      typeof data.subscriptionExpiresAt === 'string' &&
      data.subscriptionExpiresAt
        ? new Date(data.subscriptionExpiresAt)
        : null,
    createdAt,
    updatedAt,
  };
}

export function userToJSON(user: User): UserJSON {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    profileImageUrl: user.profileImageUrl,
    provider: user.provider,
    emailVerified: user.emailVerified,
    subscriptionTier: user.subscriptionTier,
    subscriptionExpiresAt: user.subscriptionExpiresAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

// ============================================================================
// Update User Request (PATCH /users/me)
// ============================================================================

export interface UpdateUserRequest {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly email?: string;
}

export function updateUserRequestToJSON(
  request: UpdateUserRequest,
): Record<string, string> {
  const json: Record<string, string> = {};

  if (request.firstName !== undefined && request.firstName !== '') {
    json.firstName = request.firstName;
  }
  if (request.lastName !== undefined && request.lastName !== '') {
    json.lastName = request.lastName;
  }
  if (request.email !== undefined && request.email !== '') {
    json.email = request.email;
  }

  return json;
}

// ============================================================================
// Upload Avatar Response (POST /users/me/avatar)
// ============================================================================

export interface UploadAvatarResponse {
  readonly avatarUrl: string;
}

export function parseUploadAvatarResponseFromJSON(
  json: unknown,
): UploadAvatarResponse {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid avatar response data: expected object');
  }

  const data = json as Record<string, unknown>;

  if (typeof data.avatarUrl !== 'string' || !data.avatarUrl) {
    throw new Error('Invalid avatar response data: missing or invalid avatarUrl');
  }

  return {
    avatarUrl: data.avatarUrl,
  };
}
