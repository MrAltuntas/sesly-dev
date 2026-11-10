const mockGenerateLink = jest.fn();
const mockFirebase = { apps: [{}] as unknown[] };

jest.mock('firebase-admin', () => ({
  get apps() {
    return mockFirebase.apps;
  },
  auth: () => ({ generatePasswordResetLink: (...args: unknown[]) => mockGenerateLink(...args) }),
}));

import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import {
  PASSWORD_RESET_EMAIL_LIMIT,
  PasswordResetService,
} from './password-reset.service';

const FIREBASE_LINK =
  'https://sesly-app.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=CODE-123&apiKey=WEB-KEY&lang=tr';

describe('PasswordResetService', () => {
  let prisma: { user: { findFirst: jest.Mock } };
  let email: { sendPasswordResetEmail: jest.Mock };
  let storage: { increment: jest.Mock };
  let config: Record<string, string | undefined>;
  let service: PasswordResetService;
  let hits: Map<string, number>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFirebase.apps = [{}];
    mockGenerateLink.mockResolvedValue(FIREBASE_LINK);
    prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({ firstName: 'Ayşe', preferences: { uiLanguage: 'en' } }),
      },
    };
    email = { sendPasswordResetEmail: jest.fn().mockResolvedValue(true) };
    hits = new Map();
    storage = {
      increment: jest.fn(async (key: string) => {
        const total = (hits.get(key) ?? 0) + 1;
        hits.set(key, total);
        return { totalHits: total, timeToExpire: 3600, isBlocked: false, timeToBlockExpire: 0 };
      }),
    };
    config = { 'app.frontendUrl': 'https://sesly.test/' };
    service = new PasswordResetService(
      prisma as any,
      { get: jest.fn((key: string) => config[key]) } as any,
      email as any,
      storage as any,
    );
  });

  describe('request (the HTTP answer)', () => {
    it('answers the same for an existing and an unknown address', async () => {
      const deliver = jest.spyOn(service, 'deliver');
      const known = await service.request('ayse@example.com', undefined, undefined);
      mockGenerateLink.mockRejectedValue({ code: 'auth/user-not-found' });
      const unknown = await service.request('nobody@example.com', undefined, undefined);

      expect(known).toEqual({ accepted: true });
      expect(unknown).toEqual(known);
      await expect(deliver.mock.results[0].value).resolves.toBe('sent');
      await expect(deliver.mock.results[1].value).resolves.toBe('no-account');
    });

    it('answers before the lookup and the email are done (timing does not depend on the account)', async () => {
      mockGenerateLink.mockReturnValue(new Promise(() => undefined)); // never settles
      await expect(service.request('ayse@example.com', undefined, undefined)).resolves.toEqual({ accepted: true });
      expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('normalises the address (trim, lower case) for the limiter and the lookup', async () => {
      const deliver = jest.spyOn(service, 'deliver');
      await service.request('  Ayse@Example.COM ', undefined, undefined);
      expect(deliver).toHaveBeenCalledWith('ayse@example.com', null);
      await deliver.mock.results[0].value;
      expect(mockGenerateLink).toHaveBeenCalledWith('ayse@example.com');
    });

    it(`allows ${PASSWORD_RESET_EMAIL_LIMIT.limit} requests per address and hour, then 429 RATE_LIMITED`, async () => {
      for (let i = 0; i < PASSWORD_RESET_EMAIL_LIMIT.limit; i++) {
        await expect(service.request('ayse@example.com', undefined, undefined)).resolves.toEqual({ accepted: true });
      }
      const error = await service.request('AYSE@example.com', undefined, undefined).catch((e) => e);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect((error as HttpException).getResponse()).toEqual({ code: 'RATE_LIMITED', message: 'errors.rateLimited' });
      // Another address has its own counter.
      await expect(service.request('other@example.com', undefined, undefined)).resolves.toEqual({ accepted: true });
    });

    it('the limit counts unknown addresses too (a 429 says nothing about the account)', async () => {
      mockGenerateLink.mockRejectedValue({ code: 'auth/user-not-found' });
      for (let i = 0; i < PASSWORD_RESET_EMAIL_LIMIT.limit; i++) {
        await service.request('nobody@example.com', undefined, undefined);
      }
      await expect(service.request('nobody@example.com', undefined, undefined)).rejects.toBeInstanceOf(HttpException);
    });

    it('limiter key is a hash, never the address, with the configured window', async () => {
      await service.request('ayse@example.com', undefined, undefined);
      const [key, ttl, limit] = storage.increment.mock.calls[0];
      expect(key).toMatch(/^password-reset:email:[0-9a-f]{12}$/);
      expect(key).not.toContain('ayse');
      expect(ttl).toBe(PASSWORD_RESET_EMAIL_LIMIT.ttl);
      expect(limit).toBe(PASSWORD_RESET_EMAIL_LIMIT.limit);
    });

    it('a broken limiter never blocks a reset', async () => {
      storage.increment.mockRejectedValue(new Error('storage down'));
      await expect(service.request('ayse@example.com', undefined, undefined)).resolves.toEqual({ accepted: true });
    });

    it.each([
      ['en', 'tr-TR', 'en'],
      [undefined, 'en-US,en;q=0.9', 'en'],
      ['de', 'en', 'en'],
      ['de', undefined, null],
      [undefined, undefined, null],
    ])('language hint: lang %p + Accept-Language %p gives %p', async (lang, acceptLanguage, expected) => {
      const deliver = jest.spyOn(service, 'deliver').mockResolvedValue('sent');
      await service.request('ayse@example.com', lang, acceptLanguage);
      expect(deliver).toHaveBeenCalledWith('ayse@example.com', expected);
    });
  });

  describe('deliver', () => {
    it('sends our link to the web action page with the Firebase code, in the hinted language', async () => {
      await expect(service.deliver('ayse@example.com', 'tr')).resolves.toBe('sent');
      expect(email.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      const [to, params] = email.sendPasswordResetEmail.mock.calls[0];
      expect(to).toBe('ayse@example.com');
      expect(params.language).toBe('tr');
      expect(params.firstName).toBe('Ayşe');
      const link = new URL(params.link);
      expect(link.origin + link.pathname).toBe('https://sesly.test/auth/action');
      expect(Object.fromEntries(link.searchParams)).toEqual({
        mode: 'resetPassword',
        oobCode: 'CODE-123',
        apiKey: 'WEB-KEY',
        lang: 'tr',
      });
    });

    it('without a hint uses the stored UI language, else Turkish', async () => {
      await service.deliver('ayse@example.com', null);
      expect(email.sendPasswordResetEmail.mock.calls[0][1].language).toBe('en');
      expect(new URL(email.sendPasswordResetEmail.mock.calls[0][1].link).searchParams.get('lang')).toBe('en');

      prisma.user.findFirst.mockResolvedValue({ firstName: null, preferences: null });
      await service.deliver('ayse@example.com', null);
      expect(email.sendPasswordResetEmail.mock.calls[1][1]).toMatchObject({ language: 'tr', firstName: null });

      prisma.user.findFirst.mockResolvedValue(null); // Firebase account without a backend row
      await service.deliver('ayse@example.com', null);
      expect(email.sendPasswordResetEmail.mock.calls[2][1]).toMatchObject({ language: 'tr', firstName: null });
    });

    it('looks the user up case-insensitively', async () => {
      await service.deliver('ayse@example.com', null);
      expect(prisma.user.findFirst.mock.calls[0][0].where).toEqual({
        email: { equals: 'ayse@example.com', mode: 'insensitive' },
      });
    });

    it('unknown address: nothing is sent and the log never names the address', async () => {
      const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
      mockGenerateLink.mockRejectedValue({ code: 'auth/user-not-found' });
      await expect(service.deliver('nobody@example.com', 'tr')).resolves.toBe('no-account');
      expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
      for (const call of debug.mock.calls) expect(String(call[0])).not.toContain('nobody');
      debug.mockRestore();
    });

    it('Firebase or Resend failures are logged with the hash only and never thrown', async () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      mockGenerateLink.mockRejectedValue(Object.assign(new Error('quota'), { code: 'auth/internal-error' }));
      await expect(service.deliver('ayse@example.com', 'tr')).resolves.toBe('failed');

      mockGenerateLink.mockResolvedValue(FIREBASE_LINK);
      email.sendPasswordResetEmail.mockRejectedValue(new Error('Resend rejected the email'));
      await expect(service.deliver('ayse@example.com', 'tr')).resolves.toBe('failed');

      expect(error).toHaveBeenCalledTimes(2);
      for (const call of error.mock.calls) expect(String(call[0])).not.toContain('ayse');
      error.mockRestore();
    });

    it('Firebase Admin not initialised: not-configured, no call', async () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      mockFirebase.apps = [];
      await expect(service.deliver('ayse@example.com', 'tr')).resolves.toBe('not-configured');
      expect(mockGenerateLink).not.toHaveBeenCalled();
      error.mockRestore();
    });

    it('a Firebase link without oobCode is not sent', async () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      mockGenerateLink.mockResolvedValue('https://sesly-app.firebaseapp.com/__/auth/action?mode=resetPassword');
      await expect(service.deliver('ayse@example.com', 'tr')).resolves.toBe('failed');
      expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
      error.mockRestore();
    });
  });

  describe('actionLink', () => {
    it('defaults to https://sesly.io and leaves apiKey out when Firebase sent none', () => {
      config['app.frontendUrl'] = undefined;
      expect(service.actionLink('https://x.test/a?oobCode=A%2BB', 'en')).toBe(
        'https://sesly.io/auth/action?mode=resetPassword&oobCode=A%2BB&lang=en',
      );
    });

    it('null for something that is not a URL', () => {
      expect(service.actionLink('not a url', 'tr')).toBeNull();
    });
  });
});
