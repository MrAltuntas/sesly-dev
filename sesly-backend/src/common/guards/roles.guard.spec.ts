import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

function createContext(request: Record<string, any>) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

describe('RolesGuard (JWT + role check)', () => {
  const parentProto = Object.getPrototypeOf(RolesGuard.prototype);
  let parentCanActivate: jest.SpyInstance;
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: RolesGuard;

  /** metadata lookup by key */
  const meta = (values: { isPublic?: boolean; roles?: string[] }) =>
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return values.isPublic;
      if (key === ROLES_KEY) return values.roles;
      return undefined;
    });

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
    parentCanActivate = jest.spyOn(parentProto, 'canActivate');
  });

  afterEach(() => parentCanActivate.mockRestore());

  it('public route: allowed without running passport', async () => {
    meta({ isPublic: true, roles: ['admin'] });

    await expect(guard.canActivate(createContext({}))).resolves.toBe(true);
    expect(parentCanActivate).not.toHaveBeenCalled();
  });

  it('invalid / missing token -> 401 (not 403)', async () => {
    meta({ roles: ['admin'] });
    parentCanActivate.mockRejectedValue(new UnauthorizedException('jwt expired'));

    const err = await guard.canActivate(createContext({})).catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.message).toBe('jwt expired');
  });

  it('passport resolving false -> 401', async () => {
    meta({});
    parentCanActivate.mockResolvedValue(false);

    await expect(guard.canActivate(createContext({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('authenticated but no request.user -> 401', async () => {
    meta({});
    parentCanActivate.mockResolvedValue(true);

    await expect(guard.canActivate(createContext({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('authenticated, no roles required -> allowed', async () => {
    meta({ roles: [] });
    parentCanActivate.mockResolvedValue(true);

    await expect(guard.canActivate(createContext({ user: { id: 'u' } }))).resolves.toBe(true);
  });

  it('has one of the required roles -> allowed', async () => {
    meta({ roles: ['editor', 'admin'] });
    parentCanActivate.mockResolvedValue(true);

    await expect(guard.canActivate(createContext({ user: { id: 'u', roles: ['admin'] } }))).resolves.toBe(true);
  });

  it('authenticated but lacks the role (or has no roles array) -> 403', async () => {
    meta({ roles: ['admin'] });
    parentCanActivate.mockResolvedValue(true);

    await expect(
      guard.canActivate(createContext({ user: { id: 'u', roles: ['viewer'] } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(createContext({ user: { id: 'u' } }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
