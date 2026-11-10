/**
 * Plans: Ücretsiz, Mini, Premium (owner decisions of 2026-10-13, design v3
 * frames 22 and 23).
 *
 * The numbers mirror the backend's PLAN_LIMITS and PLAN_PRICES
 * (sesly-backend common/constants/plans.constants.ts; contract.test.ts fails
 * when they drift). The backend enforces the limits and serves the live
 * counters on GET /usage (models/Quota.ts); this constant is what the app
 * shows before /usage has answered or without a connection, and the one
 * place for plan names, prices and store product ids. Nothing here grants or
 * blocks anything. The prices here are reference prices: the plans screen
 * shows the store's own localised price once the store products are loaded
 * (stores/PurchaseStore).
 */

import { SubscriptionTier, parseSubscriptionTier } from '../types/enums';

export type PlanId = 'free' | 'mini' | 'premium';
export type BillingPeriod = 'monthly' | 'yearly';

/** A monthly limit renews every month; a lifetime limit never renews. */
export type LimitPeriod = 'month' | 'lifetime';

export interface PlanLimit {
  /** Allowed in the period; null means unlimited. */
  readonly amount: number | null;
  readonly period: LimitPeriod;
}

export interface PlanDefinition {
  readonly id: PlanId;
  /**
   * Product name, the same in every language ("Mini", "Premium"). Null for
   * the free plan, whose name is translated (plans:free).
   */
  readonly brandName: string | null;
  /** Price per billing period in `PLAN_CURRENCY`; null when not sold that way. */
  readonly prices: Readonly<Record<BillingPeriod, number | null>>;
  /**
   * Google Play product id per billing period (the App Store ids add an
   * `io.sesly.` prefix, backend STORE_PRODUCTS); null when not sold that way.
   */
  readonly productIds: Readonly<Record<BillingPeriod, string | null>>;
  /** Narrations with ready-made narrators. */
  readonly presetNarrations: PlanLimit;
  /** Narrations with the user's own (cloned) voice. */
  readonly clonedNarrations: PlanLimit;
  /** New own voices (recordings accepted). A delete never gives one back. */
  readonly cloneCreations: PlanLimit;
  /** Own voices held at once (backend PLAN_LIMITS.cloneVoiceSlots); a delete frees one. */
  readonly cloneVoiceSlots: number;
  /** Listening with the screen off, with lock-screen controls. */
  readonly backgroundPlayback: boolean;
  /** Stories flagged premium. */
  readonly premiumStories: boolean;
}

export const PLAN_CURRENCY = 'TRY';

export const PLANS: Readonly<Record<PlanId, PlanDefinition>> = {
  free: {
    id: 'free',
    brandName: null,
    prices: { monthly: null, yearly: null },
    productIds: { monthly: null, yearly: null },
    presetNarrations: { amount: 20, period: 'month' },
    // One narration in total, for the life of the account. It never renews.
    clonedNarrations: { amount: 1, period: 'lifetime' },
    cloneCreations: { amount: 1, period: 'lifetime' },
    cloneVoiceSlots: 1,
    backgroundPlayback: false,
    premiumStories: false,
  },
  mini: {
    id: 'mini',
    brandName: 'Mini',
    prices: { monthly: 49.99, yearly: null },
    productIds: { monthly: 'mini_monthly', yearly: null },
    presetNarrations: { amount: null, period: 'month' },
    clonedNarrations: { amount: 5, period: 'month' },
    cloneCreations: { amount: 2, period: 'month' },
    cloneVoiceSlots: 1,
    backgroundPlayback: true,
    premiumStories: true,
  },
  premium: {
    id: 'premium',
    brandName: 'Premium',
    prices: { monthly: 199.99, yearly: 1499.99 },
    productIds: { monthly: 'pro_monthly', yearly: 'pro_yearly' },
    presetNarrations: { amount: null, period: 'month' },
    clonedNarrations: { amount: 20, period: 'month' },
    cloneCreations: { amount: 5, period: 'month' },
    cloneVoiceSlots: 3,
    backgroundPlayback: true,
    premiumStories: true,
  },
};

/** Display order on the plans screen. */
export const PLAN_ORDER: readonly PlanId[] = ['free', 'mini', 'premium'];

/**
 * The plan a backend tier is shown as. PRO is sold as Premium, and CREATOR
 * (an admin grant with at least Premium's limits) is shown as Premium too.
 */
export function planIdForTier(tier: SubscriptionTier | string | null | undefined): PlanId {
  switch (parseSubscriptionTier(tier)) {
    case SubscriptionTier.MINI:
      return 'mini';
    case SubscriptionTier.PRO:
    case SubscriptionTier.CREATOR:
      return 'premium';
    default:
      return 'free';
  }
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** `key` with `{ amount }`, or its `One` variant at 1 (Hermes has no plural rules). */
function amountLine(t: Translate, key: string, amount: number): string {
  return amount === 1 ? t(`${key}One`) : t(key, { amount });
}

/**
 * The lines of a plan card, from the plan constant: the two narration
 * limits, then what the plan does with the screen off and with premium
 * stories. `t` reads the `plans` namespace.
 */
export function planLimitLines(plan: PlanDefinition, t: Translate): string[] {
  const line = (limit: PlanLimit, kind: 'preset' | 'cloned'): string => {
    if (limit.amount === null) return t(`limits.${kind}Unlimited`);
    if (kind === 'cloned' && limit.period === 'lifetime') {
      return amountLine(t, 'limits.clonedLifetime', limit.amount);
    }
    return amountLine(t, `limits.${kind}Monthly`, limit.amount);
  };
  const lines = [line(plan.presetNarrations, 'preset'), line(plan.clonedNarrations, 'cloned')];
  if (plan.backgroundPlayback) lines.push(t('limits.screenOff'));
  else lines.push(t('limits.screenOffStops'));
  if (plan.premiumStories) lines.push(t('limits.premiumStories'));
  return lines;
}

// ─────────────────────────────────────────────────────────────
// Price formatting
// ─────────────────────────────────────────────────────────────

function groupThousands(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/**
 * A price in the UI language. Turkish: comma decimal, dot thousands, "TL"
 * after the number ("1.499,99 TL"). English: the ISO code first, dot decimal,
 * comma thousands ("TRY 1,499.99"). Written by hand because Hermes does not
 * ship full Intl number formatting.
 */
export function formatPlanPrice(amount: number, language: string): string {
  const [whole, fraction] = Math.abs(amount).toFixed(2).split('.');
  if (language === 'en') {
    return `${PLAN_CURRENCY} ${groupThousands(whole, ',')}.${fraction}`;
  }
  return `${groupThousands(whole, '.')},${fraction} TL`;
}

/** The store subscriptions are bought and cancelled in, by platform. */
export function storeNameFor(platform: string): 'App Store' | 'Google Play' {
  return platform === 'ios' ? 'App Store' : 'Google Play';
}

// ─────────────────────────────────────────────────────────────
// Usage against the plan (profile, frame 23)
// ─────────────────────────────────────────────────────────────

export interface UsageMeter {
  readonly used: number;
  /** null means unlimited. */
  readonly limit: number | null;
  readonly period: LimitPeriod;
  /** When the counter resets; null for a lifetime limit or when unknown. */
  readonly renewsAt: Date | null;
}

/** Filled part of a usage bar, 0 to 1; null when the limit is unlimited. */
export function usageFraction(meter: UsageMeter): number | null {
  if (meter.limit === null) return null;
  if (meter.limit <= 0) return 1;
  return Math.max(0, Math.min(1, meter.used / meter.limit));
}
