/**
 * TypeScript Enums for Sesly Application
 * Strict type definitions matching backend API
 */

// ============================================================================
// Subscription & Authentication
// ============================================================================

// Mirrors backend `SubscriptionPlan` (prisma/schema.prisma). Plan names are
// not here: they come from PLANS[planId].brandName and plans:free
// (models/Plans.ts, planIdForTier).
export enum SubscriptionTier {
  FREE = 'FREE',
  MINI = 'MINI',
  PRO = 'PRO',
  CREATOR = 'CREATOR',
}

/** Normalize any backend plan/tier string into a SubscriptionTier. */
export function parseSubscriptionTier(raw: unknown): SubscriptionTier {
  const value = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  switch (value) {
    case SubscriptionTier.MINI:
      return SubscriptionTier.MINI;
    case SubscriptionTier.PRO:
      return SubscriptionTier.PRO;
    case SubscriptionTier.CREATOR:
      return SubscriptionTier.CREATOR;
    default:
      return SubscriptionTier.FREE;
  }
}

/**
 * Any paid plan (Mini, Premium, Creator). What the paid plans share
 * (background playback, lock-screen controls, premium stories) checks this.
 */
export function isPaidTier(tier: SubscriptionTier | string | null | undefined): boolean {
  return parseSubscriptionTier(tier) !== SubscriptionTier.FREE;
}

export enum AuthProvider {
  FIREBASE = 'FIREBASE',
  GOOGLE = 'GOOGLE',
  APPLE = 'APPLE',
  EMAIL = 'EMAIL',
}

// ============================================================================
// Story Related
// ============================================================================

export enum AgeGroup {
  ZERO_TO_THREE = 'ZERO_TO_THREE',
  THREE_TO_SIX = 'THREE_TO_SIX',
  SIX_TO_TEN = 'SIX_TO_TEN',
  TEN_PLUS = 'TEN_PLUS',
}

// Mirrors backend `StoryCategory` (prisma/schema.prisma). Display labels
// live in `utils/storyFormat.ts` (formatCategory) so every screen renders
// the same Turkish text.
export enum StoryCategory {
  TURKISH_CLASSICS = 'TURKISH_CLASSICS',
  WORLD_CLASSICS = 'WORLD_CLASSICS',
  EDUCATIONAL = 'EDUCATIONAL',
  BEDTIME = 'BEDTIME',
}

// ============================================================================
// Voice Profile & TTS
// ============================================================================

export enum VoiceProfileStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  FAILED = 'FAILED',
}

export enum TTSProvider {
  GOOGLE = 'GOOGLE',
  CARTESIA = 'CARTESIA',
}

// ============================================================================
// Narration & Audio Generation
// ============================================================================

export enum NarrationStatus {
  PENDING = 'PENDING',
  GENERATING = 'GENERATING',
  READY = 'READY',
  FAILED = 'FAILED',
}

export enum AudioGenerationStatus {
  PENDING = 'PENDING',
  GENERATING = 'GENERATING',
  READY = 'READY',
  FAILED = 'FAILED',
}

// ============================================================================
// Subscription & Billing
// ============================================================================

export enum BillingPeriod {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

// Mirrors backend `SubscriptionStatus` (prisma/schema.prisma).
export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED',
  PAST_DUE = 'PAST_DUE',
}

/** Normalize a backend status string (tolerates the old CANCELLED spelling). */
export function parseSubscriptionStatus(raw: unknown): SubscriptionStatus {
  const value = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  switch (value) {
    case 'ACTIVE':
      return SubscriptionStatus.ACTIVE;
    case 'CANCELED':
    case 'CANCELLED':
      return SubscriptionStatus.CANCELED;
    case 'PAST_DUE':
      return SubscriptionStatus.PAST_DUE;
    default:
      return SubscriptionStatus.EXPIRED;
  }
}

export enum SubscriptionProvider {
  STRIPE = 'STRIPE',
  APPLE = 'APPLE',
  GOOGLE = 'GOOGLE',
}
