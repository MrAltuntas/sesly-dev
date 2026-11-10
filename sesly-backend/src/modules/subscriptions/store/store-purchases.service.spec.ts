import { ConflictException } from '@nestjs/common';
import { StorePurchasesService, StorePurchaseSnapshot } from './store-purchases.service';
import { createFakeStoreDb, FakeStoreDb } from '../../../test-utils/fake-store-db';
import { findStoreProduct } from '../../../common/constants/store-products.constants';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const snapshot = (overrides: Partial<StorePurchaseSnapshot> = {}): StorePurchaseSnapshot => ({
  platform: 'GOOGLE',
  purchaseKey: 'tok',
  product: findStoreProduct('GOOGLE', 'pro_monthly')!,
  state: 'ACTIVE',
  expiresAt: new Date(Date.now() + 86400000 * 10),
  autoRenew: true,
  ...overrides,
});

describe('StorePurchasesService', () => {
  let db: FakeStoreDb;
  let service: StorePurchasesService;

  beforeEach(() => {
    db = createFakeStoreDb();
    db.users.add(USER);
    service = new StorePurchasesService(db.prisma);
  });

  it('applySnapshot creates the purchase and keeps earlier details when a later snapshot omits them', async () => {
    await service.applySnapshot(USER, snapshot({ latestTransactionId: 'o1', environment: 'production', acknowledged: true }));
    const { purchase, stale } = await service.applySnapshot(USER, snapshot({ state: 'GRACE' }));
    expect(stale).toBe(false);
    expect(purchase).toMatchObject({ state: 'GRACE', latestTransactionId: 'o1', environment: 'production', acknowledged: true });
    expect(db.purchases).toHaveLength(1);
  });

  it('an older store timestamp is ignored (stale), the stored state wins', async () => {
    await service.applySnapshot(USER, snapshot({ storeTimestamp: new Date('2026-10-16T10:00:00Z') }));
    const result = await service.applySnapshot(
      USER,
      snapshot({ state: 'EXPIRED', storeTimestamp: new Date('2026-10-16T09:00:00Z') }),
    );
    expect(result.stale).toBe(true);
    expect(db.purchases[0].state).toBe('ACTIVE');
  });

  it('unique violations on purchase or subscription writes become 409 RECEIPT_IN_USE; other errors pass through', async () => {
    db.prisma.storePurchase.upsert.mockRejectedValueOnce({ code: 'P2002', meta: { target: ['platform', 'purchaseKey'] } });
    await expect(service.applySnapshot(USER, snapshot())).rejects.toBeInstanceOf(ConflictException);

    db.prisma.storePurchase.upsert.mockRejectedValueOnce({ code: 'P2002', meta: { target: 'users_email_key' } });
    await expect(service.applySnapshot(USER, snapshot())).rejects.toMatchObject({ code: 'P2002' });

    db.prisma.storePurchase.upsert.mockRejectedValueOnce(new Error('db down'));
    await expect(service.applySnapshot(USER, snapshot())).rejects.toThrow('db down');

    db.prisma.subscription.upsert.mockRejectedValueOnce({ code: 'P2002', meta: { target: ['googlePurchaseToken'] } });
    await expect(service.applySnapshot(USER, snapshot())).rejects.toBeInstanceOf(ConflictException);

    db.prisma.subscription.upsert.mockRejectedValueOnce(new Error('boom'));
    await expect(service.applySnapshot(USER, snapshot())).rejects.toThrow('boom');
  });

  it('revoke: unknown purchase is null; a known one is REVOKED and the row loses access', async () => {
    expect(await service.revoke('APPLE', 'nope')).toBeNull();
    await service.applySnapshot(USER, snapshot());
    const revoked = await service.revoke('GOOGLE', 'tok');
    expect(revoked).toMatchObject({ state: 'REVOKED', autoRenew: false });
    expect(db.subscriptions.get(USER)?.status).toBe('EXPIRED');
  });

  it('assertNotOwnedByAnotherUser checks the Apple legacy column too', async () => {
    db.subscriptions.set(OTHER, { userId: OTHER, plan: 'PRO', appleOriginalTransactionId: '9000' });
    await expect(service.assertNotOwnedByAnotherUser(USER, 'APPLE', '9000')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.assertNotOwnedByAnotherUser(OTHER, 'APPLE', '9000')).resolves.toBeUndefined();
  });

  describe('store_events', () => {
    const input = { platform: 'APPLE' as const, source: 'NOTIFICATION' as const, externalId: 'n-1', type: 'DID_RENEW' };

    it('claim: first time new, PROCESSED / IGNORED replays are duplicates, RECEIVED / FAILED may be retried', async () => {
      const first = await service.claimNotification(input);
      expect(first.duplicate).toBe(false);
      expect(await service.claimNotification(input)).toEqual({ eventId: first.eventId, duplicate: false });
      await service.finishEvent(first.eventId, 'IGNORED', { purchaseKey: 'k', productId: 'p' });
      expect(await service.claimNotification(input)).toEqual({ eventId: first.eventId, duplicate: true });
      expect(db.events[0]).toMatchObject({ purchaseKey: 'k', productId: 'p', status: 'IGNORED' });
    });

    it('claim: unexpected errors are rethrown (also a unique error without an external id)', async () => {
      db.prisma.storeEvent.create.mockRejectedValueOnce(new Error('db down'));
      await expect(service.claimNotification(input)).rejects.toThrow('db down');
      db.prisma.storeEvent.create.mockRejectedValueOnce({ code: 'P2002' });
      await expect(service.claimNotification({ ...input, externalId: null })).rejects.toMatchObject({ code: 'P2002' });
      db.prisma.storeEvent.create.mockRejectedValueOnce({ code: 'P2002' });
      db.prisma.storeEvent.findUnique.mockResolvedValueOnce(null);
      await expect(service.claimNotification(input)).rejects.toMatchObject({ code: 'P2002' });
    });

    it('recordEvent never fails the caller', async () => {
      db.prisma.storeEvent.create.mockRejectedValueOnce(new Error('db down'));
      await expect(service.recordEvent({ ...input, externalId: null }, 'PROCESSED')).resolves.toBeUndefined();
      db.prisma.storeEvent.create.mockRejectedValueOnce('plain');
      await expect(service.recordEvent({ ...input, externalId: null }, 'PROCESSED', 'note')).resolves.toBeUndefined();
    });
  });

  it('existingUserId only accepts a UUID of a real user', async () => {
    expect(await service.existingUserId(undefined)).toBeNull();
    expect(await service.existingUserId('not-a-uuid')).toBeNull();
    expect(await service.existingUserId(OTHER)).toBeNull();
    expect(await service.existingUserId(USER.toUpperCase())).toBe(USER);
  });
});
