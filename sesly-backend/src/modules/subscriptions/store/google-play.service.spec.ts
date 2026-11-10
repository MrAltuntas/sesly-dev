import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { GooglePlayService, parseGoogleSubscription } from './google-play.service';
import { StorePurchasesService } from './store-purchases.service';
import { StoreConfigError, StoreRejectedError, StoreTransientError } from './store-errors';
import { createFakeStoreDb, FakeStoreDb } from '../../../test-utils/fake-store-db';
import { resolveEffectivePlan } from '../../../common/utils/subscription-plan';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const FUTURE = new Date(Date.now() + 20 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString();

/** subscriptionsv2 fixture */
function playSub(overrides: Record<string, any> = {}) {
  return {
    kind: 'androidpublisher#subscriptionPurchaseV2',
    subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
    latestOrderId: 'GPA.0000-0000',
    externalAccountIdentifiers: { obfuscatedExternalAccountId: USER },
    lineItems: [
      {
        productId: 'pro_monthly',
        expiryTime: FUTURE,
        latestSuccessfulOrderId: 'GPA.1111-1111',
        autoRenewingPlan: { autoRenewEnabled: true },
      },
    ],
    ...overrides,
  };
}

/** Pub/Sub push body of an RTDN fixture */
function push(notification: Record<string, unknown>, messageId = 'msg-1') {
  return {
    message: {
      data: Buffer.from(JSON.stringify({ version: '1.0', packageName: 'com.sesly', eventTimeMillis: '1', ...notification })).toString('base64'),
      messageId,
      publishTime: '2026-10-16T10:00:00Z',
    },
    subscription: 'projects/sesly/subscriptions/play-rtdn',
  };
}

const subNotification = (notificationType: number, purchaseToken = 'token-1') => ({
  subscriptionNotification: { version: '1.0', notificationType, purchaseToken, subscriptionId: 'pro_monthly' },
});

describe('GooglePlayService', () => {
  let db: FakeStoreDb;
  let play: {
    packageName: string;
    isConfigured: jest.Mock;
    getSubscription: jest.Mock;
    acknowledge: jest.Mock;
    verifyPushToken: jest.Mock;
  };
  let service: GooglePlayService;

  beforeEach(() => {
    db = createFakeStoreDb();
    db.users.add(USER);
    db.users.add(OTHER);
    play = {
      packageName: 'com.sesly',
      isConfigured: jest.fn().mockReturnValue(true),
      getSubscription: jest.fn().mockResolvedValue(playSub()),
      acknowledge: jest.fn().mockResolvedValue(undefined),
      verifyPushToken: jest.fn().mockResolvedValue(undefined),
    };
    service = new GooglePlayService(play as any, new StorePurchasesService(db.prisma));
  });

  const validate = (userId = USER, dto: Record<string, any> = {}) =>
    service.validate(userId, { purchaseToken: 'token-1', productId: 'pro_monthly', packageName: 'com.sesly', ...dto } as any);

  describe('validate (POST /subscriptions/google/validate)', () => {
    it('ACTIVE: grants PREMIUM, stores token + product, acknowledges the pending purchase, audits', async () => {
      const result = await validate();

      expect(play.getSubscription).toHaveBeenCalledWith('token-1');
      expect(result.entitled).toBe(true);
      expect(db.purchases[0]).toMatchObject({
        userId: USER,
        platform: 'GOOGLE',
        purchaseKey: 'token-1',
        productId: 'pro_monthly',
        plan: 'PRO',
        billingPeriod: 'MONTH',
        state: 'ACTIVE',
        latestTransactionId: 'GPA.1111-1111',
        environment: 'production',
        acknowledged: true,
      });
      expect(play.acknowledge).toHaveBeenCalledWith('pro_monthly', 'token-1');
      const sub = db.subscriptions.get(USER)!;
      expect(sub).toMatchObject({ plan: 'PRO', status: 'ACTIVE', googlePurchaseToken: 'token-1', googleProductId: 'pro_monthly' });
      expect(resolveEffectivePlan(sub)).toBe('PRO');
      expect(db.events[0]).toMatchObject({ platform: 'GOOGLE', source: 'CLIENT', type: 'VALIDATE', status: 'PROCESSED', userId: USER });
    });

    it('IN_GRACE_PERIOD and CANCELED keep access until expiry; ON_HOLD, PAUSED, EXPIRED, PENDING do not', async () => {
      const cases: Array<[string, boolean]> = [
        ['SUBSCRIPTION_STATE_IN_GRACE_PERIOD', true],
        ['SUBSCRIPTION_STATE_CANCELED', true],
        ['SUBSCRIPTION_STATE_ON_HOLD', false],
        ['SUBSCRIPTION_STATE_PAUSED', false],
        ['SUBSCRIPTION_STATE_EXPIRED', false],
        ['SUBSCRIPTION_STATE_PENDING', false],
      ];
      for (const [subscriptionState, entitled] of cases) {
        play.getSubscription.mockResolvedValueOnce(playSub({ subscriptionState }));
        const result = await validate();
        expect([subscriptionState, result.entitled]).toEqual([subscriptionState, entitled]);
        expect([subscriptionState, resolveEffectivePlan(db.subscriptions.get(USER))]).toEqual([
          subscriptionState,
          entitled ? 'PRO' : 'FREE',
        ]);
      }
    });

    it('a pending payment is stored but never acknowledged or granted', async () => {
      play.getSubscription.mockResolvedValue(playSub({ subscriptionState: 'SUBSCRIPTION_STATE_PENDING' }));
      const result = await validate();
      expect(result.entitled).toBe(false);
      expect(play.acknowledge).not.toHaveBeenCalled();
    });

    it('an acknowledge failure is logged; the purchase is still granted (acknowledged stays false)', async () => {
      play.acknowledge.mockRejectedValue(new StoreTransientError('down'));
      const result = await validate();
      expect(result.entitled).toBe(true);
      expect(db.purchases[0].acknowledged).toBe(false);
    });

    it('already acknowledged: no second acknowledge', async () => {
      play.getSubscription.mockResolvedValue(playSub({ acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' }));
      await validate();
      expect(play.acknowledge).not.toHaveBeenCalled();
    });

    it('MINI and yearly PREMIUM map through the product map', async () => {
      play.getSubscription.mockResolvedValueOnce(playSub({ lineItems: [{ productId: 'mini_monthly', expiryTime: FUTURE }] }));
      await validate(USER, { productId: 'mini_monthly' });
      expect(db.subscriptions.get(USER)?.plan).toBe('MINI');
      play.getSubscription.mockResolvedValueOnce(playSub({ lineItems: [{ productId: 'pro_yearly', expiryTime: FUTURE }] }));
      await validate(USER, { purchaseToken: 'token-2', productId: 'pro_yearly' });
      expect(db.purchases.find((p) => p.purchaseKey === 'token-2')).toMatchObject({ plan: 'PRO', billingPeriod: 'YEAR' });
      expect(db.subscriptions.get(USER)?.plan).toBe('PRO');
    });

    it('abuse: an unknown product id is rejected before anything is called or written', async () => {
      const err = await validate(USER, { productId: 'premium_monthly' }).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ code: 'PRODUCT_UNKNOWN', productId: 'premium_monthly' });
      expect(play.getSubscription).not.toHaveBeenCalled();
      expect(db.purchases).toHaveLength(0);
    });

    it('abuse: a token whose Google product is unknown is rejected with no purchase written', async () => {
      play.getSubscription.mockResolvedValue(playSub({ lineItems: [{ productId: 'creator_monthly', expiryTime: FUTURE }] }));
      const err = await validate(USER, { productId: undefined }).catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: 'PRODUCT_UNKNOWN', productId: 'creator_monthly' });
      expect(db.purchases).toHaveLength(0);
      expect(db.subscriptions.size).toBe(0);
      expect(db.events[0]).toMatchObject({ status: 'IGNORED', note: 'unknown product' });
    });

    it('abuse: a purchase made for another account (obfuscated id) is 409 RECEIPT_IN_USE, nothing written', async () => {
      play.getSubscription.mockResolvedValue(playSub({ externalAccountIdentifiers: { obfuscatedExternalAccountId: OTHER } }));
      const err = await validate().catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: 'RECEIPT_IN_USE' });
      expect(db.purchases).toHaveLength(0);
    });

    it('abuse: a token already bound to another user is 409 before Google is called', async () => {
      await validate(USER);
      play.getSubscription.mockClear();
      play.getSubscription.mockResolvedValue(playSub({ externalAccountIdentifiers: {} }));
      const err = await validate(OTHER).catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: 'RECEIPT_IN_USE' });
      expect(play.getSubscription).not.toHaveBeenCalled();
      expect(db.subscriptions.has(OTHER)).toBe(false);
    });

    it('abuse: a token stored on another user row by an older backend is 409 as well', async () => {
      db.subscriptions.set(OTHER, { userId: OTHER, plan: 'PRO', googlePurchaseToken: 'token-1' });
      const err = await validate(USER).catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: 'RECEIPT_IN_USE' });
    });

    it('a purchase without an obfuscated id is bound to the first validator; the same user again is idempotent', async () => {
      play.getSubscription.mockResolvedValue(playSub({ externalAccountIdentifiers: undefined }));
      await validate();
      await validate();
      expect(db.purchases).toHaveLength(1);
    });

    it('linkedPurchaseToken: the replaced purchase stops granting (upgrade MINI to PREMIUM)', async () => {
      play.getSubscription.mockResolvedValueOnce(playSub({ lineItems: [{ productId: 'mini_monthly', expiryTime: FUTURE }] }));
      await validate(USER, { purchaseToken: 'old-token', productId: 'mini_monthly' });
      play.getSubscription.mockResolvedValueOnce(playSub({ linkedPurchaseToken: 'old-token' }));
      await validate(USER, { purchaseToken: 'new-token' });

      expect(db.purchases.find((p) => p.purchaseKey === 'old-token')?.state).toBe('REPLACED');
      expect(db.purchases.find((p) => p.purchaseKey === 'new-token')?.linkedPurchaseKey).toBe('old-token');
      expect(db.subscriptions.get(USER)).toMatchObject({ plan: 'PRO', googlePurchaseToken: 'new-token' });
    });

    it('a linked token that is unknown or the same purchase changes nothing', async () => {
      play.getSubscription.mockResolvedValue(playSub({ linkedPurchaseToken: 'never-seen' }));
      await validate();
      play.getSubscription.mockResolvedValue(playSub({ linkedPurchaseToken: 'token-1' }));
      await validate();
      expect(db.purchases[0].state).toBe('ACTIVE');
    });

    it('package name of another app: 400 RECEIPT_INVALID; omitted package name is fine', async () => {
      const err = await validate(USER, { packageName: 'com.evil' }).catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: 'RECEIPT_INVALID' });
      await expect(validate(USER, { packageName: undefined })).resolves.toMatchObject({ entitled: true });
    });

    it('Google answers: rejected token 400, outage 503 STORE_UNAVAILABLE, refused key 503 STORE_NOT_CONFIGURED', async () => {
      play.getSubscription.mockRejectedValueOnce(new StoreRejectedError('404'));
      expect((await validate().catch((e) => e)).getResponse()).toMatchObject({ code: 'RECEIPT_INVALID' });
      play.getSubscription.mockRejectedValueOnce(new StoreTransientError('503'));
      const outage = await validate().catch((e) => e);
      expect(outage).toBeInstanceOf(ServiceUnavailableException);
      expect(outage.getResponse()).toMatchObject({ code: 'STORE_UNAVAILABLE', retryable: true });
      play.getSubscription.mockRejectedValueOnce(new StoreConfigError('403'));
      expect((await validate().catch((e) => e)).getResponse()).toMatchObject({ code: 'STORE_NOT_CONFIGURED' });
      play.getSubscription.mockRejectedValueOnce(new Error('bug'));
      await expect(validate()).rejects.toThrow('bug');
      expect(db.purchases).toHaveLength(0);
    });

    it('no service account configured: 503 STORE_NOT_CONFIGURED before any call', async () => {
      play.isConfigured.mockReturnValue(false);
      const err = await validate().catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: 'STORE_NOT_CONFIGURED' });
      expect(play.getSubscription).not.toHaveBeenCalled();
    });
  });

  describe('handlePush (POST /webhooks/google-play)', () => {
    beforeEach(async () => {
      await validate(); // the purchase exists and is bound to USER
      play.getSubscription.mockClear();
    });

    it('authenticates first: a bad token never reaches Google or the database', async () => {
      play.verifyPushToken.mockRejectedValue(new StoreRejectedError('bad'));
      await expect(service.handlePush('Bearer x', push(subNotification(3)))).rejects.toBeInstanceOf(StoreRejectedError);
      expect(play.getSubscription).not.toHaveBeenCalled();
      expect(db.events.filter((e) => e.source === 'NOTIFICATION')).toHaveLength(0);
    });

    it('re-fetches the subscription and updates the row (cancel: access until expiry, no renewal)', async () => {
      play.getSubscription.mockResolvedValue(
        playSub({
          subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
          acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
          lineItems: [{ productId: 'pro_monthly', expiryTime: FUTURE, autoRenewingPlan: { autoRenewEnabled: false } }],
        }),
      );
      const outcome = await service.handlePush('Bearer ok', push(subNotification(3)));
      expect(outcome).toEqual({ received: true, status: 'processed', note: undefined });
      expect(play.verifyPushToken).toHaveBeenCalledWith('Bearer ok');
      expect(play.getSubscription).toHaveBeenCalledWith('token-1');
      expect(db.subscriptions.get(USER)).toMatchObject({ plan: 'PRO', status: 'ACTIVE', cancelAtPeriodEnd: true });
      const event = db.events.find((e) => e.externalId === 'msg-1');
      expect(event).toMatchObject({ type: 'SUBSCRIPTION_CANCELED', status: 'PROCESSED', userId: USER, purchaseKey: 'token-1' });
    });

    it('abuse: a replayed message id is processed once', async () => {
      play.getSubscription.mockResolvedValue(playSub({ subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED', lineItems: [{ productId: 'pro_monthly', expiryTime: PAST }] }));
      await service.handlePush('Bearer ok', push(subNotification(13)));
      const replay = await service.handlePush('Bearer ok', push(subNotification(13)));
      expect(replay).toEqual({ received: true, status: 'duplicate' });
      expect(play.getSubscription).toHaveBeenCalledTimes(1);
      expect(resolveEffectivePlan(db.subscriptions.get(USER))).toBe('FREE');
    });

    it('a message that failed before is processed again on redelivery', async () => {
      play.getSubscription.mockRejectedValueOnce(new StoreTransientError('Google down'));
      await expect(service.handlePush('Bearer ok', push(subNotification(2)))).rejects.toBeInstanceOf(StoreTransientError);
      expect(db.events.find((e) => e.externalId === 'msg-1')?.status).toBe('FAILED');
      await expect(service.handlePush('Bearer ok', push(subNotification(2)))).resolves.toMatchObject({ status: 'processed' });
    });

    it('revocation (SUBSCRIPTION_REVOKED re-fetched as EXPIRED, or a voided purchase) ends access at once', async () => {
      await service.handlePush(
        'Bearer ok',
        push({ voidedPurchaseNotification: { purchaseToken: 'token-1', orderId: 'GPA.1', productType: 1, refundType: 1 } }, 'msg-void'),
      );
      expect(db.purchases[0]).toMatchObject({ state: 'REVOKED', autoRenew: false });
      expect(resolveEffectivePlan(db.subscriptions.get(USER))).toBe('FREE');
      expect(db.subscriptions.get(USER)?.status).toBe('EXPIRED');
    });

    it('a purchase that reaches us first by notification is bound through the obfuscated account id', async () => {
      play.getSubscription.mockResolvedValue(playSub({ externalAccountIdentifiers: { obfuscatedExternalAccountId: OTHER } }));
      const outcome = await service.handlePush('Bearer ok', push(subNotification(4, 'fresh-token'), 'msg-new'));
      expect(outcome.status).toBe('processed');
      expect(db.purchases.find((p) => p.purchaseKey === 'fresh-token')?.userId).toBe(OTHER);
    });

    it('ignored on purpose (200): no account yet, unknown product, rejected token, test, other package, one-time product, unreadable', async () => {
      play.getSubscription.mockResolvedValueOnce(playSub({ externalAccountIdentifiers: { obfuscatedExternalAccountId: 'not-a-user' } }));
      expect(await service.handlePush('Bearer ok', push(subNotification(4, 'orphan'), 'm1'))).toMatchObject({ status: 'ignored', note: 'no account for this purchase yet' });

      play.getSubscription.mockResolvedValueOnce(playSub({ lineItems: [{ productId: 'premium_monthly', expiryTime: FUTURE }] }));
      expect(await service.handlePush('Bearer ok', push(subNotification(4, 'p2'), 'm2'))).toMatchObject({ note: 'unknown product' });

      play.getSubscription.mockRejectedValueOnce(new StoreRejectedError('410'));
      expect(await service.handlePush('Bearer ok', push(subNotification(4, 'gone'), 'm3'))).toMatchObject({ note: 'token rejected by Google' });

      expect(await service.handlePush('Bearer ok', push({ testNotification: { version: '1.0' } }, 'm4'))).toMatchObject({ note: 'test notification' });
      expect(await service.handlePush('Bearer ok', push({ packageName: 'com.other', ...subNotification(2) }, 'm5'))).toMatchObject({ note: 'other package' });
      expect(await service.handlePush('Bearer ok', push({ oneTimeProductNotification: { purchaseToken: 't' } }, 'm6'))).toMatchObject({ note: 'no purchase token' });
      expect(await service.handlePush('Bearer ok', push({}, 'm7'))).toMatchObject({ note: 'no purchase token' });
      expect(await service.handlePush('Bearer ok', push({ voidedPurchaseNotification: { purchaseToken: 'unknown' } }, 'm8'))).toMatchObject({ note: 'unknown purchase' });
      expect(await service.handlePush('Bearer ok', { message: { data: '!!!', messageId: 'm9' } })).toMatchObject({ status: 'ignored', note: 'unreadable message' });
      expect(await service.handlePush('Bearer ok', {} as any)).toMatchObject({ status: 'ignored' });
      expect(await service.handlePush('Bearer ok', { message: { data: Buffer.from('null').toString('base64'), message_id: 'm10' } })).toMatchObject({ status: 'ignored' });

      expect(db.events.filter((e) => e.source === 'NOTIFICATION').every((e) => e.status === 'IGNORED')).toBe(true);
      expect(db.events.find((e) => e.externalId === 'm6')?.type).toBe('ONE_TIME_PRODUCT');
      expect(db.events.find((e) => e.externalId === 'm7')?.type).toBe('UNKNOWN');
    });

    it('an unknown notification type number is still recorded', async () => {
      await service.handlePush('Bearer ok', push(subNotification(99), 'm99'));
      expect(db.events.find((e) => e.externalId === 'm99')?.type).toBe('SUBSCRIPTION_99');
    });
  });

  describe('parseGoogleSubscription', () => {
    it('picks the known line item with the latest expiry; test purchases are flagged', () => {
      const parsed = parseGoogleSubscription({
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        testPurchase: {},
        lineItems: [
          { productId: 'unknown_addon', expiryTime: '2027-01-01T00:00:00Z' },
          { productId: 'pro_monthly', expiryTime: '2026-11-01T00:00:00Z' },
          { productId: 'pro_yearly', expiryTime: '2027-10-01T00:00:00Z' },
        ],
      });
      expect(parsed).toMatchObject({ productId: 'pro_yearly', environment: 'test', autoRenew: false, latestOrderId: null });
    });

    it('nothing known: falls back to the first item; an empty payload is EXPIRED with no product', () => {
      expect(parseGoogleSubscription({ lineItems: [{ productId: 'x' }, { productId: 'y' }] }).productId).toBe('x');
      expect(parseGoogleSubscription({})).toMatchObject({
        product: undefined,
        productId: null,
        state: 'EXPIRED',
        expiresAt: null,
        obfuscatedAccountId: null,
        linkedPurchaseToken: null,
        acknowledged: false,
      });
      expect(parseGoogleSubscription({ subscriptionState: 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED' }).state).toBe('EXPIRED');
    });
  });
});
