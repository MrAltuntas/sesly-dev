import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { VoiceProfilesController } from './voice-profiles.controller';
import { CLONE_UPLOAD_MAX_BYTES } from './clone-config.constants';

function audioFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'referenceAudio',
    originalname: 'clip.wav',
    mimetype: 'audio/wav',
    size: 1024,
    buffer: Buffer.alloc(1024, 1),
    ...overrides,
  } as Express.Multer.File;
}

describe('VoiceProfilesController', () => {
  let service: Record<string, jest.Mock>;
  let controller: VoiceProfilesController;

  beforeEach(() => {
    service = {
      getCloneConfig: jest.fn().mockReturnValue({ enabled: true }),
      getVoiceSlotInfo: jest.fn().mockResolvedValue({}),
      getAvailableVoices: jest.fn().mockResolvedValue([]),
      previewVoice: jest.fn().mockResolvedValue({}),
      getVoiceProfiles: jest.fn().mockResolvedValue([]),
      createVoiceProfileV2: jest.fn().mockResolvedValue({}),
      createVoiceProfile: jest.fn().mockResolvedValue({}),
      uploadVoiceSamples: jest.fn().mockResolvedValue({ status: 'PROCESSING' }),
      getVoiceProfileStatus: jest.fn().mockResolvedValue({}),
      getVoiceProfileSample: jest.fn().mockResolvedValue({}),
      deleteVoiceProfile: jest.fn().mockResolvedValue({}),
    };
    controller = new VoiceProfilesController(service as any);
  });

  it('read / create / delete routes are scoped to the authenticated user', async () => {
    controller.getCloneConfig();
    controller.getCloneConfig('en');
    await controller.getVoiceProfiles('user-1', 'tr,en');
    await controller.getVoiceSlotInfo('user-1');
    await controller.getAvailableVoices('google');
    await controller.previewVoice('user-1', { voiceId: 'v' } as any);
    await controller.getVoiceProfiles('user-1');
    await controller.createVoiceProfileV2('user-1', { name: 'Anne' } as any);
    await controller.createVoiceProfile('user-1', { name: 'Anne' } as any);
    await controller.getStatus('user-1', 'vp-1');
    await controller.getSample('user-1', 'vp-1');
    await controller.deleteProfile('user-1', 'vp-1');

    // No language parameter is passed on as absent (old builds: Turkish).
    expect(service.getCloneConfig).toHaveBeenNthCalledWith(1, undefined);
    expect(service.getCloneConfig).toHaveBeenNthCalledWith(2, 'en');
    expect(service.getVoiceProfiles).toHaveBeenNthCalledWith(1, 'user-1', 'tr,en');
    expect(service.getVoiceSlotInfo).toHaveBeenCalledWith('user-1');
    expect(service.getAvailableVoices).toHaveBeenCalledWith('google', undefined);
    expect(service.previewVoice).toHaveBeenCalledWith('user-1', { voiceId: 'v' });
    expect(service.getVoiceProfiles).toHaveBeenNthCalledWith(2, 'user-1', undefined);
    expect(service.createVoiceProfileV2).toHaveBeenCalledWith('user-1', { name: 'Anne' });
    expect(service.createVoiceProfile).toHaveBeenCalledWith('user-1', { name: 'Anne' });
    expect(service.getVoiceProfileStatus).toHaveBeenCalledWith('user-1', 'vp-1');
    expect(service.getVoiceProfileSample).toHaveBeenCalledWith('user-1', 'vp-1');
    expect(service.deleteVoiceProfile).toHaveBeenCalledWith('user-1', 'vp-1');
  });

  describe('POST /voice-profiles/:id/upload-samples', () => {
    it('forwards the files, consent version and parsed speech start to the service', async () => {
      const reference = audioFile();
      const consent = audioFile({ fieldname: 'consentAudio', mimetype: 'audio/x-m4a' });

      await controller.uploadVoiceSamples(
        'user-1',
        'vp-1',
        { referenceAudio: [reference], consentAudio: [consent] },
        { consentVersion: '2026-09-v1', speechStartMs: '350' } as any,
      );

      expect(service.uploadVoiceSamples).toHaveBeenCalledWith('user-1', 'vp-1', {
        referenceAudio: reference,
        consentAudio: consent,
        consentVersion: '2026-09-v1',
        speechStartMs: 350,
      });
    });

    it('missing reference audio -> 400 AUDIO_REQUIRED before the service is called', async () => {
      const err = await controller
        .uploadVoiceSamples('user-1', 'vp-1', undefined, {} as any)
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ code: 'AUDIO_REQUIRED' });
      expect(service.uploadVoiceSamples).not.toHaveBeenCalled();
    });

    it('unsupported type -> 400 INVALID_AUDIO_TYPE; oversize -> 413 AUDIO_TOO_LARGE', async () => {
      const bad = await controller
        .uploadVoiceSamples('user-1', 'vp-1', { referenceAudio: [audioFile({ mimetype: 'video/mp4' })] }, {} as any)
        .catch((e) => e);
      expect(bad.getResponse()).toMatchObject({ code: 'INVALID_AUDIO_TYPE' });

      const big = await controller
        .uploadVoiceSamples(
          'user-1',
          'vp-1',
          { referenceAudio: [audioFile({ size: CLONE_UPLOAD_MAX_BYTES + 1 })] },
          {} as any,
        )
        .catch((e) => e);
      expect(big).toBeInstanceOf(PayloadTooLargeException);
      expect(big.getResponse()).toMatchObject({ code: 'AUDIO_TOO_LARGE' });
      expect(service.uploadVoiceSamples).not.toHaveBeenCalled();
    });

    it('an invalid optional consent clip is rejected too', async () => {
      const err = await controller
        .uploadVoiceSamples(
          'user-1',
          'vp-1',
          { referenceAudio: [audioFile()], consentAudio: [audioFile({ mimetype: 'text/plain' })] },
          {} as any,
        )
        .catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: 'INVALID_AUDIO_TYPE' });
      expect(service.uploadVoiceSamples).not.toHaveBeenCalled();
    });

    it('no consent clip / no body fields -> consentAudio undefined, nulls', async () => {
      const reference = audioFile();
      await controller.uploadVoiceSamples('user-1', 'vp-1', { referenceAudio: [reference] }, undefined as any);
      expect(service.uploadVoiceSamples).toHaveBeenCalledWith('user-1', 'vp-1', {
        referenceAudio: reference,
        consentAudio: undefined,
        consentVersion: null,
        speechStartMs: null,
      });
    });
  });
});
