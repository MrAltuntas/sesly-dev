import { BadRequestException, ConflictException } from '@nestjs/common';
import { AppStoreService, parseAppleState } from './app-store.service';
import { StorePurchasesService } from './store-purchases.service';
import { StoreConfigError, StoreRejectedError, StoreTransientError } from './store-errors';
import { createFakeStoreDb, FakeStoreDb } from '../../../test-utils/fake-store-db';
import { resolveEffectivePlan } from '../../../common/utils/subscription-plan';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DAY = 24 * 3600 * 1000;
const now = Date.now();

/** Decoded JWSTransactionDecodedPayload fixture. */
function tx(overrides: Record<string, any> = {}) {
  return {
    originalTransactionId: '2000000111',
    transactionId: '2000000222',
    bundleId: 'com.sesly',
    productId: 'io.sesly.pro_monthly',
    type: 'Auto-Renewable Subscription',
    purchaseDate: now - DAY,
    expiresDate: now + 29 * DAY,
    appAccountToken: USER,
    environment: 'Sandbox',
    signedDate: now,
    ...overrides,
  };
}

function renewal(overrides: Record<string, any> = {}) {
  return { originalTransactionId: '2000000111', autoRenewStatus: 1, environment: 'Sandbox', signedDate: now, ...overrides };
}

/** Decoded ResponseBodyV2DecodedPayload fixture. */
function notification(type: string, subtype: string | null, id = 'uuid-1', signedDate = now + 1000) {
  return {
    notificationType: type,
    subtype: subtype ?? undefined,
    notificationUUID: id,
    signedDate,
    data: { environment: 'Sandbox', bundleId: 'com.sesly', signedTransactionInfo: 'jws-tx', signedRenewalInfo: 'jws-renewal' },
  };
}

describe('AppStoreService', () => {
  let db: FakeStoreDb;
  let apple: Record<string, jest.Mock>;
  let service: AppStoreService;

  beforeEach(() => {
    db = createFakeStoreDb();
    db.users.add(USER);
    db.users.add(OTHER);
    apple = {
      isConfigured: jest.fn().mockReturnValue(true),
      verifyTransaction: jest.fn().mockResolvedValue(tx()),
      verifyRenewalInfo: jest.fn().mockResolvedValue(renewal()),
      verifyNotification: jest.fn(),
      hasServerApi: jest.fn().mockReturnValue(false),
      getLatestStatus: jest.fn(),
    };
    service = new AppStoreService(apple as any, new StorePurchasesService(db.prisma));
  });

  const validate = (userId = USER, signedTransaction = 'jws-client') =>
    service.validate(userId, { signedTransaction } as any);

  describe('validate (POST /subscriptions/apple/validate)', () => {
    it('a verified signed transaction grants the plan, bound to the caller', async () => {
      const result = await validate();

      expect(apple.verifyTransaction).toHaveBeenCalledWith('jws-client');
      expect(result.entitled).toBe(true);
      expect(db.purchases[0]).toMatchObject({
        platform: 'APPLE',
        purchaseKey: '2000000111',
        latestTransactionId: '2000000222',
        productId: 'io.sesly.pro_monthly',
        plan: 'PRO',
        state: 'ACTIVE',
        environment: 'Sandbox',
        userId: USER,
      });
      expect(db.subscriptions.get(USER)).toMatchObject({
        plan: 'PRO',
        appleOriginalTransactionId: '2000000111',
        appleTransactionId: '2000000222',
      });
      expect(db.events[0]).toMatchObject({ source: 'CLIENT', type: 'VALIDATE', status: 'PROCESSED' });
    });

    it('MINI and yearly PREMIUM map through the product map', async () => {
      apple.verifyTransaction.mockResolvedValueOnce(tx({ productId: 'io.sesly.mini_monthly' }));
      await validate();
      expect(db.subscriptions.get(USER)?.plan).toBe('MINI');
      apple.verifyTransaction.mockResolvedValueOnce(tx({ productId: 'io.sesly.pro_yearly', originalTransactionId: '2000000999' }));
      await validate();
      expect(db.purchases.find((p) => p.purchaseKey === '2000000999')).toMatchObject({ plan: 'PRO', billingPeriod: 'YEAR' });
    });

    it('abuse: a transaction bought for another account (appAccountToken) is 409, nothing written', async () => {
      apple.verifyTransaction.mockResolvedValue(tx({ appAccountToken: OTHER }));
      const err = await validate().catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: 'RECEIPT_IN_USE' });
      expect(db.purchases).toHaveLength(0);
    });

    it('abuse: an original transaction bound to another user is 409 RECEIPT_IN_USE', async () => {
      apple.verifyTransaction.mockResolvedValue(tx({ appAccountToken: undefined }));
      await validate(USER);
      const err = await validate(OTHER).catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: 'RECEIPT_IN_USE' });
      expect(db.subscriptions.has(OTHER)).toBe(false);
    });

    it('appAccountToken compare is case-insensitive (UUID)', async () => {
      apple.verifyTransaction.mockResolvedValue(tx({ appAccountToken: USER.toUpperCase() }));
      await expect(validate()).resolves.toMatchObject({ entitled: true });
    });

    it('abuse: unknown products and non-subscription types are 400 PRODUCT_UNKNOWN, nothing written', async () => {
      apple.verifyTransaction.mockResolvedValueOnce(tx({ productId: 'io.sesly.premium_monthly' }));
      expect((await validate().catch((e) => e)).getResponse()).toMatchObject({ code: 'PRODUCT_UNKNOWN', productId: 'io.sesly.premium_monthly' });
      apple.verifyTransaction.mockResolvedValueOnce(tx({ productId: 'io.sesly.creator_monthly' }));
      expect((await validate().catch((e) => e)).getResponse()).toMatchObject({ code: 'PRODUCT_UNKNOWN' });
      apple.verifyTransaction.mockResolvedValueOnce(tx({ type: 'Consumable' }));
      expect((await validate().catch((e) => e)).getResponse()).toMatchObject({ code: 'PRODUCT_UNKNOWN' });
      apple.verifyTransaction.mockResolvedValueOnce(tx({ productId: undefined }));
      expect((await validate().catch((e) => e)).getResponse()).toMatchObject({ code: 'PRODUCT_UNKNOWN', productId: null });
      expect(db.purchases).toHaveLength(0);
    });

    it('a transaction without an original transaction id is RECEIPT_INVALID', async () => {
      apple.verifyTransaction.mockResolvedValue(tx({ originalTransactionId: undefined }));
      const err = await validate().catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ code: 'RECEIPT_INVALID' });
    });

    it('verification: forged / other app 400, Apple unreachable 503, not configured 503', async () => {
      apple.verifyTransaction.mockRejectedValueOnce(new StoreRejectedError('bad signature'));
      expect((await validate().catch((e) => e)).getResponse()).toMatchObject({ code: 'RECEIPT_INVALID' });
      apple.verifyTransaction.mockRejectedValueOnce(new StoreTransientError('ocsp'));
      expect((await validate().catch((e) => e)).getResponse()).toMatchObject({ code: 'STORE_UNAVAILABLE' });
      apple.isConfigured.mockReturnValueOnce(false);
      expect((await validate().catch((e) => e)).getResponse()).toMatchObject({ code: 'STORE_NOT_CONFIGURED' });
    });

    it('revoked (refunded) transaction: stored as REVOKED, no access', async () => {
      apple.verifyTransaction.mockResolvedValue(tx({ revocationDate: now - 1000, revocationReason: 0 }));
      const result = await validate();
      expect(result.entitled).toBe(false);
      expect(db.purchases[0].state).toBe('REVOKED');
      expect(resolveEffectivePlan(db.subscriptions.get(USER))).toBe('FREE');
    });

    it('expired transaction: stored, no access', async () => {
      apple.verifyTransaction.mockResolvedValue(tx({ expiresDate: now - 5 * DAY }));
      expect((await validate()).entitled).toBe(false);
      expect(db.subscriptions.get(USER)?.status).toBe('EXPIRED');
    });

    it('restore of an older transaction never pulls back a later expiry', async () => {
      await validate();
      apple.verifyTransaction.mockResolvedValue(tx({ transactionId: 'older', expiresDate: now + 2 * DAY, signedDate: now + 5000 }));
      const result = await validate();
      expect(result.entitled).toBe(true);
      expect(db.purchases[0].latestTransactionId).toBe('2000000222');
      expect(db.events.at(-1)?.payload).toMatchObject({ stale: true });
    });

    it('with App Store Server API credentials the latest status from Apple is used', async () => {
      apple.hasServerApi.mockReturnValue(true);
      apple.getLatestStatus.mockResolvedValue({ status: 1, signedTransactionInfo: 'jws-latest', signedRenewalInfo: 'jws-ren' });
      apple.verifyTransaction.mockImplementation(async (jws: string) =>
        jws === 'jws-latest' ? tx({ transactionId: '2000000333', expiresDate: now + 60 * DAY }) : tx(),
      );
      apple.verifyRenewalInfo.mockResolvedValue(renewal({ autoRenewStatus: 0 }));

      await validate();

      expect(apple.getLatestStatus).toHaveBeenCalledWith('2000000111', 'Sandbox');
      expect(db.purchases[0]).toMatchObject({ latestTransactionId: '2000000333', state: 'CANCELED', autoRenew: false });
      expect(db.subscriptions.get(USER)?.cancelAtPeriodEnd).toBe(true);
    });

    it('the API not knowing the subscription, giving no blobs, or failing falls back to the client transaction', async () => {
      apple.hasServerApi.mockReturnValue(true);
      apple.getLatestStatus.mockResolvedValueOnce(null);
      await validate();
      apple.getLatestStatus.mockResolvedValueOnce({ status: 1, signedTransactionInfo: null, signedRenewalInfo: null });
      await validate();
      apple.getLatestStatus.mockRejectedValueOnce(new StoreConfigError('key'));
      await expect(validate()).resolves.toMatchObject({ entitled: true });
      expect(db.purchases).toHaveLength(1);
    });
  });

  describe('handleNotification (POST /webhooks/apple)', () => {
    beforeEach(async () => {
      await validate();
    });

    const send = async (decoded: any, transaction = tx(), renewalInfo: any = renewal()) => {
      apple.verifyNotification.mockResolvedValue(decoded);
      apple.verifyTransaction.mockResolvedValue(transaction);
      apple.verifyRenewalInfo.mockResolvedValue(renewalInfo);
      return service.handleNotification({ signedPayload: 'signed' });
    };

    it('DID_RENEW moves the expiry forward', async () => {
      const renewed = now + 59 * DAY;
      const outcome = await send(notification('DID_RENEW', null), tx({ transactionId: 't2', expiresDate: renewed }));
      expect(outcome).toEqual({ received: true, status: 'processed', note: undefined });
      expect(db.purchases[0]).toMatchObject({ state: 'ACTIVE', latestTransactionId: 't2' });
      expect(new Date(db.subscriptions.get(USER)?.currentPeriodEnd).getTime()).toBe(renewed);
      expect(db.events.find((e) => e.externalId === 'uuid-1')).toMatchObject({ type: 'DID_RENEW', status: 'PROCESSED', userId: USER });
    });

    it('DID_CHANGE_RENEWAL_STATUS (AUTO_RENEW_DISABLED): access until expiry, no renewal', async () => {
      await send(notification('DID_CHANGE_RENEWAL_STATUS', 'AUTO_RENEW_DISABLED'), tx(), renewal({ autoRenewStatus: 0 }));
      expect(db.purchases[0].state).toBe('CANCELED');
      expect(db.subscriptions.get(USER)).toMatchObject({ plan: 'PRO', status: 'ACTIVE', cancelAtPeriodEnd: true });
    });

    it('DID_FAIL_TO_RENEW with GRACE_PERIOD keeps access until the grace end (PAST_DUE)', async () => {
      const graceEnd = now + 6 * DAY;
      await send(
        notification('DID_FAIL_TO_RENEW', 'GRACE_PERIOD'),
        tx({ expiresDate: now - DAY }),
        renewal({ isInBillingRetryPeriod: true, gracePeriodExpiresDate: graceEnd }),
      );
      expect(db.purchases[0].state).toBe('GRACE');
      expect(db.subscriptions.get(USER)).toMatchObject({ status: 'PAST_DUE' });
      expect(resolveEffectivePlan(db.subscriptions.get(USER))).toBe('PRO');
    });

    it('DID_FAIL_TO_RENEW without grace (billing retry): no access', async () => {
      await send(notification('DID_FAIL_TO_RENEW', null), tx({ expiresDate: now - 3 * DAY }), renewal({ isInBillingRetryPeriod: true }));
      expect(db.purchases[0].state).toBe('ON_HOLD');
      expect(resolveEffectivePlan(db.subscriptions.get(USER))).toBe('FREE');
    });

    it('EXPIRED and GRACE_PERIOD_EXPIRED end access', async () => {
      await send(notification('EXPIRED', 'VOLUNTARY', 'uuid-e'), tx({ expiresDate: now - DAY }));
      expect(db.purchases[0].state).toBe('EXPIRED');
      await send(notification('GRACE_PERIOD_EXPIRED', null, 'uuid-g', now + 5000));
      expect(db.purchases[0].state).toBe('EXPIRED');
      expect(resolveEffectivePlan(db.subscriptions.get(USER))).toBe('FREE');
    });

    it('REFUND and REVOKE end access at once', async () => {
      await send(notification('REFUND', null, 'uuid-r'), tx({ revocationDate: now }));
      expect(db.purchases[0]).toMatchObject({ state: 'REVOKED' });
      expect(resolveEffectivePlan(db.subscriptions.get(USER))).toBe('FREE');
      await send(notification('REVOKE', null, 'uuid-v', now + 9000));
      expect(db.purchases[0].state).toBe('REVOKED');
    });

    it('SUBSCRIBED for a purchase the app has not validated yet is bound through appAccountToken', async () => {
      await send(notification('SUBSCRIBED', 'INITIAL_BUY', 'uuid-s'), tx({ originalTransactionId: '3000', transactionId: '3001', appAccountToken: OTHER }));
      expect(db.purchases.find((p) => p.purchaseKey === '3000')?.userId).toBe(OTHER);
      expect(db.subscriptions.get(OTHER)?.plan).toBe('PRO');
    });

    it('abuse: a replayed notification UUID is processed once', async () => {
      await send(notification('REFUND', null, 'uuid-x'), tx({ revocationDate: now }));
      const replay = await send(notification('REFUND', null, 'uuid-x'));
      expect(replay).toEqual({ received: true, status: 'duplicate' });
      expect(db.events.filter((e) => e.externalId === 'uuid-x')).toHaveLength(1);
    });

    it('an older notification never overwrites a newer state', async () => {
      await send(notification('DID_RENEW', null, 'uuid-new', now + 100000), tx({ expiresDate: now + 59 * DAY }));
      const outcome = await send(notification('EXPIRED', null, 'uuid-old', now + 10), tx({ expiresDate: now - DAY }));
      expect(outcome).toMatchObject({ status: 'ignored', note: 'older than the stored state' });
      expect(db.purchases[0].state).toBe('ACTIVE');
    });

    it('ignored on purpose: TEST, no transaction, unknown product, no account', async () => {
      expect(await send({ ...notification('TEST', null, 'u-t'), data: undefined })).toMatchObject({ note: 'test notification' });
      expect(await send({ ...notification('PRICE_INCREASE', null, 'u-n'), data: {} })).toMatchObject({ note: 'no transaction' });
      expect(await send(notification('DID_RENEW', null, 'u-p'), tx({ productId: 'io.sesly.premium_monthly' }))).toMatchObject({
        note: 'unknown product',
      });
      expect(await send(notification('SUBSCRIBED', null, 'u-a'), tx({ originalTransactionId: '4000', appAccountToken: undefined }))).toMatchObject({
        note: 'no account for this purchase yet',
      });
      expect(await send({ notificationUUID: 'u-x', data: { signedTransactionInfo: 'jws-tx' } })).toMatchObject({ status: 'processed' });
    });

    it('missing or forged payloads are rejected (400) before anything is recorded', async () => {
      await expect(service.handleNotification({})).rejects.toBeInstanceOf(StoreRejectedError);
      await expect(service.handleNotification({ signedPayload: 42 })).rejects.toBeInstanceOf(StoreRejectedError);
      apple.verifyNotification.mockRejectedValue(new StoreRejectedError('bad chain'));
      const before = db.events.length;
      await expect(service.handleNotification({ signedPayload: 'forged' })).rejects.toBeInstanceOf(StoreRejectedError);
      expect(db.events).toHaveLength(before);
    });

    it('a failure while processing marks the event FAILED and is retried on redelivery', async () => {
      apple.verifyNotification.mockResolvedValue(notification('DID_RENEW', null, 'uuid-f'));
      apple.verifyTransaction.mockResolvedValue(tx());
      apple.verifyRenewalInfo.mockResolvedValue(renewal());
      db.prisma.storePurchase.upsert.mockRejectedValueOnce(new Error('db down'));
      await expect(service.handleNotification({ signedPayload: 's' })).rejects.toThrow('db down');
      expect(db.events.find((e) => e.externalId === 'uuid-f')?.status).toBe('FAILED');
      await expect(service.handleNotification({ signedPayload: 's' })).resolves.toMatchObject({ status: 'processed' });
    });
  });

  describe('parseAppleState', () => {
    const at = new Date(now);
    it('maps every case', () => {
      expect(parseAppleState(tx() as any, null, null, at)).toMatchObject({ state: 'ACTIVE', autoRenew: true });
      expect(parseAppleState(tx() as any, renewal({ autoRenewStatus: 0 }) as any, null, at).state).toBe('CANCELED');
      expect(parseAppleState(tx({ expiresDate: undefined }) as any, null, null, at)).toMatchObject({ state: 'EXPIRED', expiresAt: null });
      expect(parseAppleState(tx() as any, null, 'REVOKE', at)).toMatchObject({ state: 'REVOKED', revokedAt: at });
      expect(parseAppleState(tx() as any, null, 'GRACE_PERIOD_EXPIRED', at).state).toBe('EXPIRED');
      expect(parseAppleState(tx({ expiresDate: now - DAY }) as any, renewal({ gracePeriodExpiresDate: now - 1 }) as any, null, at).state).toBe('EXPIRED');
      expect(parseAppleState(tx() as any, null).state).toBe('ACTIVE');
    });
  });
});
