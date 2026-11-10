import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';
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

describe('UsageController (HTTP)', () => {
  let app: INestApplication;
  const usage = { getCurrentUsage: jest.fn(), getLimits: jest.fn(), getUsageSummary: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UsageController],
      providers: [
        { provide: UsageService, useValue: usage },
        { provide: APP_GUARD, useClass: FakeJwtGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    usage.getCurrentUsage.mockResolvedValue({ storiesGenerated: 1, limit: 5, remaining: 4 });
    usage.getLimits.mockResolvedValue({ maxStories: 5, maxVoices: 4 });
    usage.getUsageSummary.mockResolvedValue({ plan: 'FREE', buckets: {} });
  });

  it('no usage route is public', () => {
    for (const m of ['getUsage', 'getCurrentUsage', 'getLimits']) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, (UsageController.prototype as any)[m])).toBeUndefined();
    }
  });

  it('GET /usage/current and /usage/limits require auth', async () => {
    await request(app.getHttpServer()).get('/usage/current').expect(401);
    await request(app.getHttpServer()).get('/usage/limits').expect(401);
    expect(usage.getCurrentUsage).not.toHaveBeenCalled();
    expect(usage.getLimits).not.toHaveBeenCalled();
  });

  it('GET /usage/current returns usage of the authenticated user (query userId is ignored)', async () => {
    const res = await request(app.getHttpServer())
      .get('/usage/current?userId=victim')
      .set('x-test-user', AUTH_USER)
      .expect(200);
    expect(usage.getCurrentUsage).toHaveBeenCalledWith(AUTH_USER);
    expect(res.body).toEqual({ storiesGenerated: 1, limit: 5, remaining: 4 });
  });

  it('GET /usage requires auth and returns the summary of the authenticated user', async () => {
    await request(app.getHttpServer()).get('/usage').expect(401);
    const res = await request(app.getHttpServer()).get('/usage?userId=victim').set('x-test-user', AUTH_USER).expect(200);
    expect(usage.getUsageSummary).toHaveBeenCalledWith(AUTH_USER);
    expect(res.body).toEqual({ plan: 'FREE', buckets: {} });
  });

  it('GET /usage/limits returns limits of the authenticated user', async () => {
    const res = await request(app.getHttpServer()).get('/usage/limits').set('x-test-user', AUTH_USER).expect(200);
    expect(usage.getLimits).toHaveBeenCalledWith(AUTH_USER);
    expect(res.body).toEqual({ maxStories: 5, maxVoices: 4 });
  });
});
