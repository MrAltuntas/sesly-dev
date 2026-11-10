import { renderMessage } from '../../test-utils/i18n';
import { HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { MaintenanceGuard } from './maintenance.guard';

function createContext(request: Record<string, any>) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

describe('MaintenanceGuard', () => {
  let maintenance: { getEnabledSync: jest.Mock };
  let guard: MaintenanceGuard;

  beforeEach(() => {
    maintenance = { getEnabledSync: jest.fn().mockReturnValue(false) };
    guard = new MaintenanceGuard(maintenance as any);
  });

  it('maintenance OFF: every route passes, including user routes', () => {
    for (const path of ['/stories', '/narrations', '/voice-profiles/x', '/admin/users']) {
      expect(guard.canActivate(createContext({ path }))).toBe(true);
    }
  });

  describe('maintenance ON', () => {
    beforeEach(() => {
      maintenance.getEnabledSync.mockReturnValue(true);
    });

    it.each(['/stories', '/narrations', '/voice-profiles', '/auth/firebase', '/users/me', '/subscriptions/plans'])(
      'blocks user route %s with 503 + localized message',
      (path) => {
        let error: any;
        try {
          guard.canActivate(createContext({ path }));
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect(error.getResponse()).toMatchObject({
          statusCode: 503,
          message: 'errors.maintenance',
        });
        expect(renderMessage(error)).toBe('Sistem bakım altında, birazdan tekrar deneyin.');
        expect(renderMessage(error, 'en')).toBe('Sesly is under maintenance. Please try again shortly.');
      },
    );

    it.each([
      '/admin',
      '/admin/',
      '/admin/auth/login',
      '/admin/ops/system/maintenance',
      '/health',
      '/health/ready',
      '/legal',
      '/legal/tos',
      '/app/config',
      '/app/config/',
      '/',
      '',
    ])('allows %s (admin panel, health probes, legal pages, app config, root)', (path) => {
      expect(guard.canActivate(createContext({ path }))).toBe(true);
    });

    it('allows GET /app/config?platform=ios via url fallback (force-update gate)', () => {
      expect(guard.canActivate(createContext({ url: '/app/config?platform=ios' }))).toBe(true);
    });

    it.each([
      '/admin-foo',
      '/administrator',
      '/healthz',
      '/legalese',
      '/stories/admin',
      '/api/admin',
      '/app',
      '/app/configx',
      '/app/config/other',
      '/apps/config',
    ])(
      'allowlist is anchored: %s is still blocked',
      (path) => {
        expect(() => guard.canActivate(createContext({ path }))).toThrow(ServiceUnavailableException);
      },
    );

    it('falls back to url / originalUrl and ignores the query string', () => {
      expect(guard.canActivate(createContext({ url: '/admin/users?page=2' }))).toBe(true);
      expect(guard.canActivate(createContext({ originalUrl: '/health?probe=1' }))).toBe(true);
      expect(() => guard.canActivate(createContext({ url: '/stories?next=/admin' }))).toThrow(
        ServiceUnavailableException,
      );
    });

    it('a request with no path information is treated as root', () => {
      expect(guard.canActivate(createContext({}))).toBe(true);
    });
  });

  it('reads the flag synchronously on every request (no Redis round trip in the guard)', () => {
    guard.canActivate(createContext({ path: '/stories' }));
    guard.canActivate(createContext({ path: '/stories' }));
    expect(maintenance.getEnabledSync).toHaveBeenCalledTimes(2);
  });
});
