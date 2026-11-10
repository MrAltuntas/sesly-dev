/**
 * Unit tests for the model helpers and parser branches the contract test
 * does not reach (legacy field aliases, error paths, derived helpers).
 */

import {
  getStoryChunkPreview,
  getStoryDurationLabel,
  getStoryReadingTime,
  hasMoreStories,
  isStoryCompleted,
  parsePaginatedStoriesFromJSON,
  parseStoryChunkFromJSON,
  parseStoryDetailFromJSON,
  parseStoryFromJSON,
  parseUserProgressFromJSON,
} from './Story';
import {
  StoryNarration,
  getNarrationProgressPercentage,
  isNarrationFailed,
  isNarrationGenerating,
  isNarrationPending,
  isNarrationReady,
  parseStoryNarrationFromJSON,
  parseVoiceSlotInfoFromJSON as parseNarrationSlotInfo,
} from './Narration';
import {
  User,
  getUserFullName,
  getUserInitials,
  hasActiveSubscription,
  parseUploadAvatarResponseFromJSON,
  parseUserFromJSON,
  updateUserRequestToJSON,
  userToJSON,
} from './User';
import {
  getAudioUsagePercentage,
  getDaysUntilRenewal,
  getMonthlySavings,
  getRemainingAudio,
  getRemainingVoiceProfiles,
  getSubscriptionPrice,
  getVoiceProfileUsagePercentage,
  isAudioLimitReached,
  isSubscriptionActive,
  isVoiceProfileLimitReached,
  parseCheckoutSessionResponseFromJSON,
  parseCurrentSubscriptionFromJSON,
  parseCurrentSubscriptionResponse,
  parseSubscriptionPlanFromJSON,
  parseUsageFromJSON,
  parseUsageLimitsFromJSON,
  willSubscriptionRenew,
} from './Subscription';
import {
  isCollectionTone,
  parseCollectionFromJSON,
  parseCollectionsFromJSON,
} from './Collection';
import {
  isLegalLanguageFallback,
  isLegalSlug,
  parseLegalDocumentFromJSON,
  parseLegalDocumentsFromJSON,
  parseLegalLanguage,
} from './Legal';
import { formatHoursListened, parseUserStatsFromJSON } from './UserStats';
import { parseUserPreferencesFromJSON } from './UserPreferences';
import {
  VoiceProfile,
  createVoiceProfileRequestToJSON,
  getTotalVoiceCount,
  hasAvailableVoiceSlots,
  isVoiceProfileFailed,
  isVoiceProfilePending,
  isVoiceProfileProcessing,
  isVoiceProfileReady,
  isVoiceProfileStatusComplete,
  isVoiceSlotLimitReached,
  parseAvailableCartesiaVoiceFromJSON,
  parseAvailableGoogleVoiceFromJSON,
  parseAvailableVoicesResponseFromJSON,
  parseVoiceProfileFromJSON,
  parseVoiceProfileStatusResponseFromJSON,
  parseVoiceSlotInfoFromJSON,
  voiceProfileToJSON,
} from './VoiceProfile';
import {
  NotificationType,
  getNotificationTarget,
  isNarrationNotification,
  isVoiceNotification,
  parseNotificationFromJSON,
  parseNotificationListResponseFromJSON,
  parsePushPayload,
  parseUnreadCountFromJSON,
} from './Notification';
import {
  AudioGenerationStatus,
  AuthProvider,
  BillingPeriod,
  NarrationStatus,
  StoryCategory,
  SubscriptionStatus,
  SubscriptionTier,
  TTSProvider,
  VoiceProfileStatus,
} from '../types/enums';

const ISO = '2026-09-27T10:00:00.000Z';

// Silence the parser warnings/debug logs these error paths produce.
beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

// ============================================================================
// Audio (legacy audio library model)
// ============================================================================

describe('Story helpers', () => {
  it('duration labels', () => {
    expect(getStoryDurationLabel(7)).toBe('7 dakika');
    expect(getStoryDurationLabel(60)).toBe('1 saat');
    expect(getStoryDurationLabel(95)).toBe('1 saat 35 dakika');
  });

  it('parseStoryChunkFromJSON reads backend and legacy field names', () => {
    expect(
      parseStoryChunkFromJSON({ id: 'c1', chunkIndex: 2, content: 'Bir varmış', startTime: 1, endTime: 5 }),
    ).toEqual({ id: 'c1', index: 2, text: 'Bir varmış', startPosition: 1, endPosition: 5 });
    expect(
      parseStoryChunkFromJSON({ id: 'c2', index: 0, text: 'Bir yokmuş', startPosition: 3, endPosition: 9 }),
    ).toEqual({ id: 'c2', index: 0, text: 'Bir yokmuş', startPosition: 3, endPosition: 9 });
    expect(parseStoryChunkFromJSON({ id: 'c3', index: 1, text: 'x' })).toMatchObject({
      startPosition: 0,
      endPosition: 0,
    });
  });

  it('parseStoryChunkFromJSON rejects incomplete chunks', () => {
    expect(() => parseStoryChunkFromJSON(null)).toThrow();
    expect(() => parseStoryChunkFromJSON({ index: 0, text: 'x' })).toThrow('id');
    expect(() => parseStoryChunkFromJSON({ id: 'c', text: 'x' })).toThrow('index');
    expect(() => parseStoryChunkFromJSON({ id: 'c', index: 0 })).toThrow('text');
  });

  it('chunk preview truncates with three dots', () => {
    const chunk = { id: 'c', index: 0, text: 'a'.repeat(120), startPosition: 0, endPosition: 0 };
    expect(getStoryChunkPreview(chunk)).toBe(`${'a'.repeat(100)}...`);
    expect(getStoryChunkPreview({ ...chunk, text: 'kisa' })).toBe('kisa');
  });

  it('user progress', () => {
    const done = parseUserProgressFromJSON({ lastChunkIndex: 3, completedAt: ISO });
    expect(done.completedAt?.toISOString()).toBe(ISO);
    expect(isStoryCompleted(done)).toBe(true);
    expect(isStoryCompleted(parseUserProgressFromJSON({ lastChunkIndex: 0 }))).toBe(false);
    expect(() => parseUserProgressFromJSON({})).toThrow('lastChunkIndex');
    expect(() => parseUserProgressFromJSON(null)).toThrow();
  });

  it('story detail with chunks and progress (older backend shape)', () => {
    const detail = parseStoryDetailFromJSON({
      id: 's-1',
      chunks: [{ id: 'c1', chunkIndex: 0, content: 'Metin' }],
      userProgress: { lastChunkIndex: 0 },
    });
    expect(detail).toMatchObject({
      title: '',
      description: null,
      language: 'tr',
      estimatedDuration: 0,
      coverImageUrl: null,
      isPremium: false,
      isFavorite: false,
    });
    expect(detail.chunks).toHaveLength(1);
    expect(detail.userProgress?.lastChunkIndex).toBe(0);
    expect(() => parseStoryDetailFromJSON(null)).toThrow();
  });

  it('reading time and pagination helpers', () => {
    expect(getStoryReadingTime('kelime '.repeat(401).trim())).toBe('3 dk okuma');
    const page = parsePaginatedStoriesFromJSON({});
    expect(page.meta).toEqual({ page: 1, limit: 20, total: 0, totalPages: 1 });
    expect(hasMoreStories(page)).toBe(false);
    expect(() => parsePaginatedStoriesFromJSON(null)).toThrow();
    expect(() => parseStoryFromJSON('x')).toThrow();
  });
});

// ============================================================================
// Narration
// ============================================================================

describe('Narration helpers', () => {
  const narration = (status: string, extra: Record<string, unknown> = {}): StoryNarration =>
    parseStoryNarrationFromJSON({ id: 'n', storyId: 's', status, createdAt: ISO, ...extra });

  it('status predicates', () => {
    expect(isNarrationReady(narration(NarrationStatus.READY))).toBe(true);
    expect(isNarrationGenerating(narration(NarrationStatus.GENERATING))).toBe(true);
    expect(isNarrationFailed(narration(NarrationStatus.FAILED))).toBe(true);
    expect(isNarrationPending(narration(NarrationStatus.PENDING))).toBe(true);
  });

  it('progress percentage', () => {
    expect(getNarrationProgressPercentage(narration('GENERATING'))).toBe(0);
    expect(
      getNarrationProgressPercentage(narration('GENERATING', { totalChunks: 4, completedChunks: 1 })),
    ).toBe(25);
  });

  it('parses audio chunks and defaults a missing status to PENDING', () => {
    const n = parseStoryNarrationFromJSON({
      id: 'n',
      audioChunks: [
        { chunkIndex: 1, audioUrl: 'u', duration: 3, status: 'READY' },
        null,
        {},
      ],
      duration: '42',
      isPreGenerated: 1,
    });
    expect(n.status).toBe(NarrationStatus.PENDING);
    expect(n.audioChunks).toEqual([
      { chunkIndex: 1, audioUrl: 'u', duration: 3, status: 'READY' },
      { chunkIndex: 0, audioUrl: null, duration: 0, status: 'PENDING' },
      { chunkIndex: 0, audioUrl: null, duration: 0, status: 'PENDING' },
    ]);
    expect(n.totalDuration).toBe(42);
    expect(n.isPreGenerated).toBe(true);
    expect(n.voiceProfileId).toBeNull();
    expect(n.audioUrl).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(() => parseStoryNarrationFromJSON(null)).toThrow();
  });

  it('keeps a broken voice profile relation from dropping the narration', () => {
    const n = parseStoryNarrationFromJSON({ id: 'n', voiceProfile: { id: 'v' }, audioUrl: 'x' });
    expect(n.voiceProfile).toBeNull();
    expect(n.audioUrl).toBe('x');
  });

  it('legacy slot info parser in Narration.ts requires every field', () => {
    const full = {
      plan: 'FREE',
      totalSlots: 4,
      usedSlots: 1,
      availableSlots: 3,
      extraSlots: 0,
      canCreate: true,
    };
    expect(parseNarrationSlotInfo(full)).toEqual(full);
    expect(() => parseNarrationSlotInfo(null)).toThrow();
    (['plan', 'totalSlots', 'usedSlots', 'availableSlots', 'extraSlots', 'canCreate'] as const).forEach(
      field => {
        const json: Record<string, unknown> = { ...full };
        delete json[field];
        expect(() => parseNarrationSlotInfo(json)).toThrow(field);
      },
    );
  });
});

// ============================================================================
// User
// ============================================================================

describe('User helpers', () => {
  const user = (extra: Record<string, unknown> = {}): User =>
    parseUserFromJSON({
      id: 'u',
      email: 'deniz@example.com',
      provider: 'email',
      subscriptionTier: 'FREE',
      createdAt: ISO,
      updatedAt: ISO,
      ...extra,
    });

  it('normalizes provider case and falls back to avatarUrl', () => {
    const u = user({ avatarUrl: 'https://a/b.jpg' });
    expect(u.provider).toBe(AuthProvider.EMAIL);
    expect(u.profileImageUrl).toBe('https://a/b.jpg');
  });

  it('full name and initials', () => {
    expect(getUserFullName(user({ firstName: 'Ali', lastName: 'Kaya' }))).toBe('Ali Kaya');
    expect(getUserFullName(user({ firstName: 'Ali' }))).toBe('Ali');
    expect(getUserFullName(user({ lastName: 'Kaya' }))).toBe('Kaya');
    // No names: null, never the e-mail's local part (a private relay id).
    expect(getUserFullName(user())).toBeNull();
    expect(getUserFullName(user({ firstName: '  ', email: 'x7k2abc9d@privaterelay.appleid.com' }))).toBeNull();
    expect(getUserInitials(user({ firstName: 'ali', lastName: 'kaya' }))).toBe('AK');
    expect(getUserInitials(user({ firstName: 'ali' }))).toBe('A');
    expect(getUserInitials(user())).toBe('D');
  });

  it('pro and active subscription', () => {
    const now = Date.now();
    const future = new Date(now + 86_400_000).toISOString();
    const past = new Date(now - 86_400_000).toISOString();
    expect(hasActiveSubscription(user({ subscriptionTier: 'MINI', subscriptionExpiresAt: future }))).toBe(true);
    expect(hasActiveSubscription(user({ subscriptionTier: 'CREATOR', subscriptionExpiresAt: future }))).toBe(true);
    expect(hasActiveSubscription(user())).toBe(false);
    expect(hasActiveSubscription(user({ subscriptionTier: 'PRO' }))).toBe(false);
    expect(hasActiveSubscription(user({ subscriptionTier: 'PRO', subscriptionExpiresAt: future }))).toBe(true);
    expect(hasActiveSubscription(user({ subscriptionTier: 'PRO', subscriptionExpiresAt: past }))).toBe(false);
  });

  it('round-trips through userToJSON', () => {
    const u = user({ firstName: 'Ali', subscriptionExpiresAt: ISO });
    expect(parseUserFromJSON(userToJSON(u))).toEqual(u);
    expect(userToJSON(user()).subscriptionExpiresAt).toBeNull();
  });

  it('update request drops empty fields', () => {
    expect(updateUserRequestToJSON({ firstName: 'Ali', lastName: '', email: undefined })).toEqual({
      firstName: 'Ali',
    });
    expect(updateUserRequestToJSON({ lastName: 'Kaya', email: 'a@b.c' })).toEqual({
      lastName: 'Kaya',
      email: 'a@b.c',
    });
  });

  it('rejects invalid payloads', () => {
    expect(() => parseUserFromJSON(null)).toThrow();
    expect(() => parseUploadAvatarResponseFromJSON(null)).toThrow();
  });
});

// ============================================================================
// Subscription (plan / usage parsers kept for the IAP work)
// ============================================================================

describe('Subscription parsers and helpers', () => {
  const planJSON = {
    id: 'pro',
    name: 'Pro',
    tier: 'PRO',
    monthlyPrice: 100,
    yearlyPrice: 960,
    features: ['a', 3, 'b'],
    audioLimit: -1,
    voiceProfileLimit: 13,
    isPopular: 1,
  };

  it('parses a plan and computes prices', () => {
    const plan = parseSubscriptionPlanFromJSON(planJSON);
    expect(plan).toMatchObject({ currency: 'TRY', features: ['a', 'b'], isPopular: true });
    expect(getSubscriptionPrice(plan, BillingPeriod.MONTHLY)).toBe(100);
    expect(getSubscriptionPrice(plan, BillingPeriod.YEARLY)).toBe(960);
    expect(getMonthlySavings(plan)).toBe(20);
  });

  it.each(['id', 'name', 'tier', 'monthlyPrice', 'yearlyPrice', 'audioLimit', 'voiceProfileLimit'])(
    'plan requires %s',
    field => {
      const json: Record<string, unknown> = { ...planJSON };
      delete json[field];
      expect(() => parseSubscriptionPlanFromJSON(json)).toThrow(field);
    },
  );

  it('current subscription row helpers', () => {
    const row = {
      plan: 'PRO',
      status: 'ACTIVE',
      billingPeriod: 'monthly',
      currentPeriodStart: ISO,
      currentPeriodEnd: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      cancelAtPeriodEnd: false,
      provider: 'APPLE',
      autoRenew: true,
      stripeSubscriptionId: 'sub_1',
    };
    const sub = parseCurrentSubscriptionFromJSON(row);
    expect(sub).toMatchObject({ billingPeriod: 'monthly', provider: 'APPLE', autoRenew: true });
    expect(isSubscriptionActive(sub)).toBe(true);
    expect(willSubscriptionRenew(sub)).toBe(true);
    expect(willSubscriptionRenew({ ...sub, cancelAtPeriodEnd: true })).toBe(false);
    expect(getDaysUntilRenewal(sub)).toBe(3);
    expect(() => parseCurrentSubscriptionFromJSON(null)).toThrow();
    (['plan', 'status', 'currentPeriodStart', 'currentPeriodEnd'] as const).forEach(field => {
      const json: Record<string, unknown> = { ...row };
      delete json[field];
      expect(() => parseCurrentSubscriptionFromJSON(json)).toThrow(field);
    });
  });

  it('parseCurrentSubscriptionResponse tolerates tier/expiresAt aliases and bad dates', () => {
    const now = new Date('2026-09-28T00:00:00.000Z');
    expect(
      parseCurrentSubscriptionResponse({ tier: 'PRO', expiresAt: '2026-10-28T00:00:00.000Z' }, now),
    ).toMatchObject({ tier: SubscriptionTier.PRO, status: SubscriptionStatus.ACTIVE });
    expect(
      parseCurrentSubscriptionResponse({ plan: 'PRO', currentPeriodEnd: 'not-a-date' }, now)
        .currentPeriodEnd,
    ).toBeNull();
  });

  it('checkout, usage and limits', () => {
    expect(parseCheckoutSessionResponseFromJSON({ sessionId: 's', url: 'u' })).toEqual({
      sessionId: 's',
      url: 'u',
    });
    expect(() => parseCheckoutSessionResponseFromJSON({ sessionId: 's' })).toThrow('url');
    expect(() => parseCheckoutSessionResponseFromJSON({ url: 'u' })).toThrow('sessionId');
    expect(() => parseCheckoutSessionResponseFromJSON(null)).toThrow();

    const usageJSON = {
      audioGenerated: 3,
      audioLimit: 5,
      voiceProfiles: 4,
      voiceProfileLimit: 4,
      resetDate: ISO,
    };
    const usage = parseUsageFromJSON(usageJSON);
    expect(getRemainingAudio(usage)).toBe(2);
    expect(getRemainingVoiceProfiles(usage)).toBe(0);
    expect(getAudioUsagePercentage(usage)).toBe(60);
    expect(getVoiceProfileUsagePercentage(usage)).toBe(100);
    expect(isAudioLimitReached(usage)).toBe(false);
    expect(isVoiceProfileLimitReached(usage)).toBe(true);
    expect(getAudioUsagePercentage({ ...usage, audioLimit: 0 })).toBe(0);
    expect(getVoiceProfileUsagePercentage({ ...usage, voiceProfileLimit: 0 })).toBe(0);
    expect(() => parseUsageFromJSON(null)).toThrow();
    Object.keys(usageJSON).forEach(field => {
      const json: Record<string, unknown> = { ...usageJSON };
      delete json[field];
      expect(() => parseUsageFromJSON(json)).toThrow(field);
    });

    expect(parseUsageLimitsFromJSON({ audioLimit: 5, voiceProfileLimit: 4, plan: 'FREE' })).toEqual({
      audioLimit: 5,
      voiceProfileLimit: 4,
      plan: 'FREE',
    });
    expect(() => parseUsageLimitsFromJSON(null)).toThrow();
    expect(() => parseUsageLimitsFromJSON({ voiceProfileLimit: 4, plan: 'FREE' })).toThrow('audioLimit');
    expect(() => parseUsageLimitsFromJSON({ audioLimit: 5, plan: 'FREE' })).toThrow('voiceProfileLimit');
    expect(() => parseUsageLimitsFromJSON({ audioLimit: 5, voiceProfileLimit: 4 })).toThrow('plan');
  });
});

// ============================================================================
// Collection, Legal, stats, preferences
// ============================================================================

describe('Collection and Legal', () => {
  it('guards', () => {
    expect(isCollectionTone('SUN')).toBe(true);
    expect(isCollectionTone('sun')).toBe(false);
    expect(isLegalSlug('tos')).toBe(true);
    expect(isLegalSlug('cookies')).toBe(false);
  });

  it('collection defaults and Date inputs', () => {
    const c = parseCollectionFromJSON({
      id: 'c',
      slug: 's',
      title: 'T',
      isActive: undefined,
      createdAt: new Date(ISO),
      updatedAt: 5,
    });
    expect(c).toMatchObject({
      subtitle: null,
      description: null,
      tone: 'ACCENT',
      coverImageUrl: null,
      isActive: true,
      sortOrder: 0,
      storyCount: 0,
      createdAt: ISO,
      updatedAt: '',
    });
    expect(parseCollectionFromJSON({ id: 'c', slug: 's', title: 'T', isActive: false }).isActive).toBe(false);
    expect(() => parseCollectionFromJSON(null)).toThrow();
    expect(() => parseCollectionsFromJSON({})).toThrow();
  });

  it('legal defaults', () => {
    expect(
      parseLegalDocumentFromJSON({ slug: 'tos', title: 'T', contentMd: '', version: NaN, publishedAt: new Date(ISO), fromCache: true }),
    ).toEqual({ slug: 'tos', language: 'tr', title: 'T', contentMd: '', version: 1, publishedAt: ISO, fromCache: true });
    expect(parseLegalDocumentFromJSON({ slug: 'tos', title: 'T', contentMd: '' }).publishedAt).toBe('');
    expect(parseLegalDocumentFromJSON({ slug: 'tos', language: 'en', title: 'T', contentMd: '' }).language).toBe('en');
    expect(() => parseLegalDocumentFromJSON(null)).toThrow();
    expect(() => parseLegalDocumentsFromJSON('x')).toThrow();
  });

  it('legal languages: anything but en is Turkish, and only a Turkish answer to another language is a fallback', () => {
    expect(parseLegalLanguage('en')).toBe('en');
    expect(parseLegalLanguage('tr')).toBe('tr');
    expect(parseLegalLanguage(undefined)).toBe('tr');
    expect(parseLegalLanguage('de')).toBe('tr');
    expect(parseLegalLanguage('EN')).toBe('tr');

    expect(isLegalLanguageFallback('en', 'tr')).toBe(true);
    expect(isLegalLanguageFallback('en', 'en')).toBe(false);
    expect(isLegalLanguageFallback('tr', 'tr')).toBe(false);
    expect(isLegalLanguageFallback('tr', 'en')).toBe(false);
  });
});

describe('UserStats and UserPreferences', () => {
  it('stats coerce strings, clamp negatives and round counts', () => {
    expect(parseUserStatsFromJSON({ storiesCompleted: '4.6', hoursListened: -2, voicesTrained: 'x' })).toEqual({
      storiesCompleted: 5,
      hoursListened: 0,
      voicesTrained: 0,
    });
    expect(() => parseUserStatsFromJSON(null)).toThrow();
  });

  it('formatHoursListened', () => {
    expect(formatHoursListened(0.34)).toBe('0.3');
    expect(formatHoursListened(2.6)).toBe('3');
    expect(formatHoursListened(-1)).toBe('0');
    expect(formatHoursListened(NaN)).toBe('0');
  });

  it('preferences fall back to the backend defaults', () => {
    expect(parseUserPreferencesFromJSON({ userId: 'u', settings: [1], createdAt: new Date(ISO) })).toEqual({
      userId: 'u',
      sleepTimerFadeOut: true,
      sleepTimerPauseWhenAsleep: false,
      sleepTimerLastDuration: null,
      voiceReadyNotifications: true,
      narrationReadyNotifications: true,
      promoNotifications: false,
      contentLanguage: null,
      effectiveContentLanguage: null,
      uiLanguage: null,
      settings: {},
      createdAt: ISO,
      updatedAt: '',
    });
    expect(() => parseUserPreferencesFromJSON(null)).toThrow();
    // The UI language the backend writes in: one of the two, else unknown.
    expect(parseUserPreferencesFromJSON({ userId: 'u', uiLanguage: 'en' }).uiLanguage).toBe('en');
    expect(parseUserPreferencesFromJSON({ userId: 'u', uiLanguage: 'de' }).uiLanguage).toBeNull();
  });
});

// ============================================================================
// VoiceProfile
// ============================================================================

describe('VoiceProfile helpers', () => {
  const profileJSON = {
    id: 'v',
    name: 'Annem',
    status: 'PROCESSING',
    provider: 'CARTESIA',
    voiceId: 'pending-v',
    voiceModelId: 'model-1',
    consentAt: 'not-a-date',
    createdAt: ISO,
    updatedAt: ISO,
  };

  it('status predicates', () => {
    const p = (status: VoiceProfileStatus): VoiceProfile =>
      parseVoiceProfileFromJSON({ ...profileJSON, status });
    expect(isVoiceProfileProcessing(p(VoiceProfileStatus.PROCESSING))).toBe(true);
    expect(isVoiceProfileProcessing(p(VoiceProfileStatus.PENDING))).toBe(true);
    expect(isVoiceProfilePending(p(VoiceProfileStatus.PENDING))).toBe(true);
    expect(isVoiceProfileReady(p(VoiceProfileStatus.READY))).toBe(true);
    expect(isVoiceProfileFailed(p(VoiceProfileStatus.FAILED))).toBe(true);
  });

  it('round-trips through voiceProfileToJSON', () => {
    const p = parseVoiceProfileFromJSON(profileJSON);
    expect(p.consentAt).toBeNull();
    expect(p.voiceModelId).toBe('model-1');
    expect(parseVoiceProfileFromJSON(voiceProfileToJSON(p))).toEqual(p);
    const withConsent = parseVoiceProfileFromJSON({ ...profileJSON, consentAt: ISO });
    expect(voiceProfileToJSON(withConsent).consentAt).toBe(ISO);
    expect(() => parseVoiceProfileFromJSON(null)).toThrow();
  });

  it('slot info accepts legacy names and numeric strings', () => {
    const info = parseVoiceSlotInfoFromJSON({ used: '2', limit: '4', available: '2', plan: 'PRO' });
    expect(info).toMatchObject({ used: 2, limit: 4, available: 2, plan: 'pro', canCreate: true });
    expect(hasAvailableVoiceSlots(info)).toBe(true);
    expect(isVoiceSlotLimitReached(info)).toBe(false);
    expect(
      parseVoiceSlotInfoFromJSON({ usedSlots: '4', totalSlots: '4', availableSlots: '0' }),
    ).toMatchObject({ used: 4, limit: 4, available: 0, plan: 'free', canCreate: false });
    expect(parseVoiceSlotInfoFromJSON({ used: 1, limit: 2, available: 1 })).toMatchObject({
      used: 1,
      limit: 2,
      available: 1,
    });
    expect(parseVoiceSlotInfoFromJSON({})).toMatchObject({ used: 0, limit: 0, available: 0 });
    expect(() => parseVoiceSlotInfoFromJSON({ usedSlots: 'abc' })).toThrow('numeric');
    expect(() => parseVoiceSlotInfoFromJSON(null)).toThrow();
    // Per-kind slots with string numbers and a bad sub-object.
    expect(
      parseVoiceSlotInfoFromJSON({ preset: { used: '1', limit: 'x' }, clone: [] }),
    ).toMatchObject({ preset: { used: 1, limit: 0, canCreate: false }, clone: null });
  });

  it('available voices: legacy array shape, defaults and bad entries', () => {
    const res = parseAvailableVoicesResponseFromJSON([
      { provider: 'CARTESIA', voices: [{ voiceId: 'c-1', name: 'Sonic' }, { name: 'no-id' }] },
      {
        provider: 'Google',
        voices: [
          { id: 'tr-TR-Chirp3-HD-Kore', name: 'Kore' },
          { id: 'g-1', name: 'Wavenet A' },
          { id: 'g-2' },
        ],
      },
      { provider: 'azure', voices: [{ id: 'a', name: 'A' }] },
      null,
      { voices: 'x' },
    ]);
    expect(res.cartesia).toEqual([
      {
        id: 'c-1',
        voiceId: 'c-1',
        name: 'Sonic',
        language: 'Turkish',
        languageCode: 'tr-TR',
        gender: 'UNKNOWN',
        description: '',
        provider: 'CARTESIA',
        locale: 'tr-TR',
        isPremium: null,
      },
    ]);
    // Only Chirp 3 voices are ready-made narrators.
    expect(res.google.map(v => v.id)).toEqual(['tr-TR-Chirp3-HD-Kore']);
    expect(res.google[0].provider).toBe('GOOGLE');
    expect(getTotalVoiceCount(res)).toBe(2);

    const obj = parseAvailableVoicesResponseFromJSON({
      cartesia: [{ id: 'c', name: 'C' }, {}],
      google: [{}, { id: 'en-US-Chirp3-HD-Puck', name: 'Puck' }],
    });
    expect(getTotalVoiceCount(obj)).toBe(2);
    expect(getTotalVoiceCount(parseAvailableVoicesResponseFromJSON(null))).toBe(0);
    expect(() => parseAvailableCartesiaVoiceFromJSON(null)).toThrow();
    expect(() => parseAvailableGoogleVoiceFromJSON(null)).toThrow();
  });

  it('status response aliases and error payloads', () => {
    const s = parseVoiceProfileStatusResponseFromJSON({
      voiceProfileId: 'v-9',
      status: 'READY',
      progress: 100,
      error: 'legacy error',
    });
    expect(s).toMatchObject({ id: 'v-9', provider: 'GOOGLE', voiceId: '', name: '', errorMessage: 'legacy error' });
    expect(isVoiceProfileStatusComplete(s)).toBe(true);
    expect(isVoiceProfileStatusComplete({ ...s, progress: 40 })).toBe(false);
    expect(() =>
      parseVoiceProfileStatusResponseFromJSON({ statusCode: 404, message: 'Not found' }),
    ).toThrow('HTTP 404');
    expect(() => parseVoiceProfileStatusResponseFromJSON({ statusCode: 500 })).toThrow('unknown');
    expect(() => parseVoiceProfileStatusResponseFromJSON(null)).toThrow();
  });

  it('create request serializes exactly the DTO fields', () => {
    expect(
      createVoiceProfileRequestToJSON({
        name: 'Annem',
        provider: TTSProvider.CARTESIA,
        voiceId: 'custom-cloning-pending',
        language: 'tr',
      }),
    ).toEqual({ name: 'Annem', provider: 'CARTESIA', voiceId: 'custom-cloning-pending', language: 'tr' });
  });
});

// ============================================================================
// Notification
// ============================================================================

describe('Notification parsers (alternate shapes)', () => {
  const row = { id: 'n', title: 'T', createdAt: ISO };

  it('reads legacy description/isRead fields', () => {
    const n = parseNotificationFromJSON({ ...row, description: 'eski', isRead: true, data: [1] });
    expect(n).toMatchObject({ body: 'eski', read: true, data: null, userId: '' });
    expect(parseNotificationFromJSON(row)).toMatchObject({ body: '', read: false });
    expect(() => parseNotificationFromJSON(null)).toThrow();
  });

  it('list envelope variants', () => {
    expect(parseNotificationListResponseFromJSON({ notifications: [row, { id: 'bad' }] })).toMatchObject({
      items: [{ id: 'n' }],
      total: 1,
      page: 1,
      limit: 1,
      hasMore: false,
    });
    expect(parseNotificationListResponseFromJSON([row, row]).items).toHaveLength(2);
    expect(parseNotificationListResponseFromJSON({ items: [], hasMore: true }).hasMore).toBe(true);
    expect(parseNotificationListResponseFromJSON({})).toMatchObject({ items: [], total: 0 });
    expect(() => parseNotificationListResponseFromJSON(null)).toThrow();
  });

  it('unread count variants', () => {
    expect(parseUnreadCountFromJSON(7)).toBe(7);
    expect(parseUnreadCountFromJSON({ count: 2 })).toBe(2);
    expect(parseUnreadCountFromJSON({ unread: 4 })).toBe(4);
    expect(parseUnreadCountFromJSON({ unreadCount: 5 })).toBe(5);
    expect(parseUnreadCountFromJSON({})).toBe(0);
    expect(parseUnreadCountFromJSON(null)).toBe(0);
  });

  it('push payload with only a notification block', () => {
    expect(parsePushPayload({ notification: { title: 'T' } })).toEqual({
      type: NotificationType.SYSTEM,
      notificationId: null,
      data: {},
      title: 'T',
      body: null,
    });
    expect(parsePushPayload(undefined)).toBeNull();
  });

  it('type groups', () => {
    expect(isVoiceNotification(NotificationType.VOICE_FAILED)).toBe(true);
    expect(isVoiceNotification(NotificationType.NARRATION_READY)).toBe(false);
    expect(isNarrationNotification(NotificationType.NARRATION_FAILED)).toBe(true);
    expect(isNarrationNotification(NotificationType.SYSTEM)).toBe(false);
  });

  it('narration targets without ids go nowhere; empty strings count as missing', () => {
    expect(getNotificationTarget({ type: NotificationType.NARRATION_READY, data: null })).toEqual({
      kind: 'none',
    });
    expect(
      getNotificationTarget({ type: NotificationType.NARRATION_READY, data: { narrationId: '', storyId: '' } }),
    ).toEqual({ kind: 'none' });
    expect(
      getNotificationTarget({ type: NotificationType.NARRATION_FAILED, data: { narrationId: 'n' } }),
    ).toEqual({ kind: 'none' });
    expect(
      getNotificationTarget({ type: NotificationType.NARRATION_READY, data: { narrationId: 5 } }),
    ).toEqual({ kind: 'none' });
  });
});
