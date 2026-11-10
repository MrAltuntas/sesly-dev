import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { WebhooksController } from './webhooks.controller';
import { GooglePlayService } from '../subscriptions/store/google-play.service';
import { AppStoreService } from '../subscriptions/store/app-store.service';
import {
  StoreConfigError,
  StoreRejectedError,
  StoreTransientError,
} from '../subscriptions/store/store-errors';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

describe('WebhooksController (HTTP)', () => {
  let app: INestApplication;
  const googlePlay = { handlePush: jest.fn() };
  const appStore = { handleNotification: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: GooglePlayService, useValue: googlePlay },
        { provide: AppStoreService, useValue: appStore },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    googlePlay.handlePush.mockResolvedValue({ received: true, status: 'processed' });
    appStore.handleNotification.mockResolvedValue({ received: true, status: 'processed' });
  });

  const pushBody = {
    message: { data: Buffer.from('{}').toString('base64'), messageId: 'm1', publishTime: 'x', attributes: {} },
    subscription: 'projects/p/subscriptions/s',
    deliveryAttempt: 1,
  };

  it('both endpoints are @Public (they authenticate the store themselves)', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, WebhooksController.prototype.handleGooglePlay)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, WebhooksController.prototype.handleApple)).toBe(true);
  });

  it('Google Play: the raw Pub/Sub body (extra fields too) and the Authorization header reach the service', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/google-play')
      .set('Authorization', 'Bearer oidc')
      .send(pushBody)
      .expect(200, { received: true, status: 'processed' });
    expect(googlePlay.handlePush).toHaveBeenCalledWith('Bearer oidc', pushBody);
  });

  it('Google Play: bad push auth 401, not configured 503, transient 500 (Pub/Sub redelivers)', async () => {
    googlePlay.handlePush.mockRejectedValueOnce(new StoreRejectedError('bad'));
    await request(app.getHttpServer()).post('/webhooks/google-play').send(pushBody).expect(401);
    googlePlay.handlePush.mockRejectedValueOnce(new StoreConfigError('no audience'));
    await request(app.getHttpServer()).post('/webhooks/google-play').send(pushBody).expect(503);
    googlePlay.handlePush.mockRejectedValueOnce(new StoreTransientError('google down'));
    await request(app.getHttpServer()).post('/webhooks/google-play').send(pushBody).expect(500);
  });

  it('Apple: signedPayload reaches the service; forged 400, unreachable checks 500', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/apple')
      .send({ signedPayload: 'eyJ.jws' })
      .expect(200, { received: true, status: 'processed' });
    expect(appStore.handleNotification).toHaveBeenCalledWith({ signedPayload: 'eyJ.jws' });

    appStore.handleNotification.mockRejectedValueOnce(new StoreRejectedError('forged'));
    await request(app.getHttpServer()).post('/webhooks/apple').send({ signedPayload: 'x' }).expect(400);
    appStore.handleNotification.mockRejectedValueOnce(new Error('db down'));
    await request(app.getHttpServer()).post('/webhooks/apple').send({ signedPayload: 'x' }).expect(500);
    appStore.handleNotification.mockRejectedValueOnce('odd');
    await request(app.getHttpServer()).post('/webhooks/apple').send({ signedPayload: 'x' }).expect(500);
  });

  it('the Stripe webhook is gone', async () => {
    await request(app.getHttpServer()).post('/webhooks/stripe').send({}).expect(404);
  });
});
