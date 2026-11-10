import { api } from "@/lib/api";
import {
  // Auth
  AdminLoginDto,
  AdminAuthResponse,
  MessageResponse,

  // Users
  User,
  UserDetail,
  UserListQueryDto,
  UserStats,
  PaginatedResponse,

  // Stories
  StoryDetail,
  AdminStoryIdsQueryDto,
  AdminStoryListItem,
  BulkReviewResponse,
  StoryIdsResponse,
  AdminStoriesQueryDto,
  StoriesMeta,
  StoryCatalogueFields,
  StoryLlmTask,
  StoryLlmTaskRow,
  StoryLlmTasksQueryDto,
  TranslateBatchResponse,
  TranslationRequestRow,
  TranslationRequestsQueryDto,
  AssessLevelBatchResponse,
  CreateStoryDto,
  UpdateStoryDto,
  PaginationDto,
  StorySegment,
  StorySegmentPreview,
  StorySegmentsView,
  NarrationCacheSummary,
  NarrationCacheClearResult,
  ImportResult,
  LlmFillSegmentsResponse,
  StoryReviewCard,
  ImportBatchSummary,
  BulkPublishResponse,
  BulkArchiveResponse,
  BulkDeletePreview,
  BulkDeleteResponse,
  CoverMatchResult,
  CoverCredit,
  SetCoverResponse,

  // Analytics
  SystemStats,
  RecentActivity,
  UsageStats,
  ActivityQueryDto,

  // Finance
  PromoCode,
  CreatePromoCodeDto,
  GrantAccessDto,

  // Moderation
  ModerationVoiceProfile,
  ModerationListQueryDto,
  RejectVoiceDto,

  // Audio
  Audio,
  AudioListQueryDto,

  // Operations
  BroadcastDto,
  BroadcastResponse,
  MaintenanceModeResponse,

  // Collections
  Collection,
  CollectionListQueryDto,
  CollectionStoryItem,
  CreateCollectionDto,
  UpdateCollectionDto,
  AddStoriesDto,
  ReorderStoriesDto,

  // Legal
  LegalDocument,
  LegalDocumentVersion,
  LegalLanguage,
  LegalListLanguage,
  CreateLegalDocumentDto,
  UpdateLegalDocumentDto,

  // Storage
  StorageStats,
  OrphanedFile,
  DeleteOrphanResponse,

  // Runtime settings
  SettingsResponse,
  SettingView,
  SettingValue,
  GeminiModelOptionsResponse,

  // Email templates
  EmailTemplateFields,
  EmailTemplateKind,
  EmailTemplatePreview,
  EmailTemplatesResponse,
  EmailTemplateView,
  EmailTestResponse,
} from "@/types/api.types";

// ============================================
// AUTHENTICATION SERVICE
// ============================================

export const AuthService = {
  login: (data: AdminLoginDto) =>
    api.post<AdminAuthResponse>("/admin/auth/login", data),

  logout: () =>
    api.post<MessageResponse>("/admin/auth/logout"),
};

// ============================================
// ANALYTICS SERVICE
// ============================================

export const AnalyticsService = {
  getSystemStats: () =>
    api.get<SystemStats>("/admin/analytics/system"),

  getRecentActivity: (params?: ActivityQueryDto) =>
    api.get<RecentActivity>("/admin/analytics/activity", { params }),

  getUsageStats: () =>
    api.get<UsageStats>("/admin/analytics/usage"),
};

// ============================================
// USERS SERVICE
// ============================================

export const UsersService = {
  getStats: () =>
    api.get<UserStats>("/admin/users/stats"),

  getAll: (params?: UserListQueryDto) =>
    api.get<PaginatedResponse<User>>("/admin/users", { params }),

  getById: (id: string) =>
    api.get<UserDetail>(`/admin/users/${id}`),

  deactivate: (id: string) =>
    api.patch<MessageResponse>(`/admin/users/${id}/deactivate`),

  delete: (id: string) =>
    api.delete<MessageResponse>(`/admin/users/${id}`),
};

// ============================================
// STORIES SERVICE
// ============================================

// Catalogue fields are sent whenever the key is present, so an empty string
// reaches the backend and clears the column.
function appendCatalogue(formData: FormData, catalogue?: StoryCatalogueFields) {
  if (!catalogue) return;
  for (const [key, value] of Object.entries(catalogue)) {
    if (typeof value === "string") formData.append(key, value);
  }
}

export const StoriesService = {
  /** Rows without text and segments; open a story with getById for those. */
  getAll: (params?: AdminStoriesQueryDto) =>
    api.get<PaginatedResponse<AdminStoryListItem>>("/admin/stories", { params }),

  /** Every story matching the filters (at most 1000), small rows: "select every matching story". */
  getIds: (params?: AdminStoryIdsQueryDto) =>
    api.get<StoryIdsResponse>("/admin/stories/ids", { params, timeout: 60000 }),

  /** Languages, enum labels, sorts and publish rules the page renders from. */
  getMeta: () => api.get<StoriesMeta>("/admin/stories/meta"),

  getById: (id: string) =>
    api.get<StoryDetail>(`/admin/stories/${id}`),

  create: (data: CreateStoryDto) => {
    const formData = new FormData();
    formData.append("title", data.title);
    formData.append("content", data.content);
    formData.append("category", data.category);
    // Absent: the backend asks the AI for the age group.
    if (data.ageGroup) formData.append("ageGroup", data.ageGroup);
    if (typeof data.estimatedDuration === "number") {
      formData.append("estimatedDuration", data.estimatedDuration.toString());
    }

    if (data.language) formData.append("language", data.language);
    if (data.coverImageUrl) formData.append("coverImageUrl", data.coverImageUrl);
    if (data.isPremium !== undefined) formData.append("isPremium", data.isPremium.toString());
    if (data.coverImage) {
      formData.append("coverImage", data.coverImage);
      formData.append("applyCoverToTale", String(data.applyCoverToTale ?? true));
    }
    if (data.defaultEmotion) formData.append("defaultEmotion", data.defaultEmotion);
    if (typeof data.defaultSpeed === "number") formData.append("defaultSpeed", data.defaultSpeed.toString());
    if (data.cartesiaPronunciationDictId) formData.append("cartesiaPronunciationDictId", data.cartesiaPronunciationDictId);
    if (data.coverImage && data.coverCredit) formData.append("coverCredit", JSON.stringify(data.coverCredit));
    appendCatalogue(formData, data.catalogue);

    return api.post<StoryDetail>("/admin/stories", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  update: (id: string, data: UpdateStoryDto) => {
    const formData = new FormData();

    if (data.title) formData.append("title", data.title);
    if (data.content) formData.append("content", data.content);
    if (data.category) formData.append("category", data.category);
    if (data.ageGroup) formData.append("ageGroup", data.ageGroup);
    if (data.estimatedDuration) formData.append("estimatedDuration", data.estimatedDuration.toString());
    if (data.language) formData.append("language", data.language);
    if (data.coverImageUrl) formData.append("coverImageUrl", data.coverImageUrl);
    if (data.isPremium !== undefined) formData.append("isPremium", data.isPremium.toString());
    if (data.coverImage) {
      formData.append("coverImage", data.coverImage);
      formData.append("applyCoverToTale", String(data.applyCoverToTale ?? true));
    }
    if (data.defaultEmotion) formData.append("defaultEmotion", data.defaultEmotion);
    if (typeof data.defaultSpeed === "number") formData.append("defaultSpeed", data.defaultSpeed.toString());
    if (data.cartesiaPronunciationDictId) formData.append("cartesiaPronunciationDictId", data.cartesiaPronunciationDictId);
    // null clears the credit of the current cover; with a new file it goes with that file.
    if (data.coverCredit !== undefined) {
      formData.append("coverCredit", data.coverCredit ? JSON.stringify(data.coverCredit) : "");
    }
    appendCatalogue(formData, data.catalogue);

    return api.patch<StoryDetail>(`/admin/stories/${id}`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  delete: (id: string) =>
    api.delete<MessageResponse>(`/admin/stories/${id}`),

  // Phase 2A: Cartesia segment editor surface
  previewSegments: (id: string) =>
    api.get<StorySegmentPreview>(`/admin/stories/${id}/segment-preview`),

  /** Stored segments with tags, version, source, vocabulary and cache summary. */
  getSegments: (id: string) =>
    api.get<StorySegmentsView>(`/admin/stories/${id}/segments`),

  /**
   * Replaces the segments. Bumps the segmentation version and clears the
   * story's narration cache. `expectedVersion`: 409 SEGMENTS_VERSION_CONFLICT
   * when the segments changed since the editor loaded them.
   */
  updateSegments: (id: string, segments: StorySegment[], expectedVersion?: number) =>
    api.patch<StorySegmentsView>(`/admin/stories/${id}/segments`, {
      segments,
      ...(typeof expectedVersion === "number" ? { expectedVersion } : {}),
    }),

  /** How many narrations / audio rows / files the story has (every user). */
  getNarrationCache: (id: string) =>
    api.get<NarrationCacheSummary>(`/admin/stories/${id}/narration-cache`),

  /** Deletes the stored audio of every narration of the story. */
  clearNarrationCache: (id: string) =>
    api.delete<NarrationCacheClearResult>(`/admin/stories/${id}/narration-cache`),

  /**
   * Bulk import (DRAFT stories, no LLM / TTS). dryRun validates only.
   * `batch` labels the stories for the review view (the panel sends the file name).
   */
  importStories: (stories: Record<string, unknown>[], dryRun = false, batch?: string) =>
    api.post<ImportResult>(
      "/admin/stories/import",
      { stories, dryRun, ...(batch ? { batch } : {}) },
      { timeout: 120000 },
    ),

  // ----- Review before publishing, bulk actions, covers -----

  /** Review cards (defaults: imported drafts in import order). */
  getReviewList: (params?: AdminStoriesQueryDto) =>
    api.get<PaginatedResponse<StoryReviewCard>>("/admin/stories/review", { params }),

  getImportBatches: () => api.get<{ batches: ImportBatchSummary[] }>("/admin/stories/import-batches"),

  setReviewed: (id: string, reviewed: boolean) =>
    api.patch<{ id: string; reviewed: boolean; reviewedAt: string | null; reviewedBy: string | null }>(
      `/admin/stories/${id}/review`,
      { reviewed },
    ),

  /** Marks up to 1000 stories "İncelendi" or takes the mark away. */
  bulkReview: (storyIds: string[], reviewed: boolean) =>
    api.patch<BulkReviewResponse>("/admin/stories/bulk/review", { storyIds, reviewed }, { timeout: 120000 }),

  bulkPublish: (storyIds: string[], requireReviewed: boolean) =>
    api.post<BulkPublishResponse>("/admin/stories/bulk/publish", { storyIds, requireReviewed }, { timeout: 120000 }),

  bulkArchive: (storyIds: string[]) =>
    api.post<BulkArchiveResponse>("/admin/stories/bulk/archive", { storyIds }),

  /** What a bulk delete removes; writes nothing. */
  bulkDeletePreview: (storyIds: string[]) =>
    api.post<BulkDeletePreview>("/admin/stories/bulk/delete-preview", { storyIds }),

  bulkDelete: (storyIds: string[], expectedCount: number, confirm: string) =>
    api.post<BulkDeleteResponse>(
      "/admin/stories/bulk/delete",
      { storyIds, expectedCount, confirm },
      { timeout: 300000 },
    ),

  /** File names (without extension) to tales; writes nothing. */
  matchCovers: (keys: string[]) =>
    api.post<{ results: CoverMatchResult[] }>("/admin/stories/covers/match", { keys }, { timeout: 120000 }),

  /** Uploads a cover with its credit; applyCoverToTale (default true) reaches every language and part. */
  setCover: (id: string, file: File, options: { coverCredit?: CoverCredit | null; applyCoverToTale?: boolean } = {}) => {
    const formData = new FormData();
    formData.append("coverImage", file);
    formData.append("applyCoverToTale", String(options.applyCoverToTale ?? true));
    if (options.coverCredit && Object.keys(options.coverCredit).length > 0) {
      formData.append("coverCredit", JSON.stringify(options.coverCredit));
    }
    return api.post<SetCoverResponse>(`/admin/stories/${id}/cover`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 120000,
    });
  },

  clearSegments: (id: string) =>
    api.delete<StoryDetail>(`/admin/stories/${id}/segments`),

  // Phase 2B: Gemini LLM-based auto-fill. Returns segments + warnings, does
  // NOT persist — caller decides whether to save via updateSegments().
  llmFillSegments: (id: string) =>
    api.post<LlmFillSegmentsResponse>(`/admin/stories/${id}/segments/llm-fill`),

  // ----- Translation groups -----

  /** Puts both stories (and the groups they already belong to) into one group. */
  linkTranslation: (id: string, otherStoryId: string) =>
    api.post<StoryDetail>(`/admin/stories/${id}/link-translation`, { otherStoryId }),

  /** Takes the story out of its group. `translatedFromId` is kept. */
  unlinkTranslation: (id: string) =>
    api.delete<StoryDetail>(`/admin/stories/${id}/translation-link`),

  // ----- Background LLM tasks (202 with a task; poll getLlmTasks) -----

  translate: (id: string, targetLanguage: string, replaceDraft = false) =>
    api.post<StoryLlmTask>(`/admin/stories/${id}/translate`, {
      targetLanguage,
      ...(replaceDraft ? { replaceDraft: true } : {}),
    }),

  translateBatch: (storyIds: string[], targetLanguage: string) =>
    api.post<TranslateBatchResponse>("/admin/stories/translate-batch", {
      storyIds,
      targetLanguage,
    }),

  assessLevel: (id: string, force = false) =>
    api.post<StoryLlmTask>(`/admin/stories/${id}/level/assess`, force ? { force: true } : {}),

  assessLevelBatch: (storyIds: string[], onlyMissing: boolean) =>
    api.post<AssessLevelBatchResponse>("/admin/stories/level/assess-batch", {
      storyIds,
      onlyMissing,
    }),

  /** An age group chosen by hand answers 409 AGE_GROUP_IS_MANUAL unless forced. */
  assessAgeGroup: (id: string, force = false) =>
    api.post<StoryLlmTask>(`/admin/stories/${id}/age-group/assess`, force ? { force: true } : {}),

  /** Translation requests of users, aggregated by tale and language, most requested first. */
  getTranslationRequests: (params?: TranslationRequestsQueryDto) =>
    api.get<PaginatedResponse<TranslationRequestRow>>("/admin/stories/translation-requests", { params }),

  getLlmTasks: (params?: StoryLlmTasksQueryDto) =>
    api.get<PaginatedResponse<StoryLlmTaskRow>>("/admin/stories/llm-tasks", { params }),
};

// ============================================
// FINANCE SERVICE
// ============================================

export const FinanceService = {
  createPromoCode: (data: CreatePromoCodeDto) =>
    api.post<PromoCode>("/admin/finance/promocodes", data),

  getPromoCodes: () =>
    api.get<PromoCode[]>("/admin/finance/promocodes"),

  grantAccess: (data: GrantAccessDto) =>
    api.post<MessageResponse>("/admin/finance/grant-access", data),
};

// ============================================
// MODERATION SERVICE
// ============================================

// Voice-profile monitor. There is no approve step: voices go live when the
// provider finishes cloning. Reject marks the profile FAILED and notifies
// the owner.
export const ModerationService = {
  listVoiceProfiles: (params?: ModerationListQueryDto) =>
    api.get<PaginatedResponse<ModerationVoiceProfile>>(
      "/admin/moderation/voice-profiles",
      { params },
    ),

  rejectVoice: (id: string, data?: RejectVoiceDto) =>
    api.post<MessageResponse>(`/admin/moderation/${id}/reject`, data ?? {}),
};

// ============================================
// OPERATIONS SERVICE
// ============================================

export const OpsService = {
  sendBroadcast: (data: BroadcastDto) =>
    api.post<BroadcastResponse>("/admin/ops/data/broadcast", data),

  toggleMaintenance: (enabled: boolean) =>
    api.post<MaintenanceModeResponse>("/admin/ops/system/maintenance", { enabled }),

  getMaintenanceStatus: () =>
    api.get<MaintenanceModeResponse>("/admin/ops/system/maintenance"),

  /**
   * Run a full Cartesia voice clone test: upload an audio sample, clone the
   * voice, then narrate an existing Story end-to-end through the production
   * pipeline (segment fan-out, per-segment emotion/speed/volume, ffmpeg
   * merge). Backend returns the raw + preprocessed clip URLs, the merged
   * narration URL, and per-segment metadata so the admin can audit how
   * each segment came out. The temporary VoiceProfile + upstream voice id
   * are deleted server-side as soon as the merge completes.
   */
  voiceCloneTest: (
    audio: File,
    storyId: string,
    options?: { skipPreprocessing?: boolean },
  ) => {
    const fd = new FormData();
    fd.append("audio", audio);
    fd.append("storyId", storyId);
    if (options?.skipPreprocessing) {
      fd.append("skipPreprocessing", "true");
    }
    return api.post<VoiceCloneTestResult>(
      "/admin/ops/voice-clone-test",
      fd,
      {
        headers: { "Content-Type": "multipart/form-data" },
        // Real story narration can take 1-3 min depending on segment count
        // (Cartesia clone ~10-20s + per-segment TTS + ffmpeg merge). Pad
        // generously so the request doesn't time out before the backend
        // finishes — the backend itself caps at 5 min internally.
        timeout: 6 * 60 * 1000,
      },
    );
  },
};

export interface VoiceCloneTestSegmentResult {
  index: number;
  content: string;
  emotion: string | null;
  speed: number | null;
  volume: number | null;
  status: string;
}

export interface VoiceCloneTestResult {
  jobId: string;
  storyId: string;
  storyTitle: string;
  rawUrl: string;
  processedUrl: string;
  /** Final merged narration. Null if generation timed out or failed. */
  finalAudioUrl: string | null;
  audioId: string;
  audioStatus: string;
  segmentCount: number;
  segments: VoiceCloneTestSegmentResult[];
  durationMs: {
    preprocess: number;
    cloneCreate: number;
    narration: number;
    total: number;
  };
}

// ============================================
// AUDIO SERVICE
// ============================================

export const AudioService = {
  getAll: (params?: AudioListQueryDto) =>
    api.get<PaginatedResponse<Audio>>("/admin/audio", { params }),

  delete: (id: string) =>
    api.delete<MessageResponse>(`/admin/audio/${id}`),
};

// ============================================
// COLLECTIONS SERVICE
// ============================================
// Everything goes through `/admin/collections/*`. The admin list includes
// inactive collections (unlike the public `/collections` surface).

export const CollectionsService = {
  getAll: (params?: CollectionListQueryDto) =>
    api.get<PaginatedResponse<Collection>>("/admin/collections", { params }),

  getStories: (id: string, params?: PaginationDto) =>
    api.get<PaginatedResponse<CollectionStoryItem>>(
      `/admin/collections/${id}/stories`,
      { params },
    ),

  create: (data: CreateCollectionDto) =>
    api.post<Collection>("/admin/collections", data),

  update: (id: string, data: UpdateCollectionDto) =>
    api.patch<Collection>(`/admin/collections/${id}`, data),

  delete: (id: string) =>
    api.delete<MessageResponse>(`/admin/collections/${id}`),

  addStories: (id: string, data: AddStoriesDto) =>
    api.post<MessageResponse>(`/admin/collections/${id}/stories`, data),

  removeStory: (id: string, storyId: string) =>
    api.delete<MessageResponse>(`/admin/collections/${id}/stories/${storyId}`),

  reorderStories: (id: string, data: ReorderStoriesDto) =>
    api.patch<MessageResponse>(`/admin/collections/${id}/reorder`, data),
};

// ============================================
// LEGAL DOCUMENTS SERVICE
// ============================================

// A document is (slug, language). Every route takes ?language=tr|en and the
// list also takes all. The backend reads an absent language as tr; the panel
// always sends one so no call silently lands on the Turkish document.
export const LegalService = {
  list: (language: LegalListLanguage = "all") =>
    api.get<LegalDocument[]>("/admin/legal", { params: { language } }),

  getBySlug: (slug: string, language: LegalLanguage) =>
    api.get<LegalDocument>(`/admin/legal/${encodeURIComponent(slug)}`, {
      params: { language },
    }),

  getVersions: (slug: string, language: LegalLanguage) =>
    api.get<LegalDocumentVersion[]>(
      `/admin/legal/${encodeURIComponent(slug)}/versions`,
      { params: { language } },
    ),

  create: (data: CreateLegalDocumentDto) =>
    api.post<LegalDocument>("/admin/legal", data),

  update: (slug: string, language: LegalLanguage, data: UpdateLegalDocumentDto) =>
    api.patch<LegalDocument>(`/admin/legal/${encodeURIComponent(slug)}`, data, {
      params: { language },
    }),

  publish: (slug: string, language: LegalLanguage) =>
    api.post<LegalDocument>(
      `/admin/legal/${encodeURIComponent(slug)}/publish`,
      undefined,
      { params: { language } },
    ),
};

// ============================================
// STORAGE SERVICE
// ============================================
// Wraps /admin/storage/* — stats, orphan listing, and orphan deletion.
// The DELETE endpoint takes a GCS key which can contain slashes, so we
// encodeURIComponent it before embedding into the path.

export const StorageService = {
  getStats: () =>
    api.get<StorageStats>("/admin/storage/stats"),

  getOrphans: (page = 1, limit = 20) =>
    api.get<PaginatedResponse<OrphanedFile>>("/admin/storage/orphans", {
      params: { page, limit },
    }),

  deleteOrphan: (key: string) =>
    api.delete<DeleteOrphanResponse>(
      `/admin/storage/orphans/${encodeURIComponent(key)}`,
    ),
};

// ============================================
// RUNTIME SETTINGS SERVICE
// ============================================
// Reads: SUPER_ADMIN + ADMIN. Writes (update, reset): SUPER_ADMIN only.

export const SettingsService = {
  getAll: () => api.get<SettingsResponse>("/admin/settings"),

  /** All or nothing: one invalid key or value and nothing is written. */
  update: (values: Record<string, SettingValue>) =>
    api.patch<SettingsResponse>("/admin/settings", { values }),

  /** Removes the panel override; the setting falls back to env, then code default. */
  reset: (key: string) =>
    api.delete<SettingView>(`/admin/settings/${encodeURIComponent(key)}`),

  /** Always 200. An empty list comes with a `reason`. */
  getGeminiModels: () =>
    api.get<GeminiModelOptionsResponse>("/admin/settings/options/gemini-models"),
};

// ============================================
// EMAIL TEMPLATES (admin-ops)
// Reads and preview: SUPER_ADMIN, ADMIN. Save, reset, test email: SUPER_ADMIN.
// ============================================

const emailTemplatePath = (kind: EmailTemplateKind, language: string) =>
  `/admin/email-templates/${encodeURIComponent(kind)}/${encodeURIComponent(language)}`;

export const EmailTemplatesService = {
  getAll: () => api.get<EmailTemplatesResponse>("/admin/email-templates"),

  get: (kind: EmailTemplateKind, language: string) =>
    api.get<EmailTemplateView>(emailTemplatePath(kind, language)),

  /** Whole text. 400 EMAIL_TEMPLATE_INVALID with problems[] when it breaks a rule. */
  save: (kind: EmailTemplateKind, language: string, fields: EmailTemplateFields) =>
    api.put<EmailTemplateView>(emailTemplatePath(kind, language), fields),

  /** Back to the code default. */
  reset: (kind: EmailTemplateKind, language: string) =>
    api.delete<EmailTemplateView>(emailTemplatePath(kind, language)),

  /** Rendered with sample values; the draft fields replace the saved text. Problems are reported, not thrown. */
  preview: (kind: EmailTemplateKind, language: string, draft: Partial<EmailTemplateFields>) =>
    api.post<EmailTemplatePreview>(`${emailTemplatePath(kind, language)}/preview`, draft),

  /** Sends the draft (or saved) text to `to` with a [Test] subject. 503 when Resend is not configured. */
  sendTest: (kind: EmailTemplateKind, language: string, to: string, draft: Partial<EmailTemplateFields>) =>
    api.post<EmailTestResponse>(`${emailTemplatePath(kind, language)}/test`, { ...draft, to }),
};
