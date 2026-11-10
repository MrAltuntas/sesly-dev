import { AudioGenerationProcessor } from './audio-generation.processor';
import { AudioService } from '../audio.service';
import { createMockPrismaService, MockPrismaService } from '../../../test-utils/prisma-mock';
import { AudioSegmentJob } from '../interfaces/audio-generation-job.interface';

// The merge path must never spawn a real ffmpeg / download anything.
jest.mock('fluent-ffmpeg', () => {
  const factory: any = jest.fn();
  factory.setFfmpegPath = jest.fn();
  return { __esModule: true, default: factory };
});
jest.mock('ffmpeg-static', () => ({ __esModule: true, default: '/fake/bin/ffmpeg' }));
jest.mock('axios', () => ({ __esModule: true, default: jest.fn() }));

const BUCKET_URL = 'https://storage.googleapis.com/sesly-bucket';

function job(overrides: Partial<AudioSegmentJob> = {}): any {
  return {
    data: {
      audioId: 'audio-1',
      segmentId: 'seg-0',
      segmentIndex: 0,
      content: 'x'.repeat(300),
      voiceProfileId: 'voice-1',
      ...overrides,
    },
  };
}

describe('AudioGenerationProcessor', () => {
  let prisma: MockPrismaService;
  let storage: { uploadFile: jest.Mock; deleteFile: jest.Mock; getReadUrl: jest.Mock };
  let provider: { textToSpeech: jest.Mock };
  let factory: { getProvider: jest.Mock };
  let audioService: { onSegmentComplete: jest.Mock; onSegmentFailed: jest.Mock; prepareStoryAudio?: jest.Mock };
  let processor: AudioGenerationProcessor;

  beforeEach(() => {
    prisma = createMockPrismaService();
    storage = {
      uploadFile: jest.fn(async (_b: Buffer, key: string) => `${BUCKET_URL}/${key}`),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      getReadUrl: jest.fn(),
    };
    provider = { textToSpeech: jest.fn().mockResolvedValue(Buffer.from('mp3-bytes')) };
    factory = { getProvider: jest.fn().mockReturnValue(provider) };
    audioService = {
      onSegmentComplete: jest.fn().mockResolvedValue(undefined),
      onSegmentFailed: jest.fn().mockResolvedValue(undefined),
    };
    prisma.voiceProfile.findUnique.mockResolvedValue({
      id: 'voice-1',
      provider: 'CARTESIA',
      voiceId: 'cartesia-voice-9',
      language: 'tr',
    });
    processor = new AudioGenerationProcessor(
      prisma as any,
      storage as any,
      factory as any,
      audioService as any,
    );
  });

  it('happy path: GENERATING, provider from the voice profile, upload, completion callback', async () => {
    await processor.handleSegmentGeneration(
      job({ emotion: 'calm', speed: 0.9, volume: 1, pronunciationDictId: 'dict-1', language: 'tr' }),
    );

    expect(prisma.audioSegment.update).toHaveBeenCalledWith({
      where: { id: 'seg-0' },
      data: { status: 'GENERATING' },
    });
    expect(factory.getProvider).toHaveBeenCalledWith('cartesia');
    expect(provider.textToSpeech).toHaveBeenCalledWith('x'.repeat(300), 'cartesia-voice-9', {
      emotion: 'calm',
      speed: 0.9,
      volume: 1,
      pronunciationDictId: 'dict-1',
      language: 'tr',
    });
    expect(storage.uploadFile).toHaveBeenCalledWith(
      Buffer.from('mp3-bytes'),
      'audio/audio-1/segments/0.mp3',
      'audio/mpeg',
    );
    // 300 chars -> 150 words -> 60 s at 150 wpm.
    expect(audioService.onSegmentComplete).toHaveBeenCalledWith(
      'audio-1',
      0,
      `${BUCKET_URL}/audio/audio-1/segments/0.mp3`,
      60,
    );
    expect(audioService.onSegmentFailed).not.toHaveBeenCalled();
  });

  it('passes the parts of a grouped request to the provider', async () => {
    const parts = [{ text: 'Bir.', speed: 0.8 }, { text: 'Iki.', pauseAfterMs: 400 }];
    await processor.handleSegmentGeneration(job({ parts }));
    expect(provider.textToSpeech.mock.calls[0][2].parts).toEqual(parts);
  });

  it('prepare-audio jobs go to AudioService.prepareStoryAudio', async () => {
    audioService.prepareStoryAudio = jest.fn().mockResolvedValue(undefined);
    const data = { audioId: 'audio-1', storyId: 'story-1' } as any;
    await processor.handlePrepare({ data } as any);
    expect(audioService.prepareStoryAudio).toHaveBeenCalledWith(data);
  });

  it('falls back to the voice profile language when the job has none', async () => {
    prisma.voiceProfile.findUnique.mockResolvedValue({
      id: 'voice-1',
      provider: 'GOOGLE',
      voiceId: 'tr-TR-Wavenet-A',
      language: 'tr-TR',
    });

    await processor.handleSegmentGeneration(job());

    expect(factory.getProvider).toHaveBeenCalledWith('google');
    expect(provider.textToSpeech.mock.calls[0][2].language).toBe('tr-TR');
  });

  describe('ready-made voice reading a story of another language', () => {
    const turkishPreset = (overrides: Record<string, unknown> = {}) => ({
      id: 'voice-1',
      provider: 'GOOGLE',
      kind: 'PRESET',
      voiceId: 'tr-TR-Chirp3-HD-Achernar',
      language: 'tr-TR',
      ...overrides,
    });

    it('an English story is synthesised with the voice of the same name in en-US', async () => {
      prisma.voiceProfile.findUnique.mockResolvedValue(turkishPreset());

      await processor.handleSegmentGeneration(job({ language: 'en' }));

      expect(factory.getProvider).toHaveBeenCalledWith('google');
      expect(provider.textToSpeech).toHaveBeenCalledWith(
        'x'.repeat(300),
        'en-US-Chirp3-HD-Achernar',
        expect.objectContaining({ language: 'en' }),
      );
      // The profile itself is never rewritten.
      expect(prisma.voiceProfile.update).not.toHaveBeenCalled();
    });

    it('a story of its own language, or an audio without a story, uses the profile voice', async () => {
      prisma.voiceProfile.findUnique.mockResolvedValue(turkishPreset());

      await processor.handleSegmentGeneration(job({ language: 'tr' }));
      await processor.handleSegmentGeneration(job());

      expect(provider.textToSpeech.mock.calls.map((call) => call[1])).toEqual([
        'tr-TR-Chirp3-HD-Achernar',
        'tr-TR-Chirp3-HD-Achernar',
      ]);
    });

    it('a story language without ready-made voices (Russian) falls back to the profile voice', async () => {
      prisma.voiceProfile.findUnique.mockResolvedValue(turkishPreset());

      await processor.handleSegmentGeneration(job({ language: 'ru' }));

      expect(provider.textToSpeech).toHaveBeenCalledWith(
        'x'.repeat(300),
        'tr-TR-Chirp3-HD-Achernar',
        expect.objectContaining({ language: 'ru' }),
      );
    });

    it('a cloned voice keeps its own id and gets the story language as the request language', async () => {
      prisma.voiceProfile.findUnique.mockResolvedValue({
        id: 'voice-1',
        provider: 'CARTESIA',
        kind: 'CLONE',
        voiceId: 'cartesia-voice-9',
        language: 'tr-TR',
      });

      await processor.handleSegmentGeneration(job({ language: 'en' }));

      expect(provider.textToSpeech).toHaveBeenCalledWith(
        'x'.repeat(300),
        'cartesia-voice-9',
        expect.objectContaining({ language: 'en' }),
      );
    });
  });

  it('TTS failure: reports the segment as failed and rethrows (Bull marks the job failed)', async () => {
    provider.textToSpeech.mockRejectedValue(new Error('Cartesia 429'));

    await expect(processor.handleSegmentGeneration(job({ segmentIndex: 3 }))).rejects.toThrow(
      'Cartesia 429',
    );

    expect(audioService.onSegmentFailed).toHaveBeenCalledWith('audio-1', 3, 'Cartesia 429');
    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(audioService.onSegmentComplete).not.toHaveBeenCalled();
  });

  it('missing voice profile -> segment failed', async () => {
    prisma.voiceProfile.findUnique.mockResolvedValue(null);

    await expect(processor.handleSegmentGeneration(job())).rejects.toThrow('Voice profile not found');
    expect(audioService.onSegmentFailed).toHaveBeenCalledWith(
      'audio-1',
      0,
      'Voice profile not found',
    );
    expect(provider.textToSpeech).not.toHaveBeenCalled();
  });

  it('voice profile without a provider voice id -> segment failed', async () => {
    prisma.voiceProfile.findUnique.mockResolvedValue({ id: 'v', provider: 'CARTESIA', voiceId: '' });

    await expect(processor.handleSegmentGeneration(job())).rejects.toThrow('Voice ID not found');
    expect(audioService.onSegmentFailed).toHaveBeenCalled();
  });

  it('upload failure -> segment failed', async () => {
    storage.uploadFile.mockRejectedValue(new Error('gcs down'));

    await expect(processor.handleSegmentGeneration(job())).rejects.toThrow('gcs down');
    expect(audioService.onSegmentFailed).toHaveBeenCalledWith('audio-1', 0, 'gcs down');
  });
});

/**
 * Processor wired to the REAL AudioService (only Prisma / storage / TTS /
 * notifications mocked): the last segment of a narration must flip the
 * Audio and the StoryNarration to READY and notify the user once.
 */
describe('AudioGenerationProcessor + AudioService (merge trigger)', () => {
  let prisma: MockPrismaService;
  let notifications: { notifyNarrationReady: jest.Mock; notifyNarrationFailed: jest.Mock };
  let processor: AudioGenerationProcessor;
  let provider: { textToSpeech: jest.Mock };

  beforeEach(() => {
    prisma = createMockPrismaService();
    const storage = {
      uploadFile: jest.fn(async (_b: Buffer, key: string) => `${BUCKET_URL}/${key}`),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    notifications = {
      notifyNarrationReady: jest.fn().mockResolvedValue(undefined),
      notifyNarrationFailed: jest.fn().mockResolvedValue(undefined),
    };
    provider = { textToSpeech: jest.fn().mockResolvedValue(Buffer.from('mp3')) };
    const audioService = new AudioService(
      prisma as any,
      storage as any,
      notifications as any,
      {} as any,
      { add: jest.fn() } as any,
      {} as any,
      {} as any,
    );
    processor = new AudioGenerationProcessor(
      prisma as any,
      storage as any,
      { getProvider: () => provider } as any,
      audioService,
    );

    prisma.voiceProfile.findUnique.mockResolvedValue({
      id: 'voice-1',
      provider: 'GOOGLE',
      voiceId: 'tr-TR-Wavenet-A',
      language: 'tr-TR',
    });
    prisma.storyNarration.findMany.mockResolvedValue([
      { id: 'narr-1', userId: 'user-1', storyId: 'story-1', story: { title: 'Keloglan' } },
    ]);
    prisma.storyNarration.updateMany.mockResolvedValue({ count: 1 });
  });

  it('single-segment audio: completion finalizes, narration READY, one ready notification', async () => {
    prisma.audio.update.mockResolvedValue({ readySegments: 1, totalSegments: 1 });
    prisma.audio.findUnique.mockResolvedValue({
      id: 'audio-1',
      userId: 'user-1',
      title: 't',
      segments: [
        {
          index: 0,
          status: 'READY',
          audioUrl: `${BUCKET_URL}/audio/audio-1/segments/0.mp3`,
          duration: 60,
        },
      ],
    });

    await processor.handleSegmentGeneration(job());

    expect(prisma.audio.update).toHaveBeenCalledWith({
      where: { id: 'audio-1' },
      data: expect.objectContaining({ status: 'READY', duration: 60 }),
    });
    expect(prisma.storyNarration.updateMany).toHaveBeenCalledWith({
      where: { id: 'narr-1', status: { not: 'READY' } },
      data: { status: 'READY', completedAt: expect.any(Date) },
    });
    expect(notifications.notifyNarrationReady).toHaveBeenCalledTimes(1);
    expect(notifications.notifyNarrationReady).toHaveBeenCalledWith(
      'user-1',
      'Keloglan',
      'narr-1',
      'story-1',
    );
  });

  it('non-final segment: no finalize, no notification', async () => {
    prisma.audio.update.mockResolvedValue({ readySegments: 1, totalSegments: 3 });

    await processor.handleSegmentGeneration(job());

    expect(prisma.audio.findUnique).not.toHaveBeenCalled();
    expect(prisma.storyNarration.updateMany).not.toHaveBeenCalled();
    expect(notifications.notifyNarrationReady).not.toHaveBeenCalled();
  });

  it('segment failure: audio + narration FAILED, one failure notification, job rethrows', async () => {
    provider.textToSpeech.mockRejectedValue(new Error('tts down'));
    prisma.audio.findUnique.mockResolvedValue({
      id: 'audio-1',
      userId: 'user-1',
      title: 't',
      status: 'GENERATING',
    });

    await expect(processor.handleSegmentGeneration(job())).rejects.toThrow('tts down');

    expect(prisma.audioSegment.updateMany).toHaveBeenCalledWith({
      where: { audioId: 'audio-1', index: 0 },
      data: { status: 'FAILED' },
    });
    expect(prisma.storyNarration.updateMany).toHaveBeenCalledWith({
      where: { id: 'narr-1', status: { not: 'FAILED' } },
      data: expect.objectContaining({ status: 'FAILED' }),
    });
    expect(notifications.notifyNarrationFailed).toHaveBeenCalledTimes(1);
    expect(notifications.notifyNarrationReady).not.toHaveBeenCalled();
  });
});

describe('AudioGenerationProcessor + AudioService (shared audio)', () => {
  let prisma: MockPrismaService;
  let notifications: { notifyNarrationReady: jest.Mock; notifyNarrationFailed: jest.Mock };
  let storage: { uploadFile: jest.Mock; deleteFile: jest.Mock };
  let processor: AudioGenerationProcessor;
  let provider: { textToSpeech: jest.Mock };
  let getProvider: jest.Mock;

  beforeEach(() => {
    prisma = createMockPrismaService();
    storage = {
      uploadFile: jest.fn(async (_b: Buffer, key: string) => `${BUCKET_URL}/${key}`),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    notifications = {
      notifyNarrationReady: jest.fn().mockResolvedValue(undefined),
      notifyNarrationFailed: jest.fn().mockResolvedValue(undefined),
    };
    provider = { textToSpeech: jest.fn().mockResolvedValue(Buffer.from('mp3')) };
    getProvider = jest.fn(() => provider);
    const audioService = new AudioService(
      prisma as any,
      storage as any,
      notifications as any,
      {} as any,
      { add: jest.fn() } as any,
      {} as any,
      {} as any,
    );
    processor = new AudioGenerationProcessor(prisma as any, storage as any, { getProvider } as any, audioService);
  });

  it('a shared job is synthesised with its Google voice under shared-audio/ and every attached user is told', async () => {
    prisma.audio.update.mockResolvedValue({ readySegments: 1, totalSegments: 1 });
    prisma.audio.findUnique.mockResolvedValue({
      id: 'audio-s',
      userId: null,
      shared: true,
      title: 'Keloglan',
      segments: [{ index: 0, status: 'READY', audioUrl: `${BUCKET_URL}/shared-audio/audio-s/segments/0.mp3`, duration: 60 }],
    });
    prisma.storyNarration.findMany.mockResolvedValue([
      { id: 'narr-a', userId: 'user-a', storyId: 'story-1', story: { title: 'Keloglan' } },
      { id: 'narr-b', userId: 'user-b', storyId: 'story-1', story: { title: 'Keloglan' } },
    ]);
    prisma.storyNarration.updateMany.mockResolvedValue({ count: 1 });

    await processor.handleSegmentGeneration(
      job({
        audioId: 'audio-s',
        voiceProfileId: null,
        voice: { provider: 'GOOGLE', voiceId: 'en-US-Chirp3-HD-Achernar' },
        shared: true,
        language: 'en',
      }),
    );

    expect(prisma.voiceProfile.findUnique).not.toHaveBeenCalled();
    expect(getProvider).toHaveBeenCalledWith('google');
    expect(provider.textToSpeech.mock.calls[0][1]).toBe('en-US-Chirp3-HD-Achernar');
    expect(provider.textToSpeech.mock.calls[0][2].language).toBe('en');
    expect(storage.uploadFile).toHaveBeenCalledWith(Buffer.from('mp3'), 'shared-audio/audio-s/segments/0.mp3', 'audio/mpeg');
    expect(notifications.notifyNarrationReady.mock.calls.map((c: any[]) => c[0])).toEqual(['user-a', 'user-b']);
  });

  it('a job without voice and without voice profile fails the segment', async () => {
    prisma.audio.findUnique.mockResolvedValue(null);
    await expect(processor.handleSegmentGeneration(job({ voiceProfileId: null }))).rejects.toThrow(
      'Voice profile not found',
    );
  });
});
