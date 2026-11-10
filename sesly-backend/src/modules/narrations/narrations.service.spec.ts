import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { NarrationsService } from './narrations.service';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createSettingsStub } from '../../test-utils/settings-stub';

const USER = 'user-1';
const STORY_ID = '11111111-1111-4111-8111-111111111111';
const VOICE_ID = '22222222-2222-4222-8222-222222222222';

function story(overrides: Partial<any> = {}) {
  return {
    id: STORY_ID,
    title: 'Keloğlan',
    content: 'Bir varmış bir yokmuş. '.repeat(20),
    ageGroup: 'SIX_TO_TEN',
    category: 'TURKISH_CLASSICS',
    language: 'tr',
    estimatedDuration: 5,
    coverImageUrl: 'https://storage.googleapis.com/b/stories/cover/x.png',
    isPremium: false,
    hasPreGeneratedNarration: false,
    preprocessedSegments: [{ text: 'secret full text' }],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function voice(overrides: Partial<any> = {}) {
  return {
    id: VOICE_ID,
    userId: USER,
    name: 'Anne',
    profileIcon: null,
    provider: 'GOOGLE',
    voiceId: 'tr-TR-Wavenet-A',
    voiceCloningKey: null,
    language: 'tr-TR',
    status: 'READY',
    errorReason: null,
    consentAudioUrl: 'voice-samples/u/consent.wav',
    sampleAudioUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('NarrationsService', () => {
  let prisma: MockPrismaService;
  let audioService: any;
  let storageService: any;
  let usageService: any;
  let service: NarrationsService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    audioService = {
      releaseAudio: jest.fn().mockResolvedValue(undefined),
      generateAudio: jest.fn().mockResolvedValue({ audioId: 'audio-new', status: 'GENERATING', shared: false }),
      getStreamUrl: jest.fn(),
    };
    storageService = { getReadUrl: jest.fn(async (v: string | null) => (v ? `signed:${v}` : null)) };
    usageService = {
      getEffectivePlan: jest.fn().mockResolvedValue('FREE'),
      assertNarrationQuota: jest.fn().mockResolvedValue(undefined),
      consumeNarration: jest.fn().mockResolvedValue({ userId: 'user-1', premiumVoice: false, month: 10, year: 2026 }),
      refundNarration: jest.fn().mockResolvedValue(undefined),
    };
    service = new NarrationsService(
      prisma as any,
      audioService,
      {} as any,
      storageService,
      usageService,
      createSettingsStub() as any,
    );

    prisma.story.findUnique.mockResolvedValue(story());
    prisma.voiceProfile.findUnique.mockResolvedValue(voice());
    prisma.favoriteStory.findUnique.mockResolvedValue(null);
    prisma.storyNarration.create.mockImplementation(async ({ data }: any) => ({
      id: 'narr-new',
      audioId: null,
      errorMessage: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
      story: story(),
      voiceProfile: voice(),
      audio: null,
    }));
  });

  describe('create', () => {
    it.each(['READY', 'GENERATING'])('existing %s row -> 409 NARRATION_EXISTS', async (status) => {
      prisma.storyNarration.findUnique.mockResolvedValue({ id: 'narr-old', status, audioId: 'a1' });

      const err = await service
        .create(USER, { storyId: STORY_ID, voiceProfileId: VOICE_ID })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({
        code: 'NARRATION_EXISTS',
        existingNarrationId: 'narr-old',
        status,
      });
      expect(typeof err.getResponse().message).toBe('string');
      expect(prisma.storyNarration.create).not.toHaveBeenCalled();
    });

    it.each(['FAILED', 'PENDING'])('existing %s row is replaced silently (audio cleaned up)', async (status) => {
      prisma.storyNarration.findUnique.mockResolvedValue({ id: 'narr-old', status, audioId: 'a-old' });

      const result = await service.create(USER, { storyId: STORY_ID, voiceProfileId: VOICE_ID });

      expect(audioService.releaseAudio).toHaveBeenCalledWith('a-old', USER);
      expect(prisma.storyNarration.deleteMany).toHaveBeenCalledWith({ where: { id: 'narr-old' } });
      expect(result.id).toBe('narr-new');
    });

    it('checks quota BEFORE inserting (no zombie PENDING row on 403)', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(null);
      usageService.assertNarrationQuota.mockRejectedValue(new ForbiddenException('kota'));

      await expect(
        service.create(USER, { storyId: STORY_ID, voiceProfileId: VOICE_ID }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.storyNarration.create).not.toHaveBeenCalled();
    });

    it('premium story on FREE plan -> 403 before inserting', async () => {
      prisma.story.findUnique.mockResolvedValue(story({ isPremium: true }));
      prisma.storyNarration.findUnique.mockResolvedValue(null);

      const err = await service
        .create(USER, { storyId: STORY_ID, voiceProfileId: VOICE_ID })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: 'PREMIUM_STORY' });
      expect(prisma.storyNarration.create).not.toHaveBeenCalled();
    });

    it('response never embeds story content or voice secrets', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(null);

      const result: any = await service.create(USER, { storyId: STORY_ID, voiceProfileId: VOICE_ID });
      const json = JSON.stringify(result);

      expect(result.story.content).toBeUndefined();
      expect(json).not.toContain('secret full text');
      expect(result.voiceProfile.voiceCloningKey).toBeUndefined();
      expect(result.voiceProfile.consentAudioUrl).toBeUndefined();
      expect(result.story.coverImageUrl).toBe('signed:https://storage.googleapis.com/b/stories/cover/x.png');
    });
  });

  describe('findOne / findAll', () => {
    const row = () => ({
      id: 'narr-1',
      userId: USER,
      storyId: STORY_ID,
      voiceProfileId: VOICE_ID,
      title: 't',
      audioId: 'a1',
      status: 'READY',
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date('2026-09-01T00:00:00Z'),
      completedAt: new Date(),
      story: story(),
      voiceProfile: voice(),
      audio: { status: 'READY', duration: 321, totalSegments: 2, readySegments: 2 },
    });

    it('GET /narrations/:id includes totalDuration and duration', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(row());
      const result = await service.findOne('narr-1', USER);
      expect(result.totalDuration).toBe(321);
      expect(result.duration).toBe(321);
      expect(result.progress).toBe(100);
    });

    it('the library carries availableLanguages: one group query for the page, own language first', async () => {
      const grouped = () => ({
        ...row(),
        story: story({ id: 'story-tr', language: 'tr', translationGroupId: 'g1' }),
      });
      prisma.storyNarration.count.mockResolvedValue(2);
      prisma.storyNarration.findMany.mockResolvedValue([grouped(), row()]);
      prisma.favoriteStory.findMany.mockResolvedValue([]);
      prisma.story.findMany.mockResolvedValue([
        { id: 'story-tr', language: 'tr', translationGroupId: 'g1' },
        { id: 'story-de', language: 'de', translationGroupId: 'g1' },
        { id: 'story-en', language: 'en', translationGroupId: 'g1' },
      ]);

      const page = await service.findAll(USER, {});

      expect(prisma.story.findMany).toHaveBeenCalledTimes(1);
      expect(page.data[0].story.availableLanguages).toEqual(['tr', 'en', 'de']);
      // A story without a translation group is a tale of its own.
      expect(page.data[1].story.availableLanguages).toEqual(['tr']);
    });

    it('GET /narrations/:id carries availableLanguages too', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue({
        ...row(),
        story: story({ id: 'story-en', language: 'en', translationGroupId: 'g1' }),
      });
      prisma.story.findMany.mockResolvedValue([{ id: 'story-tr', language: 'tr', translationGroupId: 'g1' }]);

      const result = await service.findOne('narr-1', USER);

      expect(result.story.availableLanguages).toEqual(['en', 'tr']);
    });

    it('GET /narrations items include updatedAt', async () => {
      prisma.storyNarration.count.mockResolvedValue(1);
      prisma.storyNarration.findMany.mockResolvedValue([row()]);
      prisma.favoriteStory.findMany.mockResolvedValue([]);

      const page = await service.findAll(USER, {});
      expect(page.data[0].updatedAt).toEqual(new Date('2026-09-01T00:00:00Z'));
      expect((page.data[0].story as any).content).toBeUndefined();
    });
  });

  describe('voice and story language (languageMismatch, nativeVoiceUsed)', () => {
    const englishStory = () => story({ language: 'en', title: 'Little Red Riding Hood' });
    const chirp = (overrides: Partial<any> = {}) =>
      voice({ kind: 'PRESET', voiceId: 'tr-TR-Chirp3-HD-Achernar', ...overrides });
    const clone = (overrides: Partial<any> = {}) =>
      voice({ provider: 'CARTESIA', kind: 'CLONE', voiceId: 'c-1', language: 'tr-TR', ...overrides });
    const pendingNarration = (overrides: Partial<any> = {}) => ({
      id: 'narr-1',
      userId: USER,
      storyId: STORY_ID,
      voiceProfileId: VOICE_ID,
      title: 't',
      audioId: null,
      status: 'PENDING',
      story: englishStory(),
      voiceProfile: chirp(),
      audio: null,
      ...overrides,
    });

    /** Narration create with the given story and voice, as the database would return them. */
    const createWith = async (storyRow: any, voiceRow: any) => {
      prisma.story.findUnique.mockResolvedValue(storyRow);
      prisma.voiceProfile.findUnique.mockResolvedValue(voiceRow);
      prisma.storyNarration.create.mockImplementation(async ({ data }: any) => ({
        id: 'narr-new',
        audioId: null,
        errorMessage: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
        story: storyRow,
        voiceProfile: voiceRow,
        audio: null,
      }));
      return service.create(USER, { storyId: STORY_ID, voiceProfileId: VOICE_ID });
    };

    it('create: a Turkish ready-made voice on an English story is accepted and read natively', async () => {
      const result = await createWith(englishStory(), chirp());

      // The old hard rejection (400 VOICE_LANGUAGE_MISMATCH) is gone.
      expect(result).toMatchObject({
        id: 'narr-new',
        voiceLanguage: 'tr',
        storyLanguage: 'en',
        languageMismatch: true,
        nativeVoiceUsed: true,
      });
      expect(result.voiceProfile.contentLanguage).toBe('tr');
      expect(result.story.language).toBe('en');
      expect(prisma.storyNarration.create).toHaveBeenCalledTimes(1);
      expect(usageService.assertNarrationQuota).toHaveBeenCalledWith(USER, 'FREE', false);
    });

    it('create: a ready-made voice on a story whose language has no such voice keeps its own voice', async () => {
      const result = await createWith(story({ language: 'ru' }), chirp());

      expect(result).toMatchObject({
        voiceLanguage: 'tr',
        storyLanguage: 'ru',
        languageMismatch: true,
        nativeVoiceUsed: false,
      });
    });

    it('create: the ready-made voice language is read from the voice id, not from the profile language', async () => {
      const result = await createWith(
        englishStory(),
        chirp({ voiceId: 'en-US-Chirp3-HD-Aoede', language: 'tr-TR' }),
      );

      expect(result).toMatchObject({
        voiceLanguage: 'en',
        storyLanguage: 'en',
        languageMismatch: false,
        nativeVoiceUsed: false,
      });
    });

    it('create: a Turkish clone on an English story is accepted and flagged as accented', async () => {
      const result = await createWith(englishStory(), clone());

      expect(result).toMatchObject({
        voiceLanguage: 'tr',
        storyLanguage: 'en',
        languageMismatch: true,
        nativeVoiceUsed: false,
      });
      // A clone counts against the premium allowance, mismatch or not.
      expect(usageService.assertNarrationQuota).toHaveBeenCalledWith(USER, 'FREE', true);
    });

    it('create: an English clone on an English story is no mismatch', async () => {
      const result = await createWith(englishStory(), clone({ language: 'en-US' }));

      expect(result).toMatchObject({ voiceLanguage: 'en', storyLanguage: 'en', languageMismatch: false });
    });

    it('create: a Turkish voice on a Turkish story reports no mismatch (apps in the field)', async () => {
      const result = await service.create(USER, { storyId: STORY_ID, voiceProfileId: VOICE_ID });

      expect(result).toMatchObject({
        id: 'narr-new',
        voiceLanguage: 'tr',
        storyLanguage: 'tr',
        languageMismatch: false,
        nativeVoiceUsed: false,
      });
    });

    it('generate: a mismatched ready-made voice starts the audio and reports both flags', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(pendingNarration());

      const result = await service.generateAudio('narr-1', USER);

      expect(result).toEqual({
        message: 'Audio generation started',
        status: 'GENERATING',
        narrationId: 'narr-1',
        audioId: 'audio-new',
        voiceLanguage: 'tr',
        storyLanguage: 'en',
        languageMismatch: true,
        nativeVoiceUsed: true,
      });
      expect(prisma.storyNarration.deleteMany).not.toHaveBeenCalled();
      expect(audioService.generateAudio).toHaveBeenCalledWith(
        expect.objectContaining({ voiceProfileId: VOICE_ID, storyId: STORY_ID }),
      );
      expect(usageService.consumeNarration).toHaveBeenCalledWith(USER, expect.any(String), false);
    });

    it('generate: a cloned voice on an English story starts the audio, flagged as accented', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(pendingNarration({ voiceProfile: clone() }));

      const result = await service.generateAudio('narr-1', USER);

      expect(result).toMatchObject({
        status: 'GENERATING',
        languageMismatch: true,
        nativeVoiceUsed: false,
        voiceLanguage: 'tr',
        storyLanguage: 'en',
      });
      expect(audioService.generateAudio).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['READY', 'Audio already generated'],
      ['GENERATING', 'Audio generation already in progress'],
    ])('generate: an audio that is already %s still reports the language fields', async (status, message) => {
      prisma.storyNarration.findUnique.mockResolvedValue(
        pendingNarration({
          audioId: 'a-1',
          audio: { id: 'a-1', status, totalSegments: 4, readySegments: 1 },
        }),
      );

      const result = await service.generateAudio('narr-1', USER);

      expect(result).toMatchObject({
        message,
        status,
        audioId: 'a-1',
        languageMismatch: true,
        nativeVoiceUsed: true,
      });
      expect(audioService.generateAudio).not.toHaveBeenCalled();
    });

    it('generate: a narration that lost its voice profile answers VOICE_NOT_READY, not a crash', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(pendingNarration({ voiceProfile: null }));

      const err = await service.generateAudio('narr-1', USER).catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse().code).toBe('VOICE_NOT_READY');
    });

    it('findOne and the per-story list carry the same language fields', async () => {
      const row = {
        ...pendingNarration(),
        errorMessage: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.storyNarration.findUnique.mockResolvedValue(row);

      await expect(service.findOne('narr-1', USER)).resolves.toMatchObject({
        languageMismatch: true,
        nativeVoiceUsed: true,
        voiceLanguage: 'tr',
        storyLanguage: 'en',
      });

      prisma.story.findUnique.mockResolvedValue({ id: STORY_ID, language: 'en' });
      prisma.storyNarration.findMany.mockResolvedValue([{ ...row, voiceProfile: clone() }]);

      const list = await service.findByStory(STORY_ID, USER);

      expect(prisma.story.findUnique).toHaveBeenLastCalledWith({
        where: { id: STORY_ID },
        select: { id: true, language: true },
      });
      expect(list[0]).toMatchObject({
        languageMismatch: true,
        nativeVoiceUsed: false,
        voiceLanguage: 'tr',
        storyLanguage: 'en',
      });
    });
  });

  describe('generateAudio', () => {
    const pending = (overrides: Partial<any> = {}) => ({
      id: 'narr-1',
      userId: USER,
      storyId: STORY_ID,
      voiceProfileId: VOICE_ID,
      title: 't',
      audioId: null,
      status: 'PENDING',
      story: story(),
      voiceProfile: voice(),
      audio: null,
      ...overrides,
    });

    it('quota failure deletes the zombie PENDING narration and rethrows', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(pending());
      usageService.consumeNarration.mockRejectedValue(new ForbiddenException('kota'));

      await expect(service.generateAudio('narr-1', USER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.storyNarration.deleteMany).toHaveBeenCalledWith({ where: { id: 'narr-1' } });
      expect(audioService.generateAudio).not.toHaveBeenCalled();
      expect(usageService.refundNarration).not.toHaveBeenCalled();
    });

    it('a ready-made Chirp 3 HD narration counts against the standard allowance', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(
        pending({
          voiceProfile: voice({ kind: 'PRESET', provider: 'GOOGLE', voiceId: 'tr-TR-Chirp3-HD-Achernar' }),
        }),
      );

      await service.generateAudio('narr-1', USER);

      expect(usageService.consumeNarration).toHaveBeenCalledWith(USER, expect.any(String), false);
      expect(usageService.consumeNarration).toHaveBeenCalledWith(USER, expect.any(String), false);
    });

    it('successful start records usage append-only (premium flag from voice tier)', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(
        pending({ voiceProfile: voice({ provider: 'CARTESIA', voiceId: 'c-1' }) }),
      );

      const result = await service.generateAudio('narr-1', USER);

      expect(result.status).toBe('GENERATING');
      expect(prisma.storyNarration.update).toHaveBeenCalledWith({
        where: { id: 'narr-1' },
        data: { audioId: 'audio-new', status: 'GENERATING', errorMessage: null, freeRegeneration: false },
      });
      expect(usageService.consumeNarration).toHaveBeenCalledWith(USER, expect.any(String), true);
    });

    it('free regeneration (admin removed the audio): no unit taken, the flag is spent on start', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(
        pending({ status: 'FAILED', freeRegeneration: true, voiceProfile: voice({ provider: 'CARTESIA', voiceId: 'c-1' }) }),
      );

      const result = await service.generateAudio('narr-1', USER);

      expect(result.status).toBe('GENERATING');
      expect(usageService.consumeNarration).not.toHaveBeenCalled();
      expect(prisma.storyNarration.update).toHaveBeenCalledWith({
        where: { id: 'narr-1' },
        data: expect.objectContaining({ freeRegeneration: false }),
      });
    });

    it('free regeneration that cannot start: nothing to refund', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(pending({ status: 'FAILED', freeRegeneration: true }));
      audioService.generateAudio.mockRejectedValueOnce(new Error('queue down'));

      await expect(service.generateAudio('narr-1', USER)).rejects.toThrow('queue down');
      expect(usageService.refundNarration).not.toHaveBeenCalled();
    });

    it('voice not ready -> Turkish 400 with code', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(
        pending({ voiceProfile: voice({ status: 'PROCESSING' }) }),
      );
      const err = await service.generateAudio('narr-1', USER).catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: 'VOICE_NOT_READY' });
    });

    it('already READY audio -> no new generation, no quota consumed', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(
        pending({ status: 'READY', audioId: 'a1', audio: { id: 'a1', status: 'READY', totalSegments: 1, readySegments: 1 } }),
      );

      const result = await service.generateAudio('narr-1', USER);

      expect(result).toMatchObject({ status: 'READY', audioId: 'a1', narrationId: 'narr-1' });
      expect(audioService.generateAudio).not.toHaveBeenCalled();
      expect(usageService.consumeNarration).not.toHaveBeenCalled();
    });

    it('generation in progress -> returns progress, does not start a second one', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(
        pending({ status: 'GENERATING', audioId: 'a1', audio: { id: 'a1', status: 'GENERATING', totalSegments: 4, readySegments: 1 } }),
      );

      const result: any = await service.generateAudio('narr-1', USER);

      expect(result).toMatchObject({ status: 'GENERATING', audioId: 'a1', progress: 25 });
      expect(audioService.generateAudio).not.toHaveBeenCalled();
      expect(usageService.consumeNarration).not.toHaveBeenCalled();
    });

    it('premium story on FREE plan -> 403 PREMIUM_STORY and the PENDING row is removed', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(pending({ story: story({ isPremium: true }) }));

      const err = await service.generateAudio('narr-1', USER).catch((e) => e);

      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: 'PREMIUM_STORY' });
      expect(prisma.storyNarration.deleteMany).toHaveBeenCalledWith({ where: { id: 'narr-1' } });
      expect(audioService.generateAudio).not.toHaveBeenCalled();
    });

    it('premium story on PRO plan is allowed', async () => {
      usageService.getEffectivePlan.mockResolvedValue('PRO');
      prisma.storyNarration.findUnique.mockResolvedValue(pending({ story: story({ isPremium: true }) }));

      await expect(service.generateAudio('narr-1', USER)).resolves.toMatchObject({ status: 'GENERATING' });
      expect(usageService.consumeNarration).toHaveBeenCalledWith(USER, 'PRO', false);
    });

    it('quota failure on a FAILED retry keeps the row (only zombie PENDING rows are deleted)', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(
        pending({ status: 'FAILED', audioId: 'a-old', audio: { id: 'a-old', status: 'FAILED', totalSegments: 2, readySegments: 1 } }),
      );
      usageService.consumeNarration.mockRejectedValue(new ForbiddenException('kota'));

      await expect(service.generateAudio('narr-1', USER)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.storyNarration.deleteMany).not.toHaveBeenCalled();
    });

    it('retrying a FAILED generation drops the stale audio and passes story content + storyId to the pipeline', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(
        pending({ status: 'FAILED', audioId: 'a-old', title: null, audio: { id: 'a-old', status: 'FAILED', totalSegments: 2, readySegments: 1 } }),
      );
      audioService.releaseAudio.mockRejectedValueOnce(new Error('already gone'));

      await service.generateAudio('narr-1', USER);

      expect(audioService.releaseAudio).toHaveBeenCalledWith('a-old', USER);
      expect(audioService.generateAudio).toHaveBeenCalledWith({
        text: story().content,
        voiceProfileId: VOICE_ID,
        userId: USER,
        title: 'Keloğlan',
        storyId: STORY_ID,
        narrationId: 'narr-1',
        share: true,
      });
      expect(usageService.consumeNarration).toHaveBeenCalledWith(USER, expect.any(String), false);
    });

    describe('shared ready-made voice audio', () => {
      it('a shared audio that is READY: answered READY, the unit is still taken, the narration is not rewritten here', async () => {
        prisma.storyNarration.findUnique.mockResolvedValue(pending());
        audioService.generateAudio.mockResolvedValueOnce({ audioId: 'shared-1', status: 'READY', shared: true });

        const result = await service.generateAudio('narr-1', USER);

        expect(result).toMatchObject({ status: 'READY', audioId: 'shared-1', narrationId: 'narr-1' });
        expect(usageService.consumeNarration).toHaveBeenCalledTimes(1);
        // AudioService linked the narration (before any job could finish).
        expect(prisma.storyNarration.update).not.toHaveBeenCalled();
      });

      it('attached to a running shared generation: GENERATING', async () => {
        prisma.storyNarration.findUnique.mockResolvedValue(pending());
        audioService.generateAudio.mockResolvedValueOnce({ audioId: 'shared-1', status: 'GENERATING', shared: true });

        await expect(service.generateAudio('narr-1', USER)).resolves.toMatchObject({
          status: 'GENERATING',
          audioId: 'shared-1',
        });
        expect(prisma.storyNarration.update).not.toHaveBeenCalled();
      });

      it('the shared audio failed just before attaching: FAILED with the user message', async () => {
        prisma.storyNarration.findUnique.mockResolvedValue(pending());
        audioService.generateAudio.mockResolvedValueOnce({ audioId: 'shared-1', status: 'FAILED', shared: true });

        await expect(service.generateAudio('narr-1', USER)).resolves.toMatchObject({
          status: 'FAILED',
          errorMessage: expect.any(String),
        });
      });
    });

    it('the pipeline failing to start gives the narration back and rethrows', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(pending());
      audioService.generateAudio.mockRejectedValueOnce(new Error('queue down'));

      await expect(service.generateAudio('narr-1', USER)).rejects.toThrow('queue down');
      expect(usageService.refundNarration).toHaveBeenCalledWith(
        expect.objectContaining({ premiumVoice: false }),
      );
      expect(prisma.storyNarration.update).not.toHaveBeenCalled();
    });

    it('a refund failure is logged, the original error still reaches the caller', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(pending());
      audioService.generateAudio.mockRejectedValueOnce(new Error('queue down'));
      usageService.refundNarration.mockRejectedValueOnce(new Error('db down'));

      await expect(service.generateAudio('narr-1', USER)).rejects.toThrow('queue down');
    });

    it('not found -> 404; another user -> 400 and nothing is generated', async () => {
      prisma.storyNarration.findUnique.mockResolvedValueOnce(null);
      await expect(service.generateAudio('nope', USER)).rejects.toBeInstanceOf(NotFoundException);

      prisma.storyNarration.findUnique.mockResolvedValueOnce(pending({ userId: 'someone-else' }));
      await expect(service.generateAudio('narr-1', USER)).rejects.toBeInstanceOf(BadRequestException);

      expect(audioService.generateAudio).not.toHaveBeenCalled();
    });
  });

  describe('create (validation + replace)', () => {
    beforeEach(() => prisma.storyNarration.findUnique.mockResolvedValue(null));

    it('a DRAFT story does not exist for clients (404); an ARCHIVED one stays narratable', async () => {
      prisma.story.findUnique.mockResolvedValueOnce(story({ status: 'DRAFT' }));
      await expect(
        service.create(USER, { storyId: STORY_ID, voiceProfileId: VOICE_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.storyNarration.create).not.toHaveBeenCalled();

      prisma.story.findUnique.mockResolvedValueOnce(story({ status: 'ARCHIVED' }));
      prisma.voiceProfile.findUnique.mockResolvedValueOnce(null);
      // Gets past the story check: the next failure is the unknown voice.
      await expect(
        service.create(USER, { storyId: STORY_ID, voiceProfileId: VOICE_ID }),
      ).rejects.toThrow('errors.voiceProfiles.notFound');
    });

    it('unknown story / unknown voice -> 404; voice of another user -> 400', async () => {
      prisma.story.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.create(USER, { storyId: STORY_ID, voiceProfileId: VOICE_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.voiceProfile.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.create(USER, { storyId: STORY_ID, voiceProfileId: VOICE_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.voiceProfile.findUnique.mockResolvedValueOnce(voice({ userId: 'someone-else' }));
      await expect(
        service.create(USER, { storyId: STORY_ID, voiceProfileId: VOICE_ID }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.storyNarration.create).not.toHaveBeenCalled();
    });

    it('replace: true replaces an existing READY narration', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue({ id: 'narr-old', status: 'READY', audioId: 'a-old' });

      const result = await service.create(USER, {
        storyId: STORY_ID,
        voiceProfileId: VOICE_ID,
        replace: true,
      } as any);

      expect(audioService.releaseAudio).toHaveBeenCalledWith('a-old', USER);
      expect(prisma.storyNarration.deleteMany).toHaveBeenCalledWith({ where: { id: 'narr-old' } });
      expect(result.id).toBe('narr-new');
    });

    it('new row is PENDING, owned by the caller, with a default "<story> - <voice>" title', async () => {
      await service.create(USER, { storyId: STORY_ID, voiceProfileId: VOICE_ID });

      expect(prisma.storyNarration.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            storyId: STORY_ID,
            voiceProfileId: VOICE_ID,
            userId: USER,
            title: 'Keloğlan - Anne',
            status: 'PENDING',
            freeRegeneration: false,
          },
        }),
      );
    });

    it('replacing a FAILED row whose audio an admin removed keeps the free regeneration and skips the quota check', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue({
        id: 'narr-old',
        status: 'FAILED',
        audioId: null,
        freeRegeneration: true,
      });

      await service.create(USER, { storyId: STORY_ID, voiceProfileId: VOICE_ID });

      expect(usageService.assertNarrationQuota).not.toHaveBeenCalled();
      expect(prisma.storyNarration.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ freeRegeneration: true }) }),
      );
    });

    it('ready-made Chirp 3 HD voice is checked against the standard quota bucket', async () => {
      prisma.voiceProfile.findUnique.mockResolvedValue(
        voice({ kind: 'PRESET', provider: 'GOOGLE', voiceId: 'tr-TR-Chirp3-HD-Achernar' }),
      );
      await service.create(USER, { storyId: STORY_ID, voiceProfileId: VOICE_ID });
      expect(usageService.assertNarrationQuota).toHaveBeenCalledWith(USER, 'FREE', false);
    });

    it('premium voice (clone) is checked against the premium quota bucket', async () => {
      prisma.voiceProfile.findUnique.mockResolvedValue(voice({ kind: 'CLONE', provider: 'CARTESIA' }));
      await service.create(USER, { storyId: STORY_ID, voiceProfileId: VOICE_ID });
      expect(usageService.assertNarrationQuota).toHaveBeenCalledWith(USER, 'FREE', true);
    });

    it('isFavorite on the embedded story reflects the caller favorites', async () => {
      prisma.favoriteStory.findUnique.mockResolvedValue({ id: 'fav-1' });
      const result: any = await service.create(USER, { storyId: STORY_ID, voiceProfileId: VOICE_ID });
      expect(result.story.isFavorite).toBe(true);
    });
  });

  describe('findAll (search + pagination)', () => {
    beforeEach(() => {
      prisma.storyNarration.count.mockResolvedValue(0);
      prisma.storyNarration.findMany.mockResolvedValue([]);
      prisma.favoriteStory.findMany.mockResolvedValue([]);
    });

    it('scopes to the user, narrows to the folded title matches, clamps the page size', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'narr-1' }, { id: 'narr-2' }]);

      const page = await service.findAll(USER, { page: 3, limit: 500, search: '  yildiz ' } as any);

      // The Turkish-aware match runs in SQL with the trimmed term bound.
      const raw = prisma.$queryRaw.mock.calls[0][0];
      expect(raw.text).toContain('sesly_search_fold(n."title")');
      expect(raw.text).toContain('sesly_search_fold(s."title")');
      expect(raw.values).toEqual([USER, 'yildiz', 'yildiz']);

      const where = prisma.storyNarration.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ userId: USER, id: { in: ['narr-1', 'narr-2'] } });
      expect(prisma.storyNarration.count).toHaveBeenCalledWith({ where });
      expect(prisma.storyNarration.findMany.mock.calls[0][0]).toMatchObject({
        orderBy: { updatedAt: 'desc' },
        skip: 200,
        take: 100,
      });
      expect(page).toEqual({ data: [], total: 0, page: 3, limit: 100, totalPages: 0 });
    });

    it('a term with no match returns an empty page without loading rows', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const page = await service.findAll(USER, { page: 2, limit: 10, search: 'KUCUK' } as any);

      expect(page).toEqual({ data: [], total: 0, page: 2, limit: 10, totalPages: 0 });
      expect(prisma.storyNarration.findMany).not.toHaveBeenCalled();
      expect(prisma.storyNarration.count).not.toHaveBeenCalled();
    });

    it('no search, or only spaces, lists every narration of the user', async () => {
      await service.findAll(USER, { search: '   ' } as any);
      await service.findAll(USER);

      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.storyNarration.findMany.mock.calls[0][0].where).toEqual({ userId: USER });
      expect(prisma.storyNarration.findMany.mock.calls[1][0].where).toEqual({ userId: USER });
    });
  });

  describe('findOne / remove ownership', () => {
    it('findOne: 404 when missing, 400 for another user', async () => {
      prisma.storyNarration.findUnique.mockResolvedValueOnce(null);
      await expect(service.findOne('x', USER)).rejects.toBeInstanceOf(NotFoundException);

      prisma.storyNarration.findUnique.mockResolvedValueOnce({ id: 'x', userId: 'someone-else' });
      await expect(service.findOne('x', USER)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('remove deletes the audio (best effort) and the row', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue({ id: 'narr-1', userId: USER, audioId: 'a1' });
      audioService.releaseAudio.mockRejectedValueOnce(new Error('gcs down'));

      await expect(service.remove('narr-1', USER)).resolves.toEqual({
        message: 'Narration deleted successfully',
      });
      expect(audioService.releaseAudio).toHaveBeenCalledWith('a1', USER);
      expect(prisma.storyNarration.deleteMany).toHaveBeenCalledWith({ where: { id: 'narr-1' } });
    });

    it("remove refuses another user's narration without touching audio", async () => {
      prisma.storyNarration.findUnique.mockResolvedValue({ id: 'narr-1', userId: 'someone-else', audioId: 'a1' });
      await expect(service.remove('narr-1', USER)).rejects.toBeInstanceOf(BadRequestException);
      expect(audioService.releaseAudio).not.toHaveBeenCalled();
      expect(prisma.storyNarration.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('getGenerationStatus (mobile polling)', () => {
    const row = (overrides: Partial<any> = {}) => ({
      id: 'narr-1',
      userId: USER,
      status: 'GENERATING',
      errorMessage: null,
      updatedAt: new Date('2026-09-01T00:00:00Z'),
      audioId: 'a1',
      audio: { status: 'GENERATING', duration: null, totalSegments: 3, readySegments: 1 },
      ...overrides,
    });

    it('exact response keys + progress', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(row());
      const status = await service.getGenerationStatus('narr-1', USER);
      expect(Object.keys(status).sort()).toEqual(
        ['duration', 'errorMessage', 'id', 'progress', 'status', 'updatedAt'].sort(),
      );
      expect(status).toMatchObject({ status: 'GENERATING', progress: 33, duration: null, errorMessage: null });
    });

    it('FAILED without a stored message gets the user-facing Turkish message, never the raw error', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue(
        row({ status: 'FAILED', audio: { status: 'FAILED', duration: null, totalSegments: 0, readySegments: 0 } }),
      );
      const status = await service.getGenerationStatus('narr-1', USER);
      expect(status.errorMessage).toBe('Masal hazırlanırken bir sorun oluştu. Lütfen tekrar dene.');
      expect(status.progress).toBe(0);
    });

    it('404 when missing, 403 for another user', async () => {
      prisma.storyNarration.findUnique.mockResolvedValueOnce(null);
      await expect(service.getGenerationStatus('x', USER)).rejects.toBeInstanceOf(NotFoundException);

      prisma.storyNarration.findUnique.mockResolvedValueOnce(row({ userId: 'someone-else' }));
      await expect(service.getGenerationStatus('x', USER)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getStreamUrl', () => {
    it('owned + audio present -> delegates to the audio service with the caller id', async () => {
      prisma.storyNarration.findUnique.mockResolvedValue({ id: 'narr-1', userId: USER, audioId: 'a1' });
      audioService.getStreamUrl.mockResolvedValue('signed-url');

      await expect(service.getStreamUrl('narr-1', USER)).resolves.toBe('signed-url');
      expect(audioService.getStreamUrl).toHaveBeenCalledWith('a1', USER);
    });

    it('no audio yet -> 404; another user -> 400; never presigns', async () => {
      prisma.storyNarration.findUnique.mockResolvedValueOnce({ id: 'narr-1', userId: USER, audioId: null });
      await expect(service.getStreamUrl('narr-1', USER)).rejects.toBeInstanceOf(NotFoundException);

      prisma.storyNarration.findUnique.mockResolvedValueOnce({ id: 'narr-1', userId: 'someone-else', audioId: 'a1' });
      await expect(service.getStreamUrl('narr-1', USER)).rejects.toBeInstanceOf(BadRequestException);

      expect(audioService.getStreamUrl).not.toHaveBeenCalled();
    });
  });

  describe('findByStory', () => {
    it('404 for an unknown story', async () => {
      prisma.story.findUnique.mockResolvedValue(null);
      await expect(service.findByStory(STORY_ID, USER)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lists only the caller narrations with the public voice shape and isFavorite', async () => {
      prisma.story.findUnique.mockResolvedValue({ id: STORY_ID });
      prisma.favoriteStory.findUnique.mockResolvedValue({ id: 'fav' });
      prisma.storyNarration.findMany.mockResolvedValue([
        {
          id: 'narr-1',
          title: 't',
          status: 'READY',
          audioId: 'a1',
          voiceProfileId: VOICE_ID,
          voiceProfile: voice({ voiceCloningKey: 'secret-key' }),
          errorMessage: null,
          audio: { status: 'READY', duration: 90, totalSegments: 2, readySegments: 2 },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const items = await service.findByStory(STORY_ID, USER);

      expect(prisma.storyNarration.findMany.mock.calls[0][0].where).toEqual({ storyId: STORY_ID, userId: USER });
      expect(items[0]).toMatchObject({ isFavorite: true, totalDuration: 90, duration: 90, progress: 100 });
      expect(JSON.stringify(items)).not.toContain('secret-key');
      expect(JSON.stringify(items)).not.toContain('consent.wav');
    });
  });
});
