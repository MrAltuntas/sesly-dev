/**
 * Subscription Models with Strict TypeScript Typing
 */

import {
  BillingPeriod,
  SubscriptionStatus,
  SubscriptionTier,
  SubscriptionProvider,
  isPaidTier,
  parseSubscriptionStatus,
  parseSubscriptionTier,
} from '../types/enums';

// ============================================================================
// Subscription Plan Model
// ============================================================================

export interface SubscriptionPlan {
  readonly id: string;
  readonly name: string;
  readonly tier: SubscriptionTier;
  readonly monthlyPrice: number;
  readonly yearlyPrice: number;
  readonly currency: string;
  readonly features: readonly string[];
  readonly audioLimit: number;
  readonly voiceProfileLimit: number;
  readonly isPopular: boolean;
}

export interface SubscriptionPlanJSON {
  readonly id: string;
  readonly name: string;
  readonly tier: string;
  readonly monthlyPrice: number;
  readonly yearlyPrice: number;
  readonly currency: string;
  readonly features: readonly string[];
  readonly audioLimit: number;
  readonly voiceProfileLimit: number;
  readonly isPopular: boolean;
}

export function parseSubscriptionPlanFromJSON(json: unknown): SubscriptionPlan {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid subscription plan data: expected object');
  }

  const data = json as Record<string, unknown>;

  if (typeof data.id !== 'string' || !data.id) {
    throw new Error('Invalid subscription plan data: missing or invalid id');
  }
  if (typeof data.name !== 'string' || !data.name) {
    throw new Error('Invalid subscription plan data: missing or invalid name');
  }
  if (typeof data.tier !== 'string') {
    throw new Error('Invalid subscription plan data: missing or invalid tier');
  }
  if (typeof data.monthlyPrice !== 'number') {
    throw new Error('Invalid subscription plan data: missing or invalid monthlyPrice');
  }
  if (typeof data.yearlyPrice !== 'number') {
    throw new Error('Invalid subscription plan data: missing or invalid yearlyPrice');
  }
  if (typeof data.audioLimit !== 'number') {
    throw new Error('Invalid subscription plan data: missing or invalid audioLimit');
  }
  if (typeof data.voiceProfileLimit !== 'number') {
    throw new Error('Invalid subscription plan data: missing or invalid voiceProfileLimit');
  }

  const features: string[] = [];
  if (Array.isArray(data.features)) {
    data.features.forEach(feature => {
      if (typeof feature === 'string') {
        features.push(feature);
      }
    });
  }

  return {
    id: data.id,
    name: data.name,
    tier: data.tier as SubscriptionTier,
    monthlyPrice: data.monthlyPrice,
    yearlyPrice: data.yearlyPrice,
    currency: typeof data.currency === 'string' ? data.currency : 'TRY',
    features,
    audioLimit: data.audioLimit,
    voiceProfileLimit: data.voiceProfileLimit,
    isPopular: Boolean(data.isPopular),
  };
}

export function getSubscriptionPrice(
  plan: SubscriptionPlan,
  billingPeriod: BillingPeriod,
): number {
  return billingPeriod === BillingPeriod.MONTHLY
    ? plan.monthlyPrice
    : plan.yearlyPrice;
}

export function getMonthlySavings(plan: SubscriptionPlan): number {
  const monthlyTotal = plan.monthlyPrice * 12;
  const yearlySavings = monthlyTotal - plan.yearlyPrice;
  return Math.round((yearlySavings / monthlyTotal) * 100);
}

// ============================================================================
// Current Subscription Model
// ============================================================================

export interface CurrentSubscription {
  readonly plan: SubscriptionTier;
  readonly status: SubscriptionStatus;
  readonly billingPeriod: BillingPeriod | null;
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
  readonly cancelAtPeriodEnd: boolean;
  readonly provider: SubscriptionProvider | null;
  readonly autoRenew: boolean;
  readonly stripeSubscriptionId: string | null;
}

export interface CurrentSubscriptionJSON {
  readonly plan: string;
  readonly status: string;
  readonly billingPeriod?: string | null;
  readonly currentPeriodStart: string;
  readonly currentPeriodEnd: string;
  readonly cancelAtPeriodEnd: boolean;
  readonly provider?: string | null;
  readonly autoRenew?: boolean;
  readonly stripeSubscriptionId?: string | null;
}

export function parseCurrentSubscriptionFromJSON(json: unknown): CurrentSubscription {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid current subscription data: expected object');
  }

  const data = json as Record<string, unknown>;

  if (typeof data.plan !== 'string') {
    throw new Error('Invalid current subscription data: missing or invalid plan');
  }
  if (typeof data.status !== 'string') {
    throw new Error('Invalid current subscription data: missing or invalid status');
  }
  if (typeof data.currentPeriodStart !== 'string') {
    throw new Error(
      'Invalid current subscription data: missing or invalid currentPeriodStart',
    );
  }
  if (typeof data.currentPeriodEnd !== 'string') {
    throw new Error(
      'Invalid current subscription data: missing or invalid currentPeriodEnd',
    );
  }

  return {
    plan: parseSubscriptionTier(data.plan),
    status: parseSubscriptionStatus(data.status),
    billingPeriod:
      typeof data.billingPeriod === 'string' && data.billingPeriod
        ? (data.billingPeriod as BillingPeriod)
        : null,
    currentPeriodStart: new Date(data.currentPeriodStart),
    currentPeriodEnd: new Date(data.currentPeriodEnd),
    cancelAtPeriodEnd: Boolean(data.cancelAtPeriodEnd),
    provider:
      typeof data.provider === 'string' && data.provider
        ? (data.provider as SubscriptionProvider)
        : null,
    autoRenew: Boolean(data.autoRenew),
    stripeSubscriptionId:
      typeof data.stripeSubscriptionId === 'string' && data.stripeSubscriptionId
        ? data.stripeSubscriptionId
        : null,
  };
}

export function isSubscriptionActive(subscription: CurrentSubscription): boolean {
  return subscription.status === SubscriptionStatus.ACTIVE;
}

export function willSubscriptionRenew(subscription: CurrentSubscription): boolean {
  return (
    subscription.status === SubscriptionStatus.ACTIVE &&
    !subscription.cancelAtPeriodEnd
  );
}

export function getDaysUntilRenewal(subscription: CurrentSubscription): number {
  const now = new Date();
  const end = subscription.currentPeriodEnd;
  const diff = end.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ============================================================================
// Checkout Session Response
// ============================================================================

export interface CheckoutSessionResponse {
  readonly sessionId: string;
  readonly url: string;
}

export function parseCheckoutSessionResponseFromJSON(
  json: unknown,
): CheckoutSessionResponse {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid checkout session data: expected object');
  }

  const data = json as Record<string, unknown>;

  if (typeof data.sessionId !== 'string' || !data.sessionId) {
    throw new Error('Invalid checkout session data: missing or invalid sessionId');
  }
  if (typeof data.url !== 'string' || !data.url) {
    throw new Error('Invalid checkout session data: missing or invalid url');
  }

  return {
    sessionId: data.sessionId,
    url: data.url,
  };
}

// ============================================================================
// Usage Model
// ============================================================================

export interface Usage {
  readonly audioGenerated: number;
  readonly audioLimit: number;
  readonly voiceProfiles: number;
  readonly voiceProfileLimit: number;
  readonly resetDate: Date;
}

export interface UsageJSON {
  readonly audioGenerated: number;
  readonly audioLimit: number;
  readonly voiceProfiles: number;
  readonly voiceProfileLimit: number;
  readonly resetDate: string;
}

export function parseUsageFromJSON(json: unknown): Usage {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid usage data: expected object');
  }

  const data = json as Record<string, unknown>;

  if (typeof data.audioGenerated !== 'number') {
    throw new Error('Invalid usage data: missing or invalid audioGenerated');
  }
  if (typeof data.audioLimit !== 'number') {
    throw new Error('Invalid usage data: missing or invalid audioLimit');
  }
  if (typeof data.voiceProfiles !== 'number') {
    throw new Error('Invalid usage data: missing or invalid voiceProfiles');
  }
  if (typeof data.voiceProfileLimit !== 'number') {
    throw new Error('Invalid usage data: missing or invalid voiceProfileLimit');
  }
  if (typeof data.resetDate !== 'string') {
    throw new Error('Invalid usage data: missing or invalid resetDate');
  }

  return {
    audioGenerated: data.audioGenerated,
    audioLimit: data.audioLimit,
    voiceProfiles: data.voiceProfiles,
    voiceProfileLimit: data.voiceProfileLimit,
    resetDate: new Date(data.resetDate),
  };
}

export function getRemainingAudio(usage: Usage): number {
  return Math.max(0, usage.audioLimit - usage.audioGenerated);
}

export function getRemainingVoiceProfiles(usage: Usage): number {
  return Math.max(0, usage.voiceProfileLimit - usage.voiceProfiles);
}

export function getAudioUsagePercentage(usage: Usage): number {
  if (usage.audioLimit === 0) {
    return 0;
  }
  return Math.round((usage.audioGenerated / usage.audioLimit) * 100);
}

export function getVoiceProfileUsagePercentage(usage: Usage): number {
  if (usage.voiceProfileLimit === 0) {
    return 0;
  }
  return Math.round((usage.voiceProfiles / usage.voiceProfileLimit) * 100);
}

export function isAudioLimitReached(usage: Usage): boolean {
  return usage.audioGenerated >= usage.audioLimit;
}

export function isVoiceProfileLimitReached(usage: Usage): boolean {
  return usage.voiceProfiles >= usage.voiceProfileLimit;
}

// ============================================================================
// Usage Limits Model
// ============================================================================

export interface UsageLimits {
  readonly audioLimit: number;
  readonly voiceProfileLimit: number;
  readonly plan: SubscriptionTier;
}

export function parseUsageLimitsFromJSON(json: unknown): UsageLimits {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid usage limits data: expected object');
  }

  const data = json as Record<string, unknown>;

  if (typeof data.audioLimit !== 'number') {
    throw new Error('Invalid usage limits data: missing or invalid audioLimit');
  }
  if (typeof data.voiceProfileLimit !== 'number') {
    throw new Error(
      'Invalid usage limits data: missing or invalid voiceProfileLimit',
    );
  }
  if (typeof data.plan !== 'string') {
    throw new Error('Invalid usage limits data: missing or invalid plan');
  }

  return {
    audioLimit: data.audioLimit,
    voiceProfileLimit: data.voiceProfileLimit,
    plan: data.plan as SubscriptionTier,
  };
}

// ============================================================================
// Current subscription parsing (GET /subscriptions/current)
// ============================================================================

export interface ParsedCurrentSubscription {
    /** Effective tier after status/expiry checks. FREE when not entitled. */
    tier: SubscriptionTier;
    /** Raw plan on the row, before entitlement checks. */
    plan: SubscriptionTier;
    status: SubscriptionStatus;
    currentPeriodEnd: Date | null;
    /** Where the plan comes from (APPLE, GOOGLE, ADMIN, STRIPE); null on the free plan. */
    source: SubscriptionSource | null;
    /** The store product of a store subscription ("pro_monthly", "io.sesly.pro_yearly"). */
    productId: string | null;
    /** The store's page for managing the subscription, when the backend sends one. */
    managementUrl: string | null;
    /** The plan ends with the period (renewal turned off). */
    cancelAtPeriodEnd: boolean;
}

/** Where a plan comes from (GET /subscriptions/current `source`). */
export type SubscriptionSource = 'APPLE' | 'GOOGLE' | 'ADMIN' | 'STRIPE';

const SUBSCRIPTION_SOURCES: readonly SubscriptionSource[] = ['APPLE', 'GOOGLE', 'ADMIN', 'STRIPE'];

function parseSource(value: unknown): SubscriptionSource | null {
    if (typeof value !== 'string') return null;
    const upper = value.toUpperCase() as SubscriptionSource;
    return SUBSCRIPTION_SOURCES.includes(upper) ? upper : null;
}

function nonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Pure parser for GET /subscriptions/current: `{ plan, status,
 * currentPeriodEnd, source, productId, managementUrl, cancelAtPeriodEnd,
 * willRenew, ... }` (never a store token).
 *
 * Entitlement rules:
 *   - ACTIVE and PAST_DUE keep the paid plan (PAST_DUE is a billing grace
 *     window; the backend decides when to downgrade).
 *   - CANCELED keeps the paid plan until currentPeriodEnd.
 *   - EXPIRED, or any paid plan whose currentPeriodEnd is in the past, is FREE.
 */
export function parseCurrentSubscriptionResponse(
    json: unknown,
    now: Date = new Date(),
): ParsedCurrentSubscription {
    const data =
        json && typeof json === 'object' ? (json as Record<string, unknown>) : {};

    // `plan` is the backend field; `tier` is the legacy spelling.
    const plan = parseSubscriptionTier(data.plan ?? data.tier);
    const status =
        data.status === undefined || data.status === null
            ? SubscriptionStatus.ACTIVE
            : parseSubscriptionStatus(data.status);

    const rawEnd = data.currentPeriodEnd ?? data.expiresAt;
    let currentPeriodEnd: Date | null = null;
    if (typeof rawEnd === 'string' && rawEnd) {
        const parsed = new Date(rawEnd);
        currentPeriodEnd = isNaN(parsed.getTime()) ? null : parsed;
    }

    let tier = plan;
    if (isPaidTier(plan)) {
        const periodOver =
            currentPeriodEnd !== null && currentPeriodEnd.getTime() < now.getTime();
        if (status === SubscriptionStatus.EXPIRED || periodOver) {
            tier = SubscriptionTier.FREE;
        }
    }

    return {
        tier,
        plan,
        status,
        currentPeriodEnd,
        source: parseSource(data.source ?? data.provider),
        productId: nonEmptyString(data.productId),
        managementUrl: nonEmptyString(data.managementUrl),
        cancelAtPeriodEnd:
            data.cancelAtPeriodEnd === true || (isPaidTier(plan) && data.willRenew === false),
    };
}

