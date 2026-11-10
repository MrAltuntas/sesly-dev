/**
 * API CONTRACT: response shapes the mobile app and the admin panel parse.
 *
 * Every assertion here is an EXACT key set produced by the real mappers /
 * services (only I/O is mocked). Renaming, removing or adding a field makes
 * this file fail on purpose: when that happens, update the clients
 * (sesly-mobile, sesly-admin-frontend) in the same change and then update the
 * expected keys below. Values are not the point here; the per-module specs
 * cover behaviour.
 */
import { ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { createI18nStub } from '../test-utils/i18n';
import { PaginationHelper } from '../common/utils/pagination.helper';
import { createMockPrismaService, MockPrismaService } from '../test-utils/prisma-mock';
import { NarrationsService } from '../modules/narrations/narrations.service';
import { toStoryListItem } from '../modules/stories/story-list.mapper';
import { StoriesService } from '../modules/stories/stories.service';
import { CollectionsService } from '../modules/collections/collections.service';
import { toPublicVoiceProfile } from '../modules/voice-profiles/voice-profile.mapper';
import { VoiceProfilesService } from '../modules/voice-profiles/voice-profiles.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { UserPreferencesService } from '../modules/user-preferences/user-preferences.service';
import { UsageService } from '../modules/usage/usage.service';
import { AudioService } from '../modules/audio/audio.service';
import { AuthService } from '../modules/auth/auth.service';
import { AppConfigService } from '../modules/app-config/app-config.service';
import { createSettingsStub } from '../test-utils/settings-stub';

const mockFirebase = {
  apps: [{}] as unknown[],
  verifyIdToken: jest.fn(),
  messaging: {
    sendEachForMulticast: jest.fn(),
    sendEach: jest.fn(),
  },
};
jest.mock('firebase-admin', () => ({
  get apps() {
    return mockFirebase.apps;
  },
  auth: () => ({ verifyIdToken: mockFirebase.verifyIdToken }),
  messaging: () => mockFirebase.messaging,
}));

const keys = (o: object | null | undefined) => Object.keys(o ?? {}).sort();
const sorted = (k: string[]) => [...k].sort();

// ---------------------------------------------------------------------------
// Expected shapes (the contract)
// ---------------------------------------------------------------------------

const PAGINATED_KEYS = ['data', 'total', 'page', 'limit', 'totalPages'];

const ERROR_KEYS = ['success', 'statusCode', 'message', 'path', 'method', 'timestamp'];

const STORY_LIST_ITEM_KEYS = [
  'id',
  'title',
  'description',
  'summary',
  'ageGroup',
  'category',
  'language',
  'languageLevel',
  'credit',
  'estimatedDuration',
  'coverImageUrl',
  'coverKey',
  'isPremium',
  'hasPreGeneratedNarration',
  'isFavorite',
  'availableLanguages',
  'isFavoriteAnyLanguage',
  'isMachineTranslation',
  'contentWarnings',
  'createdAt',
  'updatedAt',
];

const PUBLIC_VOICE_PROFILE_KEYS = [
  'id',
  'userId',
  'name',
  'profileIcon',
  'provider',
  'kind',
  'voiceId',
  'language',
  'contentLanguage',
  'status',
  'isPremium',
  'errorMessage',
  'errorReason',
  'sampleAudioUrl',
  'consentAt',
  'createdAt',
  'updatedAt',
];

// Voice language vs story language, on every narration response.
const NARRATION_LANGUAGE_KEYS = ['voiceLanguage', 'storyLanguage', 'languageMismatch', 'nativeVoiceUsed'];

const NARRATION_ITEM_KEYS = [
  'id',
  'userId',
  'title',
  'status',
  'storyId',
  'voiceProfileId',
  'audioId',
  'story',
  'voiceProfile',
  ...NARRATION_LANGUAGE_KEYS,
  'errorMessage',
  'totalDuration',
  'duration',
  'progress',
  'audioStatus',
  'createdAt',
  'updatedAt',
  'completedAt',
];

const NARRATION_BY_STORY_ITEM_KEYS = [
  'id',
  'title',
  'status',
  'audioId',
  'voiceProfileId',
  'voiceProfile',
  ...NARRATION_LANGUAGE_KEYS,
  'isFavorite',
  'errorMessage',
  'totalDuration',
  'duration',
  'progress',
  'createdAt',
  'updatedAt',
];

const NARRATION_STATUS_KEYS = ['id', 'status', 'progress', 'duration', 'errorMessage', 'updatedAt'];

const SLOTS_KEYS = [
  'plan',
  'totalSlots',
  'usedSlots',
  'availableSlots',
  'extraSlots',
  'canCreate',
  'preset',
  'clone',
];
const SLOTS_PRESET_KEYS = ['used', 'limit', 'canCreate'];
const SLOTS_CLONE_KEYS = ['used', 'limit', 'canCreate', 'monthlyCreated', 'monthlyLimit', 'creations'];

const CLONE_CONFIG_KEYS = [
  'enabled',
  'provider',
  'language',
  'locale',
  'supportedLanguages',
  'minSeconds',
  'targetSeconds',
  'maxSeconds',
  'scriptTitle',
  'script',
  'consentVersion',
  'consentTitle',
  'consentText',
  'introSteps',
  'recordingTips',
];
const CLONE_SUPPORTED_LANGUAGE_KEYS = ['code', 'locale', 'nativeName', 'englishName'];
const CLONE_INTRO_STEP_KEYS = ['title', 'body'];
const CLONE_RECORDING_TIP_KEYS = ['icon', 'text'];
const CLONE_RECORDING_TIP_ICONS = ['quiet', 'distance', 'calm', 'pauses'];

const APP_CONFIG_KEYS = ['minSupportedVersion', 'latestVersion', 'storeUrl', 'updateMessage'];
const APP_CONFIG_PLATFORM_KEYS = ['android', 'ios'];

const COLLECTION_KEYS = [
  'id',
  'slug',
  'language',
  'title',
  'subtitle',
  'description',
  'tone',
  'coverImageUrl',
  'isActive',
  'sortOrder',
  'storyCount',
  'createdAt',
  'updatedAt',
];

const AUDIO_METADATA_KEYS = [
  'id',
  'status',
  'title',
  'duration',
  'progress',
  'audioUrl',
  'createdAt',
  'completedAt',
];

const AUTH_RESPONSE_KEYS = ['accessToken', 'refreshToken', 'user'];
const AUTH_USER_KEYS = [
  'id',
  'email',
  'firstName',
  'lastName',
  'emailVerified',
  'provider',
  'profileImageUrl',
  'subscriptionTier',
  'subscriptionExpiresAt',
  'createdAt',
  'updatedAt',
];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER = 'user-1';
const NOW = new Date('2026-09-15T12:00:00Z');

function storyRow(overrides: Partial<any> = {}) {
  return {
    id: 'story-1',
    title: 'Keloglan',
    content: 'Bir varmis bir yokmus. '.repeat(20),
    ageGroup: 'SIX_TO_TEN',
    category: 'TURKISH_CLASSICS',
    language: 'tr',
    estimatedDuration: 5,
    coverImageUrl: 'stories/cover/x.png',
    isPremium: false,
    hasPreGeneratedNarration: false,
    defaultEmotion: 'calm',
    defaultSpeed: 0.9,
    cartesiaPronunciationDictId: 'dict',
    preprocessedSegments: [{ text: 'secret' }],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function voiceRow(overrides: Partial<any> = {}) {
  return {
    id: 'voice-1',
    userId: USER,
    name: 'Anne',
    profileIcon: 'mic',
    provider: 'CARTESIA',
    kind: 'CLONE',
    voiceId: 'cartesia-1',
    voiceCloningKey: 'provider-secret',
    consentAudioUrl: 'voice-samples/u/consent.wav',
    consentVersion: '2026-09-v1',
    consentAt: NOW,
    language: 'tr',
    status: 'READY',
    errorReason: null,
    sampleAudioUrl: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function narrationRow(overrides: Partial<any> = {}) {
  return {
    id: 'narr-1',
    userId: USER,
    storyId: 'story-1',
    voiceProfileId: 'voice-1',
    title: 'Keloglan - Anne',
    audioId: 'audio-1',
    status: 'READY',
    errorMessage: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: NOW,
    story: storyRow(),
    voiceProfile: voiceRow(),
    audio: { status: 'READY', duration: 300, totalSegments: 2, readySegments: 2 },
    ...overrides,
  };
}

const storage = {
  getReadUrl: jest.fn(async (v: string | null) => (v ? `signed:${v}` : null)),
};

// ---------------------------------------------------------------------------

describe('API contract (response shapes)', () => {
  let prisma: MockPrismaService;
  let loggerError: jest.SpyInstance;

  // The error-envelope cases log expected 5xx errors; keep the output clean.
  beforeAll(() => {
    loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterAll(() => loggerError.mockRestore());

  beforeEach(() => {
    prisma = createMockPrismaService();
    mockFirebase.apps = [{}];
    mockFirebase.messaging.sendEachForMulticast.mockResolvedValue({
      successCount: 0,
      failureCount: 0,
      responses: [],
    });
    mockFirebase.messaging.sendEach.mockResolvedValue({ successCount: 0, failureCount: 0, responses: [] });
  });

  describe('envelopes', () => {
    it('paginated envelope is flat {data,total,page,limit,totalPages}', () => {
      expect(keys(PaginationHelper.createPaginatedResponse([], 0, 1, 20))).toEqual(sorted(PAGINATED_KEYS));
    });

    function renderError(exception: unknown) {
      const json = jest.fn();
      const host: any = {
        switchToHttp: () => ({
          getResponse: () => ({ status: () => ({ json }) }),
          getRequest: () => ({ url: '/narrations', method: 'POST', headers: {} }),
        }),
      };
      new HttpExceptionFilter(createI18nStub() as any, createSettingsStub() as any).catch(exception, host);
      return json.mock.calls[0][0];
    }

    it('error envelope {success,statusCode,message,path,method,timestamp}', () => {
      expect(keys(renderError(new NotFoundException('Masal bulunamadı.')))).toEqual(sorted(ERROR_KEYS));
      expect(keys(renderError(new Error('boom')))).toEqual(sorted(ERROR_KEYS));
    });

    it('error envelope + optional machine-readable extras (code, ...)', () => {
      const quota = renderError(
        new ForbiddenException({ code: 'NARRATION_QUOTA_EXCEEDED', tier: 'premium', limit: 3, message: 'x' }),
      );
      expect(keys(quota)).toEqual(sorted([...ERROR_KEYS, 'code', 'tier', 'limit']));

      const exists = renderError(
        new ConflictException({
          code: 'NARRATION_EXISTS',
          existingNarrationId: 'narr-1',
          status: 'READY',
          message: 'x',
        }),
      );
      expect(keys(exists)).toEqual(sorted([...ERROR_KEYS, 'code', 'existingNarrationId', 'status']));
      expect(exists.success).toBe(false);
    });
  });

  describe('stories', () => {
    it('story list item (GET /stories, /stories/search, /stories/favorites, narration.story)', async () => {
      const item = await toStoryListItem(storyRow(), storage as any, false);
      expect(keys(item)).toEqual(sorted(STORY_LIST_ITEM_KEYS));
    });

    it('GET /stories page + GET /stories/:id detail use the list-item shape (never content)', async () => {
      const service = new StoriesService(
        prisma as any,
        {} as any,
        storage as any,
        {} as any,
        createSettingsStub() as any,
        { requestedLanguages: jest.fn().mockResolvedValue([]) } as any,
      );
      prisma.subscription.findUnique.mockResolvedValue(null);
      prisma.story.findMany.mockResolvedValue([storyRow()]);
      prisma.story.count.mockResolvedValue(1);
      prisma.favoriteStory.findMany.mockResolvedValue([]);

      const page = await service.getStories(USER, { page: 1, limit: 20 } as any);
      expect(keys(page)).toEqual(sorted(PAGINATED_KEYS));
      expect(keys(page.data[0])).toEqual(sorted(STORY_LIST_ITEM_KEYS));

      prisma.story.findUnique.mockResolvedValue(storyRow());
      const detail = await service.getStory(USER, 'story-1');
      expect(keys(detail)).toEqual(
        sorted([...STORY_LIST_ITEM_KEYS, 'translations', 'requestedLanguages', 'part', 'translation']),
      );
    });
  });

  describe('collections', () => {
    it('collection item + collection stories item (story list item + position)', async () => {
      const service = new CollectionsService(prisma as any, storage as any, createSettingsStub() as any);
      prisma.collection.findMany.mockResolvedValue([
        {
          id: 'c1',
          slug: 'klasikler',
          language: 'tr',
          title: 'Klasikler',
          subtitle: null,
          description: null,
          tone: 'SUN',
          coverImageUrl: null,
          isActive: true,
          sortOrder: 0,
          createdAt: NOW,
          updatedAt: NOW,
          _count: { stories: 3 },
        },
      ]);
      const [collection] = await service.list();
      expect(keys(collection)).toEqual(sorted(COLLECTION_KEYS));

      prisma.collection.findUnique.mockResolvedValue({ id: 'c1', isActive: true });
      prisma.storyOnCollection.findMany.mockResolvedValue([
        { storyId: 'story-1', position: 0, story: storyRow() },
      ]);
      prisma.storyOnCollection.count.mockResolvedValue(1);
      const page = await service.getStories('klasikler', 1, 20);
      expect(keys(page)).toEqual(sorted(PAGINATED_KEYS));
      expect(keys(page.data[0])).toEqual(sorted([...STORY_LIST_ITEM_KEYS, 'position']));
    });
  });

  describe('voice profiles', () => {
    let service: VoiceProfilesService;

    beforeEach(() => {
      service = new VoiceProfilesService(
        prisma as any,
        storage as any,
        {} as any,
        { add: jest.fn() } as any,
        {} as any,
        createSettingsStub() as any,
      );
    });

    it('public voice profile shape (never cloning key / consent audio / consent version)', () => {
      const pub = toPublicVoiceProfile(voiceRow());
      expect(keys(pub)).toEqual(sorted(PUBLIC_VOICE_PROFILE_KEYS));
      expect(JSON.stringify(pub)).not.toContain('provider-secret');
      expect(JSON.stringify(pub)).not.toContain('consent.wav');
    });

    it('GET /voice-profiles items use the public shape', async () => {
      prisma.voiceProfile.findMany.mockResolvedValue([voiceRow(), voiceRow({ id: 'v2', kind: 'PRESET', provider: 'GOOGLE' })]);
      const list = await service.getVoiceProfiles(USER);
      list.forEach((p) => expect(keys(p)).toEqual(sorted(PUBLIC_VOICE_PROFILE_KEYS)));
    });

    it('GET /voice-profiles/slots', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);
      prisma.voiceProfile.count.mockResolvedValue(1);
      prisma.usageLimit.findUnique.mockResolvedValue(null);

      const slots = await service.getVoiceSlotInfo(USER);
      expect(keys(slots)).toEqual(sorted(SLOTS_KEYS));
      expect(keys(slots.preset)).toEqual(sorted(SLOTS_PRESET_KEYS));
      expect(keys(slots.clone)).toEqual(sorted(SLOTS_CLONE_KEYS));
    });

    it('GET /voice-profiles/clone-config', () => {
      const cfg = service.getCloneConfig();
      expect(keys(cfg)).toEqual(sorted(CLONE_CONFIG_KEYS));
      expect(cfg.provider).toBe('CARTESIA');
      // No language parameter (app builds in the field): Turkish.
      expect(cfg.language).toBe('tr');
      expect(keys(service.getCloneConfig('en'))).toEqual(sorted(CLONE_CONFIG_KEYS));

      // supportedLanguages: Array<{ code, locale, nativeName, englishName }>
      expect(cfg.supportedLanguages.map((l) => l.code)).toEqual(['tr', 'en']);
      for (const language of cfg.supportedLanguages) {
        expect(keys(language)).toEqual(sorted(CLONE_SUPPORTED_LANGUAGE_KEYS));
      }

      // introSteps: Array<{ title: string; body: string }> (3 steps, in order)
      expect(cfg.introSteps).toHaveLength(3);
      for (const step of cfg.introSteps) {
        expect(keys(step)).toEqual(sorted(CLONE_INTRO_STEP_KEYS));
        expect(typeof step.title).toBe('string');
        expect(typeof step.body).toBe('string');
      }

      // recordingTips: Array<{ icon: 'quiet'|'distance'|'calm'|'pauses'; text: string }>
      expect(cfg.recordingTips.map((t) => t.icon)).toEqual(CLONE_RECORDING_TIP_ICONS);
      for (const tip of cfg.recordingTips) {
        expect(keys(tip)).toEqual(sorted(CLONE_RECORDING_TIP_KEYS));
        expect(typeof tip.text).toBe('string');
      }
    });
  });

  describe('app config', () => {
    it('GET /app/config {minSupportedVersion,latestVersion,storeUrl:{android,ios},updateMessage}', () => {
      const cfg = new AppConfigService({ get: () => undefined } as any).getConfig();

      expect(keys(cfg)).toEqual(sorted(APP_CONFIG_KEYS));
      for (const key of ['minSupportedVersion', 'latestVersion', 'storeUrl'] as const) {
        expect(keys(cfg[key])).toEqual(sorted(APP_CONFIG_PLATFORM_KEYS));
        expect(typeof cfg[key].android).toBe('string');
        expect(typeof cfg[key].ios).toBe('string');
      }
      expect(typeof cfg.updateMessage).toBe('string');
    });
  });

  describe('narrations', () => {
    let service: NarrationsService;
    let audioService: any;
    let usage: any;

    beforeEach(() => {
      audioService = {
        generateAudio: jest.fn().mockResolvedValue({ audioId: 'audio-2' }),
        deleteAudio: jest.fn(),
        getStreamUrl: jest.fn(),
      };
      usage = {
        getEffectivePlan: jest.fn().mockResolvedValue('PRO'),
        assertNarrationQuota: jest.fn().mockResolvedValue(undefined),
        consumeNarration: jest.fn().mockResolvedValue({ userId: 'u', premiumVoice: false, month: 10, year: 2026 }),
        refundNarration: jest.fn().mockResolvedValue(undefined),
      };
      service = new NarrationsService(
        prisma as any,
        audioService,
        {} as any,
        storage as any,
        usage,
        createSettingsStub() as any,
      );
      prisma.favoriteStory.findUnique.mockResolvedValue(null);
      prisma.favoriteStory.findMany.mockResolvedValue([]);
    });

    it('narration item (POST /narrations, GET /narrations items, GET /narrations/:id)', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(narrationRow());
      const one: any = await service.findOne('narr-1', USER);
      expect(keys(one)).toEqual(sorted(NARRATION_ITEM_KEYS));
      expect(keys(one.story)).toEqual(sorted(STORY_LIST_ITEM_KEYS));
      expect(keys(one.voiceProfile)).toEqual(sorted(PUBLIC_VOICE_PROFILE_KEYS));

      prisma.storyNarration.count.mockResolvedValue(1);
      prisma.storyNarration.findMany.mockResolvedValue([narrationRow()]);
      const page = await service.findAll(USER, {});
      expect(keys(page)).toEqual(sorted(PAGINATED_KEYS));
      expect(keys(page.data[0])).toEqual(sorted(NARRATION_ITEM_KEYS));

      prisma.story.findUnique.mockResolvedValue(storyRow());
      prisma.voiceProfile.findUnique.mockResolvedValue(voiceRow());
      prisma.storyNarration.findUnique.mockResolvedValue(null);
      prisma.storyNarration.create.mockResolvedValue(narrationRow({ status: 'PENDING', audio: null }));
      const created = await service.create(USER, { storyId: 'story-1', voiceProfileId: 'voice-1' });
      expect(keys(created)).toEqual(sorted(NARRATION_ITEM_KEYS));
    });

    it('GET /narrations/story/:storyId items', async () => {
      prisma.story.findUnique.mockResolvedValue({ id: 'story-1' });
      prisma.storyNarration.findMany.mockResolvedValue([narrationRow()]);
      const [item] = await service.findByStory('story-1', USER);
      expect(keys(item)).toEqual(sorted(NARRATION_BY_STORY_ITEM_KEYS));
      expect(keys(item.voiceProfile)).toEqual(sorted(PUBLIC_VOICE_PROFILE_KEYS));
    });

    it('GET /narrations/:id/status (polling)', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue({
        id: 'narr-1',
        userId: USER,
        status: 'GENERATING',
        errorMessage: null,
        updatedAt: NOW,
        audioId: 'audio-1',
        audio: { status: 'GENERATING', duration: null, totalSegments: 2, readySegments: 1 },
      });
      expect(keys(await service.getGenerationStatus('narr-1', USER))).toEqual(sorted(NARRATION_STATUS_KEYS));
    });

    it('POST /narrations/:id/generate responses', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(
        narrationRow({ status: 'PENDING', audioId: null, audio: null }),
      );
      expect(keys(await service.generateAudio('narr-1', USER))).toEqual(
        sorted(['message', 'status', 'narrationId', 'audioId', ...NARRATION_LANGUAGE_KEYS]),
      );

      prisma.storyNarration.findUnique.mockResolvedValue(
        narrationRow({ status: 'GENERATING', audio: { id: 'audio-1', status: 'GENERATING', totalSegments: 2, readySegments: 1 } }),
      );
      expect(keys(await service.generateAudio('narr-1', USER))).toEqual(
        sorted(['message', 'status', 'narrationId', 'audioId', 'progress', ...NARRATION_LANGUAGE_KEYS]),
      );
    });
  });

  describe('audio', () => {
    it('GET /audio/:id metadata', async () => {
      const service = new AudioService(prisma as any, storage as any, {} as any, {} as any, {} as any, {} as any, {} as any);
      prisma.audio.findUnique.mockResolvedValue({
        id: 'audio-1',
        userId: USER,
        status: 'READY',
        title: 't',
        duration: 10,
        totalSegments: 1,
        readySegments: 1,
        audioUrl: 'x',
        originalText: 'secret',
        createdAt: NOW,
        completedAt: NOW,
      });
      expect(keys(await service.getAudioById('audio-1'))).toEqual(sorted(AUDIO_METADATA_KEYS));
    });
  });

  describe('usage', () => {
    it('GET /usage/current and GET /usage/limits', async () => {
      const service = new UsageService(prisma as any);
      prisma.subscription.findUnique.mockResolvedValue(null);
      prisma.usageLimit.findUnique.mockResolvedValue(null);

      const current = await service.getCurrentUsage(USER);
      expect(keys(current)).toEqual(sorted(['storiesGenerated', 'limit', 'remaining', 'resetAt', 'usages']));
      expect(keys(current.usages)).toEqual(['premium', 'standard']);
      expect(keys(current.usages.premium)).toEqual(sorted(['generated', 'limit', 'remaining']));
      expect(keys(current.usages.standard)).toEqual(sorted(['generated', 'limit', 'remaining']));

      const limits = await service.getLimits(USER);
      expect(keys(limits)).toEqual(
        sorted(['maxStories', 'maxStoriesStandard', 'maxStoriesPremium', 'maxVoices', 'maxTextToSpeech']),
      );
    });
  });

  describe('auth', () => {
    it('POST /auth/firebase/verify response', async () => {
      mockFirebase.verifyIdToken.mockResolvedValue({
        uid: 'fb-1',
        email: 'a@b.c',
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
      });
      const user = {
        id: USER,
        email: 'a@b.c',
        firstName: 'A',
        lastName: 'B',
        emailVerified: true,
        provider: 'GOOGLE',
        providerId: 'fb-1',
        passwordHash: 'hash',
        avatarUrl: null,
        createdAt: NOW,
        updatedAt: NOW,
        subscription: { plan: 'FREE', status: 'ACTIVE', currentPeriodEnd: null },
      };
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue(user);

      const service = new AuthService(
        prisma as any,
        { sign: jest.fn().mockReturnValue('jwt') } as any,
        { get: jest.fn().mockReturnValue('x') } as any,
        {} as any,
        storage as any,
      );
      const res = await service.verifyFirebaseToken({ idToken: 'id-token' } as any);
      expect(keys(res)).toEqual(sorted(AUTH_RESPONSE_KEYS));
      expect(keys(res.user)).toEqual(sorted(AUTH_USER_KEYS));
    });

    it('POST /auth/firebase/verify 409 {code:EMAIL_IN_USE} for an unverified identity on an existing email', async () => {
      mockFirebase.verifyIdToken.mockResolvedValue({
        uid: 'fb-other',
        email: 'a@b.c',
        email_verified: false,
        firebase: { sign_in_provider: 'password' },
      });
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: USER, email: 'a@b.c', providerId: 'fb-1' });

      const service = new AuthService(
        prisma as any,
        { sign: jest.fn() } as any,
        { get: jest.fn() } as any,
        {} as any,
        storage as any,
      );
      const err = await service.verifyFirebaseToken({ idToken: 'id-token' } as any).catch((e) => e);
      const json = jest.fn();
      new HttpExceptionFilter(createI18nStub() as any, createSettingsStub() as any).catch(err, {
        switchToHttp: () => ({
          getResponse: () => ({ status: () => ({ json }) }),
          getRequest: () => ({ url: '/auth/firebase/verify', method: 'POST', headers: {} }),
        }),
      } as any);
      const body = json.mock.calls[0][0];

      expect(keys(body)).toEqual(sorted([...ERROR_KEYS, 'code']));
      expect(body).toMatchObject({
        statusCode: 409,
        code: 'EMAIL_IN_USE',
        message: 'Bu e-posta başka bir giriş yöntemiyle kayıtlı. Lütfen o yöntemle giriş yap.',
      });
    });
  });

  describe('notifications (socket + push payloads)', () => {
    let gateway: { sendToUser: jest.Mock };
    let service: NotificationsService;

    beforeEach(() => {
      gateway = { sendToUser: jest.fn() };
      prisma.notification.create.mockImplementation(async ({ data }: any) => ({ id: 'n1', createdAt: NOW, ...data }));
      prisma.userDevice.findMany.mockResolvedValue([{ deviceToken: 'tok-1' }]);
      prisma.userPreferences.findUnique.mockResolvedValue(null);
      service = new NotificationsService(prisma as any, gateway as any, new UserPreferencesService(prisma as any, createSettingsStub() as any));
    });

    const socketPayload = (event: string) =>
      gateway.sendToUser.mock.calls.find((c: any[]) => c[1] === event)?.[2];

    it('voice_status READY / FAILED', async () => {
      await service.notifyVoiceReady(USER, 'Anne', 'voice-1');
      expect(keys(socketPayload('voice_status'))).toEqual(sorted(['voiceProfileId', 'status']));

      gateway.sendToUser.mockClear();
      await service.notifyVoiceFailed(USER, 'Anne', 'voice-1', 'Kayit cok kisa.');
      expect(keys(socketPayload('voice_status'))).toEqual(sorted(['voiceProfileId', 'status', 'errorMessage']));
    });

    it('narration_status READY / FAILED', async () => {
      await service.notifyNarrationReady(USER, 'Keloglan', 'narr-1', 'story-1');
      expect(keys(socketPayload('narration_status'))).toEqual(sorted(['status', 'narrationId', 'storyId']));

      gateway.sendToUser.mockClear();
      await service.notifyNarrationFailed(USER, 'Keloglan', 'narr-1', 'story-1', 'x');
      expect(keys(socketPayload('narration_status'))).toEqual(
        sorted(['status', 'narrationId', 'storyId', 'errorMessage']),
      );
    });

    it('`notification` socket event, persisted data and FCM data keys (deep links)', async () => {
      await service.notifyNarrationReady(USER, 'Keloglan', 'narr-1', 'story-1');

      const event = socketPayload('notification');
      expect(keys(event)).toEqual(sorted(['id', 'type', 'title', 'body', 'data', 'read', 'createdAt']));
      expect(keys(event.data)).toEqual(sorted(['type', 'narrationId', 'storyId']));

      const persisted = prisma.notification.create.mock.calls[0][0].data;
      expect(keys(persisted)).toEqual(sorted(['userId', 'type', 'title', 'body', 'data']));
      expect(keys(persisted.data)).toEqual(sorted(['type', 'narrationId', 'storyId']));

      const fcm = mockFirebase.messaging.sendEachForMulticast.mock.calls[0][0];
      expect(keys(fcm.data)).toEqual(sorted(['type', 'notificationId', 'narrationId', 'storyId']));
    });

    it('voice notification data carries voiceProfileId', async () => {
      await service.notifyVoiceReady(USER, 'Anne', 'voice-1');
      const persisted = prisma.notification.create.mock.calls[0][0].data;
      expect(keys(persisted.data)).toEqual(sorted(['type', 'voiceProfileId']));
      const fcm = mockFirebase.messaging.sendEachForMulticast.mock.calls[0][0];
      expect(keys(fcm.data)).toEqual(sorted(['type', 'notificationId', 'voiceProfileId']));
    });

    it('GET /notifications envelope {items,total,page,limit,unreadCount}', async () => {
      prisma.$transaction.mockResolvedValue([[], 0, 0]);
      expect(keys(await service.listNotifications(USER))).toEqual(
        sorted(['items', 'total', 'page', 'limit', 'unreadCount']),
      );
    });
  });
});
