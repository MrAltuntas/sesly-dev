import { HttpException, HttpStatus } from '@nestjs/common';
import {
  AudioTooShortError,
  transcodeToWav,
} from '../utils/audio-preprocessor';
import {
  VoiceTrainingProcessor,
  VOICE_FAILURE_REASONS,
  isFinalAttempt,
  voiceFailureReason,
  AudioPreprocessingError,
} from './voice-training.processor';
import { PermanentVoiceCloningError } from '../../tts-providers/voice-cloning-errors';
import { serverText } from '../../../common/i18n/server-text';
import { createMockPrismaService, MockPrismaService } from '../../../test-utils/prisma-mock';
import { createMockVoiceProfile } from '../../../test-utils/mock-factories';
import { CLONE_TEST_SAMPLE_TEXT, CLONE_TEST_SAMPLE_TEXT_EN } from '../clone-config.constants';

jest.mock('../utils/audio-preprocessor', () => {
  const actual = jest.requireActual('../utils/audio-preprocessor');
  return {
    ...actual,
    transcodeToWav: jest.fn(),
    cleanupTempDir: jest.fn().mockResolvedValue(undefined),
  };
});

const transcodeMock = transcodeToWav as jest.MockedFunction<typeof transcodeToWav>;

/** The reasons as stored for an owner without a stored UI language (Turkish) and for English. */
const reasonsIn = (language: 'tr' | 'en') =>
  Object.fromEntries(
    Object.entries(VOICE_FAILURE_REASONS).map(([name, key]) => [name, serverText(key, language)]),
  ) as Record<keyof typeof VOICE_FAILURE_REASONS, string>;
const TR_REASONS = reasonsIn('tr');
const EN_REASONS = reasonsIn('en');

describe('VoiceTrainingProcessor', () => {
  let prisma: MockPrismaService;
  let storage: any;
  let cartesia: any;
  let notifications: any;
  let processor: VoiceTrainingProcessor;

  const profile = () =>
    createMockVoiceProfile({
      id: 'vp-1',
      userId: 'u1',
      name: 'Annem',
      provider: 'CARTESIA',
      kind: 'CLONE',
      status: 'PROCESSING',
      voiceId: 'pending-x',
      voiceCloningKey: null,
      language: 'tr-TR',
      sampleAudioUrl: 'voice-samples/u1/vp-1/reference/r.m4a',
      consentAudioUrl: null,
      creationChargedAt: new Date(2026, 9, 10, 12, 0, 0),
    } as any);

  const job = (attemptsMade = 0, attempts = 3) =>
    ({
      data: {
        profileId: 'vp-1',
        referenceS3Key: 'voice-samples/u1/vp-1/reference/r.m4a',
        speechStartMs: 900,
      },
      attemptsMade,
      opts: { attempts },
    }) as any;

  beforeEach(() => {
    prisma = createMockPrismaService();
    storage = {
      downloadFile: jest.fn().mockResolvedValue(Buffer.from('m4a')),
      uploadFile: jest.fn().mockResolvedValue('url'),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      deleteFolder: jest.fn().mockResolvedValue(undefined),
    };
    cartesia = {
      createVoiceClone: jest.fn().mockResolvedValue('cartesia-new'),
      textToSpeech: jest.fn().mockResolvedValue(Buffer.from('mp3')),
      deleteVoiceClone: jest.fn().mockResolvedValue(undefined),
    };
    notifications = {
      notifyVoiceReady: jest.fn().mockResolvedValue(undefined),
      notifyVoiceFailed: jest.fn().mockResolvedValue(undefined),
    };
    processor = new VoiceTrainingProcessor(prisma as any, storage, cartesia, notifications);

    prisma.voiceProfile.findUnique.mockResolvedValue(profile());
    prisma.voiceProfile.updateMany.mockResolvedValue({ count: 1 });
    prisma.voiceDeletionRequest.create.mockResolvedValue({ id: 'req' });
    prisma.voiceDeletionRequest.update.mockResolvedValue({});
    prisma.usageLimit.updateMany.mockResolvedValue({ count: 1 });
    prisma.usageLifetime.updateMany.mockResolvedValue({ count: 1 });
    transcodeMock.mockReset();
    transcodeMock.mockResolvedValue({
      buffer: Buffer.from('RIFFwav'),
      tempDir: '/tmp/x',
      outputPath: '/tmp/x/output.wav',
      durationMs: 5,
      audioSeconds: 32,
      trimStartMs: 650,
    });
  });

  it('happy path: trims with speechStartMs, clones the WAV with the profile language, READY + notify', async () => {
    await processor.handleVoiceTraining(job());

    expect(transcodeMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.anything(),
      'vp-1',
      { speechStartMs: 900, maxDurationSec: 60, minDurationSec: 10 },
    );
    expect(cartesia.createVoiceClone).toHaveBeenCalledWith(
      { buffer: Buffer.from('RIFFwav'), mimeType: 'audio/wav', filename: 'reference.wav' },
      'Annem',
      // The language the user chose, and the accent label Cartesia files it under.
      { language: 'tr-TR', accent: 'istanbul' },
    );
    expect(storage.uploadFile).toHaveBeenCalledWith(
      Buffer.from('RIFFwav'),
      'voice-samples/u1/vp-1/reference/r.m4a.normalized.wav',
      'audio/wav',
    );
    expect(cartesia.textToSpeech).toHaveBeenCalledWith(CLONE_TEST_SAMPLE_TEXT, 'cartesia-new', { language: 'tr-TR' });

    const [persist, finish] = prisma.voiceProfile.updateMany.mock.calls.map((c: any[]) => c[0]);
    expect(persist).toEqual({
      where: { id: 'vp-1', status: 'PROCESSING' },
      data: { voiceCloningKey: 'cartesia-new', voiceId: 'cartesia-new' },
    });
    expect(finish.data).toMatchObject({
      status: 'READY',
      sampleAudioUrl: 'voice-samples/u1/vp-1/test-sample.mp3',
    });
    expect(notifications.notifyVoiceReady).toHaveBeenCalledWith('u1', 'Annem', 'vp-1');
  });

  it('an English clone is sent to Cartesia as English with its accent and tested with an English sentence', async () => {
    prisma.voiceProfile.findUnique.mockResolvedValue({ ...profile(), language: 'en-US' });

    await processor.handleVoiceTraining(job());

    expect(cartesia.createVoiceClone).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'audio/wav' }),
      'Annem',
      { language: 'en-US', accent: 'general-american' },
    );
    expect(cartesia.textToSpeech).toHaveBeenCalledWith(CLONE_TEST_SAMPLE_TEXT_EN, 'cartesia-new', {
      language: 'en-US',
    });
  });

  it('a row written by an app build that sent the bare code "tr" is cloned as Turkish', async () => {
    prisma.voiceProfile.findUnique.mockResolvedValue({ ...profile(), language: 'tr' });

    await processor.handleVoiceTraining(job());

    expect(cartesia.createVoiceClone).toHaveBeenCalledWith(expect.anything(), 'Annem', {
      language: 'tr',
      accent: 'istanbul',
    });
    expect(cartesia.textToSpeech).toHaveBeenCalledWith(CLONE_TEST_SAMPLE_TEXT, 'cartesia-new', { language: 'tr' });
  });

  it('a legacy row in a language that is not a voice language sends no accent and keeps the Turkish sample', async () => {
    prisma.voiceProfile.findUnique.mockResolvedValue({ ...profile(), language: 'de-DE' });

    await processor.handleVoiceTraining(job());

    expect(cartesia.createVoiceClone).toHaveBeenCalledWith(expect.anything(), 'Annem', {
      language: 'de-DE',
      accent: undefined,
    });
    expect(cartesia.textToSpeech).toHaveBeenCalledWith(CLONE_TEST_SAMPLE_TEXT, 'cartesia-new', {
      language: 'de-DE',
    });
  });

  it('never logs presigned URLs (no presign call at all)', async () => {
    storage.generatePresignedUrl = jest.fn();
    await processor.handleVoiceTraining(job());
    expect(storage.generatePresignedUrl).not.toHaveBeenCalled();
  });

  it('retry reuses an upstream id persisted by an earlier attempt (no second clone)', async () => {
    prisma.voiceProfile.findUnique.mockResolvedValue({ ...profile(), voiceCloningKey: 'cartesia-old', voiceId: 'cartesia-old' });
    await processor.handleVoiceTraining(job(1));
    expect(cartesia.createVoiceClone).not.toHaveBeenCalled();
    expect(transcodeMock).not.toHaveBeenCalled();
    expect(notifications.notifyVoiceReady).toHaveBeenCalled();
  });

  it('profile deleted while cloning -> the new upstream clone is deleted immediately', async () => {
    prisma.voiceProfile.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.voiceProfile.findUnique.mockResolvedValueOnce(profile()).mockResolvedValueOnce(null);

    await processor.handleVoiceTraining(job());

    expect(cartesia.deleteVoiceClone).toHaveBeenCalledWith('cartesia-new');
    expect(prisma.voiceDeletionRequest.create.mock.calls[0][0].data).toMatchObject({
      providerVoiceId: 'cartesia-new',
      status: 'IN_PROGRESS',
    });
    expect(storage.deleteFolder).toHaveBeenCalledWith('voice-samples/u1/vp-1/');
    expect(notifications.notifyVoiceReady).not.toHaveBeenCalled();
  });

  it('skips profiles that are gone or no longer PROCESSING', async () => {
    prisma.voiceProfile.findUnique.mockResolvedValueOnce(null);
    await processor.handleVoiceTraining(job());
    prisma.voiceProfile.findUnique.mockResolvedValueOnce({ ...profile(), status: 'FAILED' });
    await processor.handleVoiceTraining(job());
    expect(cartesia.createVoiceClone).not.toHaveBeenCalled();
  });

  it('too short after trimming: permanent -> FAILED (Turkish), refund, no throw', async () => {
    transcodeMock.mockRejectedValue(new AudioTooShortError(6.2, 10));

    await expect(processor.handleVoiceTraining(job())).resolves.toBeUndefined();

    expect(prisma.voiceProfile.updateMany).toHaveBeenCalledWith({
      where: { id: 'vp-1', status: 'PROCESSING' },
      data: { status: 'FAILED', errorReason: TR_REASONS.tooShort },
    });
    // The creation goes back to the month it was taken in (October 2026)
    // and on the lifetime counter, once (the profile marker is cleared first).
    expect(prisma.voiceProfile.updateMany).toHaveBeenCalledWith({
      where: { id: 'vp-1', creationChargedAt: new Date(2026, 9, 10, 12, 0, 0) },
      data: { creationChargedAt: null },
    });
    expect(prisma.usageLimit.updateMany.mock.calls[0][0]).toEqual({
      where: { userId: 'u1', month: 10, year: 2026, clonesCreated: { gt: 0 } },
      data: { clonesCreated: { decrement: 1 } },
    });
    expect(prisma.usageLifetime.updateMany.mock.calls[0][0].data).toEqual({ clonesCreated: { decrement: 1 } });
    expect(notifications.notifyVoiceFailed).toHaveBeenCalledWith('u1', 'Annem', 'vp-1', TR_REASONS.tooShort);
    expect(cartesia.createVoiceClone).not.toHaveBeenCalled();
  });

  it('Cartesia input rejection: permanent -> FAILED and the creation is given back (no voice was made)', async () => {
    cartesia.createVoiceClone.mockRejectedValue(new PermanentVoiceCloningError('No speech detected in clip'));

    await expect(processor.handleVoiceTraining(job())).resolves.toBeUndefined();
    expect(prisma.voiceProfile.updateMany.mock.calls[0][0].data).toEqual({
      status: 'FAILED',
      errorReason: TR_REASONS.noSpeech,
    });
    expect(prisma.usageLimit.updateMany.mock.calls[0][0].data).toEqual({ clonesCreated: { decrement: 1 } });
  });

  it('no refund twice: a profile whose marker is already cleared gives nothing back', async () => {
    cartesia.createVoiceClone.mockRejectedValue(new PermanentVoiceCloningError('No speech detected in clip'));
    prisma.voiceProfile.findUnique
      .mockResolvedValueOnce(profile())
      .mockResolvedValueOnce({ userId: 'u1', creationChargedAt: null });

    await expect(processor.handleVoiceTraining(job())).resolves.toBeUndefined();
    expect(prisma.usageLimit.updateMany).not.toHaveBeenCalled();
    expect(prisma.usageLifetime.updateMany).not.toHaveBeenCalled();
  });

  it('transient error before the last attempt: rethrow for Bull, profile stays PROCESSING', async () => {
    cartesia.createVoiceClone.mockRejectedValue(new HttpException('Cartesia 502', HttpStatus.BAD_GATEWAY));

    await expect(processor.handleVoiceTraining(job(0, 3))).rejects.toThrow('Cartesia 502');
    expect(prisma.voiceProfile.updateMany).not.toHaveBeenCalled();
    expect(notifications.notifyVoiceFailed).not.toHaveBeenCalled();
  });

  it('transient error on the final attempt: FAILED + notify, then rethrow', async () => {
    cartesia.createVoiceClone.mockRejectedValue(new HttpException('Cartesia 502', HttpStatus.BAD_GATEWAY));

    await expect(processor.handleVoiceTraining(job(2, 3))).rejects.toThrow('Cartesia 502');
    expect(prisma.voiceProfile.updateMany.mock.calls[0][0].data).toEqual({
      status: 'FAILED',
      errorReason: TR_REASONS.generic,
    });
    expect(notifications.notifyVoiceFailed).toHaveBeenCalledTimes(1);
    // Retries used up on our side: the creation is refunded.
    expect(prisma.usageLifetime.updateMany).toHaveBeenCalledTimes(1);
  });

  it('stores and sends the failure reason in the stored UI language of the owner', async () => {
    transcodeMock.mockRejectedValue(new AudioTooShortError(6.2, 10));
    (prisma as any).userPreferences.findUnique.mockResolvedValue({ uiLanguage: 'en' });

    await expect(processor.handleVoiceTraining(job())).resolves.toBeUndefined();

    expect(prisma.voiceProfile.updateMany).toHaveBeenCalledWith({
      where: { id: 'vp-1', status: 'PROCESSING' },
      data: { status: 'FAILED', errorReason: EN_REASONS.tooShort },
    });
    expect(notifications.notifyVoiceFailed).toHaveBeenCalledWith('u1', 'Annem', 'vp-1', EN_REASONS.tooShort);
    expect(EN_REASONS.tooShort).toContain('at least 15 seconds');
  });

  it('helpers: final attempt + Turkish reasons', () => {
    expect(isFinalAttempt({ attemptsMade: 0, opts: { attempts: 3 } } as any)).toBe(false);
    expect(isFinalAttempt({ attemptsMade: 2, opts: { attempts: 3 } } as any)).toBe(true);
    expect(isFinalAttempt({ attemptsMade: 0, opts: {} } as any)).toBe(true);
    expect(voiceFailureReason(new AudioPreprocessingError('x'))).toBe(TR_REASONS.unreadable);
    expect(voiceFailureReason(new Error('Clip too short'))).toBe(TR_REASONS.tooShort);
    expect(voiceFailureReason(new Error('boom'))).toBe(TR_REASONS.generic);
    for (const reason of [...Object.values(TR_REASONS), ...Object.values(EN_REASONS)]) {
      expect(reason).not.toMatch(/[—…→]/);
    }
  });
});
