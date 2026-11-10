import {
  getCloneCreationAllowance,
  getCloneVoiceSlots,
  getPresetVoiceSlots,
  getTotalVoiceSlots,
} from '../../common/constants/voice-slots.constants';
import { Allowance, AllowancePeriod } from '../../common/constants/plans.constants';
import {
  CounterPrisma,
  currentUsagePeriod,
  ensureLifetimeRow,
  ensureMonthlyRow,
  getLifetimeCounters,
} from '../usage/usage-counters';

export { currentUsagePeriod } from '../usage/usage-counters';
export type { UsagePeriod } from '../usage/usage-counters';

/**
 * Clone creation allowance (PLAN_LIMITS.*.cloneCreations).
 *
 * A creation is taken when a recording upload is accepted and counted on two
 * append-only counters: `usage_limits.clonesCreated` (this month) and
 * `usage_lifetime.clonesCreated` (ever). The FREE allowance is checked on the
 * lifetime counter, paid plans on the monthly one. Deleting a clone NEVER
 * gives a creation back, so deleting and recording again cannot go past the
 * plan: the counters count creations, not the clone rows that still exist.
 *
 * The only refund is {@link refundCloneCreationForProfile}: a training that
 * ended FAILED (our pipeline produced no voice: the clip was rejected before
 * Cartesia, the provider kept failing, the job timed out) or a job that could
 * not be queued. `voice_profiles.creationChargedAt` makes that refund happen
 * at most once per profile and against the month the creation was taken in.
 */

export interface CloneCreationUsage {
  /** Creations this calendar month. */
  monthly: number;
  /** Creations ever. */
  lifetime: number;
}

export async function getCloneCreationUsage(
  prisma: CounterPrisma,
  userId: string,
  now: Date = new Date(),
): Promise<CloneCreationUsage> {
  const { month, year } = currentUsagePeriod(now);
  const [row, lifetime] = await Promise.all([
    prisma.usageLimit.findUnique({ where: { userId_month_year: { userId, month, year } } }),
    getLifetimeCounters(prisma, userId),
  ]);
  return { monthly: row?.clonesCreated ?? 0, lifetime: lifetime.clonesCreated };
}

/**
 * Atomically take one clone creation if the allowance has one left. The
 * conditional update makes concurrent uploads unable to overshoot.
 *
 * @returns the charge time (store it on the profile) or null when the
 * allowance is used up.
 */
export async function tryConsumeCloneCreation(
  prisma: CounterPrisma,
  userId: string,
  allowance: Allowance,
  now: Date = new Date(),
): Promise<Date | null> {
  const period = currentUsagePeriod(now);
  await ensureMonthlyRow(prisma, userId, period);
  await ensureLifetimeRow(prisma, userId);

  const monthWhere = { userId, month: period.month, year: period.year };
  const increment = { clonesCreated: { increment: 1 } };

  if (allowance.limit === null) {
    await prisma.usageLimit.updateMany({ where: monthWhere, data: increment });
    await prisma.usageLifetime.updateMany({ where: { userId }, data: increment });
    return now;
  }

  if (allowance.period === 'lifetime') {
    const { count } = await prisma.usageLifetime.updateMany({
      where: { userId, clonesCreated: { lt: allowance.limit } },
      data: increment,
    });
    if (count !== 1) return null;
    await prisma.usageLimit.updateMany({ where: monthWhere, data: increment });
    return now;
  }

  const { count } = await prisma.usageLimit.updateMany({
    where: { ...monthWhere, clonesCreated: { lt: allowance.limit } },
    data: increment,
  });
  if (count !== 1) return null;
  await prisma.usageLifetime.updateMany({ where: { userId }, data: increment });
  return now;
}

/** Give one creation back on both counters (never below zero). */
export async function refundCloneCreation(
  prisma: CounterPrisma,
  userId: string,
  chargedAt: Date,
): Promise<void> {
  const { month, year } = currentUsagePeriod(chargedAt);
  const decrement = { clonesCreated: { decrement: 1 } };
  await prisma.usageLimit.updateMany({
    where: { userId, month, year, clonesCreated: { gt: 0 } },
    data: decrement,
  });
  await prisma.usageLifetime.updateMany({
    where: { userId, clonesCreated: { gt: 0 } },
    data: decrement,
  });
}

export interface RefundPrisma extends CounterPrisma {
  voiceProfile: {
    findUnique(args: any): Promise<any>;
    updateMany(args: any): Promise<{ count: number }>;
  };
}

/**
 * Refund the creation a profile took, exactly once (the charge marker is
 * cleared with a conditional update first). No marker, no refund.
 *
 * @returns true when a creation was given back.
 */
export async function refundCloneCreationForProfile(
  prisma: RefundPrisma,
  profileId: string,
): Promise<boolean> {
  const profile = await prisma.voiceProfile.findUnique({
    where: { id: profileId },
    select: { userId: true, creationChargedAt: true },
  });
  if (!profile?.creationChargedAt) return false;
  const { userId, creationChargedAt } = profile;
  const { count } = await prisma.voiceProfile.updateMany({
    where: { id: profileId, creationChargedAt },
    data: { creationChargedAt: null },
  });
  if (count !== 1) return false;
  await refundCloneCreation(prisma, userId, new Date(creationChargedAt));
  return true;
}

// ---------------------------------------------------------------------------
// GET /voice-profiles/slots
// ---------------------------------------------------------------------------

export interface CloneCreationInfo {
  used: number;
  /** -1 = unlimited */
  limit: number;
  period: AllowancePeriod;
  /** null for a lifetime allowance */
  renewsAt: Date | null;
  canCreate: boolean;
}

export interface VoiceSlotInfo {
  plan: string;
  /** presets + clones (+ extra clone slots) */
  totalSlots: number;
  usedSlots: number;
  availableSlots: number;
  extraSlots: number;
  /** preset.canCreate || clone.canCreate (for clients predating the split) */
  canCreate: boolean;
  preset: { used: number; limit: number; canCreate: boolean };
  clone: {
    used: number;
    limit: number;
    canCreate: boolean;
    /**
     * Legacy names read by app builds in the field: the creations counted
     * against the plan allowance and its limit. For a lifetime allowance
     * (FREE) these are the lifetime numbers, so old builds still see "used up".
     */
    monthlyCreated: number;
    monthlyLimit: number;
    creations: CloneCreationInfo;
  };
}

export function buildVoiceSlotInfo(input: {
  plan: string;
  extraSlots: number;
  presetUsed: number;
  cloneUsed: number;
  creations: CloneCreationUsage;
  now?: Date;
}): VoiceSlotInfo {
  const extraSlots = Math.max(0, input.extraSlots || 0);
  const presetLimit = getPresetVoiceSlots(input.plan);
  const cloneLimit = getCloneVoiceSlots(input.plan, extraSlots);
  const allowance = getCloneCreationAllowance(input.plan);

  const creationsUsed =
    allowance.period === 'lifetime' ? input.creations.lifetime : input.creations.monthly;
  const creationLimit = allowance.limit ?? -1;
  const creations: CloneCreationInfo = {
    used: creationsUsed,
    limit: creationLimit,
    period: allowance.period,
    renewsAt: allowance.period === 'month' ? currentUsagePeriod(input.now).resetAt : null,
    canCreate: creationLimit === -1 || creationsUsed < creationLimit,
  };

  const preset = {
    used: input.presetUsed,
    limit: presetLimit,
    canCreate: input.presetUsed < presetLimit,
  };
  const clone = {
    used: input.cloneUsed,
    limit: cloneLimit,
    canCreate: input.cloneUsed < cloneLimit && creations.canCreate,
    monthlyCreated: creationsUsed,
    monthlyLimit: creationLimit,
    creations,
  };

  const totalSlots = getTotalVoiceSlots(input.plan, extraSlots);
  const usedSlots = preset.used + clone.used;
  const availableSlots =
    Math.max(0, preset.limit - preset.used) + Math.max(0, clone.limit - clone.used);

  return {
    plan: input.plan,
    totalSlots,
    usedSlots,
    availableSlots,
    extraSlots,
    canCreate: preset.canCreate || clone.canCreate,
    preset,
    clone,
  };
}
