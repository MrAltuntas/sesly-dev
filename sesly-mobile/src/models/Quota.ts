/**
 * Quota: the plan allowances as the backend counts them, the coded 403 a
 * used-up allowance answers with, and the copy the app shows for it.
 *
 * Contract (sesly-backend):
 *   - GET /usage (usage.service.ts getUsageSummary), not wrapped:
 *     { plan, planName, renewsAt, buckets: { presetNarrations, cloneNarrations,
 *       cloneCreations }, voiceSlots: { preset, clone }, features }
 *     with each bucket { limit (null = unlimited), used, remaining, period,
 *     renewsAt (ISO, null for a lifetime allowance) }.
 *   - 403 QUOTA_PRESET_MONTHLY / QUOTA_CLONE_LIFETIME / QUOTA_CLONE_MONTHLY
 *     from POST /narrations and POST /narrations/:id/generate, 403
 *     CLONE_CREATION_LIMIT from the clone create and upload, each with
 *     { code, plan, limit, used, period, renewsAt, message }; 403
 *     PREMIUM_STORY (FREE only) with { code, message }.
 *
 * The server `message` of these errors is Turkish only and never shown:
 * `describeQuotaBlock` builds the copy in the UI language (messages:quota.*).
 * A number of 1 uses the `One` variant of a key (no i18next plural suffixes,
 * Hermes has no Intl.PluralRules).
 */

import i18n from '../i18n';
import { msg } from '../i18n/messages';
import { SubscriptionTier } from '../types/enums';
import { LimitPeriod, PLANS, PlanId, PlanLimit, planIdForTier } from './Plans';

export type AllowancePeriod = LimitPeriod;

export interface UsageBucket {
  /** null means unlimited. */
  limit: number | null;
  used: number;
  /** null when unlimited. */
  remaining: number | null;
  period: AllowancePeriod;
  /** When the counter resets; null for a lifetime allowance. */
  renewsAt: Date | null;
}

export interface UsageSummary {
  planId: PlanId;
  buckets: {
    presetNarrations: UsageBucket;
    cloneNarrations: UsageBucket;
    cloneCreations: UsageBucket;
  };
  voiceSlots: {
    preset: { used: number; limit: number };
    clone: { used: number; limit: number };
  };
  features: { backgroundPlayback: boolean; premiumStories: boolean };
}

// ─────────────────────────────────────────────────────────────
// GET /usage
// ─────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parsePeriod(value: unknown): AllowancePeriod | null {
  return value === 'month' || value === 'lifetime' ? value : null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

/** A limit as the backend writes it: null (and -1 on /voice-profiles/slots) is unlimited. */
function parseLimit(value: unknown): number | null | undefined {
  if (value === null || value === -1) return null;
  return isCount(value) ? value : undefined;
}

/** A backend plan string to a plan id; null when it is not a plan the app knows. */
function parsePlanId(value: unknown): PlanId | null {
  if (typeof value !== 'string') return null;
  const tier = value.trim().toUpperCase();
  return (Object.values(SubscriptionTier) as string[]).includes(tier) ? planIdForTier(tier) : null;
}

function parseBucket(value: unknown): UsageBucket | null {
  const data = asObject(value);
  if (!data) return null;
  const limit = parseLimit(data.limit);
  const period = parsePeriod(data.period);
  if (limit === undefined || period === null || !isCount(data.used)) return null;
  const used = data.used;
  const remaining =
    limit === null ? null : isCount(data.remaining) ? data.remaining : Math.max(0, limit - used);
  return {
    limit,
    used,
    remaining,
    period,
    renewsAt: period === 'month' ? parseDate(data.renewsAt) : null,
  };
}

function parseSlot(value: unknown): { used: number; limit: number } | null {
  const data = asObject(value);
  if (!data || !isCount(data.used) || !isCount(data.limit)) return null;
  return { used: data.used, limit: data.limit };
}

/**
 * GET /usage. Returns null for anything that is not the documented shape,
 * so a caller never shows a number it could not read.
 */
export function parseUsageSummary(json: unknown): UsageSummary | null {
  const data = asObject(json);
  if (!data) return null;
  const planId = parsePlanId(data.plan);
  const buckets = asObject(data.buckets);
  const slots = asObject(data.voiceSlots);
  const features = asObject(data.features);
  if (!planId || !buckets || !slots || !features) return null;

  const presetNarrations = parseBucket(buckets.presetNarrations);
  const cloneNarrations = parseBucket(buckets.cloneNarrations);
  const cloneCreations = parseBucket(buckets.cloneCreations);
  const preset = parseSlot(slots.preset);
  const clone = parseSlot(slots.clone);
  if (!presetNarrations || !cloneNarrations || !cloneCreations || !preset || !clone) return null;
  if (typeof features.backgroundPlayback !== 'boolean' || typeof features.premiumStories !== 'boolean') {
    return null;
  }

  return {
    planId,
    buckets: { presetNarrations, cloneNarrations, cloneCreations },
    voiceSlots: { preset, clone },
    features: {
      backgroundPlayback: features.backgroundPlayback,
      premiumStories: features.premiumStories,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Coded 403s
// ─────────────────────────────────────────────────────────────

export const QUOTA_CODES = {
  PRESET_MONTHLY: 'QUOTA_PRESET_MONTHLY',
  CLONE_LIFETIME: 'QUOTA_CLONE_LIFETIME',
  CLONE_MONTHLY: 'QUOTA_CLONE_MONTHLY',
  CLONE_CREATION: 'CLONE_CREATION_LIMIT',
  PREMIUM_STORY: 'PREMIUM_STORY',
} as const;

export type QuotaCode = (typeof QUOTA_CODES)[keyof typeof QUOTA_CODES];

const KNOWN_CODES = Object.values(QUOTA_CODES) as string[];

export function isQuotaCode(value: unknown): value is QuotaCode {
  return typeof value === 'string' && KNOWN_CODES.includes(value);
}

export interface QuotaBlock {
  code: QuotaCode;
  /** The plan the block applies to (the error's `plan`, else the caller's). */
  planId: PlanId;
  /** null when unlimited or unknown (and for PREMIUM_STORY). */
  limit: number | null;
  /** null for PREMIUM_STORY. */
  period: AllowancePeriod | null;
  /** When the allowance renews; null for a lifetime one or when unknown. */
  renewsAt: Date | null;
}

/** The plan allowance a code is about, for the numbers the error left out. */
function planAllowance(code: QuotaCode, planId: PlanId): PlanLimit | null {
  const plan = PLANS[planId];
  switch (code) {
    case QUOTA_CODES.PRESET_MONTHLY:
      return plan.presetNarrations;
    case QUOTA_CODES.CLONE_LIFETIME:
    case QUOTA_CODES.CLONE_MONTHLY:
      return plan.clonedNarrations;
    case QUOTA_CODES.CLONE_CREATION:
      return plan.cloneCreations;
    default:
      return null;
  }
}

/** The period a code implies on its own (CLONE_CREATION_LIMIT says it in `period`). */
function periodForCode(code: QuotaCode): AllowancePeriod | null {
  switch (code) {
    case QUOTA_CODES.CLONE_LIFETIME:
      return 'lifetime';
    case QUOTA_CODES.PRESET_MONTHLY:
    case QUOTA_CODES.CLONE_MONTHLY:
      return 'month';
    default:
      return null;
  }
}

/**
 * A quota 403 as a block the UI can explain, or null for any other error.
 * Reads an ApiError (`status`, `code`, `data`) or any object of that shape.
 * `fallbackPlan` is used when the body names no plan (PREMIUM_STORY).
 */
export function parseQuotaBlock(error: unknown, fallbackPlan: PlanId): QuotaBlock | null {
  const err = asObject(error);
  if (!err || err.status !== 403) return null;
  const data = asObject(err.data) ?? {};
  const code = isQuotaCode(err.code) ? err.code : isQuotaCode(data.code) ? data.code : null;
  if (!code) return null;

  const planId = parsePlanId(data.plan) ?? fallbackPlan;
  if (code === QUOTA_CODES.PREMIUM_STORY) {
    return { code, planId, limit: null, period: null, renewsAt: null };
  }

  const allowance = planAllowance(code, planId);
  const period = periodForCode(code) ?? parsePeriod(data.period) ?? allowance?.period ?? 'month';
  // A used-up allowance is never unlimited, so a null (or -1) limit is as
  // unknown as a missing one: the plan constant gives the number.
  const limit = parseLimit(data.limit) ?? allowance?.amount ?? null;
  return {
    code,
    planId,
    limit,
    period,
    renewsAt: period === 'month' ? parseDate(data.renewsAt) : null,
  };
}

// ─────────────────────────────────────────────────────────────
// Copy
// ─────────────────────────────────────────────────────────────

export interface QuotaCopy {
  title: string;
  message: string;
  /** Show "Planları gör": there is a bigger plan (FREE and MINI). */
  offerPlans: boolean;
  /** Show "Hazır anlatıcıyla dinle": the own-voice narrations are used up. */
  offerReadyMade: boolean;
}

/** "1 Kasım'da yenilenir." / "Renews on 1 November." in the UI language. */
export function renewalLine(date: Date): string {
  return i18n.t(`profile:usage.renewsOn.${date.getMonth()}`, { day: date.getDate() });
}

/** `key` with `{ limit }`, or its `One` variant at 1. */
function limitMessage(key: string, limit: number | null): string {
  return limit === 1 ? msg(`${key}One`) : msg(key, { limit: limit ?? '' });
}

/** The copy key group and base sentence of a block. */
function baseCopy(block: QuotaBlock): { group: string; message: string } {
  switch (block.code) {
    case QUOTA_CODES.PRESET_MONTHLY:
      return { group: 'presetMonthly', message: limitMessage('quota.presetMonthly.message', block.limit) };
    case QUOTA_CODES.CLONE_LIFETIME:
      return { group: 'cloneLifetime', message: limitMessage('quota.cloneLifetime.message', block.limit) };
    case QUOTA_CODES.CLONE_MONTHLY:
      return { group: 'cloneMonthly', message: limitMessage('quota.cloneMonthly.message', block.limit) };
    case QUOTA_CODES.CLONE_CREATION:
      return block.period === 'lifetime'
        ? { group: 'creationLifetime', message: msg('quota.creationLifetime.message') }
        : { group: 'creationMonthly', message: limitMessage('quota.creationMonthly.message', block.limit) };
    default:
      return { group: 'premiumStory', message: msg('quota.premiumStory.message') };
  }
}

/** Which narration bucket a voice draws from: an own voice or a ready-made narrator. */
export type NarrationKind = 'preset' | 'clone';

export function narrationBucket(usage: UsageSummary, kind: NarrationKind): UsageBucket {
  return kind === 'clone' ? usage.buckets.cloneNarrations : usage.buckets.presetNarrations;
}

/**
 * The block a narration would hit, known before asking the backend: the
 * bucket of the voice is used up. Null while something is left or the plan
 * has no limit there (the backend still decides on the request).
 */
export function blockForUsedUpBucket(
  kind: NarrationKind,
  bucket: UsageBucket,
  planId: PlanId,
): QuotaBlock | null {
  if (bucket.limit === null || bucket.remaining === null || bucket.remaining > 0) return null;
  const code =
    kind === 'preset'
      ? QUOTA_CODES.PRESET_MONTHLY
      : bucket.period === 'lifetime'
        ? QUOTA_CODES.CLONE_LIFETIME
        : QUOTA_CODES.CLONE_MONTHLY;
  return {
    code,
    planId,
    limit: bucket.limit,
    period: bucket.period,
    renewsAt: bucket.period === 'month' ? bucket.renewsAt : null,
  };
}

/** Shown under the story's play button from this many left down. */
export const REMAINING_LINE_FROM = 3;

/**
 * "Bu ay 2 masal hakkın kaldı" (detail:quota.*) when a limited bucket is
 * nearly used up, null otherwise (unlimited, or more than
 * REMAINING_LINE_FROM left).
 */
export function remainingNarrationsLine(kind: NarrationKind, bucket: UsageBucket): string | null {
  if (bucket.limit === null || bucket.remaining === null) return null;
  const left = bucket.remaining;
  if (left > REMAINING_LINE_FROM) return null;
  const key =
    kind === 'preset'
      ? 'detail:quota.presetLeft'
      : bucket.period === 'lifetime'
        ? 'detail:quota.cloneLeftLifetime'
        : 'detail:quota.cloneLeftMonth';
  return left === 1 ? i18n.t(`${key}One`) : i18n.t(key, { left });
}

/**
 * Title and message for a block, and which ways out to offer. The message is
 * the base sentence, then the renewal date for a monthly allowance, then the
 * upsell when a bigger plan exists. PREMIUM_STORY's message already names
 * the plans, so it has no separate upsell.
 */
export function describeQuotaBlock(block: QuotaBlock): QuotaCopy {
  const offerPlans = block.planId !== 'premium';
  const { group, message } = baseCopy(block);
  const parts = [message];
  if (block.period === 'month' && block.renewsAt) parts.push(renewalLine(block.renewsAt));
  if (offerPlans && block.code !== QUOTA_CODES.PREMIUM_STORY) parts.push(msg(`quota.${group}.upsell`));
  return {
    title: msg(`quota.${group}.title`),
    message: parts.join(' '),
    offerPlans,
    offerReadyMade:
      block.code === QUOTA_CODES.CLONE_LIFETIME || block.code === QUOTA_CODES.CLONE_MONTHLY,
  };
}
