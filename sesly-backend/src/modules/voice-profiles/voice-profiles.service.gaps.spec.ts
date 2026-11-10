import { renderMessage } from '../../test-utils/i18n';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { VoiceProfilesService } from './voice-profiles.service';
import { listPresetVoices } from '../../common/constants/google-preset-voices';
import { createSettingsStub } from '../../test-utils/settings-stub';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createMockVoiceProfile } from '../../test-utils/mock-factories';
import { CLONE_CONSENT_VERSION } from './clone-config.constants';

/**
 * Failure / fallback paths of VoiceProfilesService that the main spec does
 * not reach: storage outages during upload, claim races on a deleted
 * profile, sample + preview fallbacks, status shape and the voice catalogue.
 */
// Short hash of the default Google prosody (0.92 / -2) in preset preview keys.
const DEFAULT_PROSODY = `p${createHash('sha256').update('0.92|-2').digest('hex').slice(0, 8)}`;

describe('VoiceProfilesService (failure and fallback paths)', () => {
  let prisma: MockPrismaService;
  let google: any;
  let cartesia: any;
  let factory: any;
  let storage: any;
  let queue: any;
  let service: VoiceProfilesService;

  const readyClone = (overrides: Partial<any> = {}) =>
    createMockVoiceProfile({
      id: 'vp-1',
      userId: 'u1',
      provider: 'CARTESIA',
      kind: 'CLONE',
      status: 'READY',
      voiceId: 'cartesia-voice-1',
      language: 'tr',
      sampleAudioUrl: 'voice-samples/u1/vp-1/test-sample.mp3',
      consentAudioUrl: 'voice-samples/u1/vp-1/consent/c.m4a',
      voiceCloningKey: 'cartesia-voice-1',
      ...overrides,
    });

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
    factory = {
      getAllProviders: () => [google, cartesia],
      getProvider: (p: string) => (String(p).toLowerCase() === 'cartesia' ? cartesia : google),
    };
    storage = {
      uploadFile: jest.fn(async (_b: Buffer, key: string) => key),
      deleteFolder: jest.fn().mockResolvedValue(undefined),
      fileExists: jest.fn().mockResolvedValue(false),
      generatePresignedUrl: jest.fn(async (key: string) => `signed:${key}`),
    };
    queue = { add: jest.fn().mockResolvedValue({}) };
    service = new VoiceProfilesService(prisma as any, storage, factory, queue, {} as any, createSettingsStub() as any);

    // Slots: FREE, nothing used.
    prisma.subscription.findUnique.mockResolvedValue(null);
    prisma.voiceProfile.count.mockResolvedValue(0);
    prisma.usageLimit.findUnique.mockResolvedValue(null);
    prisma.usageLifetime.findUnique.mockResolvedValue(null);
  });

  describe('create', () => {
    it('legacy POST /voice-profiles creates a PENDING clone placeholder', async () => {
      prisma.voiceProfile.create.mockImplementation(async ({ data }: any) =>
        createMockVoiceProfile({ id: 'vp-new', ...data }),
      );

      const result = await service.createVoiceProfile('u1', { name: 'Anne', profileIcon: 'heart' } as any);

      expect(prisma.voiceProfile.create.mock.calls[0][0].data).toMatchObject({
        userId: 'u1',
        name: 'Anne',
        profileIcon: 'heart',
        provider: 'CARTESIA',
        kind: 'CLONE',
        status: 'PENDING',
      });
      expect(result).toMatchObject({ trainingText: '', estimatedDuration: 0 });
      expect((result.profile as any).voiceCloningKey).toBeUndefined();
    });

    it('unsupported provider -> 400; Google without a ready-made voice id -> 400', async () => {
      await expect(
        service.createVoiceProfileV2('u1', { name: 'x', provider: 'MINIMAX', voiceId: 'v' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.createVoiceProfileV2('u1', { name: 'x', provider: 'GOOGLE' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.createVoiceProfileV2('u1', {
          name: 'x',
          provider: 'GOOGLE',
          voiceId: 'custom-cloning-pending',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.voiceProfile.create).not.toHaveBeenCalled();
    });
  });

  describe('upload-samples failure paths', () => {
    const reference = {
      originalname: 'ref.m4a',
      mimetype: 'audio/m4a',
      size: 10,
      buffer: Buffer.from('ref'),
    } as Express.Multer.File;
    const consent = { ...reference, originalname: 'consent.m4a' } as Express.Multer.File;
    const upload = () =>
      service.uploadVoiceSamples('u1', 'vp-1', {
        referenceAudio: reference,
        consentAudio: consent,
        consentVersion: CLONE_CONSENT_VERSION,
      });

    beforeEach(() => {
      prisma.voiceProfile.findFirst.mockResolvedValue(
        readyClone({ status: 'PENDING', voiceId: 'pending-x', sampleAudioUrl: null, consentAudioUrl: null }),
      );
    });

    it('unknown / foreign profile -> 404 before anything is stored', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(null);
      await expect(upload()).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.uploadFile).not.toHaveBeenCalled();
    });

    it('storage outage -> 503 VOICE_UPLOAD_FAILED, partial files removed, profile not claimed', async () => {
      storage.uploadFile.mockRejectedValueOnce(new Error('gcs 503'));
      storage.deleteFolder.mockRejectedValueOnce(new Error('also down')); // cleanup is best effort

      const err = await upload().catch((e) => e);

      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(err.getResponse()).toMatchObject({ code: 'VOICE_UPLOAD_FAILED' });
      expect(storage.deleteFolder).toHaveBeenCalledWith('voice-samples/u1/vp-1/');
      expect(prisma.voiceProfile.updateMany).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('consent clip is stored next to the reference', async () => {
      prisma.voiceProfile.updateMany.mockResolvedValue({ count: 1 });
      prisma.usageLimit.upsert.mockResolvedValue({});
      prisma.usageLimit.updateMany.mockResolvedValue({ count: 1 });
      prisma.usageLifetime.upsert.mockResolvedValue({});
      prisma.usageLifetime.updateMany.mockResolvedValue({ count: 1 });

      await upload();

      const keys = storage.uploadFile.mock.calls.map((c: any[]) => c[1]);
      expect(keys[0]).toMatch(/^voice-samples\/u1\/vp-1\/reference\//);
      expect(keys[1]).toMatch(/^voice-samples\/u1\/vp-1\/consent\//);
      expect(queue.add.mock.calls[0][1]).toMatchObject({ consentS3Key: keys[1], speechStartMs: null });
    });

    it('profile deleted between lookup and claim -> 404 and files discarded', async () => {
      prisma.voiceProfile.updateMany.mockResolvedValueOnce({ count: 0 });
      prisma.voiceProfile.findFirst
        .mockResolvedValueOnce(readyClone({ status: 'PENDING', voiceId: 'pending-x' }))
        .mockResolvedValueOnce(null);

      await expect(upload()).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.deleteFolder).toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('a failing claim release is logged, the 503 still reaches the client', async () => {
      prisma.voiceProfile.updateMany
        .mockResolvedValueOnce({ count: 1 }) // claim
        .mockResolvedValueOnce({ count: 1 }) // creation charge marker
        .mockRejectedValueOnce(new Error('db blip')); // release
      prisma.usageLimit.upsert.mockResolvedValue({});
      prisma.usageLimit.updateMany.mockResolvedValue({ count: 1 });
      prisma.usageLifetime.upsert.mockResolvedValue({});
      prisma.usageLifetime.updateMany.mockResolvedValue({ count: 1 });
      queue.add.mockRejectedValue(new Error('redis down'));

      const err = await upload().catch((e) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(err.getResponse()).toMatchObject({ code: 'VOICE_QUEUE_UNAVAILABLE' });
    });

    it('re-upload on a READY clone -> 409 (would orphan the upstream clone)', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(readyClone());
      await expect(upload()).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('GET /voice-profiles/:id/status', () => {
    it('full shape the mobile parser requires, no secrets', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(readyClone());
      const status: any = await service.getVoiceProfileStatus('u1', 'vp-1');

      expect(status).toMatchObject({
        id: 'vp-1',
        status: 'READY',
        progress: 100,
        provider: 'CARTESIA',
        kind: 'CLONE',
        voiceId: 'cartesia-voice-1',
      });
      expect(JSON.stringify(status)).not.toContain('consent/c.m4a');
      expect(status.voiceCloningKey).toBeUndefined();
    });

    it('404 for a profile the caller does not own', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(null);
      await expect(service.getVoiceProfileStatus('u1', 'vp-x')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.voiceProfile.findFirst).toHaveBeenCalledWith({ where: { id: 'vp-x', userId: 'u1' } });
    });
  });

  describe('GET /voice-profiles/:id/sample', () => {
    it('stored sample -> presigned, cached', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(readyClone());
      await expect(service.getVoiceProfileSample('u1', 'vp-1')).resolves.toEqual({
        audioUrl: 'signed:voice-samples/u1/vp-1/test-sample.mp3',
        cached: true,
      });
    });

    it('presign failure falls through to an on-demand clone preview under the profile folder', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(readyClone());
      storage.generatePresignedUrl
        .mockRejectedValueOnce(new Error('sign failed'))
        .mockImplementation(async (key: string) => `signed:${key}`);

      const result = await service.getVoiceProfileSample('u1', 'vp-1');

      expect(cartesia.textToSpeech).toHaveBeenCalled();
      expect(storage.uploadFile.mock.calls[0][1]).toBe('voice-samples/u1/vp-1/previews/default.mp3');
      expect(result).toEqual({ audioUrl: 'signed:voice-samples/u1/vp-1/previews/default.mp3', cached: false });
    });

    it('no sample and not READY -> audioUrl null (no synthesis for unfinished clones)', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(readyClone({ status: 'PROCESSING', sampleAudioUrl: null }));
      await expect(service.getVoiceProfileSample('u1', 'vp-1')).resolves.toEqual({
        audioUrl: null,
        message: 'Preview generation failed.',
      });
      expect(cartesia.textToSpeech).not.toHaveBeenCalled();
    });

    it('preset without a sample: cached Google preview is reused', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(
        readyClone({ provider: 'GOOGLE', kind: 'PRESET', voiceId: 'tr-TR-Chirp3-HD-Achernar', sampleAudioUrl: null }),
      );
      storage.fileExists.mockResolvedValue(true);

      const result = await service.getVoiceProfileSample('u1', 'vp-1');

      expect(result).toEqual({ audioUrl: `signed:voice-previews/GOOGLE/v2/tr-TR/tr-TR-Chirp3-HD-Achernar/${DEFAULT_PROSODY}.mp3`, cached: true });
      expect(google.textToSpeech).not.toHaveBeenCalled();
    });

    it('TTS failure -> audioUrl null, never a 500', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(readyClone({ sampleAudioUrl: null }));
      cartesia.textToSpeech.mockRejectedValue(new Error('cartesia 500'));

      await expect(service.getVoiceProfileSample('u1', 'vp-1')).resolves.toEqual({
        audioUrl: null,
        message: 'Preview generation failed.',
      });
    });
  });

  describe('POST /voice-profiles/preview', () => {
    it('TTS failure -> 400 with a localized message', async () => {
      google.textToSpeech.mockRejectedValue(new Error('quota'));
      const err = await service
        .previewVoice('u1', { provider: 'google', voiceId: 'tr-TR-Chirp3-HD-Achernar' } as any)
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('errors.voiceProfiles.previewFailed');
      expect(renderMessage(err)).toBe('Ses önizlemesi oluşturulamadı. Lütfen tekrar dene.');
    });

    it('custom text is cached under a hash of the text, not the raw text', async () => {
      await service.previewVoice('u1', { provider: 'GOOGLE', voiceId: 'tr-TR-Chirp3-HD-Achernar', text: 'Merhaba dunya' } as any);
      const key: string = storage.uploadFile.mock.calls[0][1];
      expect(key).toMatch(/^voice-previews\/GOOGLE\/v2\/tr-TR\/tr-TR-Chirp3-HD-Achernar\/p[0-9a-f]{8}-[0-9a-f]{16}\.mp3$/);
      expect(key).not.toContain('Merhaba');
    });
  });

  describe('GET /voice-profiles/available-voices', () => {
    it('single provider filter -> { provider, voices } with isPremium flags', async () => {
      const result: any = await service.getAvailableVoices('google');
      expect(result.provider).toBe('GOOGLE');
      expect(result.voices[0]).toMatchObject({ id: 'tr-TR-Chirp3-HD-Achernar', isPremium: false });
    });

    it('a failing provider yields an empty list instead of failing the whole catalogue', async () => {
      google.getAvailableVoices.mockRejectedValue(new Error('google down'));
      const result: any = await service.getAvailableVoices();
      expect(result).toEqual({ google: [], cartesia: [] });
    });
  });
});
