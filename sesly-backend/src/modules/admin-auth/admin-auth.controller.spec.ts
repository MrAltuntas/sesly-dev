import 'reflect-metadata';
import { HttpStatus, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { AdminAuthController } from './admin-auth.controller';
import { AdminJwtAuthGuard } from '../../common/guards/admin-jwt-auth.guard';
import { AdminJwtRefreshGuard } from '../../common/guards/admin-jwt-refresh.guard';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

function httpContext(request: any) {
  return { switchToHttp: () => ({ getRequest: () => request }) } as any;
}

function customParam(method: string, index = 0) {
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, AdminAuthController, method) ?? {};
  return Object.values<any>(meta).find((m) => m.index === index && typeof m.factory === 'function');
}

describe('AdminAuthController', () => {
  let controller: AdminAuthController;
  let service: { login: jest.Mock; refreshTokens: jest.Mock; logout: jest.Mock };

  beforeEach(() => {
    service = {
      login: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', admin: { id: 'admin-1' } }),
      refreshTokens: jest.fn().mockResolvedValue({ accessToken: 'a2', refreshToken: 'r2' }),
      logout: jest.fn().mockResolvedValue({ message: 'Logged out successfully' }),
    };
    controller = new AdminAuthController(service as any);
  });

  it('POST /admin/auth/login delegates the credentials DTO', async () => {
    const dto = { email: 'ops@sesly.com', password: 'CorrectHorse1!' };

    await expect(controller.login(dto)).resolves.toEqual({ accessToken: 'a', refreshToken: 'r', admin: { id: 'admin-1' } });
    expect(service.login).toHaveBeenCalledWith(dto);
  });

  it('POST /admin/auth/refresh delegates with the admin id from the verified refresh token', async () => {
    await controller.refresh('admin-1');
    expect(service.refreshTokens).toHaveBeenCalledWith('admin-1');
  });

  it('POST /admin/auth/logout delegates with the authenticated admin id', async () => {
    await controller.logout('admin-1');
    expect(service.logout).toHaveBeenCalledWith('admin-1');
  });

  it.each(['refresh', 'logout'])('%s reads the admin id from request.user (guard output), never from the body', (method) => {
    const param = customParam(method);
    expect(param).toBeDefined();
    expect(param.data).toBe('id');

    const value = param.factory(param.data, httpContext({ user: { id: 'guard-admin' }, body: { id: 'body-admin', adminId: 'body-admin' } }));
    expect(value).toBe('guard-admin');
  });

  describe('route contract', () => {
    const proto = AdminAuthController.prototype as any;

    it('is mounted under /admin/auth', () => {
      expect(Reflect.getMetadata(PATH_METADATA, AdminAuthController)).toBe('admin/auth');
    });

    it.each(['login', 'refresh', 'logout'])('%s is a POST returning 200 and bypasses the global user guard', (method) => {
      const handler = proto[method];
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(method);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(HttpStatus.OK);
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    });

    it('login has no admin guard; refresh uses the refresh guard; logout the access guard', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, proto.login)).toBeUndefined();
      expect(Reflect.getMetadata(GUARDS_METADATA, proto.refresh)).toEqual([AdminJwtRefreshGuard]);
      expect(Reflect.getMetadata(GUARDS_METADATA, proto.logout)).toEqual([AdminJwtAuthGuard]);
    });
  });
});
