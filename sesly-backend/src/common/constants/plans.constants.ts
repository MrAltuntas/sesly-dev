import { SubscriptionPlan } from '../enums/prisma.enums';

/**
 * Plans and their limits: the ONE place every allowance is defined.
 *
 * Read by the limits engine (UsageService, clone-quota), GET /usage,
 * GET /voice-profiles/slots, the public plan list and the admin revenue
 * estimate. Change a number here and every consumer follows.
 *
 * Plan ids are the Prisma enum values. PRO is sold and shown as "Premium"
 * (the value stays PRO because app builds in the field parse it). CREATOR is
 * an admin-grant plan only: never sold, never in the public plan list.
 *
 * Owner decisions 2026-10-13:
 *   - ready-made (preset) narrations: FREE 20 a month, every paid plan unlimited
 *   - cloned-voice narrations: FREE 1 in total (lifetime, never renews),
 *     MINI 5 a month, PREMIUM 20 a month
 *   - lock-screen and background playback: paid plans only
 * Clone creations (decided with the limits engine, 2026-10-16): FREE 1 in
 * total, MINI 2 a month, PREMIUM 5 a month. Deleting a clone never gives a
 * creation back; only a training that failed does.
 */

/** 'month' renews on the first day of the next calendar month; 'lifetime' never renews. */
export type AllowancePeriod = 'month' | 'lifetime';

export interface Allowance {
  /** null = unlimited */
  limit: number | null;
  period: AllowancePeriod;
}

export interface PlanLimits {
  /** Narrations with a ready-made (Google) voice. */
  presetNarrations: Allowance;
  /** Narrations with the user's own cloned voice. */
  cloneNarrations: Allowance;
  /** New clone voices (accepted recording uploads). Counted, never refunded by a delete. */
  cloneCreations: Allowance;
  /** Clone voices held at the same time (FAILED ones excluded). Subscription.extraVoiceSlots adds here. */
  cloneVoiceSlots: number;
  /** Ready-made narrator voices held at the same time. */
  presetVoiceSlots: number;
  /** Lock-screen controls and background playback (enforced by the app from the plan). */
  backgroundPlayback: boolean;
  /** Stories flagged isPremium. */
  premiumStories: boolean;
}

export const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  FREE: {
    presetNarrations: { limit: 20, period: 'month' },
    cloneNarrations: { limit: 1, period: 'lifetime' },
    cloneCreations: { limit: 1, period: 'lifetime' },
    cloneVoiceSlots: 1,
    presetVoiceSlots: 3,
    backgroundPlayback: false,
    premiumStories: false,
  },
  MINI: {
    presetNarrations: { limit: null, period: 'month' },
    cloneNarrations: { limit: 5, period: 'month' },
    cloneCreations: { limit: 2, period: 'month' },
    cloneVoiceSlots: 1,
    presetVoiceSlots: 10,
    backgroundPlayback: true,
    premiumStories: true,
  },
  PRO: {
    presetNarrations: { limit: null, period: 'month' },
    cloneNarrations: { limit: 20, period: 'month' },
    cloneCreations: { limit: 5, period: 'month' },
    cloneVoiceSlots: 3,
    presetVoiceSlots: 10,
    backgroundPlayback: true,
    premiumStories: true,
  },
  // Admin grant only. At least everything Premium has.
  CREATOR: {
    presetNarrations: { limit: null, period: 'month' },
    cloneNarrations: { limit: 20, period: 'month' },
    cloneCreations: { limit: 10, period: 'month' },
    cloneVoiceSlots: 5,
    presetVoiceSlots: 20,
    backgroundPlayback: true,
    premiumStories: true,
  },
};

/** Plan ranking for "which entitlement wins" (admin grant vs store, two purchases). */
export const PLAN_RANK: Record<SubscriptionPlan, number> = {
  FREE: 0,
  MINI: 1,
  PRO: 2,
  CREATOR: 3,
};

/** User-facing plan names (Turkish). */
export const PLAN_NAMES: Record<SubscriptionPlan, string> = {
  FREE: 'Ücretsiz',
  MINI: 'Mini',
  PRO: 'Premium',
  CREATOR: 'Creator',
};

/**
 * Reference list prices in TRY. The stores charge the price set in Play
 * Console / App Store Connect; the backend never charges. Used for the plan
 * list (display fallback) and the admin revenue estimate only.
 */
export const PLAN_CURRENCY = 'TRY';

export const PLAN_PRICES: Record<SubscriptionPlan, number> = {
  FREE: 0,
  MINI: 49.99,
  PRO: 199.99,
  CREATOR: 0,
};

export const PLAN_YEARLY_PRICES: Partial<Record<SubscriptionPlan, number>> = {
  PRO: 1499.99,
};

/** Normalise any stored or requested plan string; unknown means FREE. */
export function toPlan(plan: string | null | undefined): SubscriptionPlan {
  const key = String(plan || '').toUpperCase();
  return key in PLAN_LIMITS ? (key as SubscriptionPlan) : SubscriptionPlan.FREE;
}

export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[toPlan(plan)];
}

export function isPaidPlanValue(plan: string | null | undefined): boolean {
  return toPlan(plan) !== SubscriptionPlan.FREE;
}

/**
 * Legacy monthly view kept for older consumers (GET /usage/current,
 * GET /usage/limits, plan list `limits`): `premium` = cloned-voice
 * narrations, `standard` = ready-made voice narrations, -1 = unlimited.
 * A lifetime allowance is reported with its total limit.
 */
export interface NarrationQuota {
  premium: number;
  standard: number;
}

export function getNarrationLimits(plan: string): NarrationQuota {
  const limits = getPlanLimits(plan);
  return {
    premium: limits.cloneNarrations.limit ?? -1,
    standard: limits.presetNarrations.limit ?? -1,
  };
}

export const NARRATION_LIMITS: Record<SubscriptionPlan, NarrationQuota> = {
  FREE: getNarrationLimits('FREE'),
  MINI: getNarrationLimits('MINI'),
  PRO: getNarrationLimits('PRO'),
  CREATOR: getNarrationLimits('CREATOR'),
};
