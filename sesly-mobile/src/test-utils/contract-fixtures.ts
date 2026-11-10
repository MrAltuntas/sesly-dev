/**
 * Backend contract fixtures.
 *
 * JSON exactly as the NestJS backend (E:/Coding/sesly-base/sesly-backend)
 * puts it on the wire: Date fields are ISO strings, optional relations are
 * null, and every field the mapper emits is present (including the ones
 * mobile ignores). Each fixture names the backend function it mirrors.
 *
 * How to use when the backend contract changes:
 *   1. Update the fixture here to the new wire shape (rename / add / drop).
 *   2. Run `npx jest src/models/contract.test.ts`.
 *   3. The failing case names the mobile parser that no longer reads the
 *      field; fix the parser (never shim the backend).
 *
 * Keep fixtures JSON-only (no Date objects, no undefined) so `cloneFixture`
 * can deep-copy them and tests can mutate copies freely.
 */

export const ISO_CREATED = '2026-09-20T18:30:00.000Z';
export const ISO_UPDATED = '2026-09-27T19:45:00.000Z';
export const ISO_COMPLETED = '2026-09-27T19:47:12.000Z';
export const ISO_PERIOD_START = '2026-09-01T00:00:00.000Z';
export const ISO_PERIOD_END = '2026-10-01T00:00:00.000Z';

/** Deep copy of a JSON fixture, so a test can delete/rename fields. */
export function cloneFixture<T>(fixture: T): T {
  return JSON.parse(JSON.stringify(fixture)) as T;
}

// ============================================================================
// Auth + users
// ============================================================================

/** users/dto/user-response.dto.ts UserResponseDto.fromUser (GET /users/me). */
export const backendUser = {
  id: '6b1f3c2e-8d4a-4f7b-9a51-2c7e0d9b1a01',
  email: 'ayse.yilmaz@example.com',
  firstName: 'Ayşe',
  lastName: 'Yılmaz',
  provider: 'GOOGLE',
  emailVerified: true,
  avatarUrl: 'https://storage.googleapis.com/sesly-avatars/u-1.jpg?X-Goog-Signature=abc',
  profileImageUrl: 'https://storage.googleapis.com/sesly-avatars/u-1.jpg?X-Goog-Signature=abc',
  subscriptionTier: 'PRO',
  subscriptionExpiresAt: ISO_PERIOD_END,
  createdAt: ISO_CREATED,
  updatedAt: ISO_UPDATED,
};

/**
 * auth/auth.service.ts createAuthResponse (POST /auth/firebase/verify).
 * Note: no `avatarUrl`, and subscriptionTier is null when the user has no
 * subscription row yet.
 */
export const backendAuthResponse = {
  accessToken: 'eyJhbGciOiJIUzI1NiJ9.access.sig',
  refreshToken: 'eyJhbGciOiJIUzI1NiJ9.refresh.sig',
  user: {
    id: '6b1f3c2e-8d4a-4f7b-9a51-2c7e0d9b1a01',
    email: 'ayse.yilmaz@example.com',
    firstName: 'Ayşe',
    lastName: 'Yılmaz',
    emailVerified: true,
    provider: 'APPLE',
    profileImageUrl: null,
    subscriptionTier: null,
    subscriptionExpiresAt: null,
    createdAt: ISO_CREATED,
    updatedAt: ISO_UPDATED,
  },
};

/** users/users.service.ts uploadAvatar (POST /users/me/avatar). */
export const backendAvatarUpload = {
  message: 'Avatar uploaded successfully',
  avatarUrl: 'https://storage.googleapis.com/sesly-avatars/u-1-new.jpg?X-Goog-Signature=def',
  profileImageUrl: 'https://storage.googleapis.com/sesly-avatars/u-1-new.jpg?X-Goog-Signature=def',
};

/** users/users.service.ts getStats (GET /users/me/stats). */
export const backendUserStats = {
  storiesCompleted: 12,
  hoursListened: 3.4,
  voicesTrained: 2,
};

/** Prisma UserPreferences row (GET /users/me/preferences). */
export const backendUserPreferences = {
  userId: '6b1f3c2e-8d4a-4f7b-9a51-2c7e0d9b1a01',
  sleepTimerFadeOut: false,
  sleepTimerPauseWhenAsleep: true,
  sleepTimerLastDuration: 20,
  voiceReadyNotifications: true,
  narrationReadyNotifications: false,
  promoNotifications: true,
  settings: { playbackSpeed: 1.25, autoplay: true },
  createdAt: ISO_CREATED,
  updatedAt: ISO_UPDATED,
};

// ============================================================================
// Stories
// ============================================================================

/** stories/story-list.mapper.ts toStoryListItem (GET /stories items). */
export const backendStoryListItem = {
  id: 'c0a8012e-0000-4000-8000-000000000001',
  title: 'Keloğlan ile Dev',
  description:
    'Keloğlan bir sabah annesine veda edip ormana doğru yola koyulmuş. Yolda karşılaştığı dev, ona üç soru sormuş ve cevap veremezse...',
  ageGroup: 'THREE_TO_SIX',
  summary: 'Keloğlan, ormanda karşılaştığı devin üç sorusunu aklıyla yanıtlar.',
  category: 'TURKISH_CLASSICS',
  language: 'tr',
  languageLevel: 'A2',
  estimatedDuration: 7,
  coverImageUrl: 'https://storage.googleapis.com/sesly-covers/keloglan.jpg?X-Goog-Signature=abc',
  isPremium: true,
  hasPreGeneratedNarration: false,
  isFavorite: true,
  credit: {
    originalTitle: null,
    originalLanguage: 'tr',
    authorName: null,
    authorDeathYear: null,
    collectorName: 'Pertev Naili Boratav',
    collectorDeathYear: 1998,
    translatorName: null,
    translatorDeathYear: null,
    adaptedBy: 'Sesly Yayın Kurulu',
    firstPublishedYear: 1946,
    editionYear: null,
    sourceName: 'Az Gittik Uz Gittik',
    sourceUrl: null,
    origin: 'Anadolu halk masalı',
    textFidelity: 'ADAPTED',
    translationMethod: null,
    attribution: null,
    licenseName: null,
    licenseUrl: null,
    coverCredit: null,
  },
  isMachineTranslation: false,
  contentWarnings: ['OLD_LANGUAGE'],
  coverKey: '5f2c9a1d0b7e4c33',
  createdAt: ISO_CREATED,
  updatedAt: ISO_UPDATED,
};

/** common/utils/pagination.helper.ts createPaginatedResponse (GET /stories). */
export const backendStoryPage = {
  data: [
    backendStoryListItem,
    {
      ...backendStoryListItem,
      id: 'c0a8012e-0000-4000-8000-000000000002',
      title: 'Uykucu Ayı',
      description: '',
      ageGroup: 'ZERO_TO_THREE',
      category: 'BEDTIME',
      estimatedDuration: 4,
      coverImageUrl: null,
      isPremium: false,
      isFavorite: false,
    },
  ],
  total: 42,
  page: 2,
  limit: 20,
  totalPages: 3,
};

/**
 * stories/stories.service.ts getStory (GET /stories/:id): the list-item
 * shape plus `translations`; no chunks, no content, no userProgress.
 */
export const backendStoryDetail = {
  ...backendStoryListItem,
  /** stories.service.ts getTranslations: other published language versions. */
  translations: [
    { id: 'c0a8012e-0000-4000-8000-0000000000e1', language: 'en', title: 'Keloglan and the Giant' },
    { id: 'c0a8012e-0000-4000-8000-0000000000d1', language: 'de', title: 'Keloglan und der Riese' },
  ],
  /** story-translation-source.ts: null for a story that is not a translation. */
  translation: null,
  /** story-parts.ts: null for a single-part story. */
  part: null,
};

/** GET /stories/:id of the second of three parts (story-parts.ts loadStoryPart). */
export const backendStoryPartDetail = {
  ...backendStoryDetail,
  id: 'c0a8012e-0000-4000-8000-0000000000f2',
  part: {
    number: 2,
    total: 3,
    next: { id: 'c0a8012e-0000-4000-8000-0000000000f3', title: 'Keloğlan ile Dev, Bölüm 3', number: 3 },
    previous: { id: 'c0a8012e-0000-4000-8000-0000000000f1', title: 'Keloğlan ile Dev, Bölüm 1', number: 1 },
  },
};

/**
 * GET /stories/:id of a text we translated with AI (CC BY original): the
 * licence credit and `translation` with the published original.
 */
export const backendMachineTranslatedStoryDetail = {
  ...backendStoryDetail,
  id: 'c0a8012e-0000-4000-8000-0000000000e1',
  title: 'Keloglan and the Giant',
  language: 'en',
  credit: {
    ...backendStoryListItem.credit,
    textFidelity: 'TRANSLATED',
    translationMethod: 'MACHINE',
    attribution: 'Keloğlan ile Dev, Sesly, CC BY 4.0',
    licenseName: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  isMachineTranslation: true,
  translations: [{ id: 'c0a8012e-0000-4000-8000-000000000001', language: 'tr', title: 'Keloğlan ile Dev' }],
  translation: {
    isMachineTranslation: true,
    method: 'MACHINE',
    fromLanguage: 'tr',
    original: { id: 'c0a8012e-0000-4000-8000-000000000001', title: 'Keloğlan ile Dev', language: 'tr' },
  },
};

// ============================================================================
// Voice profiles
// ============================================================================

/** voice-profiles/voice-profile.mapper.ts toPublicVoiceProfile, a PRESET. */
export const backendPresetVoiceProfile = {
  id: 'vp-preset-0001',
  userId: '6b1f3c2e-8d4a-4f7b-9a51-2c7e0d9b1a01',
  name: 'Masalcı Deniz',
  profileIcon: 'mic',
  provider: 'GOOGLE',
  kind: 'PRESET',
  voiceId: 'tr-TR-Chirp3-HD-Achernar',
  language: 'tr-TR',
  contentLanguage: 'tr',
  status: 'READY',
  isPremium: true,
  errorMessage: null,
  errorReason: null,
  sampleAudioUrl: null,
  consentAt: null,
  createdAt: ISO_CREATED,
  updatedAt: ISO_UPDATED,
};

/** toPublicVoiceProfile, a CLONE that failed training. */
export const backendFailedCloneVoiceProfile = {
  id: 'vp-clone-0002',
  userId: '6b1f3c2e-8d4a-4f7b-9a51-2c7e0d9b1a01',
  name: 'Annemin Sesi',
  profileIcon: null,
  provider: 'CARTESIA',
  kind: 'CLONE',
  voiceId: 'pending-vp-clone-0002',
  language: 'tr',
  contentLanguage: 'tr',
  status: 'FAILED',
  isPremium: false,
  errorMessage: 'Ses hazırlanırken bir sorun oluştu. Lütfen tekrar dene.',
  errorReason: null,
  sampleAudioUrl: 'https://storage.googleapis.com/sesly-voices/vp-clone-0002/sample.mp3',
  consentAt: '2026-09-27T19:40:00.000Z',
  createdAt: ISO_CREATED,
  updatedAt: ISO_UPDATED,
};

/** voice-profiles.controller POST /voice-profiles/v2. */
export const backendCreateVoiceProfileResponse = {
  profile: {
    ...backendPresetVoiceProfile,
    id: 'vp-clone-0003',
    name: 'Babamın Sesi',
    provider: 'CARTESIA',
    kind: 'CLONE',
    voiceId: 'custom-cloning-pending',
    status: 'PENDING',
    isPremium: false,
  },
  availableVoices: [],
};

/** voice-profiles/clone-config.constants.ts buildCloneConfig (text shortened). */
export const backendCloneConfig = {
  enabled: true,
  provider: 'CARTESIA',
  language: 'tr',
  // Served since the voice languages change: the locale of `language` and
  // the languages a voice can be recorded in.
  locale: 'tr-TR',
  supportedLanguages: [
    { code: 'tr', locale: 'tr-TR', nativeName: 'Türkçe', englishName: 'Turkish' },
    { code: 'en', locale: 'en-US', nativeName: 'English', englishName: 'English' },
  ],
  minSeconds: 15,
  targetSeconds: 30,
  maxSeconds: 60,
  scriptTitle: 'Yıldızlı Bir Gece',
  script:
    'Akşam olunca köyün üstüne yumuşak bir sessizlik çöker.\n\nAnnesi ona ılık bir süt getirir.\n\nAy yavaşça yükselir.',
  consentVersion: '2026-09-v1',
  consentTitle: 'Sesin için açık rıza',
  consentText:
    'Sesly, masalları senin sesinle anlatabilmek için ses kaydından sesinin yapay bir kopyasını oluşturur.\n\nOnayladığında açık rıza vermiş olursun.',
  // Served since 2026-09-28 (mobile falls back to built-in copy without them).
  introSteps: [
    { title: 'Sessiz bir yer bul', body: 'Kayıt yaklaşık yarım dakika sürer.' },
    { title: 'Metni oku', body: 'Ekrandaki masalı sakin bir sesle oku.' },
  ],
  recordingTips: [
    { icon: 'quiet', text: 'Sessiz bir odada kaydet.' },
    { icon: 'distance', text: 'Telefonu ağzından bir karış uzakta tut.' },
  ],
};

/** app-config (GET /app/config, public): force-update gate. */
export const backendAppConfig = {
  minSupportedVersion: { android: '1.0.5', ios: '1.0.5' },
  latestVersion: { android: '1.0.8', ios: '1.0.8' },
  storeUrl: {
    android: 'https://play.google.com/store/apps/details?id=com.sesly',
    ios: 'https://apps.apple.com/app/id000000000',
  },
  updateMessage: "Sesly'nin yeni sürümü hazır. Devam etmek için uygulamayı güncelle.",
};

/** auth.service.ts verifyFirebaseToken: e-mail owned by another sign-in method. */
export const backendEmailInUseError = {
  success: false,
  statusCode: 409,
  code: 'EMAIL_IN_USE',
  message: 'Bu e-posta adresi başka bir giriş yöntemiyle kayıtlı.',
  path: '/auth/firebase/verify',
  method: 'POST',
};

/**
 * voice-profiles/clone-quota.ts buildVoiceSlotInfo (GET /voice-profiles/slots),
 * FREE with 2 narrators and 1 own voice, its one lifetime creation used. The
 * legacy monthlyCreated / monthlyLimit carry the lifetime numbers on FREE.
 */
export const backendVoiceSlots = {
  plan: 'FREE',
  totalSlots: 4,
  usedSlots: 3,
  availableSlots: 1,
  extraSlots: 0,
  canCreate: true,
  preset: { used: 2, limit: 3, canCreate: true },
  clone: {
    used: 1,
    limit: 1,
    canCreate: false,
    monthlyCreated: 1,
    monthlyLimit: 1,
    creations: { used: 1, limit: 1, period: 'lifetime', renewsAt: null, canCreate: false },
  },
};

/** voice-profiles.service.ts getVoiceProfileStatus (GET /voice-profiles/:id/status). */
export const backendVoiceProfileStatus = {
  id: 'vp-clone-0003',
  name: 'Babamın Sesi',
  status: 'PROCESSING',
  progress: 0,
  provider: 'CARTESIA',
  kind: 'CLONE',
  voiceId: 'pending-vp-clone-0003',
  contentLanguage: 'tr',
  sampleAudioUrl: null,
  consentAt: '2026-09-27T19:40:00.000Z',
  createdAt: ISO_CREATED,
  updatedAt: ISO_UPDATED,
  errorMessage: null,
};

/**
 * voice-profiles.service.ts getAvailableVoices without a provider filter:
 * object keyed by lowercased provider name; cartesia is always empty.
 */
export const backendAvailableVoices = {
  google: [
    {
      id: 'tr-TR-Chirp3-HD-Achernar',
      name: 'Achernar (HD)',
      language: 'Turkish',
      languageCode: 'tr-TR',
      gender: 'female',
      description: 'Ultra yüksek kalite, stüdyo sesi (Chirp 3 HD)',
      provider: 'GOOGLE',
      isPremium: true,
    },
    {
      id: 'tr-TR-Standard-A',
      name: 'Standard A',
      language: 'Turkish',
      languageCode: 'tr-TR',
      gender: 'female',
      description: 'Standart kalite ses',
      provider: 'GOOGLE',
      isPremium: false,
    },
  ],
  cartesia: [],
};

/** POST /voice-profiles/preview. */
export const backendVoicePreview = {
  audioUrl: 'https://storage.googleapis.com/sesly-previews/tr-TR-Standard-A.mp3',
  voiceId: 'tr-TR-Standard-A',
  provider: 'GOOGLE',
  cached: true,
};

// ============================================================================
// Narrations
// ============================================================================

/** narrations/narrations.service.ts toResponse (POST /narrations, GET /narrations/:id). */
export const backendNarration = {
  id: 'nar-0001',
  userId: '6b1f3c2e-8d4a-4f7b-9a51-2c7e0d9b1a01',
  title: 'Keloğlan ile Dev',
  status: 'READY',
  storyId: backendStoryListItem.id,
  voiceProfileId: backendPresetVoiceProfile.id,
  audioId: 'aud-0001',
  story: backendStoryListItem,
  voiceProfile: backendPresetVoiceProfile,
  errorMessage: null,
  totalDuration: 312,
  duration: 312,
  progress: 100,
  audioStatus: 'READY',
  // narrations describeNarrationLanguage: on every narration response.
  voiceLanguage: 'tr',
  storyLanguage: 'tr',
  languageMismatch: false,
  nativeVoiceUsed: false,
  createdAt: ISO_CREATED,
  updatedAt: ISO_UPDATED,
  completedAt: ISO_COMPLETED,
};

/** GET /narrations (PaginationHelper envelope around toResponse items). */
export const backendNarrationPage = {
  data: [
    backendNarration,
    {
      ...backendNarration,
      id: 'nar-0002',
      status: 'GENERATING',
      audioStatus: 'PROCESSING',
      totalDuration: 0,
      duration: null,
      progress: 40,
      completedAt: null,
    },
  ],
  total: 21,
  page: 1,
  limit: 20,
  totalPages: 2,
};

/** narrations.service.ts getGenerationStatus (GET /narrations/:id/status). */
export const backendNarrationStatus = {
  id: 'nar-0002',
  status: 'GENERATING',
  progress: 40,
  duration: null,
  errorMessage: null,
  updatedAt: ISO_UPDATED,
};

// ============================================================================
// Realtime (Socket.io /notifications namespace)
// ============================================================================

/** notifications.service.ts notifyVoiceReady -> `voice_status`. */
export const socketVoiceReady = { voiceProfileId: 'vp-clone-0003', status: 'READY' };

/** notifications.service.ts notifyVoiceFailed -> `voice_status`. */
export const socketVoiceFailed = {
  voiceProfileId: 'vp-clone-0003',
  status: 'FAILED',
  errorMessage: 'Ses kaydı çok kısa. En az 10 saniye konuşma gerekiyor.',
};

/** notifications.service.ts notifyNarrationReady -> `narration_status`. */
export const socketNarrationReady = {
  status: 'READY',
  narrationId: 'nar-0002',
  storyId: backendStoryListItem.id,
};

/** notifications.service.ts sendNotification -> `notification` (no userId, no readAt). */
export const socketNotification = {
  id: 'ntf-0001',
  type: 'NARRATION_READY',
  title: 'Masalın hazır',
  body: '"Keloğlan ile Dev" masalını şimdi dinleyebilirsin.',
  data: { type: 'NARRATION_READY', narrationId: 'nar-0002', storyId: backendStoryListItem.id },
  read: false,
  createdAt: ISO_UPDATED,
};

// ============================================================================
// Notifications (REST + FCM)
// ============================================================================

/** notifications/dto/notification-response.dto.ts NotificationDto (a Prisma row). */
export const backendNotification = {
  id: 'ntf-0002',
  userId: '6b1f3c2e-8d4a-4f7b-9a51-2c7e0d9b1a01',
  type: 'VOICE_FAILED',
  title: 'Ses hazırlanamadı',
  body: '"Annemin Sesi" sesi hazırlanırken bir sorun oluştu. Lütfen tekrar dene.',
  data: { type: 'VOICE_FAILED', voiceProfileId: 'vp-clone-0002' },
  read: true,
  readAt: ISO_UPDATED,
  createdAt: ISO_CREATED,
};

/** NotificationListResponseDto (GET /notifications): no hasMore, has unreadCount. */
export const backendNotificationList = {
  items: [socketNotification, backendNotification],
  total: 45,
  page: 1,
  limit: 20,
  unreadCount: 3,
};

/** UnreadCountResponseDto (GET /notifications/unread-count). */
export const backendUnreadCount = { unreadCount: 3 };

/**
 * FCM RemoteMessage per type, as notifications.service.ts pushToUser sends
 * it: visible `notification` block + string-only `data` with type and
 * notificationId plus the deep-link ids.
 */
export const fcmMessages = {
  NARRATION_READY: {
    notification: { title: 'Masalın hazır', body: '"Keloğlan ile Dev" masalını şimdi dinleyebilirsin.' },
    data: { type: 'NARRATION_READY', notificationId: 'ntf-1', narrationId: 'nar-0002', storyId: 'story-1' },
  },
  NARRATION_FAILED: {
    notification: { title: 'Masal hazırlanamadı', body: 'Lütfen tekrar dene.' },
    data: { type: 'NARRATION_FAILED', notificationId: 'ntf-2', narrationId: 'nar-0003', storyId: 'story-1' },
  },
  VOICE_READY: {
    notification: { title: 'Ses profilin hazır', body: '"Annemin Sesi" sesi artık kullanılabilir.' },
    data: { type: 'VOICE_READY', notificationId: 'ntf-3', voiceProfileId: 'vp-clone-0002' },
  },
  VOICE_FAILED: {
    notification: { title: 'Ses hazırlanamadı', body: 'Lütfen tekrar dene.' },
    data: { type: 'VOICE_FAILED', notificationId: 'ntf-4', voiceProfileId: 'vp-clone-0002' },
  },
  BROADCAST: {
    notification: { title: 'Yeni masallar geldi', body: 'Bu hafta 5 yeni masal eklendi.' },
    data: { type: 'BROADCAST', notificationId: 'ntf-5' },
  },
};

// ============================================================================
// Collections, legal
// ============================================================================

/** collections/collections.service.ts toResponseDto (GET /collections items). */
export const backendCollection = {
  id: 'col-0001',
  slug: 'uyku-vakti',
  title: 'Uyku Vakti',
  subtitle: 'Sakin, yumuşak masallar',
  description: 'Gün sonunda sakinleşmek için seçilmiş masallar.',
  tone: 'NATURE',
  coverImageUrl: 'https://storage.googleapis.com/sesly-covers/uyku.jpg',
  isActive: true,
  sortOrder: 2,
  storyCount: 14,
  createdAt: ISO_CREATED,
  updatedAt: ISO_UPDATED,
};

/**
 * legal-documents.service.ts PublicLegalDocumentDto (GET /legal, /legal/:slug):
 * `language` is the language of the text that was served.
 */
export const backendLegalDocument = {
  slug: 'privacy',
  language: 'tr',
  title: 'Gizlilik Politikası',
  contentMd: '# Gizlilik Politikası\n\nSesly kişisel verilerini KVKK kapsamında işler.',
  version: 3,
  publishedAt: ISO_UPDATED,
};

// ============================================================================
// Subscriptions
// ============================================================================

/**
 * subscriptions.service.ts getCurrentSubscription (GET /subscriptions/current):
 * the raw Prisma Subscription row, including billing ids mobile ignores.
 */
export const backendSubscriptionRow = {
  id: 'sub-0001',
  userId: '6b1f3c2e-8d4a-4f7b-9a51-2c7e0d9b1a01',
  plan: 'PRO',
  status: 'ACTIVE',
  extraVoiceSlots: 0,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  stripePriceId: null,
  appleTransactionId: '2000000123456789',
  appleOriginalTransactionId: '2000000123456789',
  googlePurchaseToken: null,
  googleProductId: null,
  currentPeriodStart: ISO_PERIOD_START,
  currentPeriodEnd: ISO_PERIOD_END,
  cancelAtPeriodEnd: false,
  createdAt: ISO_CREATED,
  updatedAt: ISO_UPDATED,
};

/**
 * subscriptions.service.ts getPlans (GET /subscriptions/plans): the public
 * plans FREE, MINI and PRO (sold as Premium), every number from PLAN_LIMITS,
 * PLAN_PRICES / PLAN_YEARLY_PRICES and STORE_PRODUCTS.
 */
export const backendPlans = {
  plans: [
    {
      id: 'FREE',
      name: 'Ücretsiz',
      price: 0,
      yearlyPrice: null,
      currency: 'TRY',
      billingPeriod: 'monthly',
      appleProductId: null,
      googleProductId: null,
      appleYearlyProductId: null,
      googleYearlyProductId: null,
      products: [],
      features: [
        'Hazır anlatıcı seslerle ayda 20 masal',
        'Kendi sesinle 1 masal (tek seferlik hak)',
        'Kendi sesinle 1 ses kaydı',
        '3 hazır anlatıcı ses',
      ],
      allowances: {
        presetNarrations: { limit: 20, period: 'month' },
        cloneNarrations: { limit: 1, period: 'lifetime' },
        cloneCreations: { limit: 1, period: 'lifetime' },
      },
      limits: {
        storiesPerMonth: 20,
        premiumStoriesPerMonth: 1,
        textToSpeechPerMonth: -1,
        voiceProfiles: 4,
        presetVoices: 3,
        cloneVoices: 1,
        monthlyCloneCreations: 1,
        cloneCreationPeriod: 'lifetime',
        backgroundPlayback: false,
        premiumStories: false,
        providers: ['GOOGLE', 'CARTESIA'],
      },
    },
    {
      id: 'MINI',
      name: 'Mini',
      price: 49.99,
      yearlyPrice: null,
      currency: 'TRY',
      billingPeriod: 'monthly',
      appleProductId: 'io.sesly.mini_monthly',
      googleProductId: 'mini_monthly',
      appleYearlyProductId: null,
      googleYearlyProductId: null,
      products: [
        { platform: 'GOOGLE', productId: 'mini_monthly', billingPeriod: 'month', referencePrice: 49.99 },
        { platform: 'APPLE', productId: 'io.sesly.mini_monthly', billingPeriod: 'month', referencePrice: 49.99 },
      ],
      features: [
        'Hazır anlatıcı seslerle sınırsız masal',
        'Kendi sesinle ayda 5 masal',
        'Kendi sesinle 1 ses kaydı (ayda en fazla 2 yeni kayıt)',
        '10 hazır anlatıcı ses',
        'Tüm masal kataloğu',
        'Arka planda ve kilit ekranında dinleme',
      ],
      allowances: {
        presetNarrations: { limit: null, period: 'month' },
        cloneNarrations: { limit: 5, period: 'month' },
        cloneCreations: { limit: 2, period: 'month' },
      },
      limits: {
        storiesPerMonth: -1,
        premiumStoriesPerMonth: 5,
        textToSpeechPerMonth: -1,
        voiceProfiles: 11,
        presetVoices: 10,
        cloneVoices: 1,
        monthlyCloneCreations: 2,
        cloneCreationPeriod: 'month',
        backgroundPlayback: true,
        premiumStories: true,
        providers: ['GOOGLE', 'CARTESIA'],
      },
    },
    {
      id: 'PRO',
      name: 'Premium',
      price: 199.99,
      yearlyPrice: 1499.99,
      currency: 'TRY',
      billingPeriod: 'monthly',
      popular: true,
      appleProductId: 'io.sesly.pro_monthly',
      googleProductId: 'pro_monthly',
      appleYearlyProductId: 'io.sesly.pro_yearly',
      googleYearlyProductId: 'pro_yearly',
      products: [
        { platform: 'GOOGLE', productId: 'pro_monthly', billingPeriod: 'month', referencePrice: 199.99 },
        { platform: 'GOOGLE', productId: 'pro_yearly', billingPeriod: 'year', referencePrice: 1499.99 },
        { platform: 'APPLE', productId: 'io.sesly.pro_monthly', billingPeriod: 'month', referencePrice: 199.99 },
        { platform: 'APPLE', productId: 'io.sesly.pro_yearly', billingPeriod: 'year', referencePrice: 1499.99 },
      ],
      features: [
        'Hazır anlatıcı seslerle sınırsız masal',
        'Kendi sesinle ayda 20 masal',
        'Kendi sesinle 3 ses kaydı (ayda en fazla 5 yeni kayıt)',
        '10 hazır anlatıcı ses',
        'Tüm masal kataloğu',
        'Arka planda ve kilit ekranında dinleme',
      ],
      allowances: {
        presetNarrations: { limit: null, period: 'month' },
        cloneNarrations: { limit: 20, period: 'month' },
        cloneCreations: { limit: 5, period: 'month' },
      },
      limits: {
        storiesPerMonth: -1,
        premiumStoriesPerMonth: 20,
        textToSpeechPerMonth: -1,
        voiceProfiles: 13,
        presetVoices: 10,
        cloneVoices: 3,
        monthlyCloneCreations: 5,
        cloneCreationPeriod: 'month',
        backgroundPlayback: true,
        premiumStories: true,
        providers: ['GOOGLE', 'CARTESIA'],
      },
    },
  ],
};

// ============================================================================
// Usage and quota (GET /usage, coded 403s)
// ============================================================================

/** usage-counters.ts currentUsagePeriod resetAt: the first day of next month (server in UTC). */
export const ISO_USAGE_RENEWS = '2026-11-01T00:00:00.000Z';

/**
 * usage.service.ts getUsageSummary (GET /usage, not wrapped), FREE: nothing
 * narrated yet, the one lifetime own-voice creation used.
 */
export const backendUsageFree = {
  plan: 'FREE',
  planName: 'Ücretsiz',
  renewsAt: ISO_USAGE_RENEWS,
  buckets: {
    presetNarrations: { limit: 20, used: 0, remaining: 20, period: 'month', renewsAt: ISO_USAGE_RENEWS },
    cloneNarrations: { limit: 1, used: 0, remaining: 1, period: 'lifetime', renewsAt: null },
    cloneCreations: { limit: 1, used: 1, remaining: 0, period: 'lifetime', renewsAt: null },
  },
  voiceSlots: { preset: { used: 2, limit: 3 }, clone: { used: 1, limit: 1 } },
  features: { backgroundPlayback: false, premiumStories: false },
};

/** getUsageSummary, MINI: ready-made narrators unlimited (limit null, renewsAt still set). */
export const backendUsageMini = {
  plan: 'MINI',
  planName: 'Mini',
  renewsAt: ISO_USAGE_RENEWS,
  buckets: {
    presetNarrations: { limit: null, used: 12, remaining: null, period: 'month', renewsAt: ISO_USAGE_RENEWS },
    cloneNarrations: { limit: 5, used: 3, remaining: 2, period: 'month', renewsAt: ISO_USAGE_RENEWS },
    cloneCreations: { limit: 2, used: 1, remaining: 1, period: 'month', renewsAt: ISO_USAGE_RENEWS },
  },
  voiceSlots: { preset: { used: 4, limit: 10 }, clone: { used: 1, limit: 1 } },
  features: { backgroundPlayback: true, premiumStories: true },
};

/** usage.service.ts quotaExceeded: 403 from POST /narrations, FREE ready-made narrations used up. */
export const backendQuotaPresetMonthlyError = {
  success: false,
  statusCode: 403,
  message:
    'Bu ay hazır anlatıcı seslerle 20 masal hakkını kullandın. Hakların 1 Kasım tarihinde yenilenir. Sınırsız masal için Mini ya da Premium plana geçebilirsin.',
  code: 'QUOTA_PRESET_MONTHLY',
  bucket: 'presetNarrations',
  tier: 'standard',
  plan: 'FREE',
  limit: 20,
  used: 20,
  period: 'month',
  renewsAt: ISO_USAGE_RENEWS,
  path: '/narrations',
  method: 'POST',
  timestamp: ISO_UPDATED,
};

/** quotaExceeded: 403 from POST /narrations, FREE own-voice narration used (lifetime). */
export const backendQuotaCloneLifetimeError = {
  success: false,
  statusCode: 403,
  message:
    'Ücretsiz planda kendi sesinle 1 masal hakkın var ve bu hakkı kullandın. Bu hak yenilenmez. Kendi sesinle daha fazla masal için Mini ya da Premium plana geçebilirsin.',
  code: 'QUOTA_CLONE_LIFETIME',
  bucket: 'cloneNarrations',
  tier: 'premium',
  plan: 'FREE',
  limit: 1,
  used: 1,
  period: 'lifetime',
  renewsAt: null,
  path: '/narrations',
  method: 'POST',
  timestamp: ISO_UPDATED,
};

/** quotaExceeded: 403 from POST /narrations/:id/generate, MINI own-voice narrations used this month. */
export const backendQuotaCloneMonthlyError = {
  success: false,
  statusCode: 403,
  message:
    'Bu ay kendi sesinle 5 masal hakkını kullandın. Hakların 1 Kasım tarihinde yenilenir. Daha fazlası için Premium plana geçebilirsin.',
  code: 'QUOTA_CLONE_MONTHLY',
  bucket: 'cloneNarrations',
  tier: 'premium',
  plan: 'MINI',
  limit: 5,
  used: 5,
  period: 'month',
  renewsAt: ISO_USAGE_RENEWS,
  path: '/narrations/nar-0002/generate',
  method: 'POST',
  timestamp: ISO_UPDATED,
};

/** quotaExceeded: the same 403 for PRO (Premium): 20 a month, no upsell sentence. */
export const backendQuotaCloneMonthlyPremiumError = {
  success: false,
  statusCode: 403,
  message: 'Bu ay kendi sesinle 20 masal hakkını kullandın. Hakların 1 Kasım tarihinde yenilenir.',
  code: 'QUOTA_CLONE_MONTHLY',
  bucket: 'cloneNarrations',
  tier: 'premium',
  plan: 'PRO',
  limit: 20,
  used: 20,
  period: 'month',
  renewsAt: ISO_USAGE_RENEWS,
  path: '/narrations',
  method: 'POST',
  timestamp: ISO_UPDATED,
};

/** voice-profiles.service.ts throwCreationLimit: 403 from POST /voice-profiles/v2, FREE (lifetime). */
export const backendCloneCreationLimitError = {
  success: false,
  statusCode: 403,
  message:
    'Ücretsiz planda 1 ses kaydı oluşturabilirsin ve bu hakkı kullandın. Bu hak yenilenmez, sesini silmek de yeni bir hak vermez. Yeni bir ses kaydı için Mini ya da Premium plana geçebilirsin.',
  code: 'CLONE_CREATION_LIMIT',
  plan: 'FREE',
  limit: 1,
  used: 1,
  period: 'lifetime',
  renewsAt: null,
  path: '/voice-profiles/v2',
  method: 'POST',
  timestamp: ISO_UPDATED,
};

/** throwCreationLimit: 403 from POST /voice-profiles/:id/upload-samples, MINI (this month). */
export const backendCloneCreationLimitMonthlyError = {
  success: false,
  statusCode: 403,
  message:
    'Bu ay en fazla 2 yeni ses kaydı oluşturabilirsin ve bu hakkı kullandın. Sesini silmek yeni bir hak vermez. Yeni kayıt hakkın 1 Kasım tarihinde yenilenir.',
  code: 'CLONE_CREATION_LIMIT',
  plan: 'MINI',
  limit: 2,
  used: 2,
  period: 'month',
  renewsAt: ISO_USAGE_RENEWS,
  path: '/voice-profiles/vp-clone-0003/upload-samples',
  method: 'POST',
  timestamp: ISO_UPDATED,
};

// ============================================================================
// Enums (prisma/schema.prisma). Copy the member lists verbatim.
// ============================================================================

export const backendEnums = {
  AuthProvider: ['EMAIL', 'GOOGLE', 'APPLE'],
  VoiceProfileStatus: ['PENDING', 'PROCESSING', 'READY', 'FAILED'],
  VoiceProfileKind: ['PRESET', 'CLONE'],
  AgeGroup: ['ZERO_TO_THREE', 'THREE_TO_SIX', 'SIX_TO_TEN', 'TEN_PLUS'],
  StoryCategory: ['TURKISH_CLASSICS', 'WORLD_CLASSICS', 'EDUCATIONAL', 'BEDTIME'],
  CollectionTone: ['ACCENT', 'TRUST', 'NATURE', 'SUN'],
  AudioStatus: ['PENDING', 'GENERATING', 'READY', 'FAILED'],
  NarrationStatus: ['PENDING', 'GENERATING', 'READY', 'FAILED'],
  SubscriptionPlan: ['FREE', 'PRO', 'CREATOR', 'MINI'],
  SubscriptionStatus: ['ACTIVE', 'CANCELLED', 'EXPIRED', 'PAST_DUE'],
  TTSProvider: ['GOOGLE', 'CARTESIA'],
  /** notifications.service.ts NotificationType. */
  NotificationType: ['VOICE_READY', 'VOICE_FAILED', 'NARRATION_READY', 'NARRATION_FAILED', 'BROADCAST'],
};

// ============================================================================
// Error envelopes (HttpExceptionFilter)
// ============================================================================

/** 409 from POST /narrations when the (story, voice) pair already exists. */
export const backendNarrationExistsError = {
  success: false,
  statusCode: 409,
  message: 'Bu masal bu sesle zaten seslendirilmiş.',
  code: 'NARRATION_EXISTS',
  existingNarrationId: 'nar-0001',
  status: 'READY',
  path: '/narrations',
  method: 'POST',
  timestamp: ISO_UPDATED,
};

/** 403 from GET /stories/:id and POST /narrations for FREE users on premium stories. */
export const backendPremiumStoryError = {
  success: false,
  statusCode: 403,
  message: 'Bu masal Pro aboneliği gerektiriyor.',
  code: 'PREMIUM_STORY',
  path: '/stories/c0a8012e-0000-4000-8000-000000000001',
  method: 'GET',
  timestamp: ISO_UPDATED,
};

/** 503 maintenance mode. */
export const backendMaintenanceError = {
  success: false,
  statusCode: 503,
  message: 'Sesly şu anda planlı bakımda. Yaklaşık 30 dakika içinde geri döneceğiz.',
  path: '/stories',
  method: 'GET',
  timestamp: ISO_UPDATED,
};

/** 400 from the global ValidationPipe (class-validator message array). */
export const backendValidationError = {
  success: false,
  statusCode: 400,
  message: ['Geçerli bir e-posta adresi girin.', 'Şifre en az 8 karakter olmalı.'],
  error: 'Bad Request',
  path: '/users/me',
  method: 'PATCH',
  timestamp: ISO_UPDATED,
};
