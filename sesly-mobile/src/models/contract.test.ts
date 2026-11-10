/**
 * Backend contract test: every mobile parser runs over the backend-shaped
 * fixtures in src/test-utils/contract-fixtures.ts and must read the real
 * values (never silently fall back to a default).
 *
 * Expected values are literals on purpose. When the backend renames a field,
 * update the fixture; the case for the parser that still reads the old name
 * fails here with the field in the diff.
 */

const mockApiGet = jest.fn();
const mockApiPost = jest.fn();

jest.mock('../services/ApiClient', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    delete: jest.fn(),
  },
}));

import {
  ISO_COMPLETED,
  ISO_CREATED,
  ISO_PERIOD_END,
  ISO_UPDATED,
  ISO_USAGE_RENEWS,
  backendAuthResponse,
  backendCloneCreationLimitError,
  backendCloneCreationLimitMonthlyError,
  backendQuotaCloneLifetimeError,
  backendQuotaCloneMonthlyError,
  backendQuotaPresetMonthlyError,
  backendUsageFree,
  backendUsageMini,
  backendAvailableVoices,
  backendAvatarUpload,
  backendAppConfig,
  backendCloneConfig,
  backendCollection,
  backendEmailInUseError,
  backendCreateVoiceProfileResponse,
  backendFailedCloneVoiceProfile,
  backendLegalDocument,
  backendMaintenanceError,
  backendNarration,
  backendNarrationExistsError,
  backendNarrationPage,
  backendNarrationStatus,
  backendNotification,
  backendNotificationList,
  backendPlans,
  backendPremiumStoryError,
  backendPresetVoiceProfile,
  backendStoryDetail,
  backendMachineTranslatedStoryDetail,
  backendStoryPartDetail,
  backendStoryListItem,
  backendStoryPage,
  backendSubscriptionRow,
  backendUnreadCount,
  backendUser,
  backendUserPreferences,
  backendUserStats,
  backendEnums,
  backendValidationError,
  backendVoiceProfileStatus,
  backendVoiceSlots,
  cloneFixture,
  fcmMessages,
  socketNarrationReady,
  socketNotification,
  socketVoiceFailed,
  socketVoiceReady,
} from '../test-utils/contract-fixtures';
import { parseUploadAvatarResponseFromJSON, parseUserFromJSON } from './User';
import { parseUserStatsFromJSON } from './UserStats';
import { parseUserPreferencesFromJSON } from './UserPreferences';
import {
  parsePaginatedStoriesFromJSON,
  parseStoryDetailFromJSON,
  parseStoryFromJSON,
} from './Story';
import {
  canCreateCloneFromSlots,
  canCreatePresetFromSlots,
  isCloneProfile,
  parseAvailableVoicesResponseFromJSON,
  parseVoiceProfileKind,
  parseVoiceProfileFromJSON,
  parseVoiceProfileStatusResponseFromJSON,
  parseVoiceSlotInfoFromJSON,
} from './VoiceProfile';
import { parseCloneConfigFromJSON } from './VoiceClone';
import { parseAppConfigFromJSON } from './AppConfig';
import { parseStoryNarrationFromJSON } from './Narration';
import {
  NotificationType,
  getNotificationTarget,
  parseNotificationFromJSON,
  parseNotificationListResponseFromJSON,
  parseNotificationType,
  parsePushPayload,
  parseUnreadCountFromJSON,
} from './Notification';
import {
  isCollectionTone,
  parseCollectionFromJSON,
  parseCollectionsFromJSON,
} from './Collection';
import { parseLegalDocumentFromJSON, parseLegalDocumentsFromJSON } from './Legal';
import {
  parseCurrentSubscriptionFromJSON,
  parseCurrentSubscriptionResponse,
} from './Subscription';
import { PLANS, PlanId } from './Plans';
import { QUOTA_CODES, parseQuotaBlock, parseUsageSummary } from './Quota';
import { routeForNotificationTarget } from '../navigation/pushRouting';
import { parseVoiceStatusPayload } from '../services/WebSocketService';
import { apiErrorFromResponse } from '../services/ApiError';
import NarrationService, { toNarrationConflict } from '../services/NarrationService';
import VoiceProfileService from '../services/VoiceProfileService';
import StoryService from '../services/StoryService';
import NotificationService from '../services/NotificationService';
import {
  AgeGroup,
  AudioGenerationStatus,
  AuthProvider,
  NarrationStatus,
  StoryCategory,
  SubscriptionStatus,
  SubscriptionTier,
  TTSProvider,
  VoiceProfileStatus,
  parseSubscriptionStatus,
  parseSubscriptionTier,
} from '../types/enums';

// WebSocketService pulls in the notifications store; keep it inert.
jest.mock('../hooks/useNotifications', () => ({
  getNotificationsStore: jest.fn(),
}));

const NOW = new Date('2026-09-28T12:00:00.000Z');

interface ContractCase {
  readonly name: string;
  readonly parse: () => unknown;
  readonly expected: Record<string, unknown>;
}

// ============================================================================
// Parser x fixture table
// ============================================================================

const CASES: ContractCase[] = [
  {
    name: 'GET /users/me -> parseUserFromJSON',
    parse: () => parseUserFromJSON(backendUser),
    expected: {
      id: backendUser.id,
      email: 'ayse.yilmaz@example.com',
      firstName: 'Ayşe',
      lastName: 'Yılmaz',
      profileImageUrl: backendUser.profileImageUrl,
      provider: 'GOOGLE',
      emailVerified: true,
      subscriptionTier: SubscriptionTier.PRO,
      subscriptionExpiresAt: new Date(ISO_PERIOD_END),
      createdAt: new Date(ISO_CREATED),
      updatedAt: new Date(ISO_UPDATED),
    },
  },
  {
    name: 'POST /auth/firebase/verify user (no subscription yet) -> parseUserFromJSON',
    parse: () => parseUserFromJSON(backendAuthResponse.user),
    expected: {
      provider: 'APPLE',
      profileImageUrl: null,
      subscriptionTier: SubscriptionTier.FREE,
      subscriptionExpiresAt: null,
    },
  },
  {
    name: 'POST /users/me/avatar -> parseUploadAvatarResponseFromJSON',
    parse: () => parseUploadAvatarResponseFromJSON(backendAvatarUpload),
    expected: { avatarUrl: backendAvatarUpload.avatarUrl },
  },
  {
    name: 'GET /users/me/stats -> parseUserStatsFromJSON',
    parse: () => parseUserStatsFromJSON(backendUserStats),
    expected: { storiesCompleted: 12, hoursListened: 3.4, voicesTrained: 2 },
  },
  {
    // Every value differs from the parser default, so a rename cannot hide.
    name: 'GET /users/me/preferences -> parseUserPreferencesFromJSON',
    parse: () => parseUserPreferencesFromJSON(backendUserPreferences),
    expected: {
      userId: backendUserPreferences.userId,
      sleepTimerFadeOut: false,
      sleepTimerPauseWhenAsleep: true,
      sleepTimerLastDuration: 20,
      voiceReadyNotifications: true,
      narrationReadyNotifications: false,
      promoNotifications: true,
      settings: { playbackSpeed: 1.25, autoplay: true },
      createdAt: ISO_CREATED,
      updatedAt: ISO_UPDATED,
    },
  },
  {
    name: 'GET /stories item -> parseStoryFromJSON',
    parse: () => parseStoryFromJSON(backendStoryListItem),
    expected: {
      id: backendStoryListItem.id,
      title: 'Keloğlan ile Dev',
      description: backendStoryListItem.description,
      ageGroup: 'THREE_TO_SIX',
      category: 'TURKISH_CLASSICS',
      estimatedDuration: 7,
      coverImageUrl: backendStoryListItem.coverImageUrl,
      isPremium: true,
      isFavorite: true,
      language: 'tr',
      languageLevel: 'A2',
      summary: backendStoryListItem.summary,
      credit: {
        collectorName: 'Pertev Naili Boratav',
        collectorDeathYear: 1998,
        adaptedBy: 'Sesly Yayın Kurulu',
        firstPublishedYear: 1946,
        origin: 'Anadolu halk masalı',
        translationMethod: null,
      },
      contentWarnings: ['OLD_LANGUAGE'],
      coverKey: '5f2c9a1d0b7e4c33',
      // Not sent by the backend yet (see the placeholders in models/Story.ts).
      translationGroupId: null,
      availableLanguages: ['tr'],
    },
  },
  {
    name: 'GET /stories page -> parsePaginatedStoriesFromJSON',
    parse: () => parsePaginatedStoriesFromJSON(backendStoryPage),
    expected: {
      data: [
        { id: backendStoryListItem.id, isPremium: true },
        {
          title: 'Uykucu Ayı',
          description: null,
          coverImageUrl: null,
          isPremium: false,
          isFavorite: false,
        },
      ],
      meta: { page: 2, limit: 20, total: 42, totalPages: 3 },
    },
  },
  {
    name: 'GET /stories/:id -> parseStoryDetailFromJSON',
    parse: () => parseStoryDetailFromJSON(backendStoryDetail),
    expected: {
      id: backendStoryDetail.id,
      title: 'Keloğlan ile Dev',
      description: backendStoryDetail.description,
      language: 'tr',
      languageLevel: 'A2',
      summary: backendStoryDetail.summary,
      translations: [
        { id: 'c0a8012e-0000-4000-8000-0000000000e1', language: 'en', title: 'Keloglan and the Giant' },
        { id: 'c0a8012e-0000-4000-8000-0000000000d1', language: 'de', title: 'Keloglan und der Riese' },
      ],
      availableLanguages: ['tr', 'en', 'de'],
      estimatedDuration: 7,
      coverImageUrl: backendStoryDetail.coverImageUrl,
      isPremium: true,
      isFavorite: true,
      chunks: [],
      userProgress: null,
      translation: null,
      part: null,
    },
  },
  {
    name: 'GET /stories/:id of a part of a multi-part tale -> parseStoryDetailFromJSON (part)',
    parse: () => parseStoryDetailFromJSON(backendStoryPartDetail),
    expected: { part: { number: 2, total: 3 } },
  },
  {
    name: 'GET /stories/:id of an AI translation -> parseStoryDetailFromJSON (licence credit, original)',
    parse: () => parseStoryDetailFromJSON(backendMachineTranslatedStoryDetail),
    expected: {
      language: 'en',
      credit: {
        translationMethod: 'MACHINE',
        attribution: 'Keloğlan ile Dev, Sesly, CC BY 4.0',
        licenseName: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      },
      translation: {
        isMachineTranslation: true,
        fromLanguage: 'tr',
        original: { id: 'c0a8012e-0000-4000-8000-000000000001', title: 'Keloğlan ile Dev', language: 'tr' },
      },
    },
  },
  {
    name: 'voice profile (PRESET) -> parseVoiceProfileFromJSON',
    parse: () => parseVoiceProfileFromJSON(backendPresetVoiceProfile),
    expected: {
      id: 'vp-preset-0001',
      name: 'Masalcı Deniz',
      status: VoiceProfileStatus.READY,
      provider: 'GOOGLE',
      voiceId: 'tr-TR-Chirp3-HD-Achernar',
      language: 'tr-TR',
      contentLanguage: 'tr',
      kind: 'PRESET',
      errorMessage: null,
      sampleAudioUrl: null,
      consentAt: null,
    },
  },
  {
    name: 'voice profile (failed CLONE) -> parseVoiceProfileFromJSON',
    parse: () => parseVoiceProfileFromJSON(backendFailedCloneVoiceProfile),
    expected: {
      kind: 'CLONE',
      provider: 'CARTESIA',
      status: VoiceProfileStatus.FAILED,
      errorMessage: 'Ses hazırlanırken bir sorun oluştu. Lütfen tekrar dene.',
      sampleAudioUrl: backendFailedCloneVoiceProfile.sampleAudioUrl,
      consentAt: new Date('2026-09-27T19:40:00.000Z'),
    },
  },
  {
    name: 'POST /voice-profiles/v2 profile -> parseVoiceProfileFromJSON',
    parse: () => parseVoiceProfileFromJSON(backendCreateVoiceProfileResponse.profile),
    expected: {
      id: 'vp-clone-0003',
      kind: 'CLONE',
      voiceId: 'custom-cloning-pending',
      status: VoiceProfileStatus.PENDING,
    },
  },
  {
    // Script and title differ from the local FALLBACK_* constants.
    name: 'GET /voice-profiles/clone-config -> parseCloneConfigFromJSON',
    parse: () => parseCloneConfigFromJSON(backendCloneConfig),
    expected: {
      enabled: true,
      provider: 'CARTESIA',
      language: 'tr',
      locale: 'tr-TR',
      supportedLanguages: backendCloneConfig.supportedLanguages,
      minSeconds: 15,
      targetSeconds: 30,
      maxSeconds: 60,
      scriptTitle: 'Yıldızlı Bir Gece',
      script: backendCloneConfig.script,
      consentVersion: '2026-09-v1',
      consentTitle: 'Sesin için açık rıza',
      consentText: backendCloneConfig.consentText,
      introSteps: backendCloneConfig.introSteps,
      recordingTips: backendCloneConfig.recordingTips,
    },
  },
  {
    name: 'GET /app/config -> parseAppConfigFromJSON',
    parse: () => parseAppConfigFromJSON(backendAppConfig),
    expected: backendAppConfig,
  },
  {
    name: 'POST /auth/firebase/verify 409 EMAIL_IN_USE -> ApiError code',
    parse: () => {
      const error = apiErrorFromResponse(409, backendEmailInUseError);
      return { status: error.status, code: error.code };
    },
    expected: { status: 409, code: 'EMAIL_IN_USE' },
  },
  {
    name: 'GET /voice-profiles/slots -> parseVoiceSlotInfoFromJSON',
    parse: () => parseVoiceSlotInfoFromJSON(backendVoiceSlots),
    expected: {
      used: 3,
      limit: 4,
      available: 1,
      plan: 'free',
      canCreate: true,
      message: null,
      preset: { used: 2, limit: 3, canCreate: true, message: null },
      clone: {
        used: 1,
        limit: 1,
        canCreate: false,
        message: null,
        monthlyCreated: 1,
        monthlyLimit: 1,
      },
    },
  },
  {
    name: 'GET /voice-profiles/:id/status -> parseVoiceProfileStatusResponseFromJSON',
    parse: () => parseVoiceProfileStatusResponseFromJSON(backendVoiceProfileStatus),
    expected: {
      id: 'vp-clone-0003',
      name: 'Babamın Sesi',
      status: VoiceProfileStatus.PROCESSING,
      progress: 0,
      provider: 'CARTESIA',
      voiceId: 'pending-vp-clone-0003',
      contentLanguage: 'tr',
      createdAt: new Date(ISO_CREATED),
      updatedAt: new Date(ISO_UPDATED),
      errorMessage: null,
    },
  },
  {
    name: 'GET /voice-profiles/available-voices -> parseAvailableVoicesResponseFromJSON',
    parse: () => parseAvailableVoicesResponseFromJSON(backendAvailableVoices),
    expected: {
      cartesia: [],
      google: [
        {
          id: 'tr-TR-Chirp3-HD-Achernar',
          voiceId: 'tr-TR-Chirp3-HD-Achernar',
          // The wire still says "Achernar (HD)": the client shows the bare name.
          name: 'Achernar',
          languageCode: 'tr-TR',
          contentLanguage: 'tr',
          gender: 'female',
          description: 'Ultra yüksek kalite, stüdyo sesi (Chirp 3 HD)',
          provider: 'GOOGLE',
        },
        // tr-TR-Standard-A is on the wire too; only Chirp 3 voices are listed.
      ],
    },
  },
  {
    name: 'GET /narrations/:id -> parseStoryNarrationFromJSON',
    parse: () => parseStoryNarrationFromJSON(backendNarration),
    expected: {
      id: 'nar-0001',
      userId: backendNarration.userId,
      storyId: backendStoryListItem.id,
      voiceProfileId: 'vp-preset-0001',
      status: 'READY',
      errorMessage: null,
      totalDuration: 312,
      voiceLanguage: 'tr',
      storyLanguage: 'tr',
      languageMismatch: false,
      nativeVoiceUsed: false,
      createdAt: new Date(ISO_CREATED),
      updatedAt: new Date(ISO_UPDATED),
      completedAt: new Date(ISO_COMPLETED),
      story: { id: backendStoryListItem.id, title: 'Keloğlan ile Dev', isFavorite: true },
      voiceProfile: { id: 'vp-preset-0001', kind: 'PRESET', contentLanguage: 'tr' },
    },
  },
  {
    name: 'GET /narrations item still generating -> parseStoryNarrationFromJSON',
    parse: () => parseStoryNarrationFromJSON(backendNarrationPage.data[1]),
    expected: {
      id: 'nar-0002',
      status: 'GENERATING',
      totalDuration: 0,
      completedAt: null,
    },
  },
  {
    name: 'socket voice_status READY -> parseVoiceStatusPayload',
    parse: () => parseVoiceStatusPayload(socketVoiceReady),
    expected: {
      voiceProfileId: 'vp-clone-0003',
      status: VoiceProfileStatus.READY,
      errorMessage: null,
    },
  },
  {
    name: 'socket voice_status FAILED -> parseVoiceStatusPayload',
    parse: () => parseVoiceStatusPayload(socketVoiceFailed),
    expected: {
      voiceProfileId: 'vp-clone-0003',
      status: VoiceProfileStatus.FAILED,
      errorMessage: socketVoiceFailed.errorMessage,
    },
  },
  {
    name: 'socket notification -> parseNotificationFromJSON',
    parse: () => parseNotificationFromJSON(socketNotification),
    expected: {
      id: 'ntf-0001',
      userId: '',
      type: NotificationType.NARRATION_READY,
      title: 'Masalın hazır',
      body: socketNotification.body,
      data: socketNotification.data,
      read: false,
      readAt: null,
      createdAt: new Date(ISO_UPDATED),
    },
  },
  {
    name: 'GET /notifications row -> parseNotificationFromJSON',
    parse: () => parseNotificationFromJSON(backendNotification),
    expected: {
      id: 'ntf-0002',
      userId: backendNotification.userId,
      type: NotificationType.VOICE_FAILED,
      read: true,
      readAt: new Date(ISO_UPDATED),
      createdAt: new Date(ISO_CREATED),
    },
  },
  {
    name: 'GET /notifications -> parseNotificationListResponseFromJSON',
    parse: () => parseNotificationListResponseFromJSON(backendNotificationList),
    expected: {
      items: [{ id: 'ntf-0001' }, { id: 'ntf-0002' }],
      total: 45,
      page: 1,
      limit: 20,
      hasMore: true,
    },
  },
  {
    name: 'GET /notifications/unread-count -> parseUnreadCountFromJSON',
    parse: () => ({ count: parseUnreadCountFromJSON(backendUnreadCount) }),
    expected: { count: 3 },
  },
  {
    name: 'GET /collections item -> parseCollectionFromJSON',
    parse: () => parseCollectionFromJSON(backendCollection),
    expected: {
      id: 'col-0001',
      slug: 'uyku-vakti',
      title: 'Uyku Vakti',
      subtitle: 'Sakin, yumuşak masallar',
      description: backendCollection.description,
      tone: 'NATURE',
      coverImageUrl: backendCollection.coverImageUrl,
      isActive: true,
      sortOrder: 2,
      storyCount: 14,
      createdAt: ISO_CREATED,
      updatedAt: ISO_UPDATED,
    },
  },
  {
    name: 'GET /legal/:slug -> parseLegalDocumentFromJSON',
    parse: () => parseLegalDocumentFromJSON(backendLegalDocument),
    expected: {
      slug: 'privacy',
      language: 'tr',
      title: 'Gizlilik Politikası',
      contentMd: backendLegalDocument.contentMd,
      version: 3,
      publishedAt: ISO_UPDATED,
      fromCache: false,
    },
  },
  {
    name: 'GET /subscriptions/current -> parseCurrentSubscriptionResponse',
    parse: () => parseCurrentSubscriptionResponse(backendSubscriptionRow, NOW),
    expected: {
      tier: SubscriptionTier.PRO,
      plan: SubscriptionTier.PRO,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date(ISO_PERIOD_END),
    },
  },
  {
    name: 'GET /subscriptions/current -> parseCurrentSubscriptionFromJSON',
    parse: () => parseCurrentSubscriptionFromJSON(backendSubscriptionRow),
    expected: {
      plan: SubscriptionTier.PRO,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: new Date(ISO_PERIOD_END),
      cancelAtPeriodEnd: false,
      stripeSubscriptionId: null,
    },
  },
  {
    name: 'GET /users/me (Mini subscriber) -> parseUserFromJSON',
    parse: () => parseUserFromJSON({ ...backendUser, subscriptionTier: 'MINI' }),
    expected: { subscriptionTier: SubscriptionTier.MINI },
  },
  {
    name: 'GET /subscriptions/current (MINI row) -> parseCurrentSubscriptionResponse',
    parse: () => parseCurrentSubscriptionResponse({ ...backendSubscriptionRow, plan: 'MINI' }, NOW),
    expected: { tier: SubscriptionTier.MINI, plan: SubscriptionTier.MINI },
  },
  {
    name: 'GET /usage (FREE) -> parseUsageSummary',
    parse: () => parseUsageSummary(backendUsageFree),
    expected: {
      planId: 'free',
      buckets: {
        presetNarrations: {
          limit: 20,
          used: 0,
          remaining: 20,
          period: 'month',
          renewsAt: new Date(ISO_USAGE_RENEWS),
        },
        cloneNarrations: { limit: 1, used: 0, remaining: 1, period: 'lifetime', renewsAt: null },
        cloneCreations: { limit: 1, used: 1, remaining: 0, period: 'lifetime', renewsAt: null },
      },
      voiceSlots: { preset: { used: 2, limit: 3 }, clone: { used: 1, limit: 1 } },
      features: { backgroundPlayback: false, premiumStories: false },
    },
  },
  {
    name: 'GET /usage (MINI, unlimited narrators) -> parseUsageSummary',
    parse: () => parseUsageSummary(backendUsageMini),
    expected: {
      planId: 'mini',
      buckets: {
        presetNarrations: { limit: null, used: 12, remaining: null, period: 'month' },
        cloneNarrations: { limit: 5, used: 3, remaining: 2, period: 'month' },
        cloneCreations: { limit: 2, used: 1, remaining: 1, period: 'month' },
      },
      features: { backgroundPlayback: true, premiumStories: true },
    },
  },
];

describe('backend contract: parsers read the real wire shape', () => {
  it.each(CASES.map(c => [c.name, c] as const))('%s', (_name, c) => {
    expect(c.parse()).toMatchObject(c.expected);
  });
});

// ============================================================================
// Forward compatibility: unknown extra fields never change the result
// ============================================================================

const EXTRA_FIELD_CASES: Array<readonly [string, (json: unknown) => unknown, unknown]> = [
  ['parseUserFromJSON', parseUserFromJSON, backendUser],
  ['parseStoryFromJSON', parseStoryFromJSON, backendStoryListItem],
  ['parseStoryDetailFromJSON', parseStoryDetailFromJSON, backendStoryDetail],
  ['parsePaginatedStoriesFromJSON', parsePaginatedStoriesFromJSON, backendStoryPage],
  ['parseVoiceProfileFromJSON', parseVoiceProfileFromJSON, backendFailedCloneVoiceProfile],
  ['parseCloneConfigFromJSON', parseCloneConfigFromJSON, backendCloneConfig],
  ['parseVoiceSlotInfoFromJSON', parseVoiceSlotInfoFromJSON, backendVoiceSlots],
  ['parseUsageSummary', parseUsageSummary, backendUsageMini],
  [
    'parseVoiceProfileStatusResponseFromJSON',
    parseVoiceProfileStatusResponseFromJSON,
    backendVoiceProfileStatus,
  ],
  ['parseStoryNarrationFromJSON', parseStoryNarrationFromJSON, backendNarration],
  ['parseNotificationFromJSON', parseNotificationFromJSON, backendNotification],
  [
    'parseNotificationListResponseFromJSON',
    parseNotificationListResponseFromJSON,
    backendNotificationList,
  ],
  ['parseCollectionFromJSON', parseCollectionFromJSON, backendCollection],
  ['parseLegalDocumentFromJSON', parseLegalDocumentFromJSON, backendLegalDocument],
  ['parseUserPreferencesFromJSON', parseUserPreferencesFromJSON, backendUserPreferences],
  ['parseUserStatsFromJSON', parseUserStatsFromJSON, backendUserStats],
];

describe('backend contract: extra fields from a newer backend are ignored', () => {
  it.each(EXTRA_FIELD_CASES)('%s', (_name, parse, fixture) => {
    const withExtra = {
      ...cloneFixture(fixture as Record<string, unknown>),
      fieldFromNewerBackend: { nested: ['x'] },
      anotherNewFlag: true,
    };
    expect(parse(withExtra)).toEqual(parse(cloneFixture(fixture)));
  });
});

// ============================================================================
// Required fields: a missing one fails loudly instead of rendering garbage
// ============================================================================

function without(fixture: object, field: string): Record<string, unknown> {
  const copy = cloneFixture(fixture) as Record<string, unknown>;
  delete copy[field];
  return copy;
}

const REQUIRED_FIELD_CASES: Array<readonly [string, string, (json: unknown) => unknown, object]> = [
  ['parseUserFromJSON', 'id', parseUserFromJSON, backendUser],
  ['parseUserFromJSON', 'email', parseUserFromJSON, backendUser],
  ['parseUserFromJSON', 'provider', parseUserFromJSON, backendUser],
  ['parseStoryFromJSON', 'id', parseStoryFromJSON, backendStoryListItem],
  ['parseStoryFromJSON', 'title', parseStoryFromJSON, backendStoryListItem],
  ['parseStoryFromJSON', 'ageGroup', parseStoryFromJSON, backendStoryListItem],
  ['parseStoryFromJSON', 'category', parseStoryFromJSON, backendStoryListItem],
  ['parseStoryFromJSON', 'estimatedDuration', parseStoryFromJSON, backendStoryListItem],
  ['parseStoryDetailFromJSON', 'id', parseStoryDetailFromJSON, backendStoryDetail],
  ['parseVoiceProfileFromJSON', 'id', parseVoiceProfileFromJSON, backendPresetVoiceProfile],
  ['parseVoiceProfileFromJSON', 'name', parseVoiceProfileFromJSON, backendPresetVoiceProfile],
  ['parseVoiceProfileFromJSON', 'status', parseVoiceProfileFromJSON, backendPresetVoiceProfile],
  ['parseVoiceProfileFromJSON', 'provider', parseVoiceProfileFromJSON, backendPresetVoiceProfile],
  ['parseVoiceProfileFromJSON', 'voiceId', parseVoiceProfileFromJSON, backendPresetVoiceProfile],
  ['parseVoiceProfileFromJSON', 'createdAt', parseVoiceProfileFromJSON, backendPresetVoiceProfile],
  ['parseVoiceProfileFromJSON', 'updatedAt', parseVoiceProfileFromJSON, backendPresetVoiceProfile],
  ['parseCloneConfigFromJSON', 'consentVersion', parseCloneConfigFromJSON, backendCloneConfig],
  ['parseCloneConfigFromJSON', 'consentText', parseCloneConfigFromJSON, backendCloneConfig],
  [
    'parseVoiceProfileStatusResponseFromJSON',
    'status',
    parseVoiceProfileStatusResponseFromJSON,
    backendVoiceProfileStatus,
  ],
  [
    'parseVoiceProfileStatusResponseFromJSON',
    'id',
    parseVoiceProfileStatusResponseFromJSON,
    backendVoiceProfileStatus,
  ],
  ['parseNotificationFromJSON', 'id', parseNotificationFromJSON, backendNotification],
  ['parseNotificationFromJSON', 'title', parseNotificationFromJSON, backendNotification],
  ['parseNotificationFromJSON', 'createdAt', parseNotificationFromJSON, backendNotification],
  ['parseCollectionFromJSON', 'id', parseCollectionFromJSON, backendCollection],
  ['parseCollectionFromJSON', 'slug', parseCollectionFromJSON, backendCollection],
  ['parseCollectionFromJSON', 'title', parseCollectionFromJSON, backendCollection],
  ['parseLegalDocumentFromJSON', 'slug', parseLegalDocumentFromJSON, backendLegalDocument],
  ['parseLegalDocumentFromJSON', 'title', parseLegalDocumentFromJSON, backendLegalDocument],
  ['parseLegalDocumentFromJSON', 'contentMd', parseLegalDocumentFromJSON, backendLegalDocument],
  ['parseUserPreferencesFromJSON', 'userId', parseUserPreferencesFromJSON, backendUserPreferences],
  ['parseUploadAvatarResponseFromJSON', 'avatarUrl', parseUploadAvatarResponseFromJSON, backendAvatarUpload],
];

describe('backend contract: required fields', () => {
  it.each(REQUIRED_FIELD_CASES)('%s throws without %s', (_name, field, parse, fixture) => {
    expect(() => parse(without(fixture, field))).toThrow();
  });
});

describe('backend contract: optional fields fall back to documented defaults', () => {
  it('story list item without description/cover reads as null', () => {
    const story = parseStoryFromJSON(
      without(without(backendStoryListItem, 'description'), 'coverImageUrl'),
    );
    expect(story.description).toBeNull();
    expect(story.coverImageUrl).toBeNull();
  });

  it('voice profile from an older backend (no kind/consentAt/language)', () => {
    const legacy = without(
      without(without(backendFailedCloneVoiceProfile, 'kind'), 'consentAt'),
      'language',
    );
    const profile = parseVoiceProfileFromJSON(legacy);
    expect(profile.kind).toBeNull();
    expect(profile.consentAt).toBeNull();
    expect(profile.language).toBe('tr-TR');
    // Provider fallback still classifies Cartesia as a clone.
    expect(isCloneProfile(profile)).toBe(true);
  });

  it('clone config without durations or script uses local fallbacks', () => {
    const cfg = parseCloneConfigFromJSON({
      consentVersion: '2026-09-v1',
      consentText: 'Metin',
    });
    expect(cfg).toMatchObject({ minSeconds: 15, targetSeconds: 30, maxSeconds: 60 });
    expect(cfg.script.length).toBeGreaterThan(0);
    expect(cfg.consentTitle.length).toBeGreaterThan(0);
  });

  it('slots from an older backend (no preset/clone split) fall back to canCreate', () => {
    const legacy = without(without(backendVoiceSlots, 'preset'), 'clone');
    const info = parseVoiceSlotInfoFromJSON(legacy);
    expect(info.preset).toBeNull();
    expect(info.clone).toBeNull();
    expect(canCreateCloneFromSlots(info)).toBe(true);
    expect(canCreatePresetFromSlots(info)).toBe(true);
  });

  it('slot fixture: clone slot full blocks clones but not presets', () => {
    const info = parseVoiceSlotInfoFromJSON(backendVoiceSlots);
    expect(canCreateCloneFromSlots(info)).toBe(false);
    expect(canCreatePresetFromSlots(info)).toBe(true);
  });

  it('narration without story/voiceProfile relations keeps the ids', () => {
    const n = parseStoryNarrationFromJSON(
      without(without(backendNarration, 'story'), 'voiceProfile'),
    );
    expect(n.story).toBeNull();
    expect(n.voiceProfile).toBeNull();
    expect(n.storyId).toBe(backendStoryListItem.id);
    expect(n.voiceProfileId).toBe('vp-preset-0001');
  });

  it('a broken nested story does not drop the narration', () => {
    const json = cloneFixture(backendNarration) as Record<string, unknown>;
    json.story = { id: 'x' };
    const n = parseStoryNarrationFromJSON(json);
    expect(n.id).toBe('nar-0001');
    expect(n.story).toBeNull();
  });

  it('list parsers skip unparseable items and keep the rest', () => {
    const page = cloneFixture(backendStoryPage) as { data: unknown[] };
    page.data.push({ id: 'broken' });
    expect(parsePaginatedStoriesFromJSON(page).data).toHaveLength(2);

    expect(parseCollectionsFromJSON([backendCollection, { id: 'x' }])).toHaveLength(1);
    expect(parseLegalDocumentsFromJSON([backendLegalDocument, {}])).toHaveLength(1);
  });

  it('legal document: the served language is read, and a backend without it is Turkish', () => {
    expect(parseLegalDocumentFromJSON({ ...backendLegalDocument, language: 'en' }).language).toBe('en');
    expect(parseLegalDocumentFromJSON(without(backendLegalDocument, 'language')).language).toBe('tr');
  });

  it('collection with an unknown tone falls back to ACCENT', () => {
    const json = cloneFixture(backendCollection) as Record<string, unknown>;
    json.tone = 'NEON';
    expect(parseCollectionFromJSON(json).tone).toBe('ACCENT');
  });
});

// ============================================================================
// Push routing over the real FCM data shapes
// ============================================================================

describe('backend contract: FCM data -> tap route', () => {
  it.each([
    ['NARRATION_READY', { name: 'AudioPlayer', params: { narrationId: 'nar-0002' } }],
    ['NARRATION_FAILED', { name: 'StoryDetail', params: { storyId: 'story-1' } }],
    ['VOICE_READY', { name: 'VoiceProfiles' }],
    ['VOICE_FAILED', { name: 'VoiceProfiles' }],
    ['BROADCAST', null],
  ] as const)('%s', (type, route) => {
    const payload = parsePushPayload(fcmMessages[type]);
    expect(payload).not.toBeNull();
    expect(payload?.notificationId).toMatch(/^ntf-/);
    const target = getNotificationTarget({
      type: payload!.type,
      data: payload!.data,
    });
    expect(routeForNotificationTarget(target)).toEqual(route);
  });

  it('in-app rows route the same way as pushes', () => {
    const row = parseNotificationFromJSON(socketNotification);
    expect(routeForNotificationTarget(getNotificationTarget(row))).toEqual({
      name: 'AudioPlayer',
      params: { narrationId: 'nar-0002' },
    });
    const voiceRow = parseNotificationFromJSON(backendNotification);
    expect(routeForNotificationTarget(getNotificationTarget(voiceRow))).toEqual({
      name: 'VoiceProfiles',
    });
  });

  it('socket narration_status carries the ids the player bridge needs', () => {
    expect(socketNarrationReady).toMatchObject({
      narrationId: expect.any(String),
      status: 'READY',
    });
  });
});

// ============================================================================
// Error envelopes
// ============================================================================

describe('backend contract: error envelopes', () => {
  it('409 NARRATION_EXISTS becomes a typed conflict with the existing id', () => {
    const conflict = toNarrationConflict(apiErrorFromResponse(409, backendNarrationExistsError));
    expect(conflict).not.toBeNull();
    expect(conflict?.existingNarrationId).toBe('nar-0001');
    expect(conflict?.isReady).toBe(true);
    expect(conflict?.message).toBe(backendNarrationExistsError.message);
  });

  it('403 PREMIUM_STORY keeps code and Turkish message', () => {
    const error = apiErrorFromResponse(403, backendPremiumStoryError);
    expect(error.status).toBe(403);
    expect(error.code).toBe('PREMIUM_STORY');
    expect(error.message).toBe(backendPremiumStoryError.message);
  });

  it.each([
    ['QUOTA_PRESET_MONTHLY', backendQuotaPresetMonthlyError],
    ['QUOTA_CLONE_LIFETIME', backendQuotaCloneLifetimeError],
    ['QUOTA_CLONE_MONTHLY', backendQuotaCloneMonthlyError],
    ['CLONE_CREATION_LIMIT (lifetime)', backendCloneCreationLimitError],
    ['CLONE_CREATION_LIMIT (monthly)', backendCloneCreationLimitMonthlyError],
  ])('403 %s keeps code, limit, period, renewsAt and plan in data', (_name, body) => {
    const error = apiErrorFromResponse(403, cloneFixture(body));
    expect(error.status).toBe(403);
    expect(error.code).toBe(body.code);
    expect(error.data).toMatchObject({
      code: body.code,
      plan: body.plan,
      limit: body.limit,
      used: body.used,
      period: body.period,
      renewsAt: body.renewsAt,
    });
    // The model reads the same envelope into a block with the error's plan.
    expect(parseQuotaBlock(error, 'premium')).toMatchObject({
      code: body.code,
      planId: body.plan === 'MINI' ? 'mini' : 'free',
      limit: body.limit,
      period: body.period,
      renewsAt: body.renewsAt ? new Date(body.renewsAt) : null,
    });
  });

  it('the quota codes are the backend ones (CLONE_MONTHLY_LIMIT is never thrown)', () => {
    expect(Object.values(QUOTA_CODES).sort()).toEqual(
      [
        backendQuotaPresetMonthlyError.code,
        backendQuotaCloneLifetimeError.code,
        backendQuotaCloneMonthlyError.code,
        backendCloneCreationLimitError.code,
        backendPremiumStoryError.code,
      ].sort(),
    );
  });

  it('503 maintenance passes the backend message through', () => {
    const error = apiErrorFromResponse(503, backendMaintenanceError);
    expect(error.isMaintenance).toBe(true);
    expect(error.message).toBe(backendMaintenanceError.message);
  });

  it('400 validation arrays surface the first message', () => {
    expect(apiErrorFromResponse(400, backendValidationError).message).toBe(
      backendValidationError.message[0],
    );
  });
});

// ============================================================================
// Service envelopes (ApiClient mocked with the fixtures)
// ============================================================================

describe('backend contract: service envelopes', () => {
  beforeEach(() => {
    mockApiGet.mockReset();
    mockApiPost.mockReset();
  });

  it('NarrationService.getMyNarrations reads the flat PaginatedResponse', async () => {
    mockApiGet.mockResolvedValue(cloneFixture(backendNarrationPage));
    const page = await NarrationService.getMyNarrations({ page: 1, limit: 20 });
    expect(page.data.map(n => n.id)).toEqual(['nar-0001', 'nar-0002']);
    expect(page.meta).toEqual({ page: 1, limit: 20, total: 21, totalPages: 2 });
  });

  it('NarrationService.getNarrationStatus reads status/progress/errorMessage', async () => {
    mockApiGet.mockResolvedValue(cloneFixture(backendNarrationStatus));
    await expect(NarrationService.getNarrationStatus('nar-0002')).resolves.toEqual({
      status: 'GENERATING',
      progress: 40,
      audioUrl: null,
      errorMessage: null,
    });
  });

  it('NarrationService.createNarration parses the created narration', async () => {
    mockApiPost.mockResolvedValue(cloneFixture(backendNarration));
    const created = await NarrationService.createNarration(
      backendStoryListItem.id,
      'vp-preset-0001',
    );
    expect(created.id).toBe('nar-0001');
    expect(created.story?.title).toBe('Keloğlan ile Dev');
  });

  it('VoiceProfileService.createVoiceProfile unwraps { profile, availableVoices }', async () => {
    mockApiPost.mockResolvedValue(cloneFixture(backendCreateVoiceProfileResponse));
    const profile = await VoiceProfileService.createVoiceProfile({
      name: 'Babamın Sesi',
      provider: 'CARTESIA' as never,
      voiceId: 'custom-cloning-pending',
      language: 'tr',
    });
    expect(profile.id).toBe('vp-clone-0003');
    expect(profile.status).toBe(VoiceProfileStatus.PENDING);
  });

  it('VoiceProfileService list/slots/config/status/voices read the fixtures', async () => {
    mockApiGet.mockImplementation(async (path: string) => {
      switch (path) {
        case '/voice-profiles':
          return cloneFixture([backendPresetVoiceProfile, backendFailedCloneVoiceProfile]);
        case '/voice-profiles/slots':
          return cloneFixture(backendVoiceSlots);
        case '/voice-profiles/clone-config':
          return cloneFixture(backendCloneConfig);
        case '/voice-profiles/vp-clone-0003/status':
          return cloneFixture(backendVoiceProfileStatus);
        case '/voice-profiles/available-voices':
          return cloneFixture(backendAvailableVoices);
        default:
          throw new Error(`unexpected GET ${path}`);
      }
    });

    const profiles = await VoiceProfileService.getMyVoiceProfiles();
    expect(profiles.map(p => p.kind)).toEqual(['PRESET', 'CLONE']);
    expect((await VoiceProfileService.getVoiceSlots()).clone?.monthlyLimit).toBe(1);
    expect((await VoiceProfileService.getCloneConfig()).consentVersion).toBe('2026-09-v1');
    expect((await VoiceProfileService.getVoiceProfileStatus('vp-clone-0003')).status).toBe(
      VoiceProfileStatus.PROCESSING,
    );
    expect((await VoiceProfileService.getAvailableVoices()).google).toHaveLength(1);
  });

  it('StoryService reads the stories page and detail', async () => {
    mockApiGet.mockImplementation(async (path: string) =>
      path === '/stories' ? cloneFixture(backendStoryPage) : cloneFixture(backendStoryDetail),
    );
    const page = await StoryService.getStories({ page: 2 });
    expect(page.meta.totalPages).toBe(3);
    const detail = await StoryService.getStoryById(backendStoryDetail.id);
    expect(detail.isFavorite).toBe(true);
  });

  it('NotificationService reads the list envelope and unread count', async () => {
    mockApiGet.mockImplementation(async (path: string) =>
      path.startsWith('/notifications/unread-count')
        ? cloneFixture(backendUnreadCount)
        : cloneFixture(backendNotificationList),
    );
    const list = await NotificationService.list(1, 20);
    expect(list.items).toHaveLength(2);
    expect(list.hasMore).toBe(true);
    await expect(NotificationService.getUnreadCount()).resolves.toBe(3);
  });
});

// ============================================================================
// Enums: every backend member is known to mobile
// ============================================================================

describe('backend contract: enums', () => {
  const values = (e: Record<string, string>) => Object.values(e);

  it.each([
    ['AgeGroup', AgeGroup],
    ['StoryCategory', StoryCategory],
    ['VoiceProfileStatus', VoiceProfileStatus],
    ['NarrationStatus', NarrationStatus],
    ['AudioStatus', AudioGenerationStatus],
    ['TTSProvider', TTSProvider],
  ] as const)('%s has exactly the backend members', (name, mobileEnum) => {
    expect(values(mobileEnum).sort()).toEqual([...backendEnums[name]].sort());
  });

  it('AuthProvider covers every backend provider', () => {
    backendEnums.AuthProvider.forEach(p =>
      expect(values(AuthProvider)).toContain(p),
    );
  });

  it('SubscriptionPlan members parse to themselves', () => {
    backendEnums.SubscriptionPlan.forEach(p => expect(parseSubscriptionTier(p)).toBe(p));
  });

  it('SubscriptionStatus members (CANCELLED spelling) parse without falling to EXPIRED', () => {
    expect(backendEnums.SubscriptionStatus.map(parseSubscriptionStatus)).toEqual([
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.CANCELED,
      SubscriptionStatus.EXPIRED,
      SubscriptionStatus.PAST_DUE,
    ]);
  });

  it('CollectionTone and VoiceProfileKind members are recognised', () => {
    backendEnums.CollectionTone.forEach(t => expect(isCollectionTone(t)).toBe(true));
    backendEnums.VoiceProfileKind.forEach(k => expect(parseVoiceProfileKind(k)).toBe(k));
  });

  it('NotificationType members map to a mobile type (BROADCAST reads as SYSTEM)', () => {
    expect(backendEnums.NotificationType.map(parseNotificationType)).toEqual([
      NotificationType.VOICE_READY,
      NotificationType.VOICE_FAILED,
      NotificationType.NARRATION_READY,
      NotificationType.NARRATION_FAILED,
      NotificationType.SYSTEM,
    ]);
  });
});

// ============================================================================
// Plans: the app's plan constant equals what the backend enforces and sells
// ============================================================================

describe('backend contract: plans', () => {
  const backendPlanFor: Record<PlanId, string> = { free: 'FREE', mini: 'MINI', premium: 'PRO' };
  const planOf = (planId: PlanId) => {
    const plan = backendPlans.plans.find(p => p.id === backendPlanFor[planId]);
    if (!plan) throw new Error(`no backend plan for ${planId}`);
    return plan;
  };
  const allowance = (limit: { amount: number | null; period: string }) => ({
    limit: limit.amount,
    period: limit.period,
  });

  it('the public plans are exactly Ücretsiz, Mini and Premium', () => {
    expect(backendPlans.plans.map(p => p.id)).toEqual(['FREE', 'MINI', 'PRO']);
    expect(planOf('mini').name).toBe(PLANS.mini.brandName);
    expect(planOf('premium').name).toBe(PLANS.premium.brandName);
  });

  it.each(['free', 'mini', 'premium'] as const)('%s: PLANS numbers equal the backend limits', planId => {
    const backend = planOf(planId);
    const plan = PLANS[planId];
    expect({
      presetNarrations: allowance(plan.presetNarrations),
      cloneNarrations: allowance(plan.clonedNarrations),
      cloneCreations: allowance(plan.cloneCreations),
    }).toEqual(backend.allowances);
    expect(plan.backgroundPlayback).toBe(backend.limits.backgroundPlayback);
    expect(plan.premiumStories).toBe(backend.limits.premiumStories);
  });

  it.each(['mini', 'premium'] as const)('%s: prices and Google Play products equal the backend', planId => {
    const backend = planOf(planId);
    const plan = PLANS[planId];
    expect(plan.prices).toEqual({ monthly: backend.price, yearly: backend.yearlyPrice });
    expect(plan.productIds).toEqual({
      monthly: backend.googleProductId,
      yearly: backend.googleYearlyProductId,
    });
  });

  it('free has no price and no product', () => {
    expect(planOf('free').price).toBe(0);
    expect(planOf('free').products).toEqual([]);
    expect(PLANS.free.prices).toEqual({ monthly: null, yearly: null });
  });
});

describe('contract fixtures hygiene', () => {
  it('fixtures are plain JSON (no Date objects or undefined)', () => {
    const all = [
      backendUser,
      backendNarration,
      backendNarrationPage,
      backendStoryPage,
      backendVoiceSlots,
      backendSubscriptionRow,
      backendNotificationList,
      backendPlans,
      backendUsageFree,
      backendUsageMini,
      backendQuotaPresetMonthlyError,
      backendQuotaCloneLifetimeError,
      backendQuotaCloneMonthlyError,
      backendCloneCreationLimitError,
      backendCloneCreationLimitMonthlyError,
    ];
    all.forEach(f => expect(cloneFixture(f)).toEqual(f));
  });
});
