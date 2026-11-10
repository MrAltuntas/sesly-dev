jest.mock('bcrypt', () => ({ compare: jest.fn(), hash: jest.fn() }));

import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminAuthService } from './admin-auth.service';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createMockAdmin } from '../../test-utils/mock-factories';

const bcrypt = jest.requireMock('bcrypt') as { compare: jest.Mock; hash: jest.Mock };

const CONFIG: Record<string, string | undefined> = {
  'jwt.secret': 'unit-access-secret',
  'jwt.refreshSecret': 'unit-refresh-secret',
  'jwt.adminSecret': 'unit-admin-secret',
  'jwt.adminRefreshSecret': 'unit-admin-refresh-secret',
};

const NOW = new Date('2026-09-28T10:00:00.000Z');
const PASSWORD_HASH = '$2b$12$ADMINHASHADMINHASHADMINHASHADMINHASHADMINHASHADMINHASH';

describe('AdminAuthService', () => {
  let service: AdminAuthService;
  let prisma: MockPrismaService;
  let jwtService: JwtService;
  let config: Record<string, string | undefined>;
  let configService: { get: jest.Mock };
  let admin: ReturnType<typeof createMockAdmin>;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });

    prisma = createMockPrismaService();
    jwtService = new JwtService({});
    config = { ...CONFIG };
    configService = { get: jest.fn((k: string) => config[k]) };

    admin = createMockAdmin({
      id: 'admin-1',
      email: 'ops@sesly.com',
      passwordHash: PASSWORD_HASH,
      firstName: 'Ops',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
      isActive: true,
      lastLoginAt: null,
    });
    prisma.admin.findUnique.mockResolvedValue(admin);
    prisma.admin.update.mockResolvedValue({ ...admin, lastLoginAt: NOW });
    bcrypt.compare.mockResolvedValue(true);

    service = new AdminAuthService(prisma as any, jwtService, configService as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const verifyWith = (token: string, secret: string | undefined) => jwtService.verify(token, { secret });

  describe('login', () => {
    it('valid credentials: compares with the stored hash, stamps lastLoginAt and returns tokens + safe admin', async () => {
      const res = await service.login({ email: 'ops@sesly.com', password: 'CorrectHorse1!' });

      expect(prisma.admin.findUnique).toHaveBeenCalledWith({ where: { email: 'ops@sesly.com' } });
      expect(bcrypt.compare).toHaveBeenCalledWith('CorrectHorse1!', PASSWORD_HASH);
      expect(prisma.admin.update).toHaveBeenCalledWith({
        where: { id: 'admin-1' },
        data: { lastLoginAt: NOW },
      });

      expect(Object.keys(res).sort()).toEqual(['accessToken', 'admin', 'refreshToken']);
      expect(res.admin).toEqual({
        id: 'admin-1',
        email: 'ops@sesly.com',
        firstName: 'Ops',
        lastName: 'Admin',
        role: 'SUPER_ADMIN',
      });
    });

    it('never leaks the password hash or account internals', async () => {
      const res: any = await service.login({ email: 'ops@sesly.com', password: 'CorrectHorse1!' });

      expect(Object.keys(res.admin).sort()).toEqual(['email', 'firstName', 'id', 'lastName', 'role']);
      const json = JSON.stringify(res);
      expect(json).not.toContain('ADMINHASH');
      expect(json).not.toContain('passwordHash');
      expect(json).not.toContain(CONFIG['jwt.adminSecret']!);
      expect(json).not.toContain(CONFIG['jwt.adminRefreshSecret']!);
    });

    it('issues admin tokens with admin secrets: access 1h, refresh 7d, payload sub/email/role/tv', async () => {
      prisma.admin.findUnique.mockResolvedValue({ ...admin, tokenVersion: 5 });

      const res = await service.login({ email: 'ops@sesly.com', password: 'CorrectHorse1!' });

      const access = verifyWith(res.accessToken, CONFIG['jwt.adminSecret']);
      const refresh = verifyWith(res.refreshToken, CONFIG['jwt.adminRefreshSecret']);
      expect(Object.keys(access).sort()).toEqual(['email', 'exp', 'iat', 'role', 'sub', 'tv']);
      expect(access).toMatchObject({ sub: 'admin-1', email: 'ops@sesly.com', role: 'SUPER_ADMIN', tv: 5 });
      expect(refresh).toMatchObject({ sub: 'admin-1', email: 'ops@sesly.com', role: 'SUPER_ADMIN', tv: 5 });
      expect(access.exp - access.iat).toBe(60 * 60);
      expect(refresh.exp - refresh.iat).toBe(7 * 24 * 60 * 60);

      // admin tokens are not valid user tokens (and vice versa)
      expect(() => verifyWith(res.accessToken, CONFIG['jwt.secret'])).toThrow();
      expect(() => verifyWith(res.refreshToken, CONFIG['jwt.refreshSecret'])).toThrow();
      expect(() => verifyWith(res.accessToken, CONFIG['jwt.adminRefreshSecret'])).toThrow();
    });

    it('falls back to the user JWT secrets when admin secrets are not configured', async () => {
      config['jwt.adminSecret'] = undefined;
      config['jwt.adminRefreshSecret'] = undefined;

      const res = await service.login({ email: 'ops@sesly.com', password: 'CorrectHorse1!' });

      expect(verifyWith(res.accessToken, CONFIG['jwt.secret'])).toMatchObject({ sub: 'admin-1' });
      expect(verifyWith(res.refreshToken, CONFIG['jwt.refreshSecret'])).toMatchObject({ sub: 'admin-1' });
    });

    it('unknown email -> 401 "Invalid credentials", no password check, no writes', async () => {
      prisma.admin.findUnique.mockResolvedValue(null);
      const sign = jest.spyOn(jwtService, 'sign');

      await expect(service.login({ email: 'nobody@sesly.com', password: 'whatever1' })).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
      expect(prisma.admin.update).not.toHaveBeenCalled();
      expect(sign).not.toHaveBeenCalled();
    });

    it('wrong password -> 401 with the same "Invalid credentials" message; lastLoginAt untouched', async () => {
      bcrypt.compare.mockResolvedValue(false);
      const sign = jest.spyOn(jwtService, 'sign');

      await expect(service.login({ email: 'ops@sesly.com', password: 'WrongPass1!' })).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
      expect(bcrypt.compare).toHaveBeenCalledWith('WrongPass1!', PASSWORD_HASH);
      expect(prisma.admin.update).not.toHaveBeenCalled();
      expect(sign).not.toHaveBeenCalled();
    });

    it('inactive admin -> 401, no tokens, lastLoginAt untouched (even with the right password)', async () => {
      prisma.admin.findUnique.mockResolvedValue({ ...admin, isActive: false });
      const sign = jest.spyOn(jwtService, 'sign');

      await expect(service.login({ email: 'ops@sesly.com', password: 'CorrectHorse1!' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.admin.update).not.toHaveBeenCalled();
      expect(sign).not.toHaveBeenCalled();
    });
  });

  describe('refreshTokens', () => {
    it('issues a fresh admin pair for an active admin, using the current DB role', async () => {
      prisma.admin.findUnique.mockResolvedValue({ ...admin, role: 'MODERATOR' });

      const res = await service.refreshTokens('admin-1');

      expect(prisma.admin.findUnique).toHaveBeenCalledWith({ where: { id: 'admin-1' } });
      expect(Object.keys(res).sort()).toEqual(['accessToken', 'refreshToken']);
      expect(verifyWith(res.accessToken, CONFIG['jwt.adminSecret'])).toMatchObject({
        sub: 'admin-1',
        email: 'ops@sesly.com',
        role: 'MODERATOR',
      });
      expect(verifyWith(res.refreshToken, CONFIG['jwt.adminRefreshSecret'])).toMatchObject({ sub: 'admin-1' });
    });

    it('the new pair carries the current session generation', async () => {
      prisma.admin.findUnique.mockResolvedValue({ ...admin, tokenVersion: 2 });

      const res = await service.refreshTokens('admin-1');

      expect(verifyWith(res.accessToken, CONFIG['jwt.adminSecret']).tv).toBe(2);
      expect(verifyWith(res.refreshToken, CONFIG['jwt.adminRefreshSecret']).tv).toBe(2);
    });

    it('a row without tokenVersion (pre-migration client) issues generation 0', async () => {
      const legacy: Record<string, unknown> = { ...admin };
      delete legacy.tokenVersion;
      prisma.admin.findUnique.mockResolvedValue(legacy);

      const res = await service.refreshTokens('admin-1');

      expect(verifyWith(res.accessToken, CONFIG['jwt.adminSecret']).tv).toBe(0);
    });

    it('does not stamp lastLoginAt or persist anything', async () => {
      await service.refreshTokens('admin-1');

      expect(prisma.admin.update).not.toHaveBeenCalled();
    });

    it('unknown admin -> 401', async () => {
      prisma.admin.findUnique.mockResolvedValue(null);

      await expect(service.refreshTokens('ghost')).rejects.toThrow(new UnauthorizedException('Admin not found'));
    });

    it('deactivated admin -> 401', async () => {
      prisma.admin.findUnique.mockResolvedValue({ ...admin, isActive: false });

      await expect(service.refreshTokens('admin-1')).rejects.toThrow(
        new UnauthorizedException('Admin account is deactivated'),
      );
    });
  });

  describe('logout', () => {
    it('bumps admins.tokenVersion (revokes every admin token) and returns the success message', async () => {
      prisma.admin.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.logout('admin-1')).resolves.toEqual({ message: 'Logged out successfully' });

      expect(prisma.admin.updateMany).toHaveBeenCalledWith({
        where: { id: 'admin-1' },
        data: { tokenVersion: { increment: 1 } },
      });
      expect(prisma.admin.update).not.toHaveBeenCalled();
    });

    it('an admin removed in the meantime is a 200 no-op', async () => {
      prisma.admin.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.logout('ghost')).resolves.toEqual({ message: 'Logged out successfully' });
    });
  });
});
