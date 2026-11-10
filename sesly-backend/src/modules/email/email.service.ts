import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { Resend } from 'resend';
import { EmailTemplatesService } from './email-templates.service';
import { RenderedEmail } from './templates/email-layout';
import { EmailTemplateFields, EmailTemplateLanguage } from './templates/email-template.types';

const DEFAULT_FROM = 'Sesly <onboarding@sesly.io>';

/**
 * Short, stable reference to an address for logs, so a log line never
 * carries the address itself.
 */
export function emailLogRef(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 12);
}

/**
 * Service emails through Resend: the welcome email and the password reset
 * email, each in the user's UI language, with the text from
 * EmailTemplatesService (panel text or code default) in the Sesly layout.
 *
 * Without RESEND_API_KEY every send is skipped with a warning (development).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend;
  private readonly fromEmail: string;
  private readonly isConfigured: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly templates: EmailTemplatesService,
  ) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    this.isConfigured = !!apiKey;
    this.fromEmail = withSenderName(this.configService.get<string>('EMAIL_FROM') || DEFAULT_FROM);

    if (!this.isConfigured) {
      this.logger.warn('RESEND_API_KEY is not set: emails are not sent.');
    }

    this.resend = new Resend(apiKey || 're_dummy_key_for_development');
  }

  /** True when RESEND_API_KEY is set. */
  get configured(): boolean {
    return this.isConfigured;
  }

  /**
   * Resend v4 never throws on API failures (revoked key, unverified sender
   * domain, rate limit): it resolves { data: null, error }. Turn that into a
   * thrown Error so callers never log "sent" for an email that was not sent.
   */
  private async send(to: string, email: RenderedEmail): Promise<void> {
    const result = await this.resend.emails.send({
      from: this.fromEmail,
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    if (result?.error) {
      const { name, message } = result.error;
      throw new Error(`Resend rejected the email (${name}): ${message}`);
    }
  }

  /** Welcome email after the first sign in. Never throws (not critical). */
  async sendWelcomeEmail(
    to: string,
    firstName: string | null | undefined,
    language: EmailTemplateLanguage,
  ): Promise<void> {
    if (!this.isConfigured) {
      this.logger.warn(`Email not configured, welcome email skipped (ref ${emailLogRef(to)})`);
      return;
    }
    try {
      const email = await this.templates.render('welcome', language, {
        name: firstName,
        email: to,
        link: this.templates.webBaseUrl(),
      });
      await this.send(to, email);
      this.logger.log(`Welcome email sent (${language}, ref ${emailLogRef(to)})`);
    } catch (error) {
      this.logger.error(
        `Welcome email failed (ref ${emailLogRef(to)}): ${(error as Error)?.message ?? error}`,
      );
    }
  }

  /**
   * Password reset email with our link to the web action page. Throws when
   * the email could not be sent; the caller logs it (and never tells the
   * client, see PasswordResetService).
   */
  async sendPasswordResetEmail(
    to: string,
    params: { link: string; firstName?: string | null; language: EmailTemplateLanguage },
  ): Promise<boolean> {
    if (!this.isConfigured) {
      this.logger.warn(`Email not configured, password reset email skipped (ref ${emailLogRef(to)})`);
      return false;
    }
    const email = await this.templates.render('password_reset', params.language, {
      name: params.firstName,
      email: to,
      link: params.link,
    });
    await this.send(to, email);
    this.logger.log(`Password reset email sent (${params.language}, ref ${emailLogRef(to)})`);
    return true;
  }

  /**
   * Test email from the admin panel: the draft or saved text with sample
   * values, subject prefixed with [Test]. 503 when Resend is not configured,
   * Resend errors are passed on as 503 with their message.
   */
  async sendTemplateTest(
    kind: string,
    language: string,
    to: string,
    draft: Partial<Record<keyof EmailTemplateFields, unknown>> = {},
  ): Promise<{ sent: true; to: string; subject: string }> {
    const rendered = await this.templates.renderTest(kind, language, to, draft);
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'E-posta gönderimi yapılandırılmamış: sunucuda RESEND_API_KEY tanımlı değil.',
      );
    }
    const subject = `[Test] ${rendered.email.subject}`;
    try {
      await this.send(to, { ...rendered.email, subject });
    } catch (error) {
      throw new ServiceUnavailableException(
        `Test e-postası gönderilemedi: ${(error as Error)?.message ?? 'bilinmeyen hata'}`,
      );
    }
    this.logger.log(`Test email sent kind=${rendered.kind} language=${rendered.language} (ref ${emailLogRef(to)})`);
    return { sent: true, to, subject };
  }
}

/** "noreply@sesly.io" becomes "Sesly <noreply@sesly.io>"; a named sender stays. */
function withSenderName(from: string): string {
  const value = from.trim();
  return value.includes('<') ? value : `Sesly <${value}>`;
}
