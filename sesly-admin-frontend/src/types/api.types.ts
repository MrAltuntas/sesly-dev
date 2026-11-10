// ============================================
// ENUMS
// ============================================

export enum AdminRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  MODERATOR = 'MODERATOR',
}

export enum AuthProvider {
  EMAIL = 'EMAIL',
  GOOGLE = 'GOOGLE',
  APPLE = 'APPLE',
}

export enum SubscriptionPlan {
  FREE = 'FREE',
  PRO = 'PRO',
  CREATOR = 'CREATOR',
}

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  PAST_DUE = 'PAST_DUE',
}

export enum StoryCategory {
  TURKISH_CLASSICS = 'TURKISH_CLASSICS',
  WORLD_CLASSICS = 'WORLD_CLASSICS',
  EDUCATIONAL = 'EDUCATIONAL',
  BEDTIME = 'BEDTIME',
}

export enum AgeGroup {
  ZERO_TO_THREE = 'ZERO_TO_THREE',
  THREE_TO_SIX = 'THREE_TO_SIX',
  SIX_TO_TEN = 'SIX_TO_TEN',
  TEN_PLUS = 'TEN_PLUS',
}

export enum TTSProvider {
  GOOGLE = 'GOOGLE',
  CARTESIA = 'CARTESIA',
}

export enum VoiceProfileStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  FAILED = 'FAILED',
}

export enum AudioStatus {
  PENDING = 'PENDING',
  GENERATING = 'GENERATING',
  READY = 'READY',
  FAILED = 'FAILED',
}

export enum PromoCodeType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
  FREE_TRIAL = 'FREE_TRIAL',
}

export enum BroadcastSegment {
  ALL = 'ALL',
  PREMIUM = 'PREMIUM',
  FREE = 'FREE',
}

export enum CollectionTone {
  ACCENT = 'ACCENT',
  TRUST = 'TRUST',
  NATURE = 'NATURE',
  SUN = 'SUN',
}

export enum LegalDocumentStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

// ============================================
// AUTHENTICATION
// ============================================

export interface AdminLoginDto {
  email: string;
  password: string;
}

export interface AdminAuthResponse {
  accessToken: string;
  refreshToken: string;
  admin: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    role: AdminRole;
  };
}

// ============================================
// USERS
// ============================================

export interface Subscription {
  id: string;
  userId?: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SubscriptionSummary {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodEnd?: string;
}

export interface User {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  provider: AuthProvider;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
  subscription: SubscriptionSummary | null;
  _count: {
    voiceProfiles: number;
    storyProgress: number;
    favoriteStories: number;
  };
}

export interface UserListQueryDto {
  page?: number;
  limit?: number;
  search?: string;
}

export interface UserStats {
  totalUsers: number;
  verifiedUsers: number;
  unverifiedUsers: number;
  activeSubscriptions: number;
  subscriptionsByPlan: Array<{
    plan: SubscriptionPlan;
    count: number;
  }>;
  totalStoryProgress: number;
  totalVoiceProfiles: number;
  averageVoiceProfilesPerUser: string;
}

// ============================================
// STORIES
// ============================================

export interface Story {
  id: string;
  title: string;
  content: string;
  coverImageUrl?: string;
  language: string;
  category: StoryCategory;
  ageGroup: AgeGroup;
  estimatedDuration: number;
  isPremium: boolean;
  hasPreGeneratedNarration: boolean;
  createdAt: string;
  updatedAt: string;
  // Cartesia Sonic 3 story-level defaults (Phase 2A)
  defaultEmotion?: string | null;
  defaultSpeed?: number | null;
  cartesiaPronunciationDictId?: string | null;
  preprocessedSegments?: StorySegment[] | null;
  preprocessedAt?: string | null;
  preprocessedModel?: string | null;
  /** Bumped on every write of the segments (import = 1). */
  segmentationVersion?: number;
  // Bulk import and multi-part tales (never sent to the app)
  tags?: string[];
  sourceEdition?: string | null;
  licenseName?: string | null;
  attribution?: string | null;
  /** Content warnings (enums.contentWarning), shown in the app next to the age group. */
  contentWarnings?: ContentWarning[];
  importedAt?: string | null;
  /** Label of the import the story came from (the file name, else the import date). */
  importBatch?: string | null;
  /** "İncelendi" in the review view. */
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  /** Credit of the cover picture (CC BY or public domain illustration). */
  coverCredit?: CoverCredit | null;
  partGroupId?: string | null;
  partNumber?: number | null;
  _count: {
    chunks: number;
    userProgress: number;
    favoritedBy: number;
  };
}

// ---------- Story catalogue (multi-language, credit, rights, level) ----------

export type StoryStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type StoryOrigin =
  | 'PUBLIC_DOMAIN'
  | 'FOLK_ANONYMOUS'
  | 'LICENSED'
  | 'ORIGINAL_HUMAN'
  | 'AI_GENERATED';
export type StoryTextFidelity =
  | 'VERBATIM'
  | 'SPELLING_MODERNISED'
  | 'ABRIDGED'
  | 'RETOLD'
  | 'TRANSLATED';
export type StoryRightsBasis =
  | 'AUTHOR_LIFE_PLUS_70'
  | 'ANONYMOUS_PUBLICATION_PLUS_70'
  | 'FOLK_NO_AUTHOR'
  | 'CC0'
  | 'CC_BY'
  | 'LICENCE_GRANTED'
  | 'OWNED';
export type LanguageLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
export type LanguageLevelSource = 'AI' | 'MANUAL';
export type TranslationMethod = 'HUMAN' | 'MACHINE';
export type StorySort = 'newest' | 'oldest' | 'title' | 'duration' | 'level';

/** A sibling of the translation group (same tale, other language). */
export interface StoryTranslationRef {
  id: string;
  language: string;
  title: string;
  status: StoryStatus;
}

/**
 * Every Story column as the admin API returns it (GET /admin/stories rows,
 * GET /admin/stories/:id). `Story` above stays the narrow shape the other
 * pages (collections, voice test, dashboard) read.
 */
export interface AdminStory extends Story {
  slug: string | null;
  status: StoryStatus;
  publishedAt: string | null;
  summary: string | null;
  // Public credit
  originalTitle: string | null;
  originalLanguage: string | null;
  authorName: string | null;
  authorDeathYear: number | null;
  collectorName: string | null;
  collectorDeathYear: number | null;
  translatorName: string | null;
  translatorDeathYear: number | null;
  adaptedBy: string | null;
  firstPublishedYear: number | null;
  editionYear: number | null;
  sourceName: string | null;
  sourceUrl: string | null;
  origin: StoryOrigin | null;
  textFidelity: StoryTextFidelity | null;
  // Internal rights audit (never sent to the mobile API)
  sourceRetrievedAt: string | null;
  rightsBasis: StoryRightsBasis | null;
  rightsNote: string | null;
  licenseUrl: string | null;
  rightsVerifiedAt: string | null;
  rightsVerifiedBy: string | null;
  // Translation. translatedFromId is provenance only; siblings come from
  // `translations` / `groupLanguages`.
  translationGroupId: string | null;
  translatedFromId: string | null;
  translationMethod: TranslationMethod | null;
  // Language level
  languageLevel: LanguageLevel | null;
  languageLevelSource: LanguageLevelSource | null;
  languageLevelNote: string | null;
  languageLevelAssessedAt: string | null;
  // Age group: who chose it (null on rows older than the field)
  ageGroupSource?: AgeGroupSource | null;
  ageGroupNote?: string | null;
  ageGroupAssessedAt?: string | null;
  /** Open translation requests of users for the tale of this story. */
  translationRequests?: TranslationRequestSummary;
  translations: StoryTranslationRef[];
  /** Languages of the group including the story's own, catalogue order. */
  groupLanguages: string[];
}

export type AgeGroupSource = 'AI' | 'MANUAL';

export interface TranslationRequestSummary {
  total: number;
  /** Most requested language first. */
  languages: Array<{ language: string; count: number }>;
}

/** Row of GET /admin/stories/translation-requests: one tale and one language. */
export interface TranslationRequestRow {
  /** Translation group id, or the story id for a story without a group. */
  groupKey: string;
  language: string;
  /** Turkish name of the requested language. */
  languageName: string;
  requestCount: number;
  latestRequestedAt: string | null;
  /** The story a translation would be made from. */
  story: { id: string; title: string; language: string; status: StoryStatus } | null;
  groupLanguages: string[];
  /** A story of the tale that already is in the requested language (for example a draft). */
  existingVersion: { id: string; title: string; status: StoryStatus } | null;
}

export interface TranslationRequestsQueryDto {
  page?: number;
  limit?: number;
  status?: 'pending' | 'fulfilled';
  language?: string;
}

export interface StoryDetail extends AdminStory {
  chunks: StoryChunk[];
}

/** A row of GET /admin/stories: the story without its text and segments (GET /admin/stories/:id has them). */
export type AdminStoryListItem = Omit<AdminStory, "content" | "preprocessedSegments">;

export interface AdminStoriesQueryDto {
  page?: number;
  limit?: number;
  language?: string;
  status?: string;
  /** One level or several, comma separated. */
  languageLevel?: string;
  category?: string;
  ageGroup?: string;
  origin?: string;
  q?: string;
  missingLanguage?: string;
  sort?: string;
  /** "true": only stories from a bulk import, "false": only the others. */
  imported?: string;
  importBatch?: string;
  reviewed?: string;
  /** YYYY-MM-DD, created on or after. */
  createdFrom?: string;
  /** YYYY-MM-DD, created on or before (whole day). */
  createdTo?: string;
}

export interface EnumOption {
  value: string;
  label: string;
}

export interface ContentLanguageInfo {
  code: string;
  nativeName: string;
  englishName: string;
  wordsPerMinute: number;
  enabled: boolean;
}

/** Backend Prisma enum ContentWarning (labels: enums.contentWarning of the meta). */
export type ContentWarning =
  | 'SCARY'
  | 'VIOLENCE'
  | 'DEATH'
  | 'SAD_ENDING'
  | 'BAD_EXAMPLE'
  | 'OLD_LANGUAGE'
  | 'LONELINESS';

export type StoryMetaEnumKey =
  | 'status'
  | 'origin'
  | 'textFidelity'
  | 'rightsBasis'
  | 'languageLevel'
  | 'languageLevelSource'
  | 'translationMethod'
  | 'category'
  | 'ageGroup'
  | 'contentWarning'
  | 'ageGroupSource'
  | 'llmTaskType'
  | 'llmTaskStatus';

/** GET /admin/stories/meta */
export interface StoriesMeta {
  languages: {
    all: ContentLanguageInfo[];
    enabled: string[];
    default: string;
  };
  enums: Record<StoryMetaEnumKey, EnumOption[]>;
  sorts: EnumOption[];
  publishRules: {
    always: string[];
    rightsRequiredOrigins: string[];
    /** rightsBasis CC_BY additionally needs these (attribution, licenseName). */
    ccByRequires?: string[];
  };
}

// ---------- Background LLM tasks (translation, level assessment) ----------

export type StoryLlmTaskType = 'TRANSLATE' | 'ASSESS_LEVEL' | 'ASSESS_AGE_GROUP';
export type StoryLlmTaskStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

export interface StoryLlmLevelResult {
  level: LanguageLevel;
  confidence: number;
  note: string;
}

export interface StoryLlmAgeGroupResult {
  ageGroup: AgeGroup;
  confidence: number;
  note: string;
}

export interface StoryLlmTranslateResult {
  title: string;
  sourceParagraphs: number;
  translatedParagraphs: number;
  lengthRatio: number;
  replaced: boolean;
}

export interface StoryLlmTask {
  id: string;
  storyId: string;
  type: StoryLlmTaskType;
  targetLanguage: string | null;
  status: StoryLlmTaskStatus;
  /** Turkish. FAILED: the reason. PENDING after a failed attempt: the retry note. */
  error: string | null;
  resultStoryId: string | null;
  result: StoryLlmLevelResult | StoryLlmAgeGroupResult | StoryLlmTranslateResult | null;
  createdByAdminId: string | null;
  force: boolean;
  attempts: number;
  model: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Row of GET /admin/stories/llm-tasks. */
export interface StoryLlmTaskRow extends StoryLlmTask {
  story: { id: string; title: string; language: string };
  resultStory: { id: string; title: string; language: string; status: StoryStatus } | null;
}

export interface StoryLlmTasksQueryDto {
  page?: number;
  limit?: number;
  storyId?: string;
  status?: string;
  type?: string;
}

export interface LlmBatchQueued {
  storyId: string;
  taskId: string;
}

export interface LlmBatchSkip {
  storyId: string;
  code: string;
  /** Turkish, can be shown verbatim. */
  reason: string;
}

export interface TranslateBatchResponse {
  targetLanguage: string;
  queued: LlmBatchQueued[];
  skipped: LlmBatchSkip[];
}

export interface AssessLevelBatchResponse {
  matched: number;
  queued: LlmBatchQueued[];
  skipped: LlmBatchSkip[];
}

/**
 * Catalogue fields of POST / PATCH /admin/stories. The endpoints are
 * multipart, so every value travels as text. On PATCH an empty string clears
 * a nullable field and an absent key leaves it alone.
 */
export interface StoryCatalogueFields {
  slug?: string;
  status?: string;
  summary?: string;
  originalTitle?: string;
  originalLanguage?: string;
  authorName?: string;
  authorDeathYear?: string;
  collectorName?: string;
  collectorDeathYear?: string;
  translatorName?: string;
  translatorDeathYear?: string;
  adaptedBy?: string;
  firstPublishedYear?: string;
  editionYear?: string;
  sourceName?: string;
  sourceUrl?: string;
  origin?: string;
  textFidelity?: string;
  sourceRetrievedAt?: string;
  rightsBasis?: string;
  rightsNote?: string;
  licenseUrl?: string;
  licenseName?: string;
  attribution?: string;
  sourceEdition?: string;
  /** Content warning keys separated by commas ("" clears them). */
  contentWarnings?: string;
  rightsVerifiedAt?: string;
  rightsVerifiedBy?: string;
  translatedFromId?: string;
  translationMethod?: string;
  languageLevel?: string;
  languageLevelNote?: string;
}

// Single per-segment Cartesia override entry. All fields except `text`
// are optional — null/undefined means "fall back to Story default → env".
export interface StorySegment {
  text: string;
  emotion?: string | null;
  speed?: number | null;
  volume?: number | null;
  /** Silence after the segment, 0 to 3000 ms. */
  pauseAfterMs?: number | null;
}

/** GET /admin/stories/:id/narration-cache. Narrations of every user. */
export interface NarrationCacheSummary {
  storyId: string;
  segmentationVersion: number;
  narrations: number;
  readyNarrations: number;
  generatingNarrations: number;
  audios: number;
  /** Shared ready-made voice audios of the story (one synthesis reused by every user). */
  sharedAudios: number;
  /** Narrations (of every user) that use one of those shared audios. */
  sharedNarrations: number;
  /** Runtime setting tts.sharePresetAudio. */
  sharingEnabled: boolean;
  /** Audio made from older segments than the story has now. */
  staleAudios: number;
  files: number;
}

/** DELETE /admin/stories/:id/narration-cache. */
export interface NarrationCacheClearResult extends NarrationCacheSummary {
  removedAudios: number;
  failedAudios: number;
}

export interface SegmentVocabulary {
  emotions: Array<{ value: string; label: string; recommended: boolean }>;
  speed: { min: number; max: number; recommendedMin: number; recommendedMax: number };
  volume: { min: number; max: number };
  pauseAfterMs: { min: number; max: number };
  maxSegmentChars: number;
  maxSegments: number;
}

/** GET (and PATCH) /admin/stories/:id/segments. */
export interface StorySegmentsView {
  storyId: string;
  version: number;
  /** "import" | "manual" | "fallback-split" | Gemini model id | null */
  source: string | null;
  segmentedAt: string | null;
  /** False: the first narration request will segment the story. */
  stored: boolean;
  segments: StorySegment[];
  matchesContent: boolean;
  contentDiff: string | null;
  defaultEmotion: string | null;
  defaultSpeed: number | null;
  vocabulary: SegmentVocabulary;
  cache: NarrationCacheSummary;
  /** Only on PATCH: what the save removed from the narration cache. */
  cacheCleared?: NarrationCacheClearResult;
}

/** One item of POST /admin/stories/import. */
export interface ImportItemResult {
  index: number;
  title: string | null;
  language: string | null;
  status: "created" | "skipped" | "error" | "valid";
  storyId?: string;
  slug?: string;
  message?: string;
  problems?: string[];
  segments?: number;
  pairKey?: string;
  partOf?: string;
  partNumber?: number;
}

export interface ImportResult {
  dryRun: boolean;
  /** Story.importBatch written on the created stories. */
  batch?: string;
  total: number;
  created: number;
  skipped: number;
  errors: number;
  items: ImportItemResult[];
}

export interface StorySegmentPreview {
  storyId: string;
  defaultEmotion: string | null;
  defaultSpeed: number | null;
  cartesiaPronunciationDictId: string | null;
  segments: Array<{ text: string }>;
}

export interface StoryChunk {
  id: string;
  storyId?: string;
  chunkIndex: number;
  content: string;
  startTime: number | null;
  endTime: number | null;
  createdAt: string;
  _count?: {
    audioFiles: number;
  };
}

export interface CreateStoryDto {
  title: string;
  content: string;
  category: StoryCategory;
  /** Absent: the backend stores a placeholder and asks the AI. */
  ageGroup?: AgeGroup;
  language?: string;
  /** Not sent by the panel: the backend computes it from the word count. */
  estimatedDuration?: number;
  coverImageUrl?: string;
  isPremium?: boolean;
  coverImage?: File;
  defaultEmotion?: string;
  defaultSpeed?: number;
  cartesiaPronunciationDictId?: string;
  catalogue?: StoryCatalogueFields;
  /** With a cover file: write it to every language and part of the tale. */
  applyCoverToTale?: boolean;
  /** Credit of the uploaded cover. */
  coverCredit?: CoverCredit | null;
}

export interface UpdateStoryDto {
  title?: string;
  content?: string;
  category?: StoryCategory;
  ageGroup?: AgeGroup;
  language?: string;
  estimatedDuration?: number;
  coverImageUrl?: string;
  isPremium?: boolean;
  coverImage?: File;
  defaultEmotion?: string;
  defaultSpeed?: number;
  cartesiaPronunciationDictId?: string;
  catalogue?: StoryCatalogueFields;
  /** With a cover file: write it to every language and part of the tale. */
  applyCoverToTale?: boolean;
  /** Credit of the cover; null clears it. Without a file it replaces the credit of the current cover. */
  coverCredit?: CoverCredit | null;
}

export interface UpdateSegmentsDto {
  segments: StorySegment[];
}

export interface LlmFillSegmentsResponse {
  storyId: string;
  modelUsed: string;
  durationMs: number;
  usage?: {
    promptTokens?: number;
    candidatesTokens?: number;
    thoughtsTokens?: number;
    totalTokens?: number;
  };
  warnings: string[];
  segments: StorySegment[];
}

// ============================================
// ANALYTICS
// ============================================

export interface SystemStats {
  users: {
    total: number;
    verified: number;
    unverified: number;
  };
  stories: {
    total: number;
    premium: number;
    free: number;
  };
  voiceProfiles: {
    total: number;
    byProvider: Array<{
      provider: TTSProvider;
      count: number;
    }>;
  };
  audio: {
    total: number;
    ready: number;
    pending: number;
    generating: number;
    failed: number;
    successRate: string;
  };
  subscriptions: {
    /** Active subscriptions on a non-FREE plan. */
    total: number;
    /** Active paid subscriptions (the ones counted toward revenue). */
    paid: number;
    byPlan: Array<{
      plan: SubscriptionPlan;
      count: number;
    }>;
    /** Paid-only estimate, in `currency`. */
    estimatedMonthlyRevenue: number;
    currency: string;
  };
}

export interface ActivityQueryDto {
  page?: number;
  limit?: number;
}

// The backend also returns `recentVoiceProfiles`; the dashboard does not
// render it, so it is intentionally left out of the type.
export interface RecentActivity {
  recentUsers: PaginatedResponse<User>;
  recentStories: PaginatedResponse<Story>;
}

export interface UsageStats {
  currentMonth: number;
  currentYear: number;
  totalStoriesGenerated: number;
  activeUsers: number;
  averageStoriesPerUser: number | string;
  premiumNarrations: number;
  standardNarrations: number;
}

// ============================================
// VOICE PROFILES & AUDIO
// ============================================

export interface VoiceProfile {
  id: string;
  userId?: string;
  name: string;
  profileIcon?: string;
  provider: TTSProvider;
  voiceId?: string;
  language?: string;
  status: VoiceProfileStatus;
  consentAudioUrl?: string;
  sampleAudioUrl?: string; // exposed by backend since Aşama 1.3
  createdAt: string;
  updatedAt?: string;
  user?: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  };
}

// Row returned by GET /admin/moderation/voice-profiles.
export interface ModerationVoiceProfile {
  id: string;
  name: string;
  provider: TTSProvider;
  status: VoiceProfileStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  sampleUrl: string | null;
}

export interface ModerationListQueryDto {
  page?: number;
  limit?: number;
  status?: VoiceProfileStatus;
}

export interface RejectVoiceDto {
  reason?: string;
}

export interface Device {
  id: string;
  platform: string;
  isActive: boolean;
  createdAt: string;
}

// Monthly quota counter row. `storiesGenerated` is only incremented for
// FREE-plan narrations; `textToSpeechCount` is never written by the backend
// and is intentionally omitted.
export interface UsageLimitItem {
  id: string;
  month: number;
  year: number;
  storiesGenerated: number;
  resetAt: string;
}

// ============================================
// AUDIO
// ============================================

// Row returned by GET /admin/audio.
export interface Audio {
  id: string;
  title: string | null;
  status: AudioStatus;
  duration: number | null;
  progress: number | null;
  createdAt: string;
  /** Null for a shared ready-made voice audio. */
  userId: string | null;
  user: { id: string; email: string } | null;
  voiceProfile: { id: string; name: string } | null;
  url: string | null;
  /** One synthesis reused by every user of the same story and ready-made voice. */
  shared?: boolean;
  /** Narrations that point at this audio. */
  narrationCount?: number;
}

export interface AudioListQueryDto {
  page?: number;
  limit?: number;
  status?: AudioStatus;
}

// ============================================
// FINANCE
// ============================================

export interface PromoCode {
  id: string;
  code: string;
  type: PromoCodeType;
  value: number;
  /** null = unlimited */
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface CreatePromoCodeDto {
  code: string;
  type: PromoCodeType;
  value: number;
  maxUses?: number;
  expiresAt?: string;
}

export interface GrantAccessDto {
  userEmail: string;
  plan: SubscriptionPlan;
  durationDays: number;
  reason: string;
}

// ============================================
// OPERATIONS
// ============================================

export interface BroadcastDto {
  title: string;
  body: string;
  segment: BroadcastSegment;
}

export interface BroadcastResponse {
  count: number;
  /** true when at least one push was delivered (only promo opt-in users with a device get push). */
  pushSent: boolean;
  /** number of users a push reached */
  pushDelivered?: number;
}

export interface MaintenanceModeResponse {
  enabled: boolean;
}

// ============================================
// PAGINATION
// ============================================

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginationDto {
  page?: number;
  limit?: number;
}

// ============================================
// COMMON RESPONSES
// ============================================

export interface MessageResponse {
  message: string;
}

export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
}


// ============================================
// COLLECTIONS
// ============================================

export interface Collection {
  id: string;
  slug: string;
  /** Content language of the collection; it only holds stories of this language. */
  language?: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  tone: CollectionTone;
  coverImageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  storyCount: number;
  createdAt: string;
  updatedAt: string;
}

// Row returned by GET /admin/collections/:id/stories.
export interface CollectionStoryItem {
  id: string;
  title: string;
  category: StoryCategory;
  ageGroup: AgeGroup;
  isPremium: boolean;
  coverImageUrl: string | null;
  position: number;
}

export interface CollectionListQueryDto {
  page?: number;
  limit?: number;
  search?: string;
}

export interface CreateCollectionDto {
  slug: string;
  title: string;
  subtitle?: string;
  description?: string;
  tone: CollectionTone;
  coverImageUrl?: string;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateCollectionDto {
  title?: string;
  subtitle?: string;
  description?: string;
  tone?: CollectionTone;
  coverImageUrl?: string;
  isActive?: boolean;
  sortOrder?: number;
}

export interface AddStoriesDto {
  storyIds: string[];
}

export interface ReorderStoriesDto {
  storyIds: string[];
}

// ============================================
// LEGAL DOCUMENTS
// ============================================

/**
 * Language of a legal document. A document is identified by (slug, language).
 * Turkish is the canonical text: the app is served the published Turkish one
 * when the requested language has no published version.
 */
export type LegalLanguage = 'tr' | 'en';

/** `?language=` of `GET /admin/legal`: one language, or every language. */
export type LegalListLanguage = LegalLanguage | 'all';

export interface LegalDocument {
  id: string;
  slug: string;
  language: LegalLanguage;
  title: string;
  contentMd: string;
  currentVersion: number;
  status: LegalDocumentStatus;
  publishedAt: string | null;
  publishedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LegalDocumentVersion {
  id: string;
  documentId: string;
  slug: string;
  language: LegalLanguage;
  version: number;
  title: string;
  contentMd: string;
  publishedAt: string;
  publishedBy: string | null;
}

export interface CreateLegalDocumentDto {
  slug: string;
  /** Absent: tr. Cannot be changed after creation. */
  language?: LegalLanguage;
  title: string;
  contentMd: string;
}

/** The language goes in `?language=`; the backend rejects it in the body. */
export interface UpdateLegalDocumentDto {
  title?: string;
  contentMd?: string;
}

// ============================================
// STORAGE
// ============================================

export type StorageClassification = 'audio' | 'image' | 'voiceSample' | 'other';

export interface StorageTypeBucket {
  count: number;
  sizeBytes: number;
}

export interface StorageStats {
  byType: {
    audio: StorageTypeBucket;
    image: StorageTypeBucket;
    voiceSample: StorageTypeBucket;
    other: StorageTypeBucket;
  };
  total: StorageTypeBucket;
  generatedAt: string;
}

export interface OrphanedFile {
  key: string;
  sizeBytes: number;
  updatedAt: string;
  classifiedAs: StorageClassification;
}

export interface DeleteOrphanResponse {
  deleted: true;
  key: string;
}

// ============================================
// USER DETAIL
// ============================================

export interface UserDetail {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  provider: AuthProvider;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
  subscription: Subscription | null;
  voiceProfiles: VoiceProfile[];
  usageLimits: UsageLimitItem[];
  devices: Device[];
  _count: {
    storyProgress: number;
    favoriteStories: number;
  };
}

// ============================================
// RUNTIME SETTINGS (GET/PATCH /admin/settings)
// ============================================

export type SettingValue = number | string | boolean | string[];
export type SettingType = "int" | "float" | "string" | "enum" | "boolean" | "stringList";
export type SettingSource = "panel" | "env" | "default";

export interface SettingConstraints {
  /** inclusive */
  min: number | null;
  /** inclusive */
  max: number | null;
  /** UI hint only, the server does not enforce it */
  step: number | null;
  /** allowed values for enum, allowed items for stringList */
  options: string[] | null;
  /** the same options with their Turkish display names (absent on an older backend) */
  optionLabels?: Array<{ value: string; label: string }> | null;
  /** regex source for string settings */
  pattern: string | null;
  maxLength: number | null;
}

export interface SettingView {
  key: string;
  group: string;
  type: SettingType;
  label: string;
  description: string;
  unit: string | null;
  constraints: SettingConstraints;
  /** effective value right now */
  value: SettingValue;
  source: SettingSource;
  /** what a reset (DELETE) would give */
  fallbackValue: SettingValue;
  fallbackSource: Exclude<SettingSource, "panel">;
  /** code default */
  defaultValue: SettingValue;
  /** name of the fallback environment variable (name only, never its value) */
  envVar: string;
  updatedAt: string | null;
  updatedByAdminId: string | null;
}

export interface SettingsGroup {
  id: string;
  label: string;
  description: string;
  settings: SettingView[];
}

export interface SettingsResponse {
  groups: SettingsGroup[];
}

export interface GeminiModelOptionsResponse {
  /** model ids without the "models/" prefix */
  models: string[];
  /** null on success, a Turkish explanation when models is empty */
  reason: string | null;
  fetchedAt: string | null;
}

// ============================================
// REVIEW BEFORE PUBLISHING, BULK ACTIONS, COVERS
// ============================================

/** Credit of a cover picture (Story.coverCredit). */
export interface CoverCredit {
  illustrator?: string;
  licenseName?: string;
  licenseUrl?: string;
  source?: string;
  attribution?: string;
}

/** Field of the publish rule that is still missing (story-publish.rules.ts). */
export interface PublishMissingField {
  field: string;
  label: string;
}

/** One card of GET /admin/stories/review. */
export interface StoryReviewCard {
  id: string;
  title: string;
  language: string;
  status: StoryStatus;
  slug: string | null;
  content: string;
  summary: string | null;
  wordCount: number;
  category: string;
  categoryLabel: string;
  ageGroup: string;
  ageGroupLabel: string;
  languageLevel: string | null;
  /** ContentWarning values with their Turkish labels, enum order. */
  contentWarnings: Array<{ value: ContentWarning; label: string }>;
  estimatedDuration: number;
  isPremium: boolean;
  origin: string | null;
  textFidelity: string | null;
  rightsBasis: string | null;
  rightsNote: string | null;
  authorName: string | null;
  collectorName: string | null;
  translatorName: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  sourceEdition: string | null;
  licenseName: string | null;
  licenseUrl: string | null;
  attribution: string | null;
  translationMethod: string | null;
  isMachineTranslation: boolean;
  translatedFrom: { id: string; title: string; language: string } | null;
  translations: Array<{ id: string; title: string; language: string; status: StoryStatus; reviewed: boolean }>;
  parts: Array<{ id: string; title: string; number: number | null; status: StoryStatus }>;
  partNumber: number | null;
  segments: {
    count: number;
    source: string | null;
    version: number;
    emotions: Array<{ emotion: string | null; label: string; count: number }>;
  };
  coverImageUrl: string | null;
  coverCredit: CoverCredit | null;
  coverCreditLine: string | null;
  /** Cover of another language or part the app shows until this story has its own. */
  sharedCoverImageUrl: string | null;
  importBatch: string | null;
  importedAt: string | null;
  reviewed: boolean;
  reviewedAt: string | null;
  reviewedBy: string | null;
  publishable: boolean;
  publishMissing: PublishMissingField[];
  createdAt: string;
}

export interface ImportBatchSummary {
  batch: string | null;
  total: number;
  drafts: number;
  reviewed: number;
  published: number;
  firstImportedAt: string;
  lastImportedAt: string;
}

export interface BulkSkip {
  storyId: string;
  title: string | null;
  reason: string;
  missing?: string[];
}

export interface BulkStoryRef {
  id: string;
  title: string;
  language: string;
}

export interface BulkPublishResponse {
  published: BulkStoryRef[];
  skipped: BulkSkip[];
}

export interface BulkArchiveResponse {
  archived: BulkStoryRef[];
  skipped: BulkSkip[];
}

export interface BulkDeletePreview {
  stories: number;
  missing: string[];
  published: number;
  narrations: number;
  sharedAudios: number;
  favorites: number;
  playlistItems: number;
  collectionLinks: number;
  coverFiles: number;
  titles: Array<{ id: string; title: string; language: string; status: StoryStatus }>;
}

export interface BulkDeleteResponse {
  deleted: number;
  deletedIds: string[];
  failed: BulkSkip[];
  narrations: number;
}

/** PATCH /admin/stories/bulk/review. */
export interface BulkReviewResponse {
  reviewed: boolean;
  requested: number;
  /** Stories whose mark changed. */
  changed: number;
  /** Stories that already were in that state (their reviewer is kept). */
  unchanged: number;
  missing: string[];
}

/** One story of GET /admin/stories/ids: no text, only what a bulk action needs. */
export interface StoryIdItem {
  id: string;
  title: string;
  language: string;
  status: StoryStatus;
  reviewed: boolean;
  /** Passes the publish rule (attribution, licence and the like). */
  publishable: boolean;
}

/** GET /admin/stories/ids: every story matching the filters, at most `limit` (1000). */
export interface StoryIdsResponse {
  total: number;
  limit: number;
  /** More stories match than were returned. */
  truncated: boolean;
  items: StoryIdItem[];
}

/** Query of GET /admin/stories/ids: the list filters plus the view. */
export interface AdminStoryIdsQueryDto extends AdminStoriesQueryDto {
  /** "review": the review list defaults (imported drafts, import order). */
  view?: "list" | "review";
}

/** A tale found for a cover file (POST /admin/stories/covers/match). */
export interface CoverTale {
  /** The story the upload goes to (Turkish first, then part 1); the cover reaches the whole tale. */
  storyId: string;
  title: string;
  language: string;
  storyIds: string[];
  stories: Array<{ id: string; title: string; language: string; status: StoryStatus; partNumber: number | null; slug: string | null; hasCover: boolean }>;
  languages: string[];
  coverImageUrl: string | null;
  coverCreditLine: string | null;
}

export interface CoverMatchResult {
  key: string;
  status: "matched" | "ambiguous" | "none";
  via: "pairKey" | "partOf" | "slug" | "slugPrefix" | null;
  tale: CoverTale | null;
  candidates: CoverTale[];
}

export interface SetCoverResponse {
  storyId: string;
  coverImageUrl: string | null;
  coverCredit: CoverCredit | null;
  storyIds: string[];
  appliedTo: number;
}

// ============================================
// EMAIL TEMPLATES (/admin/email-templates)
// ============================================

export type EmailTemplateKind = "welcome" | "password_reset";

/** Text fields of one template. The HTML layout is the backend's; only these are editable. */
export interface EmailTemplateFields {
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  buttonLabel: string;
  note: string;
  footer: string;
}

export type EmailTemplateFieldKey = keyof EmailTemplateFields;

export interface EmailFieldSpec {
  key: EmailTemplateFieldKey;
  label: string;
  hint: string;
  maxLength: number;
  multiline: boolean;
  /** paragraphs and **bold** are applied */
  formatted: boolean;
  /** placeholders allowed in this field, without braces */
  placeholders: string[];
}

export interface EmailKindSpec {
  kind: EmailTemplateKind;
  label: string;
  description: string;
  linkDescription: string;
  buttonRequired: boolean;
}

export interface EmailTemplateView {
  kind: EmailTemplateKind;
  language: string;
  /** "custom" when a panel text is saved */
  source: "default" | "custom";
  fields: EmailTemplateFields;
  /** code default, what a reset gives */
  defaults: EmailTemplateFields;
  updatedAt: string | null;
  updatedByAdminId: string | null;
}

export interface EmailTemplatesResponse {
  kinds: EmailKindSpec[];
  languages: Array<{ code: string; label: string }>;
  fields: EmailFieldSpec[];
  placeholders: Array<{ key: string; label: string }>;
  templates: EmailTemplateView[];
}

export interface EmailTemplatePreview {
  kind: EmailTemplateKind;
  language: string;
  subject: string;
  html: string;
  text: string;
  /** Turkish problems that would keep this text from being saved */
  problems: string[];
}

export interface EmailTestResponse {
  sent: true;
  to: string;
  subject: string;
}
