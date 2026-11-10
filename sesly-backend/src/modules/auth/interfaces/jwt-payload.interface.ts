export interface JwtPayload {
  sub: string;
  email: string;
  /**
   * users.tokenVersion at issue time (see common/utils/token-version.ts).
   * Missing on tokens issued before revocation existed: counts as 0.
   */
  tv?: number;
  iat?: number;
  exp?: number;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    profileImageUrl?: string | null;
    emailVerified: boolean;
    provider: string;
    subscriptionTier?: string | null;
    subscriptionExpiresAt?: string | null;
    createdAt: string;
    updatedAt: string;
  };
}
