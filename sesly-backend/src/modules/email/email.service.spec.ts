const mockSend = jest.fn();

// Module-level mock: no real Resend client, no network.
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: (...args: unknown[]) => mockSend(...args) },
  })),
}));

import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Resend } from 'resend';
import { EmailService, emailLogRef } from './email.service';
import { EmailTemplatesService } from './email-templates.service';

const ResendCtor = Resend as unknown as jest.Mock;
const WEB = 'https://sesly.test';

describe('EmailService', () => {
  let config: Record<string, string | undefined>;
  let prisma: { emailTemplate: { findUnique: jest.Mock } };
  let templates: EmailTemplatesService;

  const build = () => {
    const configService = { get: jest.fn((key: string) => config[key]) } as any;
    templates = new EmailTemplatesService(prisma as any, configService);
    return new EmailService(configService, templates);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    config = {
      RESEND_API_KEY: 're_test_key',
      EMAIL_FROM: 'noreply@sesly.test',
      'app.frontendUrl': WEB,
    };
    prisma = { emailTemplate: { findUnique: jest.fn().mockResolvedValue(null) } };
    mockSend.mockResolvedValue({ data: { id: 'email-1' }, error: null });
  });

  describe('configured (RESEND_API_KEY set)', () => {
    it('creates the Resend client with the configured key and names the sender Sesly', async () => {
      await build().sendWelcomeEmail('a@example.com', 'Ali', 'tr');
      expect(ResendCtor).toHaveBeenCalledWith('re_test_key');
      expect(mockSend.mock.calls[0][0].from).toBe('Sesly <noreply@sesly.test>');
    });

    it('keeps a sender that already has a display name; default sender without EMAIL_FROM', async () => {
      config.EMAIL_FROM = 'Sesly Ekibi <hello@sesly.test>';
      await build().sendWelcomeEmail('a@example.com', 'Ali', 'tr');
      expect(mockSend.mock.calls[0][0].from).toBe('Sesly Ekibi <hello@sesly.test>');

      config.EMAIL_FROM = undefined;
      await build().sendWelcomeEmail('a@example.com', 'Ali', 'tr');
      expect(mockSend.mock.calls[1][0].from).toBe('Sesly <onboarding@sesly.io>');
    });

    it('welcome email in Turkish: subject, greeting by first name, html and text', async () => {
      await build().sendWelcomeEmail('ayse@example.com', 'Ayşe', 'tr');
      const payload = mockSend.mock.calls[0][0];
      expect(payload).toMatchObject({ to: 'ayse@example.com', subject: "Sesly'ye hoş geldin" });
      expect(payload.html).toContain('Merhaba Ayşe,');
      expect(payload.html).toContain('<html lang="tr"');
      expect(payload.html).toContain(`href="${WEB}"`);
      expect(payload.text).toContain('Merhaba Ayşe,');
    });

    it('welcome email in English, without a name', async () => {
      await build().sendWelcomeEmail('emma@example.com', undefined, 'en');
      const payload = mockSend.mock.calls[0][0];
      expect(payload.subject).toBe('Welcome to Sesly');
      expect(payload.html).toContain('Hi,');
      expect(payload.html).toContain('<html lang="en"');
    });

    it('a saved panel text replaces the default', async () => {
      prisma.emailTemplate.findUnique.mockResolvedValue({
        kind: 'welcome',
        language: 'tr',
        subject: 'Panel konusu',
        preheader: '',
        heading: 'Panel başlığı',
        body: 'Selam {{name}}',
        buttonLabel: '',
        note: '',
        footer: '',
      });
      await build().sendWelcomeEmail('a@example.com', 'Ali', 'tr');
      expect(prisma.emailTemplate.findUnique).toHaveBeenCalledWith({
        where: { kind_language: { kind: 'welcome', language: 'tr' } },
      });
      expect(mockSend.mock.calls[0][0].subject).toBe('Panel konusu');
      expect(mockSend.mock.calls[0][0].html).toContain('Selam Ali');
    });

    it('a database error falls back to the default text', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      prisma.emailTemplate.findUnique.mockRejectedValue(new Error('db down'));
      await build().sendWelcomeEmail('a@example.com', 'Ali', 'en');
      expect(mockSend.mock.calls[0][0].subject).toBe('Welcome to Sesly');
    });

    it('password reset email: localized subject, our link in the button and the text version', async () => {
      const link = `${WEB}/auth/action?mode=resetPassword&oobCode=abc&lang=en`;
      await expect(
        build().sendPasswordResetEmail('emma@example.com', { link, firstName: 'Emma', language: 'en' }),
      ).resolves.toBe(true);
      const payload = mockSend.mock.calls[0][0];
      expect(payload.subject).toBe('Reset your Sesly password');
      expect(payload.html).toContain('href="https://sesly.test/auth/action?mode=resetPassword&amp;oobCode=abc&amp;lang=en"');
      expect(payload.html).toContain('emma@example.com');
      expect(payload.text).toContain(`Choose a new password: ${link}`);
    });

    it('password reset: rethrows client errors and Resend error results', async () => {
      const err = new Error('network down');
      mockSend.mockRejectedValueOnce(err);
      const params = { link: `${WEB}/x`, language: 'tr' as const };
      await expect(build().sendPasswordResetEmail('a@example.com', params)).rejects.toBe(err);

      // Resend v4 resolves { data: null, error } instead of throwing.
      mockSend.mockResolvedValueOnce({ data: null, error: { name: 'rate_limit_exceeded', message: 'Too many requests.' } });
      await expect(build().sendPasswordResetEmail('a@example.com', params)).rejects.toThrow(
        'Resend rejected the email (rate_limit_exceeded): Too many requests.',
      );
    });

    it('welcome: client errors and Resend error results are logged with a hash, never thrown', async () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      mockSend.mockRejectedValueOnce(new Error('network down'));
      await expect(build().sendWelcomeEmail('ayse@example.com', 'Ali', 'tr')).resolves.toBeUndefined();
      mockSend.mockResolvedValueOnce({ data: null, error: { name: 'invalid_api_key', message: 'API key is invalid' } });
      await expect(build().sendWelcomeEmail('ayse@example.com', 'Ali', 'tr')).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledTimes(2);
      for (const call of error.mock.calls) {
        expect(String(call[0])).not.toContain('ayse@example.com');
        expect(String(call[0])).toContain(emailLogRef('ayse@example.com'));
      }
    });

    it('test email: [Test] subject, sample name, sent to the given address', async () => {
      await expect(build().sendTemplateTest('password_reset', 'tr', 'ben@sesly.test')).resolves.toEqual({
        sent: true,
        to: 'ben@sesly.test',
        subject: '[Test] Sesly şifreni sıfırla',
      });
      const payload = mockSend.mock.calls[0][0];
      expect(payload.to).toBe('ben@sesly.test');
      expect(payload.html).toContain('Merhaba Ayşe,');
      expect(payload.html).toContain('ben@sesly.test');
      expect(payload.html).toContain('oobCode=ornek-kod');
    });

    it('test email: unsaved draft fields are used; Resend errors become 503', async () => {
      await build().sendTemplateTest('welcome', 'en', 'ben@sesly.test', { heading: 'Draft heading' });
      expect(mockSend.mock.calls[0][0].html).toContain('Draft heading');

      mockSend.mockResolvedValueOnce({ data: null, error: { name: 'validation_error', message: 'Domain not verified' } });
      const error = await build().sendTemplateTest('welcome', 'en', 'ben@sesly.test').catch((e) => e);
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error.message).toContain('Domain not verified');
    });
  });

  describe('not configured (RESEND_API_KEY missing)', () => {
    beforeEach(() => {
      config.RESEND_API_KEY = undefined;
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    it('still constructs (dummy key) instead of throwing', () => {
      expect(() => build()).not.toThrow();
      expect(ResendCtor).toHaveBeenCalledWith('re_dummy_key_for_development');
      expect(build().configured).toBe(false);
    });

    it('skips every user email without calling Resend', async () => {
      const service = build();
      await expect(service.sendWelcomeEmail('a@example.com', 'Ali', 'tr')).resolves.toBeUndefined();
      await expect(
        service.sendPasswordResetEmail('a@example.com', { link: 'https://x.test', language: 'tr' }),
      ).resolves.toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('treats an empty key as not configured', async () => {
      config.RESEND_API_KEY = '';
      await build().sendWelcomeEmail('a@example.com', 'Ali', 'tr');
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('test email: 503 with a Turkish reason', async () => {
      await expect(build().sendTemplateTest('welcome', 'tr', 'ben@sesly.test')).rejects.toThrow(
        'E-posta gönderimi yapılandırılmamış: sunucuda RESEND_API_KEY tanımlı değil.',
      );
    });
  });
});

describe('emailLogRef', () => {
  it('is a short stable hash, the same for any case and surrounding space', () => {
    expect(emailLogRef('Ayse@Example.com ')).toBe(emailLogRef('ayse@example.com'));
    expect(emailLogRef('ayse@example.com')).toMatch(/^[0-9a-f]{12}$/);
    expect(emailLogRef('ayse@example.com')).not.toBe(emailLogRef('ali@example.com'));
  });
});
