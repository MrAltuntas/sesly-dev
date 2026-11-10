import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { JwtStrategy } from './jwt.strategy';
import { JwtRefreshStrategy } from './jwt-refresh.strategy';
import { createMockPrismaService, MockPrismaService } from '../../../test-utils/prisma-mock';
import { createMockUser } from '../../../test-utils/mock-factories';

const CONFIG: Record<string, string> = {
  'jwt.secret': 'unit-access-secret',
  'jwt.refreshSecret': 'unit-refresh-secret',
  'jwt.adminSecret': 'unit-admin-secret',
  'jwt.adminRefreshSecret': 'unit-admin-refresh-secret',
};

type Outcome =
  | { kind: 'success'; user: any }
  | { kind: 'fail'; info: any }
  | { kind: 'error'; err: any };

/**
 * Drives the real passport-jwt pipeline (header extraction, signature and
 * expiry check, then our validate()) without Nest or HTTP.
 */
function runStrategy(strategy: any, token?: string): Promise<Outcome> {
  return new Promise((resolve) => {
    const s = Object.create(strategy);
    s.success = (user: any) => resolve({ kind: 'success', user });
    s.fail = (info: any) => resolve({ kind: 'fail', info });
    s.error = (err: any) => resolve({ kind: 'error', err });
    s.authenticate({ headers: token ? { authorization: `Bearer ${token}` } : {}, body: {} }, {});
  });
}

function sign(secret: string, payload: Record<string, any> = { sub: 'u-1', email: 'a@example.com' }, expiresIn: string | number = '1h') {
  return jwt.sign(payload, secret, { expiresIn });
}

describe('User JWT strategies', () => {
  let prisma: MockPrismaService;
  let configService: { get: jest.Mock };

  beforeEach(() => {
    prisma = createMockPrismaService();
    configService = { get: jest.fn((key: string) => CONFIG[key]) };
  });

  describe('JwtStrategy (access token -> request.user)', () => {
    let strategy: JwtStrategy;

    beforeEach(() => {
      strategy = new JwtStrategy(configService as any, prisma as any);
    });

    it('validate() loads the user by payload.sub with a safe field selection', async () => {
      const safe = { id: 'u-1', email: 'a@example.com', firstName: 'A', lastName: 'B', emailVerified: true, provider: 'EMAIL' };
      prisma.user.findUnique.mockResolvedValue({ ...safe, tokenVersion: 0 });

      const result = await strategy.validate({ sub: 'u-1', email: 'a@example.com' });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          emailVerified: true,
          provider: true,
          tokenVersion: true,
        },
      });
      // The session generation is only used for the check, never exposed.
      expect(result).toEqual(safe);
    });

    it('request.user shape: exactly id/email/firstName/lastName/emailVerified/provider (no secrets selected)', async () => {
      prisma.user.findUnique.mockResolvedValue({});
      const result = await strategy.validate({ sub: 'u-1', email: 'a@example.com' });

      const { select } = prisma.user.findUnique.mock.calls[0][0];
      expect(Object.keys(select).sort()).toEqual(
        ['email', 'emailVerified', 'firstName', 'id', 'lastName', 'provider', 'tokenVersion'].sort(),
      );
      expect(result).not.toHaveProperty('tokenVersion');
      expect(select).not.toHaveProperty('passwordHash');
      expect(select).not.toHaveProperty('passwordResetToken');
      expect(select).not.toHaveProperty('emailVerificationToken');
    });

    it('validate() throws 401 when the user no longer exists (deleted account)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(strategy.validate({ sub: 'u-gone', email: 'a@example.com' })).rejects.toThrow(
        new UnauthorizedException('User not found'),
      );
    });

    describe('session revocation (tv claim vs users.tokenVersion)', () => {
      it.each([
        ['current generation', { tv: 4 }, 4],
        ['pre-revocation token (no tv) before any bump', {}, 0],
      ])('accepts a token of the %s', async (_label, claims, current) => {
        prisma.user.findUnique.mockResolvedValue({ id: 'u-1', email: 'a@example.com', tokenVersion: current });

        await expect(strategy.validate({ sub: 'u-1', email: 'a@example.com', ...claims })).resolves.toEqual({
          id: 'u-1',
          email: 'a@example.com',
        });
      });

      it.each([
        ['an older generation (logged out since)', { tv: 3 }, 4],
        ['a pre-revocation token (no tv) after the first bump', {}, 1],
      ])('rejects %s with 401 immediately', async (_label, claims, current) => {
        prisma.user.findUnique.mockResolvedValue({ id: 'u-1', email: 'a@example.com', tokenVersion: current });

        await expect(strategy.validate({ sub: 'u-1', email: 'a@example.com', ...claims })).rejects.toThrow(
          new UnauthorizedException('Session revoked'),
        );
      });

      it('surfaces 401 end-to-end for a validly signed but revoked access token', async () => {
        prisma.user.findUnique.mockResolvedValue({ id: 'u-1', email: 'a@example.com', tokenVersion: 1 });

        const out = await runStrategy(strategy, sign(CONFIG['jwt.secret'], { sub: 'u-1', email: 'a@example.com', tv: 0 }));

        expect(out.kind).toBe('error');
        expect((out as any).err).toBeInstanceOf(UnauthorizedException);
      });
    });

    it('accepts a valid access token end-to-end and populates request.user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u-1', email: 'a@example.com' });

      const out = await runStrategy(strategy, sign(CONFIG['jwt.secret']));

      expect(out).toEqual({ kind: 'success', user: { id: 'u-1', email: 'a@example.com' } });
    });

    it('rejects a refresh token presented as an access token', async () => {
      const out = await runStrategy(strategy, sign(CONFIG['jwt.refreshSecret']));

      expect(out.kind).toBe('fail');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an admin access token on user routes', async () => {
      const out = await runStrategy(
        strategy,
        sign(CONFIG['jwt.adminSecret'], { sub: 'admin-1', email: 'x@sesly.com', role: 'SUPER_ADMIN' }),
      );

      expect(out.kind).toBe('fail');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an expired access token (ignoreExpiration=false)', async () => {
      const expired = jwt.sign(
        { sub: 'u-1', email: 'a@example.com', exp: Math.floor(Date.now() / 1000) - 60 },
        CONFIG['jwt.secret'],
      );

      const out = await runStrategy(strategy, expired);

      expect(out.kind).toBe('fail');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a request without a bearer token', async () => {
      const out = await runStrategy(strategy);

      expect(out.kind).toBe('fail');
    });

    it('surfaces 401 when the token is valid but the user was deleted', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const out = await runStrategy(strategy, sign(CONFIG['jwt.secret']));

      expect(out.kind).toBe('error');
      expect((out as any).err).toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('JwtRefreshStrategy', () => {
    let strategy: JwtRefreshStrategy;

    beforeEach(() => {
      strategy = new JwtRefreshStrategy(configService as any, prisma as any);
    });

    it('validate() returns the user found by payload.sub', async () => {
      const user = createMockUser({ id: 'u-1' });
      prisma.user.findUnique.mockResolvedValue(user);

      await expect(strategy.validate({ sub: 'u-1', email: user.email })).resolves.toBe(user);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u-1' } });
    });

    it('validate() throws 401 when the user no longer exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(strategy.validate({ sub: 'u-gone', email: 'a@example.com' })).rejects.toThrow(
        new UnauthorizedException('User not found'),
      );
    });

    it('validate() rejects a refresh token of an older generation with 401', async () => {
      prisma.user.findUnique.mockResolvedValue(createMockUser({ id: 'u-1', tokenVersion: 2 }));

      await expect(strategy.validate({ sub: 'u-1', email: 'a@example.com', tv: 1 })).rejects.toThrow(
        new UnauthorizedException('Session revoked'),
      );
      await expect(strategy.validate({ sub: 'u-1', email: 'a@example.com' })).rejects.toThrow(
        new UnauthorizedException('Session revoked'),
      );
    });

    it('validate() accepts a refresh token of the current generation', async () => {
      const user = createMockUser({ id: 'u-1', tokenVersion: 2 });
      prisma.user.findUnique.mockResolvedValue(user);

      await expect(strategy.validate({ sub: 'u-1', email: user.email, tv: 2 })).resolves.toBe(user);
    });

    it('verifies with the refresh secret: refresh token accepted, access token rejected', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u-1' });

      const ok = await runStrategy(strategy, sign(CONFIG['jwt.refreshSecret'], undefined, '7d'));
      const bad = await runStrategy(strategy, sign(CONFIG['jwt.secret']));

      expect(ok).toEqual({ kind: 'success', user: { id: 'u-1' } });
      expect(bad.kind).toBe('fail');
    });
  });
});
