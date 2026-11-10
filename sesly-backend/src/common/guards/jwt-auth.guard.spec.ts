import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

function createContext(request: Record<string, any>) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

describe('JwtAuthGuard (optional auth on @Public routes)', () => {
  const parentProto = Object.getPrototypeOf(JwtAuthGuard.prototype);
  let parentCanActivate: jest.SpyInstance;
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new JwtAuthGuard(reflector as unknown as Reflector);
    parentCanActivate = jest.spyOn(parentProto, 'canActivate');
  });

  afterEach(() => parentCanActivate.mockRestore());

  it('public route without a token: allowed, passport not invoked', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const request = { headers: {}, path: '/stories' };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(parentCanActivate).not.toHaveBeenCalled();
    expect(request).not.toHaveProperty('user');
  });

  it('public route with a valid token: parses it so request.user is populated', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const request: any = { headers: { authorization: 'Bearer good' }, path: '/stories' };
    parentCanActivate.mockImplementation(async () => {
      request.user = { id: 'user-1' };
      return true;
    });

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(parentCanActivate).toHaveBeenCalledTimes(1);
    expect(request.user).toEqual({ id: 'user-1' });
  });

  it('public route with an invalid/expired token: still allowed, anonymous', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const request: any = { headers: { authorization: 'Bearer expired' }, path: '/stories/search' };
    parentCanActivate.mockRejectedValue(new UnauthorizedException());

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('admin routes are not parsed with the user strategy', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const request: any = { headers: { authorization: 'Bearer admin-token' }, path: '/admin/collections' };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(parentCanActivate).not.toHaveBeenCalled();
  });

  it('protected route delegates to passport and propagates failures', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    parentCanActivate.mockRejectedValue(new UnauthorizedException());

    await expect(
      guard.canActivate(createContext({ headers: {}, path: '/narrations' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('handleRequest: returns user, anonymous on public, throws on protected', () => {
    const publicCtx = createContext({ isPublic: true });
    const protectedCtx = createContext({});

    expect(guard.handleRequest(null, { id: 'u' }, null, publicCtx)).toEqual({ id: 'u' });
    expect(guard.handleRequest(null, false, null, publicCtx)).toBeUndefined();
    expect(() => guard.handleRequest(null, false, null, protectedCtx)).toThrow(UnauthorizedException);
  });
});
