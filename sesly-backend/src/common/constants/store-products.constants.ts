import {
  StoreBillingPeriod,
  StorePlatform,
  SubscriptionPlan,
} from '../enums/prisma.enums';

/**
 * THE store product map: every product id the backend accepts, with the plan
 * and billing period it grants. Validators, server notifications and the
 * public plan list all read this list; a product that is not here is
 * rejected before anything is written (400 PRODUCT_UNKNOWN), and an unknown
 * product in a server notification is recorded and ignored.
 *
 * Product ids are permanent in both stores: create exactly these in Play
 * Console and App Store Connect (see "In-app purchases" in CLAUDE.md).
 * On the App Store all three must be in ONE subscription group, so a user
 * can hold only one of them and moving between them is an upgrade or a
 * downgrade of the same subscription.
 */
export interface StoreProduct {
  platform: StorePlatform;
  productId: string;
  plan: SubscriptionPlan;
  period: StoreBillingPeriod;
}

export const STORE_PRODUCTS: readonly StoreProduct[] = [
  // Google Play subscriptions (package com.sesly)
  { platform: 'GOOGLE', productId: 'mini_monthly', plan: 'MINI', period: 'MONTH' },
  { platform: 'GOOGLE', productId: 'pro_monthly', plan: 'PRO', period: 'MONTH' },
  { platform: 'GOOGLE', productId: 'pro_yearly', plan: 'PRO', period: 'YEAR' },
  // App Store auto-renewable subscriptions (bundle com.sesly), one group
  { platform: 'APPLE', productId: 'io.sesly.mini_monthly', plan: 'MINI', period: 'MONTH' },
  { platform: 'APPLE', productId: 'io.sesly.pro_monthly', plan: 'PRO', period: 'MONTH' },
  { platform: 'APPLE', productId: 'io.sesly.pro_yearly', plan: 'PRO', period: 'YEAR' },
];

export function findStoreProduct(
  platform: StorePlatform,
  productId: string | null | undefined,
): StoreProduct | undefined {
  if (!productId) return undefined;
  return STORE_PRODUCTS.find((p) => p.platform === platform && p.productId === productId);
}

export function storeProductsForPlan(plan: SubscriptionPlan): StoreProduct[] {
  return STORE_PRODUCTS.filter((p) => p.plan === plan);
}

/** Lower-case wire form of the billing period used by the client API. */
export function periodLabel(period: StoreBillingPeriod): 'month' | 'year' {
  return period === 'YEAR' ? 'year' : 'month';
}
