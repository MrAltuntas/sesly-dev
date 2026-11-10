/**
 * Prisma Type Definitions and Constants
 * Provides both types (for TypeScript) and const objects (for runtime validators)
 * Compatible with both Prisma Client enums and manual definitions
 * Works in Docker and local environments without type conflicts
 */

// Admin roles
export const AdminRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  MODERATOR: 'MODERATOR',
} as const;
export type AdminRole = typeof AdminRole[keyof typeof AdminRole];

// Story enums
export const AgeGroup = {
  ZERO_TO_THREE: 'ZERO_TO_THREE',
  THREE_TO_SIX: 'THREE_TO_SIX',
  SIX_TO_TEN: 'SIX_TO_TEN',
  TEN_PLUS: 'TEN_PLUS',
} as const;
export type AgeGroup = typeof AgeGroup[keyof typeof AgeGroup];

export const StoryCategory = {
  TURKISH_CLASSICS: 'TURKISH_CLASSICS',
  WORLD_CLASSICS: 'WORLD_CLASSICS',
  EDUCATIONAL: 'EDUCATIONAL',
  BEDTIME: 'BEDTIME',
} as const;
export type StoryCategory = typeof StoryCategory[keyof typeof StoryCategory];

// Audio status
export const AudioStatus = {
  PENDING: 'PENDING',
  GENERATING: 'GENERATING',
  READY: 'READY',
  FAILED: 'FAILED',
} as const;
export type AudioStatus = typeof AudioStatus[keyof typeof AudioStatus];

// Voice profile status
export const VoiceProfileStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  FAILED: 'FAILED',
} as const;
export type VoiceProfileStatus = typeof VoiceProfileStatus[keyof typeof VoiceProfileStatus];

// Voice profile kind: PRESET = ready-made provider voice, CLONE = the user's
// own recorded + cloned voice. Slots, deletion and premium rules use this.
export const VoiceProfileKind = {
  PRESET: 'PRESET',
  CLONE: 'CLONE',
} as const;
export type VoiceProfileKind = typeof VoiceProfileKind[keyof typeof VoiceProfileKind];

// Subscription enums
// PRO is shown to users as "Premium"; CREATOR is an admin-grant plan only.
export const SubscriptionPlan = {
  FREE: 'FREE',
  PRO: 'PRO',
  CREATOR: 'CREATOR',
  MINI: 'MINI',
} as const;
export type SubscriptionPlan = typeof SubscriptionPlan[keyof typeof SubscriptionPlan];

export const SubscriptionStatus = {
  ACTIVE: 'ACTIVE',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  PAST_DUE: 'PAST_DUE',
} as const;
export type SubscriptionStatus = typeof SubscriptionStatus[keyof typeof SubscriptionStatus];

// Store purchases (store_purchases / store_events)
export const StorePlatform = {
  APPLE: 'APPLE',
  GOOGLE: 'GOOGLE',
} as const;
export type StorePlatform = typeof StorePlatform[keyof typeof StorePlatform];

export const StoreBillingPeriod = {
  MONTH: 'MONTH',
  YEAR: 'YEAR',
} as const;
export type StoreBillingPeriod = typeof StoreBillingPeriod[keyof typeof StoreBillingPeriod];

export const StorePurchaseState = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  CANCELED: 'CANCELED',
  GRACE: 'GRACE',
  ON_HOLD: 'ON_HOLD',
  PAUSED: 'PAUSED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
  REPLACED: 'REPLACED',
} as const;
export type StorePurchaseState = typeof StorePurchaseState[keyof typeof StorePurchaseState];

export const StoreEventStatus = {
  RECEIVED: 'RECEIVED',
  PROCESSED: 'PROCESSED',
  IGNORED: 'IGNORED',
  FAILED: 'FAILED',
} as const;
export type StoreEventStatus = typeof StoreEventStatus[keyof typeof StoreEventStatus];

// Narration status (StoryNarration.status)
export const NarrationStatus = {
  PENDING: 'PENDING',
  GENERATING: 'GENERATING',
  READY: 'READY',
  FAILED: 'FAILED',
} as const;
export type NarrationStatus = typeof NarrationStatus[keyof typeof NarrationStatus];

// Training duration
export const TrainingDuration = {
  SHORT: 'SHORT',
  MEDIUM: 'MEDIUM',
  LONG: 'LONG',
} as const;
export type TrainingDuration = typeof TrainingDuration[keyof typeof TrainingDuration];

// Auth provider
export const AuthProvider = {
  EMAIL: 'EMAIL',
  GOOGLE: 'GOOGLE',
  APPLE: 'APPLE',
} as const;
export type AuthProvider = typeof AuthProvider[keyof typeof AuthProvider];

// TTS Provider
export const TTSProvider = {
  GOOGLE: 'GOOGLE',
  CARTESIA: 'CARTESIA',
} as const;
export type TTSProvider = typeof TTSProvider[keyof typeof TTSProvider];

// Collection tone — UI hinting for mobile's "Koleksiyonlar" screen
export const CollectionTone = {
  ACCENT: 'ACCENT',
  TRUST: 'TRUST',
  NATURE: 'NATURE',
  SUN: 'SUN',
} as const;
export type CollectionTone = typeof CollectionTone[keyof typeof CollectionTone];

// Legal document publish state — DRAFT is the editable working copy;
// PUBLISHED indicates `currentVersion` has at least one matching snapshot
// in `legal_document_versions`.
export const LegalDocumentStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
} as const;
export type LegalDocumentStatus = typeof LegalDocumentStatus[keyof typeof LegalDocumentStatus];

// Voice clone deletion request status — see `VoiceDeletionRequest` model.
// CARTESIA rows flip to COMPLETED (or FAILED with notes) immediately because
// Cartesia exposes a real delete API. GOOGLE rows are NO_OP for symmetric audit.
export const VoiceDeletionRequestStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  NO_OP: 'NO_OP',
} as const;
export type VoiceDeletionRequestStatus =
  typeof VoiceDeletionRequestStatus[keyof typeof VoiceDeletionRequestStatus];

// Story catalogue status. Lists and search only return PUBLISHED; a single
// story also resolves when ARCHIVED (old favourites / narrations), never DRAFT.
export const StoryStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type StoryStatus = typeof StoryStatus[keyof typeof StoryStatus];

// Where a story text comes from.
export const StoryOrigin = {
  PUBLIC_DOMAIN: 'PUBLIC_DOMAIN',
  FOLK_ANONYMOUS: 'FOLK_ANONYMOUS',
  LICENSED: 'LICENSED',
  ORIGINAL_HUMAN: 'ORIGINAL_HUMAN',
  AI_GENERATED: 'AI_GENERATED',
} as const;
export type StoryOrigin = typeof StoryOrigin[keyof typeof StoryOrigin];

// How close the stored text is to its source.
export const StoryTextFidelity = {
  VERBATIM: 'VERBATIM',
  SPELLING_MODERNISED: 'SPELLING_MODERNISED',
  ABRIDGED: 'ABRIDGED',
  RETOLD: 'RETOLD',
  TRANSLATED: 'TRANSLATED',
} as const;
export type StoryTextFidelity = typeof StoryTextFidelity[keyof typeof StoryTextFidelity];

// Legal ground a story is published on (internal audit only).
export const StoryRightsBasis = {
  AUTHOR_LIFE_PLUS_70: 'AUTHOR_LIFE_PLUS_70',
  ANONYMOUS_PUBLICATION_PLUS_70: 'ANONYMOUS_PUBLICATION_PLUS_70',
  FOLK_NO_AUTHOR: 'FOLK_NO_AUTHOR',
  CC0: 'CC0',
  CC_BY: 'CC_BY',
  LICENCE_GRANTED: 'LICENCE_GRANTED',
  OWNED: 'OWNED',
} as const;
export type StoryRightsBasis = typeof StoryRightsBasis[keyof typeof StoryRightsBasis];

// CEFR language level of a story text, easiest first.
export const LanguageLevel = {
  A1: 'A1',
  A2: 'A2',
  B1: 'B1',
  B2: 'B2',
  C1: 'C1',
  C2: 'C2',
} as const;
export type LanguageLevel = typeof LanguageLevel[keyof typeof LanguageLevel];

export const LanguageLevelSource = {
  AI: 'AI',
  MANUAL: 'MANUAL',
} as const;
export type LanguageLevelSource = typeof LanguageLevelSource[keyof typeof LanguageLevelSource];

export const AgeGroupSource = {
  AI: 'AI',
  MANUAL: 'MANUAL',
} as const;
export type AgeGroupSource = typeof AgeGroupSource[keyof typeof AgeGroupSource];

export const TranslationMethod = {
  HUMAN: 'HUMAN',
  MACHINE: 'MACHINE',
} as const;
export type TranslationMethod = typeof TranslationMethod[keyof typeof TranslationMethod];

// What a parent should know before listening (Story.contentWarnings),
// declaration order = display order. Turkish labels: content-warnings.ts.
export const ContentWarning = {
  SCARY: 'SCARY',
  VIOLENCE: 'VIOLENCE',
  DEATH: 'DEATH',
  SAD_ENDING: 'SAD_ENDING',
  BAD_EXAMPLE: 'BAD_EXAMPLE',
  OLD_LANGUAGE: 'OLD_LANGUAGE',
  LONELINESS: 'LONELINESS',
} as const;
export type ContentWarning = typeof ContentWarning[keyof typeof ContentWarning];

// Background LLM work on a story (queue "story-llm", table story_llm_tasks).
export const StoryLlmTaskType = {
  TRANSLATE: 'TRANSLATE',
  ASSESS_LEVEL: 'ASSESS_LEVEL',
  ASSESS_AGE_GROUP: 'ASSESS_AGE_GROUP',
} as const;
export type StoryLlmTaskType = typeof StoryLlmTaskType[keyof typeof StoryLlmTaskType];

export const StoryLlmTaskStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  DONE: 'DONE',
  FAILED: 'FAILED',
} as const;
export type StoryLlmTaskStatus = typeof StoryLlmTaskStatus[keyof typeof StoryLlmTaskStatus];
