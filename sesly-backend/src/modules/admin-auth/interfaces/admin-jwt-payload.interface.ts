import { AdminRole } from '@common/enums/prisma.enums';

export interface AdminJwtPayload {
  sub: string; // admin ID
  email: string;
  role: AdminRole;
  /** admins.tokenVersion at issue time; missing on older tokens (= 0). */
  tv?: number;
  iat?: number;
  exp?: number;
}

export interface AdminAuthResponse {
  accessToken: string;
  refreshToken: string;
  admin: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    role: AdminRole;
  };
}
