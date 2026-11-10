import { renderMessage } from '../../test-utils/i18n';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { createHash } from 'crypto';
import { PRESET_PREVIEW_CACHE_VERSION, VoiceProfilesService } from './voice-profiles.service';
import { listPresetVoices } from '../../common/constants/google-preset-voices';
import { createSettingsStub, SettingsStub } from '../../test-utils/settings-stub';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createMockVoiceProfile } from '../../test-utils/mock-factories';
import {
  CLONE_VOICE_SLOTS,
  PRESET_VOICE_SLOTS,
} from '../../common/constants/voice-slots.constants';
import { CLONE_CONSENT_VERSION } from './clone-config.constants';
import { PreviewVoiceDto } from './dto/preview-voice.dto';
import { VoiceDeletionRequestStatus } from '../../common/enums/prisma.enums';

// Characters banned from user-facing copy (CLAUDE.md UI text rules).
const FORBIDDEN_UI_CHARS = /[—–…→←•·★✓›⚡]|\p{Extended_Pictographic}/u;

// Short hash of the default Google prosody (0.92 / -2) in preset preview keys.
const DEFAULT_PROSODY = `p${createHash('sha256').update('0.92|-2').digest('hex').slice(0, 8)}`;

describe('VoiceProfilesService', () => {
  let prisma: MockPrismaService;
  let factory: any;
  let google: any;
  let cartesia: any;
  let cloningProvider: any;
  let storage: any;
  let queue: any;
  let notifications: any;
  let service: VoiceProfilesService;
  let settings: SettingsStub;


  /** counts: [presetCount, cloneCount] in the order getVoiceSlotInfo queries them. */
  const mockSlots = (opts: {
    plan?: string;
    extraVoiceSlots?: number;
    presets?: number;
    clones?: number;
    monthly?: number;
    lifetime?: number;
  }) => {
    prisma.subscription.findUnique.mockResolvedValue(
      opts.plan ? { plan: opts.plan, status: 'ACTIVE', extraVoiceSlots: opts.extraVoiceSlots ?? 0 } : null,
    );
    prisma.voiceProfile.count.mockImplementation(async ({ where }: any) =>
      where.kind === 'PRESET' ? opts.presets ?? 0 : opts.clones ?? 0,
    );
    prisma.usageLimit.findUnique.mockResolvedValue(
      opts.monthly !== undefined ? { clonesCreated: opts.monthly } : null,
    );
    prisma.usageLifetime.findUnique.mockResolvedValue(
      opts.lifetime !== undefined ? { clonesCreated: opts.lifetime, cloneNarrations: 0 } : null,
    );
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    google = {
      getProviderName: () => 'GOOGLE',
      getAvailableVoices: jest.fn(async (languages: string[] = ['tr']) =>
        languages.flatMap((l) => listPresetVoices(l).map((v) => ({ ...v, provider: 'GOOGLE' }))),
      ),
      textToSpeech: jest.fn().mockResolvedValue(Buffer.from('mp3')),
    };
    cartesia = {
      getProviderName: () => 'CARTESIA',
      getAvailableVoices: jest.fn().mockResolvedValue([]),
      textToSpeech: jest.fn().mockResolvedValue(Buffer.from('mp3')),
    };
    cloningProvider = { deleteVoiceClone: jest.fn().mockResolvedValue(undefined) };
    factory = {
      getAllProviders: () => [google, cartesia],
      getProvider: (p: string) => (p.toLowerCase() === 'cartesia' ? cartesia : google),
      getDefaultProviderType: () => 'CARTESIA',
      getCloningProvider: jest.fn(() => cloningProvider),
    };
    storage = {
      uploadFile: jest.fn(async (_b: Buffer, key: string) => `https://storage.googleapis.com/b/${key}`),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      deleteFolder: jest.fn().mockResolvedValue(undefined),
      fileExists: jest.fn().mockResolvedValue(false),
      generatePresignedUrl: jest.fn(async (key: string) => `signed:${key}`),
    };
    queue = { add: jest.fn().mockResolvedValue({}) };
    notifications = { notifyVoiceReady: jest.fn() };
    settings = createSettingsStub();
    service = new VoiceProfilesService(prisma as any, storage, factory, queue, notifications, settings as any);
  });

  describe('GET /voice-profiles/clone-config', () => {
    it('returns the contract shape with values from the constants', () => {
      const config = service.getCloneConfig();
      expect(Object.keys(config).sort()).toEqual(
        [
          'consentText',
          'consentTitle',
          'consentVersion',
          'enabled',
          'introSteps',
          'language',
          'locale',
          'maxSeconds',
          'minSeconds',
          'provider',
          'recordingTips',
          'script',
          'scriptTitle',
          'supportedLanguages',
          'targetSeconds',
        ].sort(),
      );
      expect(config).toMatchObject({
        enabled: true,
        provider: 'CARTESIA',
        language: 'tr',
        minSeconds: 15,
        targetSeconds: 30,
        maxSeconds: 60,
        consentVersion: CLONE_CONSENT_VERSION,
      });
    });

    it('script: 110-130 words, no digits, Turkish letters, ends on a full sentence', () => {
      const { script } = service.getCloneConfig();
      const words = script.split(/\s+/).filter(Boolean);
      expect(words.length).toBeGreaterThanOrEqual(110);
      expect(words.length).toBeLessThanOrEqual(130);
      expect(script).not.toMatch(/\d/);
      expect(script).not.toMatch(/!/);
      for (const ch of ['ç', 'ğ', 'ı', 'İ', 'ö', 'ş', 'ü', 'â']) {
        expect(script).toContain(ch);
      }
      expect(script.trim()).toMatch(/\.$/);
    });

    it('consent text covers KVKK points and has no AI-signature characters', () => {
      const config = service.getCloneConfig();
      for (const text of [config.script, config.scriptTitle, config.consentText, config.consentTitle]) {
        expect(text).not.toMatch(FORBIDDEN_UI_CHARS);
      }
      expect(config.consentText).toContain('biyometrik');
      expect(config.consentText).toContain('Cartesia, Inc.');
      expect(config.consentText).toContain('Amerika Birleşik Devletleri');
      expect(config.consentText).toContain('silene kadar');
      expect(config.consentText).toContain('kendi sesini');
      expect(config.consentText).toContain('ses profilini silmen');
    });

    it('introSteps: the 3 intro steps, durations taken from the recorder gates', () => {
      const { introSteps, minSeconds, targetSeconds } = service.getCloneConfig();

      expect(introSteps).toEqual([
        {
          title: 'Sessiz bir oda bul',
          body: 'Çevren ne kadar sessiz olursa Sesly sesini o kadar temiz öğrenir.',
        },
        {
          title: 'Yaklaşık 30 saniyelik bir masal oku',
          body: 'Sana kısa bir masal metni göstereceğiz. En az 15 saniye okuman gerekiyor; daha uzun kayıt aksanını daha iyi korur.',
        },
        {
          title: 'Sesin hazırlansın',
          body: 'Kaydın genellikle bir dakikadan kısa sürede hazır olur. Beklemek zorunda değilsin, hazır olunca haber veririz.',
        },
      ]);
      expect(introSteps[1].title).toContain(`${targetSeconds} saniye`);
      expect(introSteps[1].body).toContain(`${minSeconds} saniye`);
    });

    it('recordingTips: 4 tips with the agreed icon keys', () => {
      const { recordingTips } = service.getCloneConfig();

      expect(recordingTips).toEqual([
        { icon: 'quiet', text: 'Sessiz bir odada kaydet.' },
        { icon: 'distance', text: 'Telefonu ağzından bir karış uzakta tut.' },
        { icon: 'calm', text: 'Masal okur gibi doğal ve sakin oku.' },
        { icon: 'pauses', text: 'Uzun duraklama yapma, akıcı bir şekilde devam et.' },
      ]);
      for (const tip of recordingTips) {
        expect(Object.keys(tip).sort()).toEqual(['icon', 'text']);
      }
    });

    it('intro steps and tips carry no AI-signature characters and are fresh copies per call', () => {
      const first = service.getCloneConfig();
      for (const s of first.introSteps) {
        expect(s.title).not.toMatch(FORBIDDEN_UI_CHARS);
        expect(s.body).not.toMatch(FORBIDDEN_UI_CHARS);
      }
      for (const t of first.recordingTips) expect(t.text).not.toMatch(FORBIDDEN_UI_CHARS);

      first.introSteps[0].title = 'mutated';
      first.recordingTips.pop();
      const second = service.getCloneConfig();
      expect(second.introSteps[0].title).toBe('Sessiz bir oda bul');
      expect(second.recordingTips).toHaveLength(4);
    });
  });

  describe('GET /voice-profiles/available-voices', () => {
    it('no parameters: the 30 Turkish Chirp 3 HD narrators, none premium, cartesia empty', async () => {
      const result: any = await service.getAvailableVoices();

      expect(Object.keys(result)).toEqual(['google', 'cartesia']);
      expect(result.cartesia).toEqual([]);
      expect(result.google).toHaveLength(30);
      expect(result.google[0]).toEqual({
        id: 'tr-TR-Chirp3-HD-Achernar',
        name: 'Achernar',
        language: 'Turkish',
        languageCode: 'tr-TR',
        contentLanguage: 'tr',
        gender: 'female',
        description: 'Kadın anlatıcı sesi',
        provider: 'GOOGLE',
        isPremium: false,
      });
      expect(result.google.every((v: any) => /^tr-TR-Chirp3-HD-[A-Z][a-z]+$/.test(v.id))).toBe(true);
      expect(result.google.every((v: any) => v.isPremium === false)).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(/Wavenet|Standard|\(HD\)|Chirp3 /);
      expect(google.getAvailableVoices).toHaveBeenCalledWith(['tr']);
    });

    it('no language follows the default content language setting', async () => {
      settings.values['content.enabledLanguages'] = ['tr', 'en'];
      settings.values['content.defaultLanguage'] = 'en';
      const result: any = await service.getAvailableVoices();
      expect(result.google).toHaveLength(30);
      expect(result.google[0]).toMatchObject({
        id: 'en-US-Chirp3-HD-Achernar',
        name: 'Achernar',
        language: 'English',
        languageCode: 'en-US',
        contentLanguage: 'en',
      });
    });

    it('language=en lists the English narrators, also with a provider filter', async () => {
      const result: any = await service.getAvailableVoices('google', 'en');
      expect(result.provider).toBe('GOOGLE');
      expect(result.voices).toHaveLength(30);
      expect(new Set(result.voices.map((v: any) => v.contentLanguage))).toEqual(new Set(['en']));
      expect(result.voices.every((v: any) => v.id.startsWith('en-US-Chirp3-HD-'))).toBe(true);
    });

    it('several languages: comma separated or repeated, order kept, duplicates and case ignored', async () => {
      const comma: any = await service.getAvailableVoices(undefined, ' EN , tr,en ');
      expect(comma.google).toHaveLength(60);
      expect(comma.google[0].contentLanguage).toBe('en');
      expect(comma.google[30].contentLanguage).toBe('tr');

      const repeated: any = await service.getAvailableVoices(undefined, ['tr', 'de']);
      expect(repeated.google.map((v: any) => v.languageCode).filter((c: string, i: number, a: string[]) => a.indexOf(c) === i)).toEqual([
        'tr-TR',
        'de-DE',
      ]);
    });

    it('a language without ready-made voices (ru) or an unknown code returns none', async () => {
      expect(((await service.getAvailableVoices(undefined, 'ru')) as any).google).toEqual([]);
      expect(((await service.getAvailableVoices(undefined, 'xx')) as any).google).toEqual([]);
      expect(((await service.getAvailableVoices(undefined, 'ru,tr')) as any).google).toHaveLength(30);
    });
  });

  it('GET /voice-profiles hides secrets, adds kind + consentAt + errorMessage', async () => {
    const consentAt = new Date('2026-09-27T10:00:00Z');
    prisma.voiceProfile.findMany.mockResolvedValue([
      createMockVoiceProfile({
        provider: 'CARTESIA',
        voiceCloningKey: 'secret-key',
        consentAudioUrl: 'voice-samples/u/consent.wav',
        consentAt,
        consentVersion: CLONE_CONSENT_VERSION,
        status: 'FAILED',
        errorReason: 'Kayıt çok kısa.',
      }),
      createMockVoiceProfile({ provider: 'GOOGLE', voiceId: 'tr-TR-Chirp3-HD-Achernar' }),
    ]);

    const [clone, preset]: any[] = await service.getVoiceProfiles('u1');
    expect(clone.voiceCloningKey).toBeUndefined();
    expect(clone.consentAudioUrl).toBeUndefined();
    expect(clone.consentVersion).toBeUndefined();
    expect(clone.kind).toBe('CLONE');
    expect(clone.consentAt).toBe('2026-09-27T10:00:00.000Z');
    expect(clone.errorMessage).toBe('Kayıt çok kısa.');
    expect(preset.kind).toBe('PRESET');
    expect(preset.consentAt).toBeNull();
  });

  describe('create (preset vs clone)', () => {
    beforeEach(() => {
      prisma.voiceProfile.create.mockImplementation(async ({ data }: any) =>
        createMockVoiceProfile({ ...data, id: 'vp-1' }),
      );
    });

    it('ready-made Google voice -> PRESET READY, no notification', async () => {
      mockSlots({});
      const result: any = await service.createVoiceProfileV2('u1', {
        name: 'Anlatıcı',
        provider: 'GOOGLE',
        voiceId: 'tr-TR-Chirp3-HD-Achernar',
      } as any);

      expect(prisma.voiceProfile.create.mock.calls[0][0].data).toMatchObject({
        kind: 'PRESET',
        provider: 'GOOGLE',
        status: 'READY',
        voiceId: 'tr-TR-Chirp3-HD-Achernar',
        language: 'tr-TR',
      });
      expect(result.profile.kind).toBe('PRESET');
      expect(result.profile.isPremium).toBe(false);
      expect(result.availableVoices).toHaveLength(30);
      expect(result.availableVoices[0]).toMatchObject({ name: 'Achernar', isPremium: false });
      expect(notifications.notifyVoiceReady).not.toHaveBeenCalled();
    });

    it('preset limit counts presets only -> 403 PRESET_SLOT_LIMIT', async () => {
      mockSlots({ presets: PRESET_VOICE_SLOTS.FREE, clones: 0 });
      const err = await service
        .createVoiceProfileV2('u1', { name: 'x', provider: 'GOOGLE', voiceId: 'tr-TR-Chirp3-HD-Achernar' } as any)
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: 'PRESET_SLOT_LIMIT', limit: PRESET_VOICE_SLOTS.FREE });
      expect(renderMessage(err)).toContain('hazır anlatıcı');

      // A full clone budget does not block presets.
      mockSlots({ presets: 0, clones: CLONE_VOICE_SLOTS.FREE });
      await expect(
        service.createVoiceProfileV2('u1', { name: 'x', provider: 'GOOGLE', voiceId: 'tr-TR-Chirp3-HD-Achernar' } as any),
      ).resolves.toBeDefined();
    });

    it.each([
      'nope',
      'tr-TR-Wavenet-A',
      'tr-TR-Standard-B',
      'tr-TR-Chirp3-HD-Nobody',
      'ru-RU-Chirp3-HD-Kore',
      'tr-TR-Chirp-HD-F',
    ])('voice id %p is not in the catalogue -> 400 VOICE_NOT_FOUND', async (voiceId) => {
      mockSlots({});
      const err = await service
        .createVoiceProfileV2('u1', { name: 'x', provider: 'GOOGLE', voiceId } as any)
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ code: 'VOICE_NOT_FOUND' });
      expect(prisma.voiceProfile.create).not.toHaveBeenCalled();
    });

    it('validates against the static catalogue: a Google outage does not reject a Chirp voice', async () => {
      mockSlots({});
      google.getAvailableVoices.mockRejectedValueOnce(new Error('Google TTS listVoices timeout'));
      prisma.voiceProfile.create.mockClear();
      // The lookup happens before (and without) any provider call.
      const pending = service.createVoiceProfileV2('u1', {
        name: 'Kore',
        provider: 'GOOGLE',
        voiceId: 'en-US-Chirp3-HD-Kore',
        language: 'tr-TR',
      } as any);
      await pending.catch(() => undefined);
      expect(prisma.voiceProfile.create.mock.calls[0][0].data).toMatchObject({
        voiceId: 'en-US-Chirp3-HD-Kore',
        // The voice's own locale, not the language the client sent.
        language: 'en-US',
      });
    });

    it('CARTESIA only accepts the clone placeholder, never an arbitrary voice id', async () => {
      mockSlots({});
      const err = await service
        .createVoiceProfileV2('u1', { name: 'x', provider: 'CARTESIA', voiceId: 'someone-elses-clone' } as any)
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ code: 'CLONE_ONLY_PROVIDER' });
      expect(prisma.voiceProfile.create).not.toHaveBeenCalled();
    });

    it('CARTESIA placeholder -> CLONE PENDING with a pending- voice id', async () => {
      mockSlots({});
      const result: any = await service.createVoiceProfileV2('u1', {
        name: 'Annem',
        provider: 'CARTESIA',
        voiceId: 'custom-cloning-pending',
      } as any);

      const data = prisma.voiceProfile.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ kind: 'CLONE', provider: 'CARTESIA', status: 'PENDING' });
      expect(data.voiceId).toMatch(/^pending-/);
      expect(result.profile.kind).toBe('CLONE');
      expect(result.availableVoices).toEqual([]);
    });

    it('clone slot and creation allowance are enforced at creation', async () => {
      mockSlots({ clones: CLONE_VOICE_SLOTS.FREE });
      let err = await service
        .createVoiceProfileV2('u1', { name: 'x', provider: 'CARTESIA', voiceId: 'custom-cloning-pending' } as any)
        .catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: 'CLONE_SLOT_LIMIT', limit: CLONE_VOICE_SLOTS.FREE });

      // Paid plan: monthly creations used up, renews on the 1st.
      mockSlots({ plan: 'PRO', clones: 0, monthly: 5 });
      err = await service.createVoiceProfile('u1', { name: 'x' }).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({
        code: 'CLONE_CREATION_LIMIT',
        plan: 'PRO',
        limit: 5,
        used: 5,
        period: 'month',
        renewsAt: expect.any(Date),
      });
      expect(renderMessage(err)).toContain('Bu ay');
      expect(renderMessage(err)).toContain('tarihinde yenilenir');
    });

    it('abuse: a FREE user who recorded, deleted the voice and records again is refused (creations are counted, not rows)', async () => {
      // No clone row left (deleted), but the lifetime counter still holds the creation.
      mockSlots({ clones: 0, lifetime: 1, monthly: 0 });
      const err = await service
        .createVoiceProfileV2('u1', { name: 'x', provider: 'CARTESIA', voiceId: 'custom-cloning-pending' } as any)
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({
        code: 'CLONE_CREATION_LIMIT',
        plan: 'FREE',
        limit: 1,
        used: 1,
        period: 'lifetime',
        renewsAt: null,
      });
      expect(renderMessage(err)).toContain('yenilenmez');
      expect(renderMessage(err)).toContain('silmek de yeni bir hak vermez');
      expect(prisma.voiceProfile.create).not.toHaveBeenCalled();

      const slots = await service.getVoiceSlotInfo('u1');
      expect(slots.clone.canCreate).toBe(false);
      // Old app builds read monthlyCreated / monthlyLimit: they see it used up too.
      expect(slots.clone.monthlyCreated).toBe(1);
      expect(slots.clone.monthlyLimit).toBe(1);
    });
  });

  describe('GET /voice-profiles/slots', () => {
    it('keeps the old fields and adds preset / clone breakdowns', async () => {
      mockSlots({ plan: 'PRO', extraVoiceSlots: 2, presets: 4, clones: 5, monthly: 1 });
      const slots = await service.getVoiceSlotInfo('u1');

      expect(slots).toEqual({
        plan: 'PRO',
        totalSlots: PRESET_VOICE_SLOTS.PRO + CLONE_VOICE_SLOTS.PRO + 2,
        usedSlots: 9,
        availableSlots: PRESET_VOICE_SLOTS.PRO - 4 + 0,
        extraSlots: 2,
        canCreate: true,
        preset: { used: 4, limit: PRESET_VOICE_SLOTS.PRO, canCreate: true },
        clone: {
          used: 5,
          limit: CLONE_VOICE_SLOTS.PRO + 2,
          canCreate: false,
          monthlyCreated: 1,
          monthlyLimit: 5,
          creations: { used: 1, limit: 5, period: 'month', renewsAt: expect.any(Date), canCreate: true },
        },
      });
    });

    it('does not count FAILED clones against the clone slots', async () => {
      mockSlots({ plan: 'FREE', clones: 0, monthly: 0 });
      await service.getVoiceSlotInfo('u1');
      expect(prisma.voiceProfile.count).toHaveBeenCalledWith({
        where: { userId: 'u1', kind: 'CLONE', status: { not: 'FAILED' } },
      });
    });

    it('clone.canCreate is false once the creation allowance is used; canCreate falls back to presets', async () => {
      mockSlots({ presets: PRESET_VOICE_SLOTS.FREE, clones: 0, lifetime: 1 });
      const slots = await service.getVoiceSlotInfo('u1');
      expect(slots.clone.canCreate).toBe(false);
      expect(slots.preset.canCreate).toBe(false);
      expect(slots.canCreate).toBe(false);
    });
  });

  describe('POST /voice-profiles/:id/upload-samples', () => {
    const reference = {
      originalname: 'reference_1.m4a',
      mimetype: 'audio/m4a',
      size: 1000,
      buffer: Buffer.from('ref'),
    } as Express.Multer.File;

    const pendingClone = () =>
      createMockVoiceProfile({
        id: 'vp-1',
        userId: 'u1',
        provider: 'CARTESIA',
        kind: 'CLONE',
        status: 'PENDING',
        voiceId: 'pending-x',
        sampleAudioUrl: null,
        consentAudioUrl: null,
      });

    const upload = (overrides: Record<string, unknown> = {}) =>
      service.uploadVoiceSamples('u1', 'vp-1', {
        referenceAudio: reference,
        consentVersion: CLONE_CONSENT_VERSION,
        speechStartMs: 850,
        ...overrides,
      } as any);

    beforeEach(() => {
      prisma.voiceProfile.findFirst.mockResolvedValue(pendingClone());
      mockSlots({ clones: 1, monthly: 0 });
      prisma.voiceProfile.updateMany.mockResolvedValue({ count: 1 });
      prisma.usageLimit.upsert.mockResolvedValue({});
      prisma.usageLimit.updateMany.mockResolvedValue({ count: 1 });
      prisma.usageLifetime.upsert.mockResolvedValue({});
      prisma.usageLifetime.updateMany.mockResolvedValue({ count: 1 });
    });

    it('accepts: stores files under the profile folder, records consent, counts the creation, queues with retries', async () => {
      const result: any = await upload();

      const refKey = storage.uploadFile.mock.calls[0][1];
      expect(refKey).toMatch(/^voice-samples\/u1\/vp-1\/reference\/reference-1-\d+-[a-z0-9]+\.m4a$/);

      const claim = prisma.voiceProfile.updateMany.mock.calls[0][0];
      expect(claim.where).toEqual({ id: 'vp-1', userId: 'u1', status: 'PENDING' });
      expect(claim.data).toMatchObject({
        status: 'PROCESSING',
        sampleAudioUrl: refKey,
        consentVersion: CLONE_CONSENT_VERSION,
        consentAt: expect.any(Date),
      });

      // FREE: the creation is checked on the lifetime counter (limit 1)...
      const counter = prisma.usageLifetime.updateMany.mock.calls[0][0];
      expect(counter.where).toEqual({ userId: 'u1', clonesCreated: { lt: 1 } });
      expect(counter.data).toEqual({ clonesCreated: { increment: 1 } });
      // ...and counted on the row of this month as well.
      expect(prisma.usageLimit.updateMany.mock.calls[0][0].data).toEqual({ clonesCreated: { increment: 1 } });
      // The charge time is stored on the profile (for a refund after a failed training).
      const marker = prisma.voiceProfile.updateMany.mock.calls[1][0];
      expect(marker).toEqual({ where: { id: 'vp-1' }, data: { creationChargedAt: expect.any(Date) } });

      const [name, job, opts] = queue.add.mock.calls[0];
      expect(name).toBe('train-voice');
      expect(job).toMatchObject({ profileId: 'vp-1', referenceS3Key: refKey, speechStartMs: 850 });
      expect(opts).toMatchObject({
        jobId: 'train-vp-1',
        attempts: 3,
        backoff: { type: 'exponential', delay: expect.any(Number) },
      });

      expect(result.profile).toMatchObject({ status: 'PROCESSING', kind: 'CLONE' });
      expect(typeof result.profile.consentAt).toBe('string');
    });

    it('409 VOICE_ALREADY_UPLOADED unless the profile is PENDING', async () => {
      for (const status of ['PROCESSING', 'READY', 'FAILED']) {
        prisma.voiceProfile.findFirst.mockResolvedValue({ ...pendingClone(), status });
        const err = await upload().catch((e) => e);
        expect(err).toBeInstanceOf(ConflictException);
        expect(err.getResponse()).toMatchObject({ code: 'VOICE_ALREADY_UPLOADED', status });
      }
      expect(storage.uploadFile).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('400 CONSENT_REQUIRED when the consent version is missing or stale', async () => {
      for (const consentVersion of [undefined, null, '2025-01-v0']) {
        const err = await upload({ consentVersion }).catch((e) => e);
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.getResponse()).toMatchObject({
          code: 'CONSENT_REQUIRED',
          consentVersion: CLONE_CONSENT_VERSION,
        });
      }
      expect(storage.uploadFile).not.toHaveBeenCalled();
    });

    it('400 NOT_A_CLONE_PROFILE for presets', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue({ ...pendingClone(), kind: 'PRESET', provider: 'GOOGLE' });
      const err = await upload().catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: 'NOT_A_CLONE_PROFILE' });
    });

    it('clone checks run again at upload (downgraded plan)', async () => {
      mockSlots({ clones: CLONE_VOICE_SLOTS.FREE + 1, monthly: 0 });
      let err = await upload().catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: 'CLONE_SLOT_LIMIT' });

      mockSlots({ clones: 1, lifetime: 1 });
      err = await upload().catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: 'CLONE_CREATION_LIMIT' });
      expect(storage.uploadFile).not.toHaveBeenCalled();
    });

    it('losing the claim race -> 409 and uploaded files discarded', async () => {
      prisma.voiceProfile.updateMany.mockResolvedValueOnce({ count: 0 });
      prisma.voiceProfile.findFirst
        .mockResolvedValueOnce(pendingClone())
        .mockResolvedValueOnce({ status: 'PROCESSING' });

      const err = await upload().catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(storage.deleteFolder).toHaveBeenCalledWith('voice-samples/u1/vp-1/');
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('creation counter race lost -> claim released, 403 CLONE_CREATION_LIMIT', async () => {
      prisma.usageLifetime.updateMany.mockResolvedValueOnce({ count: 0 });
      const err = await upload().catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: 'CLONE_CREATION_LIMIT' });
      const release = prisma.voiceProfile.updateMany.mock.calls[1][0];
      expect(release.where).toEqual({ id: 'vp-1', status: 'PROCESSING' });
      expect(release.data).toMatchObject({ status: 'PENDING', consentAt: null, consentVersion: null });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('queue unavailable -> claim released and the creation refunded', async () => {
      queue.add.mockRejectedValueOnce(new Error('redis down'));
      prisma.voiceProfile.findUnique.mockResolvedValue({ userId: 'u1', creationChargedAt: new Date() });
      const err = await upload().catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: 'VOICE_QUEUE_UNAVAILABLE' });
      const refund = prisma.usageLimit.updateMany.mock.calls[1][0];
      expect(refund.data).toEqual({ clonesCreated: { decrement: 1 } });
      expect(refund.where.clonesCreated).toEqual({ gt: 0 });
      expect(prisma.usageLifetime.updateMany.mock.calls[1][0]).toEqual({
        where: { userId: 'u1', clonesCreated: { gt: 0 } },
        data: { clonesCreated: { decrement: 1 } },
      });
    });
  });

  describe('DELETE /voice-profiles/:id (KVKK)', () => {
    beforeEach(() => {
      prisma.audio.findMany.mockResolvedValue([{ id: 'a1' }]);
      prisma.voiceDeletionRequest.create.mockResolvedValue({ id: 'req-1' });
      prisma.voiceDeletionRequest.update.mockResolvedValue({});
    });

    it('READY clone: row, raw/normalized/consent/sample files, narrations and the upstream clone', async () => {
      const profile = createMockVoiceProfile({
        id: 'vp-1',
        userId: 'u1',
        provider: 'CARTESIA',
        kind: 'CLONE',
        voiceId: 'cartesia-123',
        voiceCloningKey: 'cartesia-123',
        sampleAudioUrl: 'voice-samples/u1/vp-1/test-sample.mp3',
        consentAudioUrl: 'https://storage.googleapis.com/bucket/voice-samples/u1/vp-1/consent/c.m4a',
      });
      prisma.voiceProfile.findFirst.mockResolvedValue(profile);
      prisma.voiceProfile.delete.mockResolvedValue(profile);

      await service.deleteVoiceProfile('u1', 'vp-1');

      expect(prisma.voiceProfile.delete).toHaveBeenCalledWith({ where: { id: 'vp-1' } });
      expect(storage.deleteFolder).toHaveBeenCalledWith('voice-samples/u1/vp-1/');
      expect(storage.deleteFolder).toHaveBeenCalledWith('audio/a1/');
      expect(storage.deleteFile).toHaveBeenCalledWith('voice-samples/u1/vp-1/consent/c.m4a');
      expect(storage.deleteFile).toHaveBeenCalledWith('voice-samples/u1/vp-1.mp3'); // legacy sample key
      expect(cloningProvider.deleteVoiceClone).toHaveBeenCalledWith('cartesia-123');
      expect(prisma.voiceDeletionRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: expect.objectContaining({ status: VoiceDeletionRequestStatus.COMPLETED }),
      });
    });

    it('uses the row state returned by delete (clone finished while deleting)', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(
        createMockVoiceProfile({ id: 'vp-1', userId: 'u1', provider: 'CARTESIA', kind: 'CLONE', voiceId: 'pending-x' }),
      );
      prisma.voiceProfile.delete.mockResolvedValue(
        createMockVoiceProfile({
          id: 'vp-1',
          userId: 'u1',
          provider: 'CARTESIA',
          kind: 'CLONE',
          voiceId: 'fresh-clone',
          voiceCloningKey: 'fresh-clone',
        }),
      );

      await service.deleteVoiceProfile('u1', 'vp-1');
      expect(cloningProvider.deleteVoiceClone).toHaveBeenCalledWith('fresh-clone');
    });

    it('pending clone and Cartesia stock preset: NO_OP audit, no upstream call', async () => {
      for (const profile of [
        createMockVoiceProfile({ id: 'vp-1', userId: 'u1', provider: 'CARTESIA', kind: 'CLONE', voiceId: 'pending-1' }),
        createMockVoiceProfile({ id: 'vp-2', userId: 'u1', provider: 'CARTESIA', kind: 'PRESET', voiceId: 'stock-voice' }),
      ]) {
        prisma.voiceProfile.findFirst.mockResolvedValue(profile);
        prisma.voiceProfile.delete.mockResolvedValue(profile);
        await service.deleteVoiceProfile('u1', profile.id);
      }
      expect(cloningProvider.deleteVoiceClone).not.toHaveBeenCalled();
      const statuses = prisma.voiceDeletionRequest.create.mock.calls.map((c: any[]) => c[0].data.status);
      expect(statuses).toEqual([VoiceDeletionRequestStatus.NO_OP, VoiceDeletionRequestStatus.NO_OP]);
    });

    it('upstream failure is recorded as FAILED (the sweeper retries it)', async () => {
      const profile = createMockVoiceProfile({
        id: 'vp-1',
        userId: 'u1',
        provider: 'CARTESIA',
        kind: 'CLONE',
        voiceId: 'c-1',
        voiceCloningKey: 'c-1',
      });
      prisma.voiceProfile.findFirst.mockResolvedValue(profile);
      prisma.voiceProfile.delete.mockResolvedValue(profile);
      cloningProvider.deleteVoiceClone.mockRejectedValue(new Error('Cartesia 503'));

      await expect(service.deleteVoiceProfile('u1', 'vp-1')).resolves.toBeDefined();
      expect(prisma.voiceDeletionRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: expect.objectContaining({ status: VoiceDeletionRequestStatus.FAILED, notes: 'Cartesia 503' }),
      });
    });
  });

  describe('POST /voice-profiles/preview', () => {
    it('DTO: strict fields, provider case-insensitive, text max 300', async () => {
      const check = (body: object) =>
        validate(plainToInstance(PreviewVoiceDto, body) as object, { whitelist: true, forbidNonWhitelisted: true });

      expect(await check({ voiceId: 'tr-TR-Chirp3-HD-Achernar', provider: 'google' })).toHaveLength(0);
      expect(await check({ voiceId: 'x', provider: 'GOOGLE', text: 'a'.repeat(300) })).toHaveLength(0);
      expect((await check({ voiceId: 'x', provider: 'GOOGLE', text: 'a'.repeat(301) })).length).toBeGreaterThan(0);
      expect((await check({ voiceId: 'x', provider: 'MINIMAX' })).length).toBeGreaterThan(0);
      expect((await check({ voiceId: 'x', provider: 'GOOGLE', extra: 1 })).length).toBeGreaterThan(0);
    });

    it('ready-made Google voice is allowed and cached by voice id', async () => {
      const result = await service.previewVoice('u1', { voiceId: 'tr-TR-Chirp3-HD-Achernar', provider: 'GOOGLE' });
      expect(storage.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        `voice-previews/GOOGLE/v2/tr-TR/tr-TR-Chirp3-HD-Achernar/${DEFAULT_PROSODY}.mp3`,
        'audio/mpeg',
      );
      expect(result.audioUrl).toBe(`signed:voice-previews/GOOGLE/v2/tr-TR/tr-TR-Chirp3-HD-Achernar/${DEFAULT_PROSODY}.mp3`);
    });

    it('preset preview key carries the Google prosody: changing rate or pitch renders a fresh file', async () => {
      const keyOf = async (text?: string) => {
        storage.uploadFile.mockClear();
        await service.previewVoice('u1', { voiceId: 'tr-TR-Chirp3-HD-Achernar', provider: 'GOOGLE', text } as any);
        return storage.uploadFile.mock.calls[0][1] as string;
      };

      const before = await keyOf();
      const beforeText = await keyOf('Merhaba dünya');
      expect(before).toBe(`voice-previews/GOOGLE/v2/tr-TR/tr-TR-Chirp3-HD-Achernar/${DEFAULT_PROSODY}.mp3`);
      expect(beforeText).toMatch(
        new RegExp(`^voice-previews/GOOGLE/v2/tr-TR/tr-TR-Chirp3-HD-Achernar/${DEFAULT_PROSODY}-[0-9a-f]{16}\\.mp3$`),
      );

      settings.values['tts.google.speakingRate'] = 1.1;
      const afterRate = await keyOf();
      settings.values['tts.google.pitch'] = 0;
      const afterPitch = await keyOf();
      const afterText = await keyOf('Merhaba dünya');

      expect(afterRate).toMatch(/^voice-previews\/GOOGLE\/v2\/tr-TR\/tr-TR-Chirp3-HD-Achernar\/p[0-9a-f]{8}\.mp3$/);
      expect(new Set([before, afterRate, afterPitch]).size).toBe(3);
      expect(afterText).not.toBe(beforeText);
      // Same text, different prosody: only the prosody part of the key moved.
      expect(afterText.split('-').pop()).toBe(beforeText.split('-').pop());
    });

    it('preset preview validates against the static catalogue and never lists provider voices', async () => {
      google.getAvailableVoices.mockRejectedValue(new Error('Google TTS listVoices timeout'));
      const result = await service.previewVoice('u1', { voiceId: 'tr-TR-Chirp3-HD-Kore', provider: 'GOOGLE' });
      expect(result).toMatchObject({ voiceId: 'tr-TR-Chirp3-HD-Kore', cached: false });
      expect(google.getAvailableVoices).not.toHaveBeenCalled();
      expect(google.textToSpeech).toHaveBeenCalledWith(
        'Merhaba, ben senin ses profilin. Böyle konuşuyorum.',
        'tr-TR-Chirp3-HD-Kore',
        { language: 'tr-TR' },
      );
    });

    it('a voice of another language previews with a line in its own language', async () => {
      await service.previewVoice('u1', { voiceId: 'en-US-Chirp3-HD-Puck', provider: 'GOOGLE' });
      expect(google.textToSpeech).toHaveBeenCalledWith(
        'Hello, I am your narrator. This is how I sound when I read a story.',
        'en-US-Chirp3-HD-Puck',
        { language: 'en-US' },
      );
      expect(storage.uploadFile.mock.calls[0][1]).toBe(
        `voice-previews/GOOGLE/v2/en-US/en-US-Chirp3-HD-Puck/${DEFAULT_PROSODY}.mp3`,
      );
    });

    it('the cache key carries a version segment: a preview stored under the old key is not served', async () => {
      expect(PRESET_PREVIEW_CACHE_VERSION).toBe('v2');
      const oldKey = `voice-previews/GOOGLE/tr-TR/tr-TR-Chirp3-HD-Achernar/${DEFAULT_PROSODY}.mp3`;
      storage.fileExists.mockImplementation(async (key: string) => key === oldKey);

      const result = await service.previewVoice('u1', { voiceId: 'tr-TR-Chirp3-HD-Achernar', provider: 'GOOGLE' });

      expect(result.cached).toBe(false);
      expect(storage.fileExists).toHaveBeenCalledWith(
        `voice-previews/GOOGLE/v2/tr-TR/tr-TR-Chirp3-HD-Achernar/${DEFAULT_PROSODY}.mp3`,
      );
      expect(storage.fileExists).not.toHaveBeenCalledWith(oldKey);
      expect(google.textToSpeech).toHaveBeenCalledTimes(1);
    });

    it('a removed Standard / WaveNet id is not a ready-made voice any more -> 403 unless the caller owns a profile', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(null);
      const err = await service
        .previewVoice('u1', { voiceId: 'tr-TR-Wavenet-B', provider: 'GOOGLE' })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: 'PREVIEW_NOT_ALLOWED' });
      expect(google.textToSpeech).not.toHaveBeenCalled();
    });

    it("someone else's (or unknown) Cartesia voice -> 403 PREVIEW_NOT_ALLOWED", async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(null);
      const err = await service
        .previewVoice('u1', { voiceId: 'other-users-clone', provider: 'CARTESIA' })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: 'PREVIEW_NOT_ALLOWED' });
      expect(prisma.voiceProfile.findFirst.mock.calls[0][0].where).toEqual({
        userId: 'u1',
        voiceId: 'other-users-clone',
        provider: 'CARTESIA',
        status: 'READY',
      });
      expect(cartesia.textToSpeech).not.toHaveBeenCalled();
    });

    it('own READY clone: preview stored under the profile folder (deleted with it)', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(
        createMockVoiceProfile({ id: 'vp-1', userId: 'u1', provider: 'CARTESIA', kind: 'CLONE', voiceId: 'c-1', language: 'tr-TR' }),
      );
      await service.previewVoice('u1', { voiceId: 'c-1', provider: 'CARTESIA', text: 'Merhaba canım.' });

      expect(cartesia.textToSpeech).toHaveBeenCalledWith('Merhaba canım.', 'c-1', { language: 'tr-TR' });
      const key = storage.uploadFile.mock.calls[0][1];
      expect(key).toMatch(/^voice-samples\/u1\/vp-1\/previews\/[0-9a-f]{16}\.mp3$/);
    });
  });
});
