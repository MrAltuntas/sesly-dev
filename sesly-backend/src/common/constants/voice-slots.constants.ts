import { Allowance, getPlanLimits, PLAN_LIMITS, PlanLimits } from './plans.constants';
import { localizedError, serverTextInAllLanguages } from '../i18n/server-text';

/**
 * Voice profile slot limits by plan, derived from PLAN_LIMITS
 * (plans.constants.ts is the single place the numbers live).
 *
 * Presets (ready-made narrator voices) and clones (the user's own recorded
 * voice) have separate budgets because a clone costs an upstream Cartesia
 * voice + biometric data, while a preset is just a pointer to a stock voice.
 *
 * Slots count voices held right now (deleting one frees the slot). The number
 * of clones a user may CREATE is a separate allowance (`cloneCreations`),
 * counted on append-only counters, so delete-and-record-again cannot go past
 * the plan.
 */
type PlanKey = keyof typeof PLAN_LIMITS;

function bySlot(pick: (limits: PlanLimits) => number): Record<PlanKey, number> {
  return Object.fromEntries(
    (Object.keys(PLAN_LIMITS) as PlanKey[]).map((plan) => [plan, pick(PLAN_LIMITS[plan])]),
  ) as Record<PlanKey, number>;
}

export const PRESET_VOICE_SLOTS = bySlot((limits) => limits.presetVoiceSlots);

/** Concurrent clone profiles (FAILED ones excluded). Subscription.extraVoiceSlots adds here. */
export const CLONE_VOICE_SLOTS = bySlot((limits) => limits.cloneVoiceSlots);

/**
 * Total voice profiles per plan (presets + clones, without extra slots).
 * Kept for consumers that only show a single number (usage limits, plan copy).
 */
export const VOICE_SLOTS = bySlot((limits) => limits.presetVoiceSlots + limits.cloneVoiceSlots);

/**
 * Extra voice slot size for separate purchases
 */
export const EXTRA_VOICE_SLOT_SIZE = 5; // Each purchase adds 5 slots

export function getPresetVoiceSlots(plan: string): number {
  return getPlanLimits(plan).presetVoiceSlots;
}

export function getCloneVoiceSlots(plan: string, extraSlots = 0): number {
  return getPlanLimits(plan).cloneVoiceSlots + Math.max(0, extraSlots || 0);
}

/** How many clones the plan may create, and whether that renews monthly or never. */
export function getCloneCreationAllowance(plan: string): Allowance {
  return getPlanLimits(plan).cloneCreations;
}

/**
 * Get total voice slots available for a plan (presets + clones + extra)
 */
export function getTotalVoiceSlots(plan: string, extraSlots = 0): number {
  const limits = getPlanLimits(plan);
  return limits.presetVoiceSlots + limits.cloneVoiceSlots + Math.max(0, extraSlots || 0);
}

/**
 * Total-count check kept for older callers. New code checks presets and
 * clones separately.
 */
export function canCreateVoiceProfile(
  plan: string,
  extraSlots: number,
  currentCount: number,
): boolean {
  const totalSlots = getTotalVoiceSlots(plan, extraSlots);
  return currentCount < totalSlots;
}

/**
 * User-facing messages of the slot / creation 403s, as `{ message, messageArgs }`
 * to spread into the exception body next to `code`: the message is an i18n
 * key (`errors.voiceSlots.*`) that HttpExceptionFilter serves per
 * Accept-Language. Render one with `serverText(r.message, lang, r.messageArgs)`.
 */
export function voiceSlotLimitError(totalSlots: number) {
  return localizedError('errors.voiceSlots.totalLimit', { totalSlots });
}

export function presetSlotLimitError(limit: number) {
  return localizedError('errors.voiceSlots.presetLimit', { limit });
}

export function cloneSlotLimitError(limit: number) {
  return localizedError('errors.voiceSlots.cloneLimit', { limit });
}

/** 403 CLONE_CREATION_LIMIT message: says what renews when (or that nothing does). */
export function cloneCreationLimitError(allowance: Allowance, renewsAt: Date | null) {
  if (allowance.period === 'lifetime') {
    return localizedError('errors.voiceSlots.cloneCreationLifetime', { limit: allowance.limit ?? 0 });
  }
  return localizedError('errors.voiceSlots.cloneCreationMonthly', {
    limit: allowance.limit ?? 0,
    // Optional sentence, empty when there is no renewal date.
    renewal: renewsAt
      ? serverTextInAllLanguages('errors.voiceSlots.cloneCreationRenews', { renewDate: renewsAt })
      : { tr: '', en: '' },
  });
}
