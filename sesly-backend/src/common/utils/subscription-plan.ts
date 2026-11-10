import { SubscriptionPlan } from '../enums/prisma.enums';
import { PLAN_RANK, toPlan } from '../constants/plans.constants';

/**
 * Central plan resolution: which plan does this user actually get right now?
 *
 * Every entitlement check (narration quota, premium stories, voice slots,
 * /users/me tier, /subscriptions/current) goes through this helper instead
 * of reading `subscription.plan` directly.
 *
 * A Subscription row carries two independent sources:
 *   - the store-backed columns (plan / status / currentPeriodEnd), written by
 *     the store validators and notifications (and by legacy admin grants);
 *   - the admin grant (grantPlan / grantEndsAt), written only by admin code.
 * The effective plan is the better of the two (PLAN_RANK), so a store write
 * can never shorten an admin grant and an ended grant never hides a store
 * subscription.
 *
 * Store-backed rules:
 *   - plan FREE / unknown          -> FREE
 *   - status EXPIRED               -> FREE
 *   - currentPeriodEnd passed      -> FREE (store-backed rows get a 24h grace
 *                                     so a late renewal notification does not
 *                                     downgrade a paying user)
 *   - otherwise                    -> the stored plan
 * Grant rules: grantPlan while grantEndsAt is null (open ended) or not passed.
 */
export interface PlanSource {
  plan: string;
  status?: string | null;
  currentPeriodEnd?: Date | string | null;
  stripeSubscriptionId?: string | null;
  appleTransactionId?: string | null;
  appleOriginalTransactionId?: string | null;
  googlePurchaseToken?: string | null;
  grantPlan?: string | null;
  grantEndsAt?: Date | string | null;
}

export const STORE_RENEWAL_GRACE_MS = 24 * 60 * 60 * 1000;

export function hasStoreBilling(sub: PlanSource): boolean {
  return !!(
    sub.stripeSubscriptionId ||
    sub.appleTransactionId ||
    sub.appleOriginalTransactionId ||
    sub.googlePurchaseToken
  );
}

/** Plan from the store-backed columns only. */
export function resolveRowPlan(sub: PlanSource, now: Date = new Date()): SubscriptionPlan {
  const plan = toPlan(sub.plan);
  if (plan === SubscriptionPlan.FREE) return SubscriptionPlan.FREE;
  if (sub.status === 'EXPIRED') return SubscriptionPlan.FREE;

  if (sub.currentPeriodEnd) {
    const end = new Date(sub.currentPeriodEnd).getTime();
    const grace = hasStoreBilling(sub) ? STORE_RENEWAL_GRACE_MS : 0;
    if (Number.isFinite(end) && end + grace < now.getTime()) {
      return SubscriptionPlan.FREE;
    }
  }
  return plan;
}

/** Plan from the admin grant only. */
export function resolveGrantPlan(sub: PlanSource, now: Date = new Date()): SubscriptionPlan {
  const plan = toPlan(sub.grantPlan);
  if (plan === SubscriptionPlan.FREE) return SubscriptionPlan.FREE;
  if (sub.grantEndsAt) {
    const end = new Date(sub.grantEndsAt).getTime();
    if (Number.isFinite(end) && end < now.getTime()) return SubscriptionPlan.FREE;
  }
  return plan;
}

export function higherPlan(a: SubscriptionPlan, b: SubscriptionPlan): SubscriptionPlan {
  return PLAN_RANK[b] > PLAN_RANK[a] ? b : a;
}

export type EntitlementSource = 'STORE' | 'GRANT' | 'NONE';

export function resolveEffectiveSource(
  sub: PlanSource | null | undefined,
  now: Date = new Date(),
): { plan: SubscriptionPlan; source: EntitlementSource } {
  if (!sub) return { plan: SubscriptionPlan.FREE, source: 'NONE' };
  const row = resolveRowPlan(sub, now);
  const grant = resolveGrantPlan(sub, now);
  if (grant !== SubscriptionPlan.FREE && PLAN_RANK[grant] > PLAN_RANK[row]) {
    return { plan: grant, source: 'GRANT' };
  }
  if (row !== SubscriptionPlan.FREE) return { plan: row, source: 'STORE' };
  return { plan: SubscriptionPlan.FREE, source: 'NONE' };
}

export function resolveEffectivePlan(
  sub: PlanSource | null | undefined,
  now: Date = new Date(),
): SubscriptionPlan {
  return resolveEffectiveSource(sub, now).plan;
}

/**
 * Prisma `where` (on Subscription) for "the paid period has not run out yet",
 * the same rule resolveRowPlan applies in memory:
 *   - no currentPeriodEnd (open-ended), or
 *   - currentPeriodEnd >= now, or
 *   - store-billed and currentPeriodEnd within the 24h renewal grace.
 * Combine it with plan / status filters; it is wrapped in AND so callers can
 * still use a top-level OR of their own.
 */
export function paidPeriodActiveWhere(now: Date = new Date()) {
  return {
    OR: [
      { currentPeriodEnd: null },
      { currentPeriodEnd: { gte: now } },
      {
        currentPeriodEnd: { gte: new Date(now.getTime() - STORE_RENEWAL_GRACE_MS) },
        OR: [
          { stripeSubscriptionId: { not: null } },
          { appleTransactionId: { not: null } },
          { appleOriginalTransactionId: { not: null } },
          { googlePurchaseToken: { not: null } },
        ],
      },
    ],
  };
}

/** Every plan a user pays for (or was granted): all but FREE. */
export const PAID_PLANS: SubscriptionPlan[] = [
  SubscriptionPlan.MINI,
  SubscriptionPlan.PRO,
  SubscriptionPlan.CREATOR,
];

export function isPaidPlan(plan: string | null | undefined): boolean {
  return PAID_PLANS.includes(plan as SubscriptionPlan);
}
