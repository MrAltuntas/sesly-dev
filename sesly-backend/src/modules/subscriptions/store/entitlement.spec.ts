import {
  computeSubscriptionRow,
  isEntitling,
  pickBestPurchase,
  PurchaseRow,
  recomputeSubscription,
} from './entitlement';
import { resolveEffectivePlan } from '../../../common/utils/subscription-plan';

const NOW = new Date('2026-10-16T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const purchase = (overrides: Partial<PurchaseRow> = {}): PurchaseRow => ({
  id: 'p1',
  userId: 'u1',
  platform: 'GOOGLE',
  purchaseKey: 'token-1',
  productId: 'pro_monthly',
  plan: 'PRO',
  state: 'ACTIVE',
  expiresAt: new Date(NOW.getTime() + 10 * DAY),
  autoRenew: true,
  latestTransactionId: 'GPA.1',
  updatedAt: NOW,
  ...overrides,
});

describe('entitlement (store purchases to the Subscription row)', () => {
  it('ACTIVE, CANCELED and GRACE grant until expiry (+24h renewal grace); others never', () => {
    for (const state of ['ACTIVE', 'CANCELED', 'GRACE']) {
      expect(isEntitling(purchase({ state }), NOW)).toBe(true);
    }
    for (const state of ['PENDING', 'ON_HOLD', 'PAUSED', 'EXPIRED', 'REVOKED', 'REPLACED']) {
      expect(isEntitling(purchase({ state }), NOW)).toBe(false);
    }
    expect(isEntitling(purchase({ expiresAt: new Date(NOW.getTime() - 2 * DAY) }), NOW)).toBe(false);
    expect(isEntitling(purchase({ expiresAt: new Date(NOW.getTime() - DAY / 2) }), NOW)).toBe(true);
    expect(isEntitling(purchase({ expiresAt: null }), NOW)).toBe(true);
    expect(isEntitling(purchase({ expiresAt: new Date(Date.now() + DAY) }))).toBe(true);
  });

  it('best purchase: highest plan first, then the latest expiry', () => {
    const mini = purchase({ id: 'mini', plan: 'MINI', expiresAt: new Date(NOW.getTime() + 30 * DAY) });
    const pro = purchase({ id: 'pro', plan: 'PRO' });
    const proLater = purchase({ id: 'pro-later', plan: 'PRO', expiresAt: new Date(NOW.getTime() + 20 * DAY) });
    const proOpen = purchase({ id: 'pro-open', plan: 'PRO', expiresAt: null });
    const expired = purchase({ id: 'old', plan: 'CREATOR', state: 'EXPIRED' });
    expect(pickBestPurchase([mini, pro, proLater, expired], NOW)?.id).toBe('pro-later');
    expect(pickBestPurchase([proLater, pro], NOW)?.id).toBe('pro-later');
    expect(pickBestPurchase([pro, proOpen], NOW)?.id).toBe('pro-open');
    expect(pickBestPurchase([expired], NOW)).toBeNull();
    expect(pickBestPurchase([mini])?.id).toBe('mini');
  });

  it('an entitling Google purchase becomes the row (status, period end, ids)', () => {
    expect(computeSubscriptionRow(null, [purchase({ state: 'CANCELED' })], NOW)).toEqual({
      plan: 'PRO',
      status: 'ACTIVE',
      currentPeriodEnd: purchase().expiresAt,
      cancelAtPeriodEnd: true,
      storePurchaseId: 'p1',
      appleOriginalTransactionId: null,
      appleTransactionId: null,
      googlePurchaseToken: 'token-1',
      googleProductId: 'pro_monthly',
    });
  });

  it('an Apple purchase in billing grace is PAST_DUE with the Apple ids', () => {
    const row = computeSubscriptionRow(
      null,
      [purchase({ platform: 'APPLE', purchaseKey: '2000001', state: 'GRACE', latestTransactionId: null, productId: 'io.sesly.mini_monthly', plan: 'MINI' })],
      NOW,
    );
    expect(row).toMatchObject({
      plan: 'MINI',
      status: 'PAST_DUE',
      cancelAtPeriodEnd: false,
      appleOriginalTransactionId: '2000001',
      appleTransactionId: null,
      googlePurchaseToken: null,
    });
  });

  it('no store entitlement but a running grant: the row mirrors the grant (store ids cleared)', () => {
    const end = new Date(NOW.getTime() + 5 * DAY);
    const row = computeSubscriptionRow(
      { plan: 'PRO', grantPlan: 'CREATOR', grantEndsAt: end },
      [purchase({ state: 'EXPIRED' })],
      NOW,
    );
    expect(row).toMatchObject({ plan: 'CREATOR', status: 'ACTIVE', currentPeriodEnd: end, storePurchaseId: null, googlePurchaseToken: null });
    const open = computeSubscriptionRow({ plan: 'FREE', grantPlan: 'MINI', grantEndsAt: null }, [], NOW);
    expect(open).toMatchObject({ plan: 'MINI', currentPeriodEnd: null });
  });

  it('nothing grants: the most recent purchase is recorded as EXPIRED; nothing at all: no write', () => {
    const older = purchase({ id: 'a', state: 'EXPIRED', updatedAt: new Date(NOW.getTime() - DAY) });
    const newer = purchase({ id: 'b', state: 'REVOKED', plan: 'MINI', updatedAt: NOW });
    expect(computeSubscriptionRow(null, [older, newer], NOW)).toMatchObject({
      plan: 'MINI',
      status: 'EXPIRED',
      storePurchaseId: 'b',
      cancelAtPeriodEnd: true,
    });
    expect(computeSubscriptionRow(null, [purchase({ state: 'EXPIRED', updatedAt: null })], NOW)).toMatchObject({ status: 'EXPIRED' });
    expect(computeSubscriptionRow({ plan: 'PRO', grantPlan: 'PRO', grantEndsAt: new Date(NOW.getTime() - DAY) }, [], NOW)).toBeNull();
    expect(computeSubscriptionRow(null, [])).toBeNull();
  });

  it('precedence: a store write never shortens an admin grant', () => {
    // Admin granted PREMIUM until the 30th; the user's store MINI lapses.
    const grant = { grantPlan: 'PRO', grantEndsAt: new Date(NOW.getTime() + 14 * DAY) };
    const row = computeSubscriptionRow({ plan: 'FREE', ...grant }, [purchase({ plan: 'MINI', state: 'EXPIRED' })], NOW);
    expect(resolveEffectivePlan({ ...(row as any), ...grant }, NOW)).toBe('PRO');
    // A running MINI under a PRO grant: PRO now, MINI after the grant.
    const withMini = computeSubscriptionRow({ plan: 'FREE', ...grant }, [purchase({ plan: 'MINI' })], NOW);
    expect(resolveEffectivePlan({ ...(withMini as any), ...grant }, NOW)).toBe('PRO');
    expect(resolveEffectivePlan({ ...(withMini as any), ...grant }, new Date(NOW.getTime() + 9 * DAY))).toBe('PRO');
  });

  it('recomputeSubscription upserts the derived row, or returns the row untouched', async () => {
    const prisma = {
      subscription: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({ id: 's1' }) },
      storePurchase: { findMany: jest.fn().mockResolvedValue([purchase()]) },
    };
    await expect(recomputeSubscription(prisma, 'u1', NOW)).resolves.toEqual({ id: 's1' });
    expect(prisma.subscription.upsert.mock.calls[0][0]).toMatchObject({
      where: { userId: 'u1' },
      create: { userId: 'u1', plan: 'PRO' },
      update: { plan: 'PRO', storePurchaseId: 'p1' },
    });

    prisma.storePurchase.findMany.mockResolvedValue([]);
    prisma.subscription.findUnique.mockResolvedValue({ plan: 'FREE' });
    await expect(recomputeSubscription(prisma, 'u1')).resolves.toEqual({ plan: 'FREE' });
    expect(prisma.subscription.upsert).toHaveBeenCalledTimes(1);
  });
});
