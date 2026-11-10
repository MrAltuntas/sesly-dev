import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AdminJwtStrategy } from './admin-jwt.strategy';
import { AdminJwtRefreshStrategy } from './admin-jwt-refresh.strategy';
import { createMockPrismaService, MockPrismaService } from '../../../test-utils/prisma-mock';

const CONFIG: Record<string, string | undefined> = {
  'jwt.secret': 'unit-access-secret',
  'jwt.refreshSecret': 'unit-refresh-secret',
  'jwt.adminSecret': 'unit-admin-secret',
  'jwt.adminRefreshSecret': 'unit-admin-refresh-secret',
};

const ADMIN_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  tokenVersion: true,
};

type Outcome =
  | { kind: 'success'; user: any }
  | { kind: 'fail'; info: any }
  | { kind: 'error'; err: any };

function runStrategy(strategy: any, token?: string): Promise<Outcome> {
  return new Promise((resolve) => {
    const s = Object.create(strategy);
    s.success = (user: any) => resolve({ kind: 'success', user });
    s.fail = (info: any) => resolve({ kind: 'fail', info });
    s.error = (err: any) => resolve({ kind: 'error', err });
    s.authenticate({ headers: token ? { authorization: `Bearer ${token}` } : {}, body: {} }, {});
  });
}

const adminPayload = { sub: 'admin-1', email: 'ops@sesly.com', role: 'SUPER_ADMIN' as const };

function sign(secret: string | undefined, payload: Record<string, any> = adminPayload, expiresIn: string = '1h') {
  return jwt.sign(payload, secret as string, { expiresIn });
}

describe('Admin JWT strategies', () => {
  let prisma: MockPrismaService;
  let config: Record<string, string | undefined>;
  let configService: { get: jest.Mock };
  const safeAdmin = {
    id: 'admin-1',
    email: 'ops@sesly.com',
    firstName: 'Ops',
    lastName: 'Admin',
    role: 'SUPER_ADMIN',
    isActive: true,
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    config = { ...CONFIG };
    configService = { get: jest.fn((k: string) => config[k]) };
    prisma.admin.findUnique.mockResolvedValue({ ...safeAdmin, tokenVersion: 0 });
  });

  describe('AdminJwtStrategy', () => {
    let strategy: AdminJwtStrategy;

    beforeEach(() => {
      strategy = new AdminJwtStrategy(configService as any, prisma as any);
    });

    it('validate() loads the admin with a field selection that excludes the password hash', async () => {
      await expect(strategy.validate(adminPayload)).resolves.toEqual(safeAdmin);
      expect(prisma.admin.findUnique).toHaveBeenCalledWith({ where: { id: 'admin-1' }, select: ADMIN_SELECT });
    });

    it('validate() -> 401 when the admin no longer exists', async () => {
      prisma.admin.findUnique.mockResolvedValue(null);

      await expect(strategy.validate(adminPayload)).rejects.toThrow(new UnauthorizedException('Admin not found'));
    });

    it('validate() -> 401 when the admin was deactivated after the token was issued', async () => {
      prisma.admin.findUnique.mockResolvedValue({ ...safeAdmin, isActive: false });

      await expect(strategy.validate(adminPayload)).rejects.toThrow(
        new UnauthorizedException('Admin account is deactivated'),
      );
    });

    it('accepts an admin access token end-to-end', async () => {
      const out = await runStrategy(strategy, sign(CONFIG['jwt.adminSecret']));

      expect(out).toEqual({ kind: 'success', user: safeAdmin });
    });

    it('rejects a user access token when an admin secret is configured', async () => {
      const out = await runStrategy(strategy, sign(CONFIG['jwt.secret'], { sub: 'u-1', email: 'a@example.com' }));

      expect(out.kind).toBe('fail');
      expect(prisma.admin.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an admin refresh token used as an access token', async () => {
      const out = await runStrategy(strategy, sign(CONFIG['jwt.adminRefreshSecret'], adminPayload, '7d'));

      expect(out.kind).toBe('fail');
    });

    it('rejects an expired admin token', async () => {
      const expired = jwt.sign({ ...adminPayload, exp: Math.floor(Date.now() / 1000) - 60 }, CONFIG['jwt.adminSecret']!);

      const out = await runStrategy(strategy, expired);

      expect(out.kind).toBe('fail');
    });

    it('falls back to jwt.secret when jwt.adminSecret is not configured', async () => {
      config['jwt.adminSecret'] = undefined;
      const fallback = new AdminJwtStrategy(configService as any, prisma as any);

      const out = await runStrategy(fallback, sign(CONFIG['jwt.secret']));

      expect(out.kind).toBe('success');
    });

    it('rejects a token of an older session generation (admin logged out since) with 401', async () => {
      prisma.admin.findUnique.mockResolvedValue({ ...safeAdmin, tokenVersion: 2 });

      await expect(strategy.validate({ ...adminPayload, tv: 1 })).rejects.toThrow(
        new UnauthorizedException('Session revoked'),
      );
      await expect(strategy.validate(adminPayload)).rejects.toThrow(new UnauthorizedException('Session revoked'));
    });

    it('accepts a token of the current generation and never exposes tokenVersion', async () => {
      prisma.admin.findUnique.mockResolvedValue({ ...safeAdmin, tokenVersion: 2 });

      const out = await runStrategy(strategy, sign(CONFIG['jwt.adminSecret'], { ...adminPayload, tv: 2 }));

      expect(out).toEqual({ kind: 'success', user: safeAdmin });
    });

    it('surfaces 401 for a validly signed token of a deactivated admin', async () => {
      prisma.admin.findUnique.mockResolvedValue({ ...safeAdmin, isActive: false });

      const out = await runStrategy(strategy, sign(CONFIG['jwt.adminSecret']));

      expect(out.kind).toBe('error');
      expect((out as any).err).toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('AdminJwtRefreshStrategy', () => {
    let strategy: AdminJwtRefreshStrategy;

    beforeEach(() => {
      strategy = new AdminJwtRefreshStrategy(configService as any, prisma as any);
    });

    it('validate(req, payload) loads the admin with the safe selection', async () => {
      await expect(strategy.validate({}, adminPayload)).resolves.toEqual(safeAdmin);
      expect(prisma.admin.findUnique).toHaveBeenCalledWith({ where: { id: 'admin-1' }, select: ADMIN_SELECT });
    });

    it('validate() -> 401 when the admin no longer exists', async () => {
      prisma.admin.findUnique.mockResolvedValue(null);

      await expect(strategy.validate({}, adminPayload)).rejects.toThrow(new UnauthorizedException('Admin not found'));
    });

    it('validate() -> 401 when the admin is deactivated', async () => {
      prisma.admin.findUnique.mockResolvedValue({ ...safeAdmin, isActive: false });

      await expect(strategy.validate({}, adminPayload)).rejects.toThrow(
        new UnauthorizedException('Admin account is deactivated'),
      );
    });

    it('rejects a refresh token of an older session generation with 401', async () => {
      prisma.admin.findUnique.mockResolvedValue({ ...safeAdmin, tokenVersion: 1 });

      await expect(strategy.validate({}, { ...adminPayload, tv: 0 })).rejects.toThrow(
        new UnauthorizedException('Session revoked'),
      );

      const out = await runStrategy(strategy, sign(CONFIG['jwt.adminRefreshSecret'], adminPayload, '7d'));
      expect(out.kind).toBe('error');
    });

    it('accepts an admin refresh token and rejects an admin access token', async () => {
      const ok = await runStrategy(strategy, sign(CONFIG['jwt.adminRefreshSecret'], adminPayload, '7d'));
      const bad = await runStrategy(strategy, sign(CONFIG['jwt.adminSecret']));

      expect(ok).toEqual({ kind: 'success', user: safeAdmin });
      expect(bad.kind).toBe('fail');
    });

    it('rejects a user refresh token when an admin refresh secret is configured', async () => {
      const out = await runStrategy(strategy, sign(CONFIG['jwt.refreshSecret'], { sub: 'u-1', email: 'a@example.com' }, '7d'));

      expect(out.kind).toBe('fail');
    });
  });
});
