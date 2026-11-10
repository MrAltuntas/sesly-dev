import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VoiceCloneTesterService } from './voice-clone-tester.service';
import { transcodeToWav, cleanupTempDir } from '../../voice-profiles/utils/audio-preprocessor';
import { createMockPrismaService, MockPrismaService } from '../../../test-utils/prisma-mock';

// No ffmpeg in unit tests.
jest.mock('../../voice-profiles/utils/audio-preprocessor', () => ({
  transcodeToWav: jest.fn(),
  cleanupTempDir: jest.fn(),
}));

const mockedTranscode = transcodeToWav as jest.Mock;
const mockedCleanup = cleanupTempDir as jest.Mock;

const SEVEN_DAYS = 7 * 24 * 60 * 60;

describe('VoiceCloneTesterService', () => {
  let prisma: MockPrismaService;
  let storage: { uploadFile: jest.Mock; generatePresignedUrl: jest.Mock };
  let cartesia: { createVoiceClone: jest.Mock; deleteVoiceClone: jest.Mock };
  let audioService: { generateAudio: jest.Mock };
  let service: VoiceCloneTesterService;

  const upload = (over: Partial<Express.Multer.File> = {}) =>
    ({
      originalname: 'Kayit.M4A',
      buffer: Buffer.from('raw-bytes'),
      mimetype: 'audio/mp4',
      ...over,
    }) as Express.Multer.File;

  const story = { id: 'story-1', title: 'Keloglan', content: 'Bir varmis. Bir yokmus.' };

  beforeEach(() => {
    prisma = createMockPrismaService();
    storage = {
      uploadFile: jest.fn(async (_b: Buffer, key: string) => `https://storage.googleapis.com/b/${key}`),
      generatePresignedUrl: jest.fn(async (key: string) => `signed:${key}`),
    };
    cartesia = {
      createVoiceClone: jest.fn().mockResolvedValue('cartesia-voice-1'),
      deleteVoiceClone: jest.fn().mockResolvedValue(undefined),
    };
    audioService = { generateAudio: jest.fn().mockResolvedValue({ audioId: 'audio-1' }) };
    service = new VoiceCloneTesterService(prisma as any, storage as any, cartesia as any, audioService as any);

    mockedTranscode.mockResolvedValue({ buffer: Buffer.from('wav-bytes'), tempDir: '/tmp/vct' });
    mockedCleanup.mockResolvedValue(undefined);

    prisma.story.findUnique.mockResolvedValue(story);
    prisma.user.findUnique.mockResolvedValue({ id: 'test-user' });
    prisma.voiceProfile.create.mockResolvedValue({ id: 'tmp-vp' });
    prisma.voiceProfile.delete.mockResolvedValue({});
    prisma.audio.findUnique.mockResolvedValue({
      status: 'READY',
      audioUrl: 'https://storage.googleapis.com/b/audio/audio-1/full.mp3',
    });
    prisma.audioSegment.findMany.mockResolvedValue([
      { index: 0, content: 'Bir varmis.', emotion: 'calm', speed: 0.9, volume: 1, status: 'READY', extra: 'x' },
      { index: 1, content: 'Bir yokmus.', emotion: null, speed: null, volume: null, status: 'READY' },
    ]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('input validation', () => {
    it.each([
      ['no file', undefined],
      ['no buffer', { originalname: 'a.wav' }],
      ['empty buffer', { originalname: 'a.wav', buffer: Buffer.alloc(0) }],
    ])('%s -> 400 before touching storage or Cartesia', async (_l, file) => {
      await expect(service.runStoryTest(file as any, 'story-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.uploadFile).not.toHaveBeenCalled();
      expect(cartesia.createVoiceClone).not.toHaveBeenCalled();
    });

    it('missing story id -> 400', async () => {
      await expect(service.runStoryTest(upload(), '')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('unknown story -> 404, nothing uploaded, no clone created', async () => {
      prisma.story.findUnique.mockResolvedValue(null);

      await expect(service.runStoryTest(upload(), 'nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.uploadFile).not.toHaveBeenCalled();
      expect(cartesia.createVoiceClone).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('raw + processed are parked under voice-clone-tests/<jobId>/, clone gets the WAV bytes', async () => {
      const res = await service.runStoryTest(upload(), 'story-1');

      const [rawCall, processedCall] = storage.uploadFile.mock.calls;
      expect(rawCall[1]).toBe(`voice-clone-tests/${res.jobId}/raw.m4a`);
      expect(rawCall[0]).toEqual(Buffer.from('raw-bytes'));
      expect(rawCall[2]).toBe('audio/mp4');
      expect(processedCall).toEqual([Buffer.from('wav-bytes'), `voice-clone-tests/${res.jobId}/processed.wav`, 'audio/wav']);

      expect(mockedTranscode).toHaveBeenCalledWith(Buffer.from('raw-bytes'), expect.anything(), res.jobId, {});
      expect(mockedCleanup).toHaveBeenCalledWith('/tmp/vct', expect.anything());
      expect(cartesia.createVoiceClone).toHaveBeenCalledWith(
        { buffer: Buffer.from('wav-bytes'), mimeType: 'audio/wav', filename: 'reference.wav' },
        `admin-test-${res.jobId.slice(0, 8)}`,
      );
    });

    it('runs the real narration pipeline with a temporary READY CARTESIA clone profile on the system test user', async () => {
      await service.runStoryTest(upload(), 'story-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'voice-test@sesly.local' },
        select: { id: true },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.voiceProfile.create.mock.calls[0][0].data).toMatchObject({
        userId: 'test-user',
        provider: 'CARTESIA',
        kind: 'CLONE',
        voiceId: 'cartesia-voice-1',
        voiceCloningKey: 'cartesia-voice-1',
        status: 'READY',
      });
      expect(audioService.generateAudio).toHaveBeenCalledWith({
        text: story.content,
        voiceProfileId: 'tmp-vp',
        userId: 'test-user',
        title: 'voice-test Keloglan',
        storyId: 'story-1',
      });
    });

    it('returns presigned (7 day) artifacts, segment breakdown and timings; response keys locked', async () => {
      const res = await service.runStoryTest(upload(), 'story-1');

      expect(Object.keys(res).sort()).toEqual(
        [
          'audioId',
          'audioStatus',
          'durationMs',
          'finalAudioUrl',
          'jobId',
          'processedUrl',
          'rawUrl',
          'segmentCount',
          'segments',
          'storyId',
          'storyTitle',
        ].sort(),
      );
      expect(res).toMatchObject({
        storyId: 'story-1',
        storyTitle: 'Keloglan',
        audioId: 'audio-1',
        audioStatus: 'READY',
        finalAudioUrl: 'signed:audio/audio-1/full.mp3',
        rawUrl: `signed:voice-clone-tests/${res.jobId}/raw.m4a`,
        processedUrl: `signed:voice-clone-tests/${res.jobId}/processed.wav`,
        segmentCount: 2,
      });
      expect(res.segments).toEqual([
        { index: 0, content: 'Bir varmis.', emotion: 'calm', speed: 0.9, volume: 1, status: 'READY' },
        { index: 1, content: 'Bir yokmus.', emotion: null, speed: null, volume: null, status: 'READY' },
      ]);
      expect(Object.keys(res.durationMs).sort()).toEqual(['cloneCreate', 'narration', 'preprocess', 'total']);
      for (const call of storage.generatePresignedUrl.mock.calls) expect(call[1]).toBe(SEVEN_DAYS);
      expect(prisma.audioSegment.findMany).toHaveBeenCalledWith({
        where: { audioId: 'audio-1' },
        orderBy: { index: 'asc' },
      });
    });

    it('always deletes the temporary profile and the upstream clone afterwards', async () => {
      await service.runStoryTest(upload(), 'story-1');

      expect(prisma.voiceProfile.delete).toHaveBeenCalledWith({ where: { id: 'tmp-vp' } });
      expect(cartesia.deleteVoiceClone).toHaveBeenCalledWith('cartesia-voice-1');
    });

    it('a bare audio key is presigned as-is', async () => {
      prisma.audio.findUnique.mockResolvedValue({ status: 'READY', audioUrl: 'audio/audio-1/full.mp3' });

      const res = await service.runStoryTest(upload(), 'story-1');

      expect(res.finalAudioUrl).toBe('signed:audio/audio-1/full.mp3');
    });
  });

  describe('options and edge cases', () => {
    it('skipPreprocessing only lifts the duration cap (still transcodes to WAV)', async () => {
      await service.runStoryTest(upload(), 'story-1', { skipPreprocessing: true });

      expect(mockedTranscode.mock.calls[0][3]).toEqual({ maxDurationSec: null });
    });

    it('creates the system test user on first run', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'new-test-user' });

      await service.runStoryTest(upload(), 'story-1');

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: 'voice-test@sesly.local', firstName: 'Voice', lastName: 'Test', emailVerified: true },
        select: { id: true },
      });
      expect(prisma.voiceProfile.create.mock.calls[0][0].data.userId).toBe('new-test-user');
    });

    it('unknown mimetype falls back to octet-stream; extension is lower-cased', async () => {
      await service.runStoryTest(upload({ originalname: 'clip.WAV', mimetype: '' }), 'story-1');

      expect(storage.uploadFile.mock.calls[0][1]).toMatch(/\/raw\.wav$/);
      expect(storage.uploadFile.mock.calls[0][2]).toBe('application/octet-stream');
    });

    it('FAILED narration: no final URL, status surfaced, cleanup still runs', async () => {
      prisma.audio.findUnique.mockResolvedValue({ status: 'FAILED', audioUrl: null });

      const res = await service.runStoryTest(upload(), 'story-1');

      expect(res).toMatchObject({ audioStatus: 'FAILED', finalAudioUrl: null });
      expect(prisma.voiceProfile.delete).toHaveBeenCalled();
      expect(cartesia.deleteVoiceClone).toHaveBeenCalled();
    });

    it('polls until READY (1.5 s interval)', async () => {
      jest.useFakeTimers();
      prisma.audio.findUnique
        .mockResolvedValueOnce({ status: 'GENERATING', audioUrl: null })
        .mockResolvedValueOnce({ status: 'GENERATING', audioUrl: null })
        .mockResolvedValue({ status: 'READY', audioUrl: 'audio/audio-1/full.mp3' });

      const promise = service.runStoryTest(upload(), 'story-1');
      await jest.advanceTimersByTimeAsync(3_000);
      const res = await promise;

      expect(prisma.audio.findUnique).toHaveBeenCalledTimes(3);
      expect(res.audioStatus).toBe('READY');
    });

    it('gives up after 5 minutes, returns the last known state and still cleans up', async () => {
      jest.useFakeTimers();
      prisma.audio.findUnique.mockResolvedValue({ status: 'GENERATING', audioUrl: null });

      const promise = service.runStoryTest(upload(), 'story-1');
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000 + 5_000);
      const res = await promise;

      expect(res).toMatchObject({ audioStatus: 'GENERATING', finalAudioUrl: null });
      expect(prisma.voiceProfile.delete).toHaveBeenCalledWith({ where: { id: 'tmp-vp' } });
      expect(cartesia.deleteVoiceClone).toHaveBeenCalledWith('cartesia-voice-1');
    });

    it('pipeline failure: error propagates, temp profile + upstream clone are still deleted', async () => {
      audioService.generateAudio.mockRejectedValue(new Error('quota'));

      await expect(service.runStoryTest(upload(), 'story-1')).rejects.toThrow('quota');
      expect(prisma.voiceProfile.delete).toHaveBeenCalledWith({ where: { id: 'tmp-vp' } });
      expect(cartesia.deleteVoiceClone).toHaveBeenCalledWith('cartesia-voice-1');
    });

    it('audio row vanishing mid-poll is an error (and still cleans up)', async () => {
      prisma.audio.findUnique.mockResolvedValue(null);

      await expect(service.runStoryTest(upload(), 'story-1')).rejects.toThrow(/vanished/);
      expect(cartesia.deleteVoiceClone).toHaveBeenCalled();
    });

    it('cleanup failures are best-effort and do not mask the result', async () => {
      prisma.voiceProfile.delete.mockRejectedValue(new Error('fk'));
      cartesia.deleteVoiceClone.mockRejectedValue(new Error('404 upstream'));

      await expect(service.runStoryTest(upload(), 'story-1')).resolves.toMatchObject({ audioStatus: 'READY' });
    });

    it('preprocessing failure: raw clip is already parked, no clone is created', async () => {
      mockedTranscode.mockRejectedValue(new Error('ffmpeg exploded'));

      await expect(service.runStoryTest(upload(), 'story-1')).rejects.toThrow('ffmpeg exploded');
      expect(storage.uploadFile).toHaveBeenCalledTimes(1);
      expect(cartesia.createVoiceClone).not.toHaveBeenCalled();
      expect(prisma.voiceProfile.create).not.toHaveBeenCalled();
    });

    it('processed upload failure still removes the temp dir', async () => {
      storage.uploadFile
        .mockResolvedValueOnce('raw-url')
        .mockRejectedValueOnce(new Error('gcs down'));

      await expect(service.runStoryTest(upload(), 'story-1')).rejects.toThrow('gcs down');
      expect(mockedCleanup).toHaveBeenCalledWith('/tmp/vct', expect.anything());
      expect(cartesia.createVoiceClone).not.toHaveBeenCalled();
    });
  });
});
