import {
  ConflictException,
  Injectable,
  UnauthorizedException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@prisma/prisma.service';
import { EmailService } from '../email/email.service';
import * as bcrypt from 'bcrypt';
import { FirebaseTokenDto } from './dto/firebase-token.dto';
import { AuthResponse, JwtPayload } from './interfaces/jwt-payload.interface';
import * as admin from 'firebase-admin';
import { User, Subscription } from '@prisma/client';
import { StorageService } from '../storage/storage.service';
import { resolveEffectivePlan } from '../../common/utils/subscription-plan';
import { DEFAULT_UI_LANGUAGE, uiLanguageFromAcceptLanguage } from '../../common/i18n/ui-language';
import { recordUserUiLanguage } from '../../common/i18n/user-ui-language';
import {
  bumpTokenVersion,
  isTokenVersionCurrent,
  tokenVersionOf,
} from '../../common/utils/token-version';

interface OAuthProfile {
  email: string;
  providerId: string;
  provider: 'GOOGLE' | 'APPLE';
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  emailVerified?: boolean;
}

interface NameParts {
  firstName?: string;
  lastName?: string;
}

/**
 * 409 body for POST /auth/firebase/verify when the token's email belongs to a
 * backend user created with another sign-in method and the token does not
 * prove ownership of that email (email_verified !== true).
 */
export const EMAIL_IN_USE_CODE = 'EMAIL_IN_USE';
/** i18n key; HttpExceptionFilter serves it per Accept-Language. */
export const EMAIL_IN_USE_MESSAGE = 'errors.auth.emailInUse';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
    private storageService: StorageService,
  ) { }

  onModuleInit() {
    // Initialize Firebase Admin SDK
    if (!admin.apps.length) {
      try {
        const serviceAccountPath = this.configService.get<string>('firebase.serviceAccountPath');
        const projectId = this.configService.get<string>('firebase.projectId');
        const clientEmail = this.configService.get<string>('firebase.clientEmail');
        const privateKey = this.configService.get<string>('firebase.privateKey');

        if (serviceAccountPath) {
          // Initialize with service account file
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccountPath),
          });
          this.logger.log('Firebase Admin initialized with service account file');
        } else if (projectId && clientEmail && privateKey) {
          // Initialize with environment variables
          admin.initializeApp({
            credential: admin.credential.cert({
              projectId,
              clientEmail,
              privateKey,
            }),
          });
          this.logger.log('Firebase Admin initialized with environment variables');
        } else {
          this.logger.warn('Firebase Admin not initialized - missing configuration');
        }
      } catch (error) {
        this.logger.error('Failed to initialize Firebase Admin', error);
      }
    }
  }

  async refreshTokens(
    refreshToken: string,
    acceptLanguage?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      this.logger.debug(`Refresh token received: ${refreshToken ? 'Present' : 'Missing'}`);

      if (!refreshToken) {
        throw new UnauthorizedException('Refresh token not provided');
      }

      // Verify refresh token
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
      });

      this.logger.debug(`Refresh token verified for user: ${payload.sub}`);

      // Get user
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      // Revoked by logout / deactivation (users.tokenVersion was bumped).
      if (!isTokenVersionCurrent(payload, user.tokenVersion)) {
        throw new UnauthorizedException('Session revoked');
      }

      await this.recordUiLanguage(user.id, acceptLanguage);

      // Generate new tokens
      const tokens = await this.generateTokens(user.id, user.email, user.tokenVersion);
      this.logger.log(`Tokens refreshed successfully for user: ${user.email}`);

      return tokens;
    } catch (error) {
      this.logger.error('Refresh token verification failed', error.message);
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /**
   * POST /auth/logout. Public on purpose: the client proves the session with
   * its refresh token, so logout also works once the 1 h access token has
   * expired. Bumps users.tokenVersion, which revokes every access and refresh
   * token issued before (every device; a device that still holds a Firebase
   * session re-authenticates through /auth/firebase/verify).
   *
   * The bump is conditional on the token's own generation, so a replayed or
   * already revoked token is a harmless no-op (still 200) and concurrent
   * logouts bump only once. Invalid / expired refresh token: 401.
   */
  async logout(refreshToken: string): Promise<{ message: string }> {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Never run the update without a concrete id: `id: undefined` would
    // match every user.
    if (typeof payload?.sub !== 'string' || payload.sub.length === 0) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const { count } = await this.prisma.user.updateMany({
      where: { id: payload.sub, tokenVersion: tokenVersionOf(payload) },
      data: bumpTokenVersion(),
    });

    this.logger.log(
      count > 0
        ? `User logged out, sessions revoked: ${payload.sub}`
        : `Logout with an already revoked session: ${payload.sub}`,
    );
    return { message: 'Logged out successfully' };
  }

  async googleLogin(profile: OAuthProfile): Promise<AuthResponse> {
    return this.handleOAuthLogin({ ...profile, provider: 'GOOGLE' });
  }

  async appleLogin(profile: OAuthProfile): Promise<AuthResponse> {
    return this.handleOAuthLogin({ ...profile, provider: 'APPLE' });
  }

  /**
   * Verify Firebase ID token and authenticate user
   * Used for all authentication methods (Google, Apple, Email/Password)
   * Firebase handles the authentication, backend verifies the token and issues JWT
   */
  async verifyFirebaseToken(
    firebaseTokenDto: FirebaseTokenDto,
    acceptLanguage?: string,
  ): Promise<AuthResponse> {
    const { idToken, firstName: dtoFirstName, lastName: dtoLastName } = firebaseTokenDto;

    try {
      // Verify Firebase ID token
      const decodedToken = await admin.auth().verifyIdToken(idToken);

      const { uid, email, email_verified, name, picture, firebase } = decodedToken;

      if (!email) {
        throw new UnauthorizedException('Email not provided in Firebase token');
      }

      // Determine provider from Firebase sign-in method
      const signInProvider = firebase?.sign_in_provider || 'password';
      let provider: 'EMAIL' | 'GOOGLE' | 'APPLE' = 'EMAIL';

      if (signInProvider === 'google.com') {
        provider = 'GOOGLE';
      } else if (signInProvider === 'apple.com') {
        provider = 'APPLE';
      }

      this.logger.log(`Firebase token verified for user: ${email} (provider: ${provider})`);

      // Resolve the backend user by Firebase uid first, then (only for a
      // token that proves ownership of the address) by email.
      const user = await this.findUserForFirebaseIdentity(uid, email, email_verified);

      if (!user) {
        // Use provided names from DTO, or fall back to parsing from token's displayName
        let firstName = dtoFirstName;
        let lastName = dtoLastName;

        if (!firstName && name) {
          const parsed = this.parseFullName(name);
          firstName = parsed.firstName;
          lastName = lastName || parsed.lastName;
        }

        const newUser = await this.prisma.user.create({
          data: {
            email,
            providerId: uid,
            firstName,
            lastName,
            provider,
            emailVerified: email_verified ?? true,
            avatarUrl: picture,
          },
        });

        this.logger.log(`New user created: ${email}`);

        // Create free subscription
        await this.ensureFreeSubscription(newUser.id);

        // Reload user with subscription
        const userWithSubscription = await this.prisma.user.findUnique({
          where: { id: newUser.id },
          include: { subscription: true },
        });

        if (!userWithSubscription) {
          throw new UnauthorizedException('Failed to create user');
        }

        await this.recordUiLanguage(newUser.id, acceptLanguage);

        // Welcome email in the app language of this first sign in.
        const welcomeLanguage = uiLanguageFromAcceptLanguage(acceptLanguage) ?? DEFAULT_UI_LANGUAGE;
        await this.sendEmailSafely(() =>
          this.emailService.sendWelcomeEmail(email, firstName || undefined, welcomeLanguage),
          'welcome email',
        );

        return this.createAuthResponse(userWithSubscription, userWithSubscription.subscription);
      } else {
        // Update existing user
        const updatedUser = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            providerId: uid,
            provider,
            emailVerified: email_verified ?? user.emailVerified,
            avatarUrl: picture || user.avatarUrl,
          },
          include: { subscription: true },
        });

        await this.recordUiLanguage(updatedUser.id, acceptLanguage);

        return this.createAuthResponse(updatedUser, updatedUser.subscription);
      }
    } catch (error: any) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error('Firebase token verification failed', error.message);
      throw new UnauthorizedException('Invalid Firebase token');
    }
  }

  // ==================== PRIVATE HELPER METHODS ====================

  /**
   * Store the app's UI language from Accept-Language (tr / en only; anything
   * else leaves the stored value alone), so app builds that do not send
   * `uiLanguage` in PATCH /users/me/preferences get localized server text
   * too. Never fails the sign in.
   */
  private async recordUiLanguage(userId: string, acceptLanguage: string | undefined) {
    await recordUserUiLanguage(this.prisma, userId, uiLanguageFromAcceptLanguage(acceptLanguage));
  }

  /**
   * Which backend user does this Firebase identity belong to?
   *
   *  1. A user whose stored providerId is the token uid (same Firebase
   *     account as before, whatever its email_verified state).
   *  2. Otherwise a user with the token email, but ONLY when Firebase says
   *     the email is verified (Google / Apple, or a verified email/password
   *     account). Anyone can create an unverified email/password account for
   *     an address they do not own, so an unverified token must never take
   *     over an existing account: 409 EMAIL_IN_USE instead.
   *  3. Otherwise null (first login, the caller creates the user).
   */
  private async findUserForFirebaseIdentity(
    uid: string,
    email: string,
    emailVerified: boolean | undefined,
  ) {
    const byUid = await this.prisma.user.findFirst({
      where: { providerId: uid },
      include: { subscription: true },
    });
    if (byUid) {
      return byUid;
    }

    const byEmail = await this.prisma.user.findUnique({
      where: { email },
      include: { subscription: true },
    });
    if (!byEmail) {
      return null;
    }

    if (emailVerified !== true) {
      this.logger.warn(
        `Refused to link an unverified Firebase identity to existing user ${byEmail.id}`,
      );
      throw new ConflictException({
        code: EMAIL_IN_USE_CODE,
        message: EMAIL_IN_USE_MESSAGE,
      });
    }

    return byEmail;
  }

  /**
   * Hash password using bcrypt with consistent salt rounds
   */
  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  /**
   * Parse full name into firstName and lastName
   * Last word is lastName, rest is firstName
   */
  private parseFullName(fullName: string): NameParts {
    const nameParts = fullName.trim().split(/\s+/);
    const firstName = nameParts.slice(0, -1).join(' ') || nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : undefined;
    return { firstName, lastName };
  }

  /**
   * Ensure user has a free subscription
   * Creates one if it doesn't exist
   */
  private async ensureFreeSubscription(userId: string): Promise<void> {
    await this.prisma.subscription.create({
      data: {
        userId,
        plan: 'FREE',
        status: 'ACTIVE',
      },
    });
  }

  /**
   * Send email with error handling
   * Logs errors but doesn't throw to prevent auth flow interruption
   */
  private async sendEmailSafely(
    emailFn: () => Promise<any>,
    emailType: string,
  ): Promise<void> {
    try {
      await emailFn();
    } catch (error) {
      this.logger.error(`Failed to send ${emailType}`, error);
    }
  }

  /**
   * Create standard AuthResponse from user
   * Includes JWT tokens and user data
   */
  private async createAuthResponse(user: User, subscription?: Subscription | null): Promise<AuthResponse> {
    const tokens = await this.generateTokens(user.id, user.email, user.tokenVersion);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        emailVerified: user.emailVerified,
        provider: user.provider,
        // Same readable URL GET /users/me returns (presigned for uploads).
        profileImageUrl: await this.storageService.getReadUrl(user.avatarUrl),
        subscriptionTier: subscription ? resolveEffectivePlan(subscription) : null,
        subscriptionExpiresAt: subscription?.currentPeriodEnd?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
    };
  }

  /**
   * Handle OAuth login for Google and Apple
   * Finds or creates user, ensures subscription, sends welcome email
   */
  private async handleOAuthLogin(profile: OAuthProfile): Promise<AuthResponse> {
    const { email, providerId, provider, firstName, lastName, avatarUrl, emailVerified } = profile;

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { subscription: true },
    });

    if (!user) {
      // Create new user
      const newUser = await this.prisma.user.create({
        data: {
          email,
          providerId,
          firstName,
          lastName,
          provider,
          emailVerified: emailVerified ?? true, // OAuth providers are pre-verified
          avatarUrl,
        },
      });

      this.logger.log(`New ${provider} user created: ${email}`);

      // Create free subscription
      await this.ensureFreeSubscription(newUser.id);

      // Reload user with subscription
      const userWithSubscription = await this.prisma.user.findUnique({
        where: { id: newUser.id },
        include: { subscription: true },
      });

      if (!userWithSubscription) {
        throw new UnauthorizedException('Failed to create user');
      }

      // Send welcome email for new users
      await this.sendEmailSafely(() =>
        this.emailService.sendWelcomeEmail(email, firstName || undefined, DEFAULT_UI_LANGUAGE),
        'welcome email',
      );

      return this.createAuthResponse(userWithSubscription, userWithSubscription.subscription);
    } else {
      // Update existing user with OAuth provider info
      const updatedUser = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          providerId,
          provider,
          emailVerified: emailVerified ?? user.emailVerified,
          avatarUrl: avatarUrl || user.avatarUrl,
          firstName: firstName || user.firstName,
          lastName: lastName || user.lastName,
        },
        include: { subscription: true },
      });

      this.logger.log(`Existing user logged in with ${provider}: ${email}`);

      return this.createAuthResponse(updatedUser, updatedUser.subscription);
    }
  }

  /**
   * Generate JWT access and refresh tokens. Both carry the account's current
   * session generation as `tv` (see common/utils/token-version.ts).
   */
  private async generateTokens(
    userId: string,
    email: string,
    tokenVersion: number | null | undefined,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: JwtPayload = { sub: userId, email, tv: tokenVersion ?? 0 };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.secret'),
      expiresIn: this.configService.get<string>('jwt.expiresIn'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.refreshSecret'),
      expiresIn: this.configService.get<string>('jwt.refreshExpiresIn'),
    });

    return { accessToken, refreshToken };
  }
}
