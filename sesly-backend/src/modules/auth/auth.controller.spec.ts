import 'reflect-metadata';
import { RequestMethod, HttpStatus, ValidationPipe } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { AuthController } from './auth.controller';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { PASSWORD_RESET_IP_LIMIT } from './password-reset.service';

/** Same options as the global ValidationPipe in main.ts. */
const validation = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });

function validateBody(value: unknown) {
  return validation.transform(value, { type: 'body', metatype: RefreshTokenDto });
}

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { verifyFirebaseToken: jest.Mock; refreshTokens: jest.Mock; logout: jest.Mock };
  let passwordReset: { request: jest.Mock };

  beforeEach(() => {
    authService = {
      verifyFirebaseToken: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', user: { id: 'u-1' } }),
      refreshTokens: jest.fn().mockResolvedValue({ accessToken: 'a2', refreshToken: 'r2' }),
      logout: jest.fn().mockResolvedValue({ message: 'Logged out successfully' }),
    };
    passwordReset = { request: jest.fn().mockResolvedValue({ accepted: true }) };
    controller = new AuthController(authService as any, passwordReset as any);
  });

  it('POST /auth/firebase/verify delegates the DTO and returns the service response', async () => {
    const dto = { idToken: 'firebase-id-token', firstName: 'Ayse' };

    await expect(controller.verifyFirebaseToken(dto)).resolves.toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      user: { id: 'u-1' },
    });
    expect(authService.verifyFirebaseToken).toHaveBeenCalledWith(dto, undefined);
  });

  it('POST /auth/firebase/verify passes the Accept-Language header on (UI language)', async () => {
    const dto = { idToken: 'firebase-id-token' };
    await controller.verifyFirebaseToken(dto, 'en-US');
    expect(authService.verifyFirebaseToken).toHaveBeenCalledWith(dto, 'en-US');
  });

  it('POST /auth/refresh passes only the refresh token string', async () => {
    await expect(controller.refresh({ refreshToken: 'rt' })).resolves.toEqual({ accessToken: 'a2', refreshToken: 'r2' });
    expect(authService.refreshTokens).toHaveBeenCalledWith('rt', undefined);
    await controller.refresh({ refreshToken: 'rt' }, 'en');
    expect(authService.refreshTokens).toHaveBeenLastCalledWith('rt', 'en');
  });

  it('POST /auth/logout passes only the refresh token string', async () => {
    await expect(controller.logout({ refreshToken: 'rt' })).resolves.toEqual({ message: 'Logged out successfully' });
    expect(authService.logout).toHaveBeenCalledWith('rt');
  });

  it('logout reads the session from the body, not from request.user (works with an expired access token)', () => {
    const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, AuthController, 'logout') ?? {};
    const params = Object.values<any>(meta);
    expect(params).toHaveLength(1);
    expect(params[0].factory).toBeUndefined(); // @Body(), no @CurrentUser()
    expect(Reflect.getMetadata('design:paramtypes', AuthController.prototype, 'logout')).toEqual([RefreshTokenDto]);
  });

  it('logout body contract: { refreshToken } required, nothing else accepted', async () => {
    await expect(validateBody({ refreshToken: 'rt' })).resolves.toEqual({ refreshToken: 'rt' });
    await expect(validateBody({})).rejects.toBeDefined();
    await expect(validateBody({ refreshToken: '' })).rejects.toBeDefined();
    await expect(validateBody({ refreshToken: 'rt', userId: 'someone-else' })).rejects.toBeDefined();
  });

  describe('route contract', () => {
    it('is mounted under /auth', () => {
      expect(Reflect.getMetadata(PATH_METADATA, AuthController)).toBe('auth');
    });

    it.each([
      ['verifyFirebaseToken', 'firebase/verify'],
      ['refresh', 'refresh'],
      ['logout', 'logout'],
    ])('%s is POST /auth/%s returning 200', (method, path) => {
      const handler = (AuthController.prototype as any)[method];
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(HttpStatus.OK);
    });

    it('firebase/verify, refresh and logout are public (logout is proven by the refresh token)', () => {
      const proto = AuthController.prototype as any;
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.verifyFirebaseToken)).toBe(true);
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.refresh)).toBe(true);
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.logout)).toBe(true);
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, AuthController)).toBeUndefined();
    });
  });

  describe('POST /auth/password-reset', () => {
    const handler = (AuthController.prototype as any).requestPasswordReset;
    const validateReset = (value: unknown) =>
      validation.transform(value, { type: 'body', metatype: PasswordResetRequestDto });

    it('is a public POST returning 202 with its own per-IP limit', () => {
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('password-reset');
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(HttpStatus.ACCEPTED);
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(PASSWORD_RESET_IP_LIMIT.limit);
      expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(PASSWORD_RESET_IP_LIMIT.ttl);
    });

    it('passes email, lang hint and Accept-Language to the service', async () => {
      await expect(
        controller.requestPasswordReset({ email: 'ayse@example.com', lang: 'en' }, 'tr-TR'),
      ).resolves.toEqual({ accepted: true });
      expect(passwordReset.request).toHaveBeenCalledWith('ayse@example.com', 'en', 'tr-TR');
    });

    it('body contract: a valid email (trimmed), optional lang, nothing else', async () => {
      await expect(validateReset({ email: '  ayse@example.com ' })).resolves.toEqual({ email: 'ayse@example.com' });
      await expect(validateReset({ email: 'ayse@example.com', lang: 'en-US' })).resolves.toEqual({
        email: 'ayse@example.com',
        lang: 'en-US',
      });
      await expect(validateReset({})).rejects.toBeDefined();
      await expect(validateReset({ email: 'not-an-email' })).rejects.toBeDefined();
      await expect(validateReset({ email: 'ayse@example.com', continueUrl: 'https://evil.test' })).rejects.toBeDefined();
    });
  });
});
