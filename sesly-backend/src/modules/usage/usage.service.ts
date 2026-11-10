import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionPlan, VoiceProfileKind } from '../../common/enums/prisma.enums';
import { resolveEffectivePlan } from '../../common/utils/subscription-plan';
import {
  Allowance,
  AllowancePeriod,
  getNarrationLimits,
  getPlanLimits,
  PLAN_NAMES,
} from '../../common/constants/plans.constants';
import { getTotalVoiceSlots } from '../../common/constants/voice-slots.constants';
import {
  MessageArgs,
  localizedError,
  serverText,
  serverTextInAllLanguages,
} from '../../common/i18n/server-text';
import { DEFAULT_UI_LANGUAGE, UiLanguage } from '../../common/i18n/ui-language';
import {
  currentUsagePeriod,
  ensureLifetimeRow,
  ensureMonthlyRow,
  getLifetimeCounters,
  UsagePeriod,
} from './usage-counters';
import { getCloneCreationUsage } from '../voice-profiles/clone-quota';

export type NarrationTier = 'premium' | 'standard';

export interface MonthlyNarrationCounters {
  premium: number;
  standard: number;
  total: number;
}

/** Coded 403s of the narration allowances. */
export const QUOTA_CODES = {
  PRESET_MONTHLY: 'QUOTA_PRESET_MONTHLY',
  CLONE_LIFETIME: 'QUOTA_CLONE_LIFETIME',
  CLONE_MONTHLY: 'QUOTA_CLONE_MONTHLY',
} as const;

/** One allowance as GET /usage reports it. */
export interface UsageBucket {
  /** null = unlimited */
  limit: number | null;
  used: number;
  /** null = unlimited */
  remaining: number | null;
  period: AllowancePeriod;
  /** When the counter starts again; null for a lifetime allowance. */
  renewsAt: Date | null;
}

/**
 * What one started narration took from the allowances, so it can be given
 * back if the generation could not even be started.
 */
export interface NarrationCharge {
  userId: string;
  premiumVoice: boolean;
  month: number;
  year: number;
}

/**
 * Limits engine for narrations (the clone creation allowance lives in
 * voice-profiles/clone-quota.ts, on the same counter rows).
 *
 * Counting is APPEND-ONLY: a narration takes one unit when its generation
 * starts, for every plan. Deleting, failing or regenerating a narration
 * never gives it back. Monthly allowances live on `usage_limits` (calendar
 * month, server-local), the FREE cloned-voice narration on `usage_lifetime`
 * (never resets; every cloned-voice narration on any plan counts there).
 */
@Injectable()
export class UsageService {
  constructor(private prisma: PrismaService) {}

  private currentPeriod(now: Date = new Date()): UsagePeriod {
    return currentUsagePeriod(now);
  }

  async getEffectivePlan(userId: string): Promise<SubscriptionPlan> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
    });
    return resolveEffectivePlan(subscription);
  }

  async getMonthlyCounters(userId: string): Promise<MonthlyNarrationCounters> {
    const { month, year } = this.currentPeriod();
    const row = await this.prisma.usageLimit.findUnique({
      where: { userId_month_year: { userId, month, year } },
    });
    const total = row?.storiesGenerated ?? 0;
    const premium = Math.min(total, row?.premiumStoriesGenerated ?? 0);
    return { premium, standard: Math.max(0, total - premium), total };
  }

  private allowanceFor(plan: string, premiumVoice: boolean): Allowance {
    const limits = getPlanLimits(plan);
    return premiumVoice ? limits.cloneNarrations : limits.presetNarrations;
  }

  /** Units used against the allowance that applies to this voice tier. */
  private async usedFor(userId: string, allowance: Allowance, premiumVoice: boolean): Promise<number> {
    if (premiumVoice && allowance.period === 'lifetime') {
      return (await getLifetimeCounters(this.prisma, userId)).cloneNarrations;
    }
    const counters = await this.getMonthlyCounters(userId);
    return premiumVoice ? counters.premium : counters.standard;
  }

  /**
   * Fast pre-check (no write), used before a narration row is created so a
   * 403 never leaves a PENDING row behind. The authoritative check is the
   * atomic {@link consumeNarration} when generation starts.
   */
  async assertNarrationQuota(userId: string, plan: string, premiumVoice: boolean): Promise<void> {
    const allowance = this.allowanceFor(plan, premiumVoice);
    if (allowance.limit === null) return;
    const used = await this.usedFor(userId, allowance, premiumVoice);
    if (used >= allowance.limit) {
      throw this.quotaExceeded(plan, premiumVoice, allowance, used);
    }
  }

  /**
   * Atomically take one narration from the allowance of this voice tier, or
   * throw the coded 403 when none is left. Call it right before generation
   * starts and {@link refundNarration} if the generation could not start.
   */
  async consumeNarration(userId: string, plan: string, premiumVoice: boolean): Promise<NarrationCharge> {
    const allowance = this.allowanceFor(plan, premiumVoice);
    const period = this.currentPeriod();
    const { month, year } = period;
    await ensureMonthlyRow(this.prisma, userId, period);
    if (premiumVoice) await ensureLifetimeRow(this.prisma, userId);

    const monthWhere = { userId, month, year };
    const monthData = premiumVoice
      ? { storiesGenerated: { increment: 1 }, premiumStoriesGenerated: { increment: 1 } }
      : { storiesGenerated: { increment: 1 } };

    let consumed: boolean;
    if (allowance.limit === null) {
      await this.prisma.usageLimit.updateMany({ where: monthWhere, data: monthData });
      consumed = true;
    } else if (premiumVoice && allowance.period === 'lifetime') {
      const { count } = await this.prisma.usageLifetime.updateMany({
        where: { userId, cloneNarrations: { lt: allowance.limit } },
        data: { cloneNarrations: { increment: 1 } },
      });
      consumed = count === 1;
      if (consumed) {
        await this.prisma.usageLimit.updateMany({ where: monthWhere, data: monthData });
      }
    } else if (premiumVoice) {
      const { count } = await this.prisma.usageLimit.updateMany({
        where: { ...monthWhere, premiumStoriesGenerated: { lt: allowance.limit } },
        data: monthData,
      });
      consumed = count === 1;
    } else {
      // standard = storiesGenerated - premiumStoriesGenerated: a column
      // comparison Prisma's updateMany cannot express.
      const count = await this.prisma.$executeRaw`
        UPDATE "usage_limits"
        SET "storiesGenerated" = "storiesGenerated" + 1
        WHERE "userId" = ${userId} AND "month" = ${month} AND "year" = ${year}
          AND ("storiesGenerated" - "premiumStoriesGenerated") < ${allowance.limit}`;
      consumed = count === 1;
    }

    if (!consumed) {
      const used = await this.usedFor(userId, allowance, premiumVoice);
      throw this.quotaExceeded(plan, premiumVoice, allowance, used);
    }

    // Every cloned-voice narration counts towards the lifetime total, on any
    // plan (the lifetime branch above already counted it).
    if (premiumVoice && allowance.period !== 'lifetime') {
      await this.prisma.usageLifetime.updateMany({
        where: { userId },
        data: { cloneNarrations: { increment: 1 } },
      });
    }

    return { userId, premiumVoice, month, year };
  }

  /** Give back a charge whose generation never started (never below zero). */
  async refundNarration(charge: NarrationCharge): Promise<void> {
    const { userId, month, year, premiumVoice } = charge;
    if (premiumVoice) {
      await this.prisma.usageLimit.updateMany({
        where: { userId, month, year, premiumStoriesGenerated: { gt: 0 }, storiesGenerated: { gt: 0 } },
        data: { storiesGenerated: { decrement: 1 }, premiumStoriesGenerated: { decrement: 1 } },
      });
      await this.prisma.usageLifetime.updateMany({
        where: { userId, cloneNarrations: { gt: 0 } },
        data: { cloneNarrations: { decrement: 1 } },
      });
      return;
    }
    await this.prisma.usageLimit.updateMany({
      where: { userId, month, year, storiesGenerated: { gt: 0 } },
      data: { storiesGenerated: { decrement: 1 } },
    });
  }

  private quotaExceeded(
    plan: string,
    premiumVoice: boolean,
    allowance: Allowance,
    used: number,
  ): ForbiddenException {
    const limit = allowance.limit as number;
    const renewsAt = allowance.period === 'month' ? this.currentPeriod().resetAt : null;
    const code = !premiumVoice
      ? QUOTA_CODES.PRESET_MONTHLY
      : allowance.period === 'lifetime'
        ? QUOTA_CODES.CLONE_LIFETIME
        : QUOTA_CODES.CLONE_MONTHLY;
    return new ForbiddenException({
      code,
      bucket: premiumVoice ? 'cloneNarrations' : 'presetNarrations',
      // Legacy field kept for clients that read it.
      tier: premiumVoice ? 'premium' : 'standard',
      plan,
      limit,
      used: Math.min(used, limit),
      period: allowance.period,
      renewsAt,
      // i18n key + placeholders: HttpExceptionFilter serves it per Accept-Language.
      ...localizedError(...UsageService.quotaMessageKey(code, plan, limit, renewsAt)),
    });
  }

  /** i18n key and placeholders of a quota 403 message (`errors.quota.*`). */
  static quotaMessageKey(
    code: string,
    plan: string,
    limit: number,
    renewsAt: Date | null,
  ): [string, MessageArgs] {
    // Optional sentences are placeholders that are empty when they do not apply.
    const renewal = renewsAt
      ? serverTextInAllLanguages('errors.quota.renews', { renewDate: renewsAt })
      : { tr: '', en: '' };
    switch (code) {
      case QUOTA_CODES.CLONE_LIFETIME:
        return ['errors.quota.cloneLifetime', { limit }];
      case QUOTA_CODES.CLONE_MONTHLY:
        return [
          'errors.quota.cloneMonthly',
          {
            limit,
            renewal,
            upsell:
              plan === SubscriptionPlan.MINI
                ? serverTextInAllLanguages('errors.quota.upsellPremium')
                : { tr: '', en: '' },
          },
        ];
      default:
        return ['errors.quota.presetMonthly', { limit, renewal }];
    }
  }

  /** The quota 403 message as text in one UI language. */
  static quotaMessage(
    code: string,
    plan: string,
    limit: number,
    renewsAt: Date | null,
    language: UiLanguage = DEFAULT_UI_LANGUAGE,
  ): string {
    const [key, args] = UsageService.quotaMessageKey(code, plan, limit, renewsAt);
    return serverText(key, language, args);
  }

  private bucket(allowance: Allowance, used: number, resetAt: Date): UsageBucket {
    const limited = allowance.limit !== null;
    const shown = limited ? Math.min(used, allowance.limit as number) : used;
    return {
      limit: allowance.limit,
      used: shown,
      remaining: limited ? Math.max(0, (allowance.limit as number) - shown) : null,
      period: allowance.period,
      renewsAt: allowance.period === 'month' ? resetAt : null,
    };
  }

  /**
   * GET /usage: every allowance of the caller's effective plan, for the
   * usage bars on the profile screen.
   */
  async getUsageSummary(userId: string) {
    const { resetAt } = this.currentPeriod();
    const [subscription, monthly, lifetime, creations, presetUsed, cloneUsed] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { userId } }),
      this.getMonthlyCounters(userId),
      getLifetimeCounters(this.prisma, userId),
      getCloneCreationUsage(this.prisma, userId),
      this.prisma.voiceProfile.count({ where: { userId, kind: VoiceProfileKind.PRESET } }),
      this.prisma.voiceProfile.count({
        where: { userId, kind: VoiceProfileKind.CLONE, status: { not: 'FAILED' } },
      }),
    ]);
    const plan = resolveEffectivePlan(subscription);
    const limits = getPlanLimits(plan);
    const extraSlots = Math.max(0, subscription?.extraVoiceSlots ?? 0);

    const cloneNarrationsUsed =
      limits.cloneNarrations.period === 'lifetime' ? lifetime.cloneNarrations : monthly.premium;
    const cloneCreationsUsed =
      limits.cloneCreations.period === 'lifetime' ? creations.lifetime : creations.monthly;

    return {
      plan,
      planName: PLAN_NAMES[plan],
      renewsAt: resetAt,
      buckets: {
        presetNarrations: this.bucket(limits.presetNarrations, monthly.standard, resetAt),
        cloneNarrations: this.bucket(limits.cloneNarrations, cloneNarrationsUsed, resetAt),
        cloneCreations: this.bucket(limits.cloneCreations, cloneCreationsUsed, resetAt),
      },
      voiceSlots: {
        preset: { used: presetUsed ?? 0, limit: limits.presetVoiceSlots },
        clone: { used: cloneUsed ?? 0, limit: limits.cloneVoiceSlots + extraSlots },
      },
      features: {
        backgroundPlayback: limits.backgroundPlayback,
        premiumStories: limits.premiumStories,
      },
    };
  }

  /**
   * GET /usage/current (legacy shape, not used by the app). `premium` is the
   * cloned-voice allowance in its own period (lifetime on FREE), `standard`
   * the ready-made voice allowance this month; -1 = unlimited.
   */
  async getCurrentUsage(userId: string) {
    const summary = await this.getUsageSummary(userId);
    const legacy = (bucket: UsageBucket) => ({
      generated: bucket.used,
      limit: bucket.limit ?? -1,
      remaining: bucket.remaining ?? -1,
    });
    const premium = legacy(summary.buckets.cloneNarrations);
    return {
      storiesGenerated: premium.generated,
      limit: premium.limit,
      remaining: premium.remaining,
      resetAt: summary.renewsAt, // First day of next month
      usages: {
        standard: legacy(summary.buckets.presetNarrations),
        premium,
      },
    };
  }

  async getLimits(userId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
    });
    const plan = resolveEffectivePlan(subscription);
    const limits = getNarrationLimits(plan);
    return {
      maxStories: limits.premium, // Backward compatibility
      maxStoriesStandard: limits.standard,
      maxStoriesPremium: limits.premium,
      maxVoices: getTotalVoiceSlots(plan, subscription?.extraVoiceSlots ?? 0),
      maxTextToSpeech: -1, // unlimited for all for now
    };
  }
}
