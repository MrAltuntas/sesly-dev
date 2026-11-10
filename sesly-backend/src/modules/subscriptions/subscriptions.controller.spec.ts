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
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { UsageService } from '../usage/usage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

const AUTH_USER = 'auth-user-1';

@Injectable()
class FakeJwtGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest();
    const id = req.headers['x-test-user'];
    if (id) req.user = { id };
    if (isPublic) return true;
    if (!id) throw new UnauthorizedException();
    return true;
  }
}

describe('SubscriptionsController (HTTP)', () => {
  let app: INestApplication;
  const subscriptions = {
    getPlans: jest.fn(),
    getCurrentSubscription: jest.fn(),
    validateAppleTransaction: jest.fn(),
    validateGooglePurchase: jest.fn(),
  };
  const usage = { getMonthlyCounters: jest.fn() };
  const prisma = { voiceProfile: { count: jest.fn() } };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SubscriptionsController],
      providers: [
        { provide: SubscriptionsService, useValue: subscriptions },
        { provide: UsageService, useValue: usage },
        { provide: PrismaService, useValue: prisma },
        { provide: APP_GUARD, useClass: FakeJwtGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // Same pipe options as main.ts.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptions.getPlans.mockResolvedValue({ plans: [] });
    subscriptions.getCurrentSubscription.mockResolvedValue({ plan: 'FREE' });
    subscriptions.validateAppleTransaction.mockResolvedValue({ success: true });
    subscriptions.validateGooglePurchase.mockResolvedValue({ success: true });
    usage.getMonthlyCounters.mockResolvedValue({ premium: 2, standard: 3, total: 5 });
    prisma.voiceProfile.count.mockResolvedValue(4);
  });

  const server = () => app.getHttpServer();

  it('GET /subscriptions/plans is public; everything else needs auth', async () => {
    await request(server()).get('/subscriptions/plans').expect(200, { plans: [] });
    await request(server()).get('/subscriptions/current').expect(401);
    await request(server()).post('/subscriptions/apple/validate').send({ signedTransaction: 'x' }).expect(401);
    await request(server()).post('/subscriptions/google/validate').send({ purchaseToken: 'x' }).expect(401);
  });

  it('GET /subscriptions/current and the legacy /subscriptions/usage for the caller', async () => {
    await request(server()).get('/subscriptions/current').set('x-test-user', AUTH_USER).expect(200, { plan: 'FREE' });
    expect(subscriptions.getCurrentSubscription).toHaveBeenCalledWith(AUTH_USER);
    await request(server())
      .get('/subscriptions/usage')
      .set('x-test-user', AUTH_USER)
      .expect(200, { storiesThisMonth: 2, voiceProfiles: 4 });
    expect(prisma.voiceProfile.count).toHaveBeenCalledWith({ where: { userId: AUTH_USER } });
  });

  it('POST /subscriptions/apple/validate takes the signed transaction; the body userId is ignored', async () => {
    await request(server())
      .post('/subscriptions/apple/validate')
      .set('x-test-user', AUTH_USER)
      .send({ signedTransaction: 'eyJ.jws', userId: 'victim', productId: 'io.sesly.pro_monthly' })
      .expect(200, { success: true });
    expect(subscriptions.validateAppleTransaction).toHaveBeenCalledWith(
      AUTH_USER,
      expect.objectContaining({ signedTransaction: 'eyJ.jws' }),
    );
  });

  it('the removed verifyReceipt body (receiptData) and empty bodies are rejected by validation', async () => {
    await request(server())
      .post('/subscriptions/apple/validate')
      .set('x-test-user', AUTH_USER)
      .send({ receiptData: 'MIIT...' })
      .expect(400);
    await request(server()).post('/subscriptions/google/validate').set('x-test-user', AUTH_USER).send({}).expect(400);
    expect(subscriptions.validateAppleTransaction).not.toHaveBeenCalled();
    expect(subscriptions.validateGooglePurchase).not.toHaveBeenCalled();
  });

  it('POST /subscriptions/google/validate accepts token + product (+ package, legacy userId)', async () => {
    await request(server())
      .post('/subscriptions/google/validate')
      .set('x-test-user', AUTH_USER)
      .send({ purchaseToken: 'tok', productId: 'pro_monthly', packageName: 'com.sesly', userId: 'ignored' })
      .expect(200);
    expect(subscriptions.validateGooglePurchase).toHaveBeenCalledWith(
      AUTH_USER,
      expect.objectContaining({ purchaseToken: 'tok', productId: 'pro_monthly' }),
    );
  });

  it('Stripe endpoints are gone', async () => {
    for (const path of ['create-checkout', 'cancel', 'reactivate']) {
      await request(server()).post(`/subscriptions/${path}`).set('x-test-user', AUTH_USER).send({}).expect(404);
    }
  });
});
