/**
 * Store product ids of the paid plans and how they relate to each other.
 *
 * Google Play sells `mini_monthly`, `pro_monthly` and `pro_yearly` (the ids in
 * `PLANS.productIds`); the App Store sells the same three with the
 * `io.sesly.` prefix (backend STORE_PRODUCTS, the only other place the ids
 * live). Pure functions, no store library.
 */

import { BillingPeriod, PLANS, PlanId } from '../../models/Plans';

export type StorePlatform = 'android' | 'ios';

/** The App Store prefix of every product id. */
export const APPLE_PRODUCT_PREFIX = 'io.sesly.';

/** The Android package (Play subscription center deep link, validation). */
export const ANDROID_PACKAGE_NAME = 'com.sesly';

export type PaidPlanId = Exclude<PlanId, 'free'>;

export interface StoreProductRef {
  readonly plan: PaidPlanId;
  readonly period: BillingPeriod;
}

/**
 * Order of the products from the smallest to the biggest: a move to a later
 * one is an upgrade (charged now, prorated), to an earlier one a downgrade
 * (from the next renewal).
 */
const PRODUCT_ORDER: readonly StoreProductRef[] = [
  { plan: 'mini', period: 'monthly' },
  { plan: 'premium', period: 'monthly' },
  { plan: 'premium', period: 'yearly' },
];

/** The store product id of a plan and period on a platform; null when not sold that way. */
export function productIdFor(plan: PlanId, period: BillingPeriod, platform: StorePlatform): string | null {
  const base = PLANS[plan].productIds[period];
  if (!base) return null;
  return platform === 'ios' ? `${APPLE_PRODUCT_PREFIX}${base}` : base;
}

/** Every product the app sells on a platform, smallest first. */
export function allProductIds(platform: StorePlatform): string[] {
  return PRODUCT_ORDER.map(ref => productIdFor(ref.plan, ref.period, platform)).filter(
    (id): id is string => id !== null,
  );
}

/** The plan and period of a store product id (either platform); null for anything else. */
export function productRefFor(productId: string | null | undefined): StoreProductRef | null {
  if (!productId) return null;
  const base = productId.startsWith(APPLE_PRODUCT_PREFIX)
    ? productId.slice(APPLE_PRODUCT_PREFIX.length)
    : productId;
  return (
    PRODUCT_ORDER.find(ref => PLANS[ref.plan].productIds[ref.period] === base) ?? null
  );
}

/** True for a product this app sells (either platform). */
export function isSeslyProduct(productId: string | null | undefined): boolean {
  return productRefFor(productId) !== null;
}

function rankOf(productId: string): number {
  const ref = productRefFor(productId);
  if (!ref) return -1;
  return PRODUCT_ORDER.findIndex(item => item.plan === ref.plan && item.period === ref.period);
}

export type PlanChange = 'upgrade' | 'downgrade' | 'same';

/** How a move from one product to another counts (unknown products count as an upgrade). */
export function planChange(fromProductId: string, toProductId: string): PlanChange {
  const from = rankOf(fromProductId);
  const to = rankOf(toProductId);
  if (from === to) return 'same';
  return to > from ? 'upgrade' : 'downgrade';
}

/**
 * The Google Play replacement mode of a subscription change (Play Billing
 * rules): an upgrade starts now and credits the time left on the old plan
 * (`with-time-proration`, valid for every upgrade, period changes included);
 * a downgrade waits for the next renewal (`deferred`), so nobody pays twice
 * or loses what they paid for.
 */
export function replacementModeFor(change: PlanChange): 'with-time-proration' | 'deferred' {
  return change === 'downgrade' ? 'deferred' : 'with-time-proration';
}
