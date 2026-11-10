/**
 * The own-voice allowances of the Sesim tab, and why a new own voice cannot
 * be recorded now.
 *
 * Two limits, as the backend enforces them (sesly-backend PLAN_LIMITS):
 *   - slots (`cloneVoiceSlots`): own voices held at once. A delete frees one.
 *   - creations (`cloneCreations`): new own voices per period, counted when
 *     a recording is accepted. A delete never gives one back. Free: 1 in
 *     total (never renews); Mini: 2 a month; Premium: 5 a month.
 *
 * The numbers come from GET /usage (`voiceSlots.clone`,
 * `buckets.cloneCreations`) when it answered, else from GET
 * /voice-profiles/slots, else from the plan constants (`PLANS`). The slots
 * in use follow the voice list on screen once it is loaded, so a delete
 * frees its slot at once.
 */

import {
  CloneCreationPeriod,
  VoiceSlotInfo,
  cloneCreationsOf,
  isCloneCreationLimitReached,
} from '../../models/VoiceProfile';
import { PLANS, PlanId } from '../../models/Plans';
import { UsageBucket, UsageSummary, renewalLine } from '../../models/Quota';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The plan's new-voice allowance. */
export interface CreationAllowance {
  /** null when not known (no answer from the backend yet). */
  readonly used: number | null;
  /** null: unlimited. */
  readonly limit: number | null;
  readonly period: CloneCreationPeriod;
  /** When a monthly allowance renews; null for a lifetime one or when unknown. */
  readonly renewsAt: Date | null;
}

export interface OwnVoiceLimits {
  /** Own voices held / held at most at once. */
  readonly slots: { readonly used: number; readonly limit: number };
  readonly creations: CreationAllowance;
}

export interface OwnVoiceLimitsInput {
  usage: UsageSummary | null;
  slotInfo: VoiceSlotInfo | null;
  planId: PlanId;
  /**
   * Own voices that take a slot in the list on screen (every one but a
   * failed one, as the backend counts); null while the list is not loaded.
   */
  held: number | null;
}

/** The slot and creation numbers to show, from the best source known. */
export function ownVoiceLimits({ usage, slotInfo, planId, held }: OwnVoiceLimitsInput): OwnVoiceLimits {
  const plan = PLANS[planId];
  const slotLimit = usage?.voiceSlots.clone.limit ?? slotInfo?.clone?.limit ?? plan.cloneVoiceSlots;
  const slotUsed = held ?? usage?.voiceSlots.clone.used ?? slotInfo?.clone?.used ?? 0;

  let creations: CreationAllowance;
  const bucket = usage?.buckets.cloneCreations ?? null;
  const fromSlots = cloneCreationsOf(slotInfo?.clone ?? null);
  if (bucket) {
    creations = {
      used: bucket.used,
      limit: bucket.limit,
      period: bucket.period,
      renewsAt: bucket.renewsAt,
    };
  } else if (fromSlots) {
    creations = {
      used: fromSlots.used,
      limit: fromSlots.limit,
      period: fromSlots.period ?? plan.cloneCreations.period,
      renewsAt: fromSlots.renewsAt,
    };
  } else {
    creations = {
      used: null,
      limit: plan.cloneCreations.amount,
      period: plan.cloneCreations.period,
      renewsAt: null,
    };
  }
  return { slots: { used: Math.max(0, slotUsed), limit: Math.max(0, slotLimit) }, creations };
}

/** Free own-voice slots (never below 0). */
export function freeVoiceSlots(limits: OwnVoiceLimits): number {
  return Math.max(0, limits.slots.limit - limits.slots.used);
}

/** True when the new-voice allowance is known and used up. */
export function creationsUsedUp(creations: CreationAllowance): boolean {
  return creations.limit !== null && creations.used !== null && creations.used >= creations.limit;
}

export type NewVoiceBlockReason = 'closed' | 'slots' | 'creations' | 'other';

export interface NewVoiceBlock {
  readonly reason: NewVoiceBlockReason;
  /** One or two sentences: why no new own voice can be recorded now. */
  readonly message: string;
}

/**
 * Why no new own voice can be recorded now; null when one can. In this
 * order: cloning closed by the backend, every slot taken, the creations used
 * up, anything else the slots answer says (`canCreate` false).
 */
export function newVoiceBlock(
  limits: OwnVoiceLimits,
  { cloningOpen, canCreate, offersPlans }: { cloningOpen: boolean; canCreate: boolean; offersPlans: boolean },
  t: Translate,
): NewVoiceBlock | null {
  if (!cloningOpen) return { reason: 'closed', message: t('voiceFlow:consent.closedMessage') };
  if (freeVoiceSlots(limits) <= 0) {
    // With no bigger plan, the way to a new voice is a delete.
    return { reason: 'slots', message: t(offersPlans ? 'voices:slots.full' : 'voices:slots.fullDelete') };
  }
  const creations = limits.creations;
  if (creationsUsedUp(creations)) {
    if (creations.period === 'lifetime') {
      return { reason: 'creations', message: t('voices:slots.creationsUsedLifetime') };
    }
    const used = t('voices:slots.creationsUsedMonth');
    return {
      reason: 'creations',
      message: creations.renewsAt ? `${used} ${renewalLine(creations.renewsAt)}` : used,
    };
  }
  if (!canCreate) return { reason: 'other', message: t('voices:add.full') };
  return null;
}

/**
 * The message of the "delete your own voice?" dialog. It always says that a
 * delete gives no new-voice allowance back, then what is left of it: when
 * nothing is (always the case for the single lifetime voice of the free
 * plan) that the voice cannot be recorded again, never on a lifetime
 * allowance, not before the renewal on a monthly one. An unknown or
 * unlimited allowance gets the no-refund sentence alone.
 *
 * `bucket` is GET /usage `cloneCreations`; the slots answer stands in for it.
 */
export function cloneDeleteMessage(
  info: VoiceSlotInfo | null,
  t: Translate,
  bucket: UsageBucket | null = null,
): string {
  const fromSlots = cloneCreationsOf(info?.clone ?? null);
  const creations: { used: number; limit: number | null; period: CloneCreationPeriod | null; renewsAt: Date | null } | null =
    bucket ?? fromSlots;
  if (!creations || creations.limit === null) return t('voices:dialogs.delete.messageNoRefund');
  const left = Math.max(0, creations.limit - creations.used);
  const usedUp = left <= 0 || (!bucket && isCloneCreationLimitReached(info?.clone ?? null));
  if (usedUp) {
    if (creations.period === 'lifetime') return t('voices:dialogs.delete.messageFinal');
    const final = t('voices:dialogs.delete.messageFinalMonth');
    return creations.renewsAt ? `${final} ${renewalLine(creations.renewsAt)}` : final;
  }
  return creations.period === 'lifetime'
    ? t('voices:dialogs.delete.messageLeftLifetime', { left })
    : t('voices:dialogs.delete.messageLeft', { left });
}

/** True when deleting the user's own voice would leave no way to record one again. */
export function isFinalCloneDelete(info: VoiceSlotInfo | null): boolean {
  const clone = info?.clone ?? null;
  const creations = cloneCreationsOf(clone);
  if (!creations || creations.limit === null) return false;
  return isCloneCreationLimitReached(clone);
}
