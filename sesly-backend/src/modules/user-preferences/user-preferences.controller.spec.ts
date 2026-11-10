import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { UserPreferencesController } from './user-preferences.controller';
import { UserPreferencesService } from './user-preferences.service';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

const AUTH_USER = 'auth-user-1';

/** Stand-in for the global JwtAuthGuard (`x-test-user` = verified token). */
@Injectable()
class FakeJwtGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const req = ctx.switchToHttp().getRequest();
    const id = req.headers['x-test-user'];
    if (id) req.user = { id };
    if (isPublic) return true;
    if (!id) throw new UnauthorizedException();
    return true;
  }
}

describe('UserPreferencesController (HTTP)', () => {
  let app: INestApplication;
  const svc = { getOrCreate: jest.fn(), update: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UserPreferencesController],
      providers: [
        { provide: UserPreferencesService, useValue: svc },
        { provide: APP_GUARD, useClass: FakeJwtGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    svc.getOrCreate.mockResolvedValue({ userId: AUTH_USER, settings: {} });
    svc.update.mockResolvedValue({ userId: AUTH_USER, settings: { theme: 'dark' } });
  });

  const patch = (body: unknown) =>
    request(app.getHttpServer()).patch('/users/me/preferences').set('x-test-user', AUTH_USER).send(body as object);

  it('routes are not public', () => {
    for (const m of ['get', 'update']) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, (UserPreferencesController.prototype as any)[m])).toBeUndefined();
    }
  });

  it('GET and PATCH require auth', async () => {
    await request(app.getHttpServer()).get('/users/me/preferences').expect(401);
    await request(app.getHttpServer()).patch('/users/me/preferences').send({}).expect(401);
    expect(svc.getOrCreate).not.toHaveBeenCalled();
    expect(svc.update).not.toHaveBeenCalled();
  });

  it('GET /users/me/preferences reads the authenticated user', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/me/preferences')
      .set('x-test-user', AUTH_USER)
      .expect(200);
    expect(svc.getOrCreate).toHaveBeenCalledWith(AUTH_USER);
    expect(res.body).toEqual({ userId: AUTH_USER, settings: {} });
  });

  it('PATCH delegates the validated body for the authenticated user', async () => {
    const body = {
      sleepTimerFadeOut: true,
      sleepTimerLastDuration: 30,
      promoNotifications: false,
      settings: { theme: 'dark', playbackSpeed: 1.25 },
    };
    const res = await patch(body).expect(200);

    expect(svc.update).toHaveBeenCalledTimes(1);
    const [userId, dto] = svc.update.mock.calls[0];
    expect(userId).toBe(AUTH_USER);
    expect({ ...dto }).toEqual(body);
    expect(res.body).toEqual({ userId: AUTH_USER, settings: { theme: 'dark' } });
  });

  it('PATCH with sleepTimerLastDuration: null is accepted (clears the value)', async () => {
    await patch({ sleepTimerLastDuration: null }).expect(200);
    expect(svc.update.mock.calls[0][1].sleepTimerLastDuration).toBeNull();
  });

  it('PATCH with an empty body is a valid no-op update', async () => {
    await patch({}).expect(200);
    expect(svc.update).toHaveBeenCalledWith(AUTH_USER, expect.any(Object));
  });

  it.each([
    ['sleepTimerLastDuration below 1', { sleepTimerLastDuration: 0 }],
    ['sleepTimerLastDuration above 480', { sleepTimerLastDuration: 481 }],
    ['sleepTimerLastDuration not an integer', { sleepTimerLastDuration: 1.5 }],
    ['boolean sent as string', { promoNotifications: 'true' }],
    ['settings as an array', { settings: ['dark'] }],
    ['settings as a string', { settings: 'dark' }],
    ['unknown field', { userId: 'victim' }],
    ['unknown field', { theme: 'dark' }],
  ])('rejects %s with 400', async (_label, body) => {
    await patch(body).expect(400);
    expect(svc.update).not.toHaveBeenCalled();
  });
});
