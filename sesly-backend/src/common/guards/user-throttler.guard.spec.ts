import { renderMessage } from '../../test-utils/i18n';
import { UserThrottlerGuard, clientIp } from './user-throttler.guard';

describe('UserThrottlerGuard', () => {
  const guard = Object.create(UserThrottlerGuard.prototype) as any;

  const httpContext = (req: Record<string, unknown>) =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => req }),
    }) as any;

  it('tracks by authenticated user id, else by client IP', async () => {
    await expect(guard.getTracker({ user: { id: 'u1' }, ip: '1.2.3.4' })).resolves.toBe('user:u1');
    await expect(guard.getTracker({ ip: '1.2.3.4', headers: {} })).resolves.toBe('ip:1.2.3.4');
  });

  it('skips Stripe / store webhooks and non-HTTP contexts only', async () => {
    await expect(guard.shouldSkip(httpContext({ originalUrl: '/webhooks/stripe' }))).resolves.toBe(true);
    await expect(guard.shouldSkip(httpContext({ originalUrl: '/webhooks' }))).resolves.toBe(true);
    await expect(guard.shouldSkip(httpContext({ originalUrl: '/voice-profiles/slots' }))).resolves.toBe(false);
    await expect(guard.shouldSkip(httpContext({ originalUrl: '/admin/ops/system/health' }))).resolves.toBe(false);
    await expect(guard.shouldSkip({ getType: () => 'ws' } as any)).resolves.toBe(true);
  });

  it('throws 429 with code RATE_LIMITED and a localized message key', async () => {
    const err = await guard.throwThrottlingException({} as any, {} as any).catch((e: any) => e);
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse()).toMatchObject({ code: 'RATE_LIMITED', message: 'errors.rateLimited' });
    expect(renderMessage(err)).toContain('Lütfen');
    expect(renderMessage(err, 'en')).toBe('You have sent too many requests. Please wait a moment and try again.');
  });

  it('clientIp prefers trust-proxy ips, then the proxy-appended XFF entry, then the socket', () => {
    expect(clientIp({ ips: ['9.9.9.9'], headers: { 'x-forwarded-for': '1.1.1.1' } })).toBe('9.9.9.9');
    expect(clientIp({ ips: [], headers: { 'x-forwarded-for': 'spoofed, 5.6.7.8' }, ip: '10.0.0.1' })).toBe('5.6.7.8');
    expect(clientIp({ headers: {}, ip: '10.0.0.1' })).toBe('10.0.0.1');
  });
});
