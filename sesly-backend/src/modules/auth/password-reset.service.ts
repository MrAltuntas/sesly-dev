import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as admin from 'firebase-admin';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService, emailLogRef } from '../email/email.service';
import {
  DEFAULT_UI_LANGUAGE,
  parseUiLanguage,
  UiLanguage,
  uiLanguageFromAcceptLanguage,
} from '../../common/i18n/ui-language';

const HOUR_MS = 60 * 60 * 1000;

/** Per client IP on POST /auth/password-reset (route @Throttle). */
export const PASSWORD_RESET_IP_LIMIT = { limit: 10, ttl: HOUR_MS } as const;

/** Per email address, whatever the IP. */
export const PASSWORD_RESET_EMAIL_LIMIT = { limit: 3, ttl: HOUR_MS } as const;

/** Firebase error codes that mean "no account with this address". */
const NO_ACCOUNT_CODES = new Set(['auth/user-not-found', 'auth/email-not-found']);

/**
 * Our own password reset email (POST /auth/password-reset).
 *
 * Firebase Auth's email templates allow one text for every language, so
 * the app no longer calls Firebase's sendPasswordResetEmail. Instead the
 * backend asks the Admin SDK for the reset link, takes its one-time code and
 * sends our link to the web action page (`<FRONTEND_URL>/auth/action`, the
 * page that already handles Firebase's links) in the user's language through
 * Resend.
 *
 * Enumeration safety: the response is the same 202 whether the address has
 * an account or not, and it is sent before any lookup happens (the lookup,
 * Firebase call and email run in the background), so its timing does not
 * depend on the account either. Logs name the address by a hash only.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
    @Inject(ThrottlerStorage) private readonly throttlerStorage: ThrottlerStorage,
  ) {}

  /**
   * Accepts a reset request. 429 (code RATE_LIMITED) when this address
   * already had PASSWORD_RESET_EMAIL_LIMIT requests in the window; the
   * counter is per address whether an account exists or not.
   */
  async request(
    rawEmail: string,
    langHint: string | undefined,
    acceptLanguage: string | undefined,
  ): Promise<{ accepted: true }> {
    const email = rawEmail.trim().toLowerCase();
    await this.consumeEmailQuota(email);

    const hinted = parseUiLanguage(langHint) ?? uiLanguageFromAcceptLanguage(acceptLanguage);
    // Not awaited on purpose (see the class comment). deliver never rejects.
    void this.deliver(email, hinted);
    return { accepted: true };
  }

  /**
   * Looks the address up, asks Firebase for a reset code and sends the
   * email. Never throws: every failure is logged with the address hash.
   * Resolves to what happened, for tests.
   */
  async deliver(
    email: string,
    hinted: UiLanguage | null,
  ): Promise<'sent' | 'no-account' | 'not-configured' | 'failed'> {
    const ref = emailLogRef(email);
    try {
      if (!admin.apps.length) {
        this.logger.error(`Password reset not possible, Firebase Admin is not initialised (ref ${ref})`);
        return 'not-configured';
      }

      let firebaseLink: string;
      try {
        firebaseLink = await admin.auth().generatePasswordResetLink(email);
      } catch (error) {
        const code = (error as { code?: string })?.code ?? '';
        if (NO_ACCOUNT_CODES.has(code)) {
          this.logger.debug(`Password reset requested, nothing sent (ref ${ref})`);
          return 'no-account';
        }
        throw error;
      }

      const user = await this.findUser(email);
      const language = hinted ?? parseUiLanguage(user?.preferences?.uiLanguage) ?? DEFAULT_UI_LANGUAGE;
      const link = this.actionLink(firebaseLink, language);
      if (!link) {
        this.logger.error(`Password reset link from Firebase has no oobCode (ref ${ref})`);
        return 'failed';
      }

      const sent = await this.emailService.sendPasswordResetEmail(email, {
        link,
        firstName: user?.firstName ?? null,
        language,
      });
      return sent ? 'sent' : 'not-configured';
    } catch (error) {
      this.logger.error(`Password reset email failed (ref ${ref}): ${(error as Error)?.message ?? error}`);
      return 'failed';
    }
  }

  /**
   * Our link to the web action page with the one-time code of Firebase's
   * link: `<FRONTEND_URL>/auth/action?mode=resetPassword&oobCode=..&apiKey=..&lang=..`.
   * `apiKey` is passed on because the page falls back to it when its build
   * has no Firebase key; `lang` sets the page language. Null without a code.
   */
  actionLink(firebaseLink: string, language: UiLanguage): string | null {
    let source: URL;
    try {
      source = new URL(firebaseLink);
    } catch {
      return null;
    }
    const oobCode = source.searchParams.get('oobCode');
    if (!oobCode) return null;

    const base = (this.config.get<string>('app.frontendUrl') || 'https://sesly.io').replace(/\/+$/, '');
    const target = new URL(`${base}/auth/action`);
    target.searchParams.set('mode', 'resetPassword');
    target.searchParams.set('oobCode', oobCode);
    const apiKey = source.searchParams.get('apiKey');
    if (apiKey) target.searchParams.set('apiKey', apiKey);
    target.searchParams.set('lang', language);
    return target.toString();
  }

  private async consumeEmailQuota(email: string): Promise<void> {
    const { limit, ttl } = PASSWORD_RESET_EMAIL_LIMIT;
    let hits = 0;
    try {
      const record = await this.throttlerStorage.increment(
        `password-reset:email:${emailLogRef(email)}`,
        ttl,
        limit,
        ttl,
        'password-reset-email',
      );
      hits = record.totalHits;
    } catch (error) {
      // The limiter must never block a legitimate reset.
      this.logger.warn(`Password reset email limiter unavailable: ${(error as Error)?.message}`);
      return;
    }
    if (hits > limit) {
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'errors.rateLimited' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async findUser(email: string) {
    try {
      return await this.prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { firstName: true, preferences: { select: { uiLanguage: true } } },
      });
    } catch (error) {
      this.logger.warn(`User lookup for password reset failed: ${(error as Error)?.message}`);
      return null;
    }
  }
}
