import {
  StorePlatform,
  StorePurchaseState,
  SubscriptionPlan,
} from '../../../common/enums/prisma.enums';
import { PLAN_RANK, toPlan } from '../../../common/constants/plans.constants';
import {
  PlanSource,
  resolveGrantPlan,
  STORE_RENEWAL_GRACE_MS,
} from '../../../common/utils/subscription-plan';

/**
 * Turns the store purchases of a user into the store-backed columns of
 * their Subscription row (plan / status / currentPeriodEnd / store ids).
 *
 * Precedence: the admin grant (grantPlan / grantEndsAt) is never written
 * here, and resolveEffectivePlan takes the better of grant and store, so a
 * store write can never shorten a grant. When no purchase grants anything
 * and a grant is running, the row mirrors the grant (admin lists and counts
 * read the row columns).
 */

export interface PurchaseRow {
  id: string;
  userId: string;
  platform: StorePlatform | string;
  purchaseKey: string;
  productId: string;
  plan: SubscriptionPlan | string;
  state: StorePurchaseState | string;
  expiresAt: Date | null;
  autoRenew: boolean;
  latestTransactionId?: string | null;
  updatedAt?: Date | null;
}

/** States that grant access until expiresAt. */
export const ENTITLING_STATES: readonly string[] = ['ACTIVE', 'CANCELED', 'GRACE'];

export function isEntitling(purchase: PurchaseRow, now: Date = new Date()): boolean {
  if (!ENTITLING_STATES.includes(purchase.state)) return false;
  if (!purchase.expiresAt) return true;
  return new Date(purchase.expiresAt).getTime() + STORE_RENEWAL_GRACE_MS >= now.getTime();
}

function expiryOf(purchase: PurchaseRow): number {
  return purchase.expiresAt ? new Date(purchase.expiresAt).getTime() : Number.POSITIVE_INFINITY;
}

/** Best entitling purchase: highest plan, then the latest expiry. */
export function pickBestPurchase(purchases: PurchaseRow[], now: Date = new Date()): PurchaseRow | null {
  let best: PurchaseRow | null = null;
  for (const purchase of purchases) {
    if (!isEntitling(purchase, now)) continue;
    if (!best) {
      best = purchase;
      continue;
    }
    const rank = PLAN_RANK[toPlan(purchase.plan)];
    const bestRank = PLAN_RANK[toPlan(best.plan)];
    if (rank > bestRank || (rank === bestRank && expiryOf(purchase) > expiryOf(best))) {
      best = purchase;
    }
  }
  return best;
}

function storeIds(purchase: PurchaseRow | null) {
  const apple = purchase?.platform === 'APPLE';
  const google = purchase?.platform === 'GOOGLE';
  return {
    appleOriginalTransactionId: apple ? purchase.purchaseKey : null,
    appleTransactionId: apple ? (purchase.latestTransactionId ?? null) : null,
    googlePurchaseToken: google ? purchase.purchaseKey : null,
    googleProductId: google ? purchase.productId : null,
  };
}

export interface SubscriptionRowData {
  plan: SubscriptionPlan;
  status: 'ACTIVE' | 'PAST_DUE' | 'EXPIRED';
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  storePurchaseId: string | null;
  appleOriginalTransactionId: string | null;
  appleTransactionId: string | null;
  googlePurchaseToken: string | null;
  googleProductId: string | null;
}

/**
 * The store-backed columns for this user, or null when there is nothing to
 * write (no purchase and no running grant: the row stays as it is).
 */
export function computeSubscriptionRow(
  subscription: (PlanSource & { grantPlan?: string | null }) | null,
  purchases: PurchaseRow[],
  now: Date = new Date(),
): SubscriptionRowData | null {
  const best = pickBestPurchase(purchases, now);
  if (best) {
    return {
      plan: toPlan(best.plan),
      status: best.state === 'GRACE' ? 'PAST_DUE' : 'ACTIVE',
      currentPeriodEnd: best.expiresAt,
      cancelAtPeriodEnd: best.state === 'CANCELED' || !best.autoRenew,
      storePurchaseId: best.id,
      ...storeIds(best),
    };
  }

  if (subscription && resolveGrantPlan(subscription, now) !== 'FREE') {
    return {
      plan: toPlan(subscription.grantPlan),
      status: 'ACTIVE',
      currentPeriodEnd: subscription.grantEndsAt ? new Date(subscription.grantEndsAt) : null,
      cancelAtPeriodEnd: false,
      storePurchaseId: null,
      ...storeIds(null),
    };
  }

  if (purchases.length === 0) return null;

  // Nothing grants access: record the most recent purchase as lapsed.
  const latest = [...purchases].sort(
    (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime(),
  )[0];
  return {
    plan: toPlan(latest.plan),
    status: 'EXPIRED',
    currentPeriodEnd: latest.expiresAt,
    cancelAtPeriodEnd: true,
    storePurchaseId: latest.id,
    ...storeIds(latest),
  };
}

export interface EntitlementPrisma {
  subscription: {
    findUnique(args: any): Promise<any>;
    upsert(args: any): Promise<any>;
  };
  storePurchase: {
    findMany(args: any): Promise<any[]>;
  };
}

/**
 * Re-derive the Subscription row of one user from their store purchases and
 * grant. Called after every store write and every admin grant change.
 */
export async function recomputeSubscription(
  prisma: EntitlementPrisma,
  userId: string,
  now: Date = new Date(),
): Promise<any> {
  const [subscription, purchases] = await Promise.all([
    prisma.subscription.findUnique({ where: { userId } }),
    prisma.storePurchase.findMany({ where: { userId } }),
  ]);
  const data = computeSubscriptionRow(subscription, purchases, now);
  if (!data) return subscription;
  return prisma.subscription.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}
