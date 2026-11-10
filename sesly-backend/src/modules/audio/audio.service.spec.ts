import { ForbiddenException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import { AudioService } from './audio.service';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createSettingsStub, SettingsStub } from '../../test-utils/settings-stub';
import {
  NARRATION_AUDIO_REMOVED_MESSAGE_KEY,
  NARRATION_FAILED_MESSAGE_KEY,
} from '../../common/constants/messages.constants';
import { serverText } from '../../common/i18n/server-text';

// Stored on the narration row in the owner's language (Turkish when none stored).
const NARRATION_AUDIO_REMOVED_MESSAGE = serverText(NARRATION_AUDIO_REMOVED_MESSAGE_KEY, 'tr');
const NARRATION_FAILED_MESSAGE = serverText(NARRATION_FAILED_MESSAGE_KEY, 'tr');

// ---------------------------------------------------------------------------
// External process / network mocks. Nothing here ever spawns ffmpeg or hits
// the network: fluent-ffmpeg is replaced by a scriptable fake command, axios
// by a jest.fn, and the fs.promises calls of the merge step are spied on.
// ---------------------------------------------------------------------------

type FfmpegBehavior = 'end' | 'error' | 'hang';
const mockFfmpegState: { behavior: FfmpegBehavior; commands: any[] } = {
  behavior: 'end',
  commands: [],
};

jest.mock('fluent-ffmpeg', () => {
  const factory: any = jest.fn(() => {
    const handlers: Record<string, (...args: any[]) => void> = {};
    const cmd: any = {
      inputs: [] as string[],
      input: jest.fn((file: string) => {
        cmd.inputs.push(file);
        return cmd;
      }),
      on: jest.fn((event: string, handler: (...args: any[]) => void) => {
        handlers[event] = handler;
        return cmd;
      }),
      kill: jest.fn(),
      inputOptions: jest.fn((opts: string[]) => {
        cmd.inputOpts = opts;
        return cmd;
      }),
      outputOptions: jest.fn((opts: string[]) => {
        cmd.outputOpts = opts;
        return cmd;
      }),
      output: jest.fn((file: string) => {
        cmd.output = file;
        return cmd;
      }),
      // mergeToFile would need ffprobe (absent in production): never used.
      mergeToFile: jest.fn(() => {
        throw new Error('mergeToFile needs ffprobe');
      }),
      run: jest.fn(() => {
        handlers.start?.('ffmpeg -f concat -safe 0 -i concat.txt -c copy merged.mp3');
        if (mockFfmpegState.behavior === 'end') handlers.end?.();
        if (mockFfmpegState.behavior === 'error') handlers.error?.(new Error('ffmpeg exploded'));
        return cmd;
      }),
    };
    mockFfmpegState.commands.push(cmd);
    return cmd;
  });
  factory.setFfmpegPath = jest.fn();
  return { __esModule: true, default: factory };
});

jest.mock('ffmpeg-static', () => ({ __esModule: true, default: '/fake/bin/ffmpeg' }));

jest.mock('axios', () => ({ __esModule: true, default: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockedAxios: jest.Mock = require('axios').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockedFfmpeg: any = require('fluent-ffmpeg').default;
// The raw CommonJS module: the `import * as fs` namespace above is a getter
// copy, so sync functions must be spied on the real module object.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeFs: typeof import('fs') = require('fs');

const USER = 'user-1';
const OTHER = 'user-2';
const VOICE = 'voice-1';
const BUCKET_URL = 'https://storage.googleapis.com/sesly-bucket';

function voiceRow(overrides: Partial<any> = {}) {
  return {
    id: VOICE,
    userId: USER,
    name: 'Anne',
    provider: 'GOOGLE',
    voiceId: 'tr-TR-Wavenet-A',
    language: 'tr-TR',
    status: 'READY',
    ...overrides,
  };
}

function segmentRow(index: number, overrides: Partial<any> = {}) {
  return {
    id: `seg-${index}`,
    audioId: 'audio-1',
    index,
    content: `Parca ${index}.`,
    status: 'READY',
    audioUrl: `${BUCKET_URL}/audio/audio-1/segments/${index}.mp3`,
    duration: 10 + index,
    emotion: null,
    speed: null,
    volume: null,
    ...overrides,
  };
}

describe('AudioService', () => {
  let prisma: MockPrismaService;
  let storage: {
    uploadFile: jest.Mock;
    deleteFile: jest.Mock;
    generatePresignedUrl: jest.Mock;
    getReadUrl: jest.Mock;
    downloadFile: jest.Mock;
  };
  let notifications: { notifyNarrationReady: jest.Mock; notifyNarrationFailed: jest.Mock };
  let queue: { add: jest.Mock };
  let gateway: { sendToUser: jest.Mock };
  let segmentation: { ensureSegments: jest.Mock };
  let settings: SettingsStub;
  let service: AudioService;
  let fsSpies: jest.SpyInstance[];

  beforeEach(() => {
    mockFfmpegState.behavior = 'end';
    mockFfmpegState.commands = [];

    prisma = createMockPrismaService();
    storage = {
      uploadFile: jest.fn(async (_buf: Buffer, key: string) => `${BUCKET_URL}/${key}`),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      generatePresignedUrl: jest.fn(async (key: string, ttl: number) => `signed:${key}:${ttl}`),
      getReadUrl: jest.fn(async (v: string | null) => (v ? `signed:${v}` : null)),
      downloadFile: jest.fn(async (key: string) => Buffer.from(`bytes-of-${key}`)),
    };
    notifications = {
      notifyNarrationReady: jest.fn().mockResolvedValue(undefined),
      notifyNarrationFailed: jest.fn().mockResolvedValue(undefined),
    };
    queue = { add: jest.fn().mockResolvedValue({ id: 'job' }) };
    gateway = { sendToUser: jest.fn() };
    segmentation = { ensureSegments: jest.fn() };
    settings = createSettingsStub();

    service = new AudioService(
      prisma as any,
      storage as any,
      notifications as any,
      gateway as any,
      queue as any,
      segmentation as any,
      settings as any,
    );

    mockedAxios.mockImplementation(async ({ url }: { url: string }) => ({
      data: Buffer.from(`bytes-of-${url}`),
    }));

    fsSpies = [
      jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined as any),
      jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined as any),
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('merged-mp3') as any),
      jest.spyOn(fs.promises, 'rm').mockResolvedValue(undefined as any),
    ];

    // Sensible defaults for the generation path.
    prisma.voiceProfile.findFirst.mockResolvedValue(voiceRow());
    prisma.story.findUnique.mockResolvedValue(null);
    prisma.audio.create.mockImplementation(async ({ data }: any) => ({ id: 'audio-1', ...data }));
    let segCounter = 0;
    prisma.audioSegment.create.mockImplementation(async ({ data }: any) => ({
      id: `seg-${segCounter++}`,
      ...data,
    }));
    prisma.audio.update.mockResolvedValue({});
    prisma.storyNarration.findFirst.mockResolvedValue(null);
    prisma.storyNarration.findMany.mockResolvedValue([]);
    prisma.storyNarration.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    fsSpies.forEach((s) => s.mockRestore());
    jest.useRealTimers();
  });

  // ==========================================================================
  // onModuleInit
  // ==========================================================================

  describe('onModuleInit', () => {
    it('points fluent-ffmpeg at the bundled binary when it exists', () => {
      const exists = jest.spyOn(nodeFs, 'existsSync').mockReturnValue(true);
      service.onModuleInit();
      expect(mockedFfmpeg.setFfmpegPath).toHaveBeenCalledWith('/fake/bin/ffmpeg');
      exists.mockRestore();
    });

    it('does not throw when the bundled binary is missing (falls back to PATH)', () => {
      const exists = jest.spyOn(nodeFs, 'existsSync').mockReturnValue(false);
      expect(() => service.onModuleInit()).not.toThrow();
      expect(mockedFfmpeg.setFfmpegPath).not.toHaveBeenCalled();
      exists.mockRestore();
    });
  });

  // ==========================================================================
  // generateAudio
  // ==========================================================================

  describe('isPremiumVoiceOf', () => {
    it('clone voices count as premium, ready-made ones do not; 404 for a voice of another user', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValueOnce({ kind: 'CLONE', provider: 'CARTESIA' });
      await expect(service.isPremiumVoiceOf(USER, VOICE)).resolves.toBe(true);
      prisma.voiceProfile.findFirst.mockResolvedValueOnce({ kind: 'PRESET', provider: 'GOOGLE' });
      await expect(service.isPremiumVoiceOf(USER, VOICE)).resolves.toBe(false);
      prisma.voiceProfile.findFirst.mockResolvedValueOnce(null);
      await expect(service.isPremiumVoiceOf(USER, VOICE)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.voiceProfile.findFirst).toHaveBeenLastCalledWith({ where: { id: VOICE, userId: USER } });
    });
  });

  describe('generateAudio', () => {
    it('voice profile must belong to the caller (scoped lookup) -> 404 otherwise', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(null);

      await expect(
        service.generateAudio({ text: 'x', voiceProfileId: VOICE, userId: USER }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.voiceProfile.findFirst).toHaveBeenCalledWith({
        where: { id: VOICE, userId: USER },
      });
      expect(prisma.audio.create).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('voice not READY -> 403 VOICE_NOT_READY, nothing created or queued', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(voiceRow({ status: 'PROCESSING' }));

      const err = await service
        .generateAudio({ text: 'x', voiceProfileId: VOICE, userId: USER })
        .catch((e) => e);

      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: 'VOICE_NOT_READY' });
      expect(prisma.audio.create).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('short text without a story: one PENDING audio, one segment, one job, totals set before queueing', async () => {
      const result = await service.generateAudio({
        text: 'Bir varmis bir yokmus.',
        voiceProfileId: VOICE,
        userId: USER,
        title: 'Deneme',
      });

      expect(result).toEqual({ audioId: 'audio-1', status: 'GENERATING', shared: false });
      expect(prisma.audio.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: USER,
          voiceProfileId: VOICE,
          title: 'Deneme',
          status: 'PENDING',
          totalSegments: 0,
          readySegments: 0,
          globalEmotion: null,
          globalSpeed: null,
          globalVolume: null,
          cartesiaPronunciationDictId: null,
        }),
      });
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith('generate-segment', {
        audioId: 'audio-1',
        segmentId: 'seg-0',
        segmentIndex: 0,
        content: 'Bir varmis bir yokmus.',
        voiceProfileId: VOICE,
        emotion: undefined,
        speed: undefined,
        volume: undefined,
        pronunciationDictId: undefined,
        language: undefined,
        parts: [{ text: 'Bir varmis bir yokmus.' }],
      });
      expect(prisma.audio.update).toHaveBeenCalledWith({
        where: { id: 'audio-1' },
        data: { totalSegments: 1, segmentationVersion: null, status: 'GENERATING' },
      });
      expect(prisma.audio.update.mock.invocationCallOrder[0]).toBeLessThan(
        queue.add.mock.invocationCallOrder[0],
      );
    });

    it('story segments win over the text; per-segment tags beat story defaults (Cartesia, one request per segment)', async () => {
      settings.values['tts.groupSegments'] = false;
      prisma.voiceProfile.findFirst.mockResolvedValue(voiceRow({ provider: 'CARTESIA' }));
      prisma.story.findUnique.mockResolvedValue({
        id: 'story-1',
        language: 'tr',
        defaultEmotion: 'calm',
        defaultSpeed: 0.9,
        cartesiaPronunciationDictId: 'dict-1',
        segmentationVersion: 4,
        preprocessedSegments: [
          { text: 'Birinci.', emotion: 'happy', speed: 1.1, pauseAfterMs: 500 },
          { text: '   ' }, // blank -> dropped
          'garbage', // not an object -> dropped
          { text: 'Ikinci.', volume: 0.8, speed: Number.NaN },
        ],
      });

      await service.generateAudio({
        text: 'IGNORED full story content',
        voiceProfileId: VOICE,
        userId: USER,
        storyId: 'story-1',
      });

      expect(prisma.audio.create.mock.calls[0][0].data).toMatchObject({
        status: 'PENDING',
        globalEmotion: 'calm',
        globalSpeed: 0.9,
        cartesiaPronunciationDictId: 'dict-1',
      });
      expect(prisma.audio.update).toHaveBeenCalledWith({
        where: { id: 'audio-1' },
        data: { totalSegments: 2, segmentationVersion: 4, status: 'GENERATING' },
      });
      const jobs = queue.add.mock.calls.map((c: any[]) => c[1]);
      expect(jobs).toHaveLength(2);
      expect(jobs[0]).toMatchObject({
        content: 'Birinci.',
        emotion: 'happy',
        speed: 1.1,
        pronunciationDictId: 'dict-1',
        language: 'tr',
        parts: [{ text: 'Birinci.', speed: 1.1, pauseAfterMs: 500 }],
      });
      // NaN speed is not a usable override -> story default applies.
      expect(jobs[1]).toMatchObject({ content: 'Ikinci.', emotion: 'calm', speed: 0.9, volume: 0.8 });
      expect(JSON.stringify(jobs)).not.toContain('IGNORED');
      expect(prisma.audioSegment.create.mock.calls[0][0].data).toMatchObject({
        index: 0,
        content: 'Birinci.',
        emotion: 'happy',
        speed: 1.1,
        volume: null,
      });
    });

    it('grouping on (default): Google gets all segments in one request', async () => {
      prisma.story.findUnique.mockResolvedValue({
        id: 'story-1',
        language: 'tr',
        defaultEmotion: null,
        defaultSpeed: null,
        cartesiaPronunciationDictId: null,
        segmentationVersion: 1,
        preprocessedSegments: [
          { text: 'Bir.', emotion: 'calm' },
          { text: 'Iki.', emotion: 'happy' },
        ],
      });

      await service.generateAudio({ text: 'x', voiceProfileId: VOICE, userId: USER, storyId: 'story-1' });

      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add.mock.calls[0][1]).toMatchObject({
        content: 'Bir. Iki.',
        parts: [{ text: 'Bir.' }, { text: 'Iki.' }],
      });
    });

    it('caller globals win over story defaults (Cartesia request values)', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(voiceRow({ provider: 'CARTESIA' }));
      prisma.story.findUnique.mockResolvedValue({
        id: 'story-1',
        language: 'tr',
        defaultEmotion: 'calm',
        defaultSpeed: 0.9,
        cartesiaPronunciationDictId: null,
        segmentationVersion: 1,
        preprocessedSegments: [{ text: 'Kisa metin.' }],
      });

      await service.generateAudio({
        text: 'Kisa metin.',
        voiceProfileId: VOICE,
        userId: USER,
        storyId: 'story-1',
        globalEmotion: 'excited',
        globalSpeed: 1.2,
        globalVolume: 0.5,
        pronunciationDictId: 'dict-x',
      });

      expect(queue.add.mock.calls[0][1]).toMatchObject({
        emotion: 'excited',
        speed: 1.2,
        volume: 0.5,
        pronunciationDictId: 'dict-x',
      });
    });

    it('a story without usable segments: GENERATING audio with 0 segments and a prepare-audio job', async () => {
      prisma.story.findUnique.mockResolvedValue({
        id: 'story-1',
        language: 'en',
        defaultEmotion: 'calm',
        defaultSpeed: null,
        cartesiaPronunciationDictId: null,
        segmentationVersion: 0,
        preprocessedSegments: [{ text: '' }, null],
      });

      const result = await service.generateAudio({
        text: 'Story text.',
        voiceProfileId: VOICE,
        userId: USER,
        storyId: 'story-1',
      });

      expect(result).toEqual({ audioId: 'audio-1', status: 'GENERATING', shared: false });
      expect(prisma.audio.create.mock.calls[0][0].data).toMatchObject({
        status: 'GENERATING',
        totalSegments: 0,
      });
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith('prepare-audio', {
        audioId: 'audio-1',
        storyId: 'story-1',
        voiceProfileId: VOICE,
        globalEmotion: 'calm',
        globalSpeed: null,
        globalVolume: null,
        pronunciationDictId: null,
        language: 'en',
      });
      expect(prisma.audioSegment.create).not.toHaveBeenCalled();
    });

    it('queue down while queueing the segmentation: the audio row is removed and the error propagates', async () => {
      prisma.story.findUnique.mockResolvedValue({
        id: 'story-1',
        language: 'tr',
        preprocessedSegments: null,
        segmentationVersion: 0,
      });
      queue.add.mockRejectedValueOnce(new Error('redis down'));
      prisma.audio.delete.mockRejectedValueOnce(new Error('already gone'));

      await expect(
        service.generateAudio({ text: 'x', voiceProfileId: VOICE, userId: USER, storyId: 'story-1' }),
      ).rejects.toThrow('redis down');
      expect(prisma.audio.delete).toHaveBeenCalledWith({ where: { id: 'audio-1' } });
    });
  });

  describe('prepareStoryAudio', () => {
    const job = {
      audioId: 'audio-1',
      storyId: 'story-1',
      voiceProfileId: VOICE,
      globalEmotion: null,
      globalSpeed: null,
      globalVolume: null,
      pronunciationDictId: null,
      language: 'tr',
    };

    it('audio removed meanwhile: nothing happens', async () => {
      prisma.audio.findUnique.mockResolvedValue(null);
      await service.prepareStoryAudio(job);
      expect(segmentation.ensureSegments).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('segments the story, then queues the requests with the segmentation version', async () => {
      prisma.audio.findUnique.mockResolvedValue({ id: 'audio-1' });
      prisma.voiceProfile.findUnique.mockResolvedValue({ provider: 'CARTESIA' });
      segmentation.ensureSegments.mockResolvedValue({
        segments: [
          { text: 'Bir.', emotion: 'calm', speed: 0.8 },
          { text: 'Iki.', emotion: 'calm', speed: 0.9 },
          { text: 'Uc.', emotion: 'scared' },
        ],
        version: 1,
        source: 'gemini-3-flash-preview',
      });

      await service.prepareStoryAudio(job);

      expect(segmentation.ensureSegments).toHaveBeenCalledWith('story-1');
      expect(prisma.audio.update).toHaveBeenCalledWith({
        where: { id: 'audio-1' },
        data: { totalSegments: 2, segmentationVersion: 1, status: 'GENERATING' },
      });
      const jobs = queue.add.mock.calls.map((c: any[]) => c[1]);
      expect(jobs[0]).toMatchObject({
        content: 'Bir. Iki.',
        emotion: 'calm',
        speed: 0.8,
        parts: [{ text: 'Bir.', speed: 0.8 }, { text: 'Iki.', speed: 0.9 }],
      });
      expect(jobs[1]).toMatchObject({ content: 'Uc.', emotion: 'scared' });
    });

    it('unknown voice provider falls back to the Google plan', async () => {
      prisma.audio.findUnique.mockResolvedValue({ id: 'audio-1' });
      prisma.voiceProfile.findUnique.mockResolvedValue(null);
      segmentation.ensureSegments.mockResolvedValue({
        segments: [{ text: 'Bir.', emotion: 'calm' }, { text: 'Iki.', emotion: 'sad' }],
        version: null,
        source: null,
      });

      await service.prepareStoryAudio(job);

      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('a segmentation failure marks the audio FAILED', async () => {
      prisma.audio.findUnique
        .mockResolvedValueOnce({ id: 'audio-1' })
        .mockResolvedValueOnce({ id: 'audio-1', userId: USER, title: 'T', status: 'GENERATING' });
      segmentation.ensureSegments.mockRejectedValue(new Error('story gone'));

      await service.prepareStoryAudio(job);

      expect(prisma.audio.update).toHaveBeenCalledWith({
        where: { id: 'audio-1' },
        data: { status: 'FAILED', errorMessage: 'Segmentation failed: story gone' },
      });
    });

    it('no segments at all marks the audio FAILED', async () => {
      prisma.audio.findUnique
        .mockResolvedValueOnce({ id: 'audio-1' })
        .mockResolvedValueOnce({ id: 'audio-1', userId: USER, title: 'T', status: 'GENERATING' });
      segmentation.ensureSegments.mockResolvedValue({ segments: [], version: null, source: null });

      await service.prepareStoryAudio(job);

      expect(prisma.audio.update).toHaveBeenCalledWith({
        where: { id: 'audio-1' },
        data: { status: 'FAILED', errorMessage: 'No text to narrate' },
      });
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Free split (admin preview + text without a story)
  // ==========================================================================

  describe('splitTextIntoSegments', () => {
    it('keeps short text as a single segment, normalizing CRLF and 3+ newlines', () => {
      expect(service.splitTextIntoSegments('  A.\r\n\r\n\r\n\r\nB.  ')).toEqual(['A.\n\nB.']);
    });

    it('never cuts a sentence and stays within the segment limit', () => {
      const sentence = 'Kucuk tavsan yildizlari saydi. ';
      const text = sentence.repeat(200);
      const chunks = service.splitTextIntoSegments(text);
      expect(chunks.length).toBeGreaterThan(3);
      chunks.forEach((c) => {
        expect(c.length).toBeLessThanOrEqual(1500);
        expect(c.endsWith('saydi.')).toBe(true);
      });
      expect(chunks.join(' ')).toBe(text.trim());
    });
  });

  // ==========================================================================
  // Reads + ownership
  // ==========================================================================

  describe('getAudioById / getAudioByIdForUser', () => {
    const audio = (overrides: Partial<any> = {}) => ({
      id: 'audio-1',
      userId: USER,
      status: 'GENERATING',
      title: 't',
      duration: null,
      totalSegments: 4,
      readySegments: 1,
      audioUrl: null,
      createdAt: new Date('2026-09-01T00:00:00Z'),
      completedAt: null,
      ...overrides,
    });

    it('returns the metadata shape with a rounded progress', async () => {
      prisma.audio.findUnique.mockResolvedValue(audio({ totalSegments: 3, readySegments: 2 }));
      const meta = await service.getAudioById('audio-1');
      expect(Object.keys(meta).sort()).toEqual(
        ['audioUrl', 'completedAt', 'createdAt', 'duration', 'id', 'progress', 'status', 'title'].sort(),
      );
      expect(meta.progress).toBe(67);
    });

    it('progress is 0 when there are no segments', async () => {
      prisma.audio.findUnique.mockResolvedValue(audio({ totalSegments: 0, readySegments: 0 }));
      expect((await service.getAudioById('audio-1')).progress).toBe(0);
    });

    it('missing audio -> 404', async () => {
      prisma.audio.findUnique.mockResolvedValue(null);
      await expect(service.getAudioById('nope')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getAudioByIdForUser('nope', USER)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("another user's audio -> 403", async () => {
      prisma.audio.findUnique.mockResolvedValue({ userId: OTHER });
      await expect(service.getAudioByIdForUser('audio-1', USER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('owner gets the metadata', async () => {
      prisma.audio.findUnique
        .mockResolvedValueOnce({ userId: USER })
        .mockResolvedValueOnce(audio());
      const meta = await service.getAudioByIdForUser('audio-1', USER);
      expect(meta.id).toBe('audio-1');
      expect(meta.progress).toBe(25);
    });
  });

  describe('getStreamUrl', () => {
    it('404 when missing, 403 for another user, 404 while not READY', async () => {
      prisma.audio.findUnique.mockResolvedValueOnce(null);
      await expect(service.getStreamUrl('a', USER)).rejects.toBeInstanceOf(NotFoundException);

      prisma.audio.findUnique.mockResolvedValueOnce({ userId: OTHER, status: 'READY', audioUrl: 'x' });
      await expect(service.getStreamUrl('a', USER)).rejects.toBeInstanceOf(ForbiddenException);

      prisma.audio.findUnique.mockResolvedValueOnce({ userId: USER, status: 'GENERATING', audioUrl: null });
      await expect(service.getStreamUrl('a', USER)).rejects.toBeInstanceOf(NotFoundException);

      expect(storage.generatePresignedUrl).not.toHaveBeenCalled();
    });

    it('READY: presigns the object key (bucket stripped) for 1 hour', async () => {
      prisma.audio.findUnique.mockResolvedValue({
        userId: USER,
        status: 'READY',
        audioUrl: `${BUCKET_URL}/audio/audio-1/full.mp3`,
      });
      await expect(service.getStreamUrl('audio-1', USER)).resolves.toBe(
        'signed:audio/audio-1/full.mp3:3600',
      );
    });
  });

  // ==========================================================================
  // Delete
  // ==========================================================================

  describe('deleteAudio (user)', () => {
    it("404 when missing, 403 for another user's audio (nothing deleted)", async () => {
      prisma.audio.findUnique.mockResolvedValueOnce(null);
      await expect(service.deleteAudio('a', USER)).rejects.toBeInstanceOf(NotFoundException);

      prisma.audio.findUnique.mockResolvedValueOnce({ id: 'a', userId: OTHER, audioUrl: null, segments: [] });
      await expect(service.deleteAudio('a', USER)).rejects.toBeInstanceOf(ForbiddenException);

      expect(storage.deleteFile).not.toHaveBeenCalled();
      expect(prisma.audio.delete).not.toHaveBeenCalled();
    });

    it('deletes the merged file + segment files by key, skips foreign URLs, tolerates storage errors', async () => {
      prisma.audio.findUnique.mockResolvedValue({
        id: 'audio-1',
        userId: USER,
        audioUrl: `${BUCKET_URL}/audio/audio-1/full.mp3`,
        segments: [
          { audioUrl: `${BUCKET_URL}/audio/audio-1/segments/0.mp3` },
          { audioUrl: 'https://cdn.example.com/not-ours.mp3' },
          { audioUrl: null },
        ],
      });
      storage.deleteFile.mockRejectedValueOnce(new Error('gcs 500'));

      await expect(service.deleteAudio('audio-1', USER)).resolves.toEqual({
        message: 'Audio deleted successfully',
      });

      expect(storage.deleteFile.mock.calls.map((c: any[]) => c[0])).toEqual([
        'audio/audio-1/full.mp3',
        'audio/audio-1/segments/0.mp3',
      ]);
      expect(prisma.audio.delete).toHaveBeenCalledWith({ where: { id: 'audio-1' } });
    });
  });

  describe('adminDeleteAudio', () => {
    it('404 when missing', async () => {
      prisma.audio.findUnique.mockResolvedValue(null);
      await expect(service.adminDeleteAudio('a')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('flips linked narrations to FAILED with the user-facing message and a free regeneration before deleting', async () => {
      prisma.audio.findUnique.mockResolvedValue({
        id: 'audio-1',
        userId: OTHER,
        audioUrl: null,
        segments: [],
      });
      prisma.storyNarration.findMany.mockResolvedValue([
        { id: 'n-1', userId: OTHER, storyId: 's-1' },
        { id: 'n-2', userId: USER, storyId: 's-1' },
      ]);
      prisma.storyNarration.updateMany.mockResolvedValue({ count: 2 });
      gateway.sendToUser.mockImplementationOnce(() => {
        throw new Error('socket down');
      });

      await service.adminDeleteAudio('audio-1');

      expect(prisma.storyNarration.updateMany).toHaveBeenCalledWith({
        where: { audioId: 'audio-1', id: { in: ['n-1', 'n-2'] } },
        data: {
          status: 'FAILED',
          errorMessage: NARRATION_AUDIO_REMOVED_MESSAGE,
          completedAt: null,
          freeRegeneration: true,
        },
      });
      // Socket only, once per narration; a socket error does not stop the delete.
      expect(gateway.sendToUser).toHaveBeenCalledTimes(2);
      expect(gateway.sendToUser).toHaveBeenLastCalledWith(USER, 'narration_status', {
        status: 'FAILED',
        narrationId: 'n-2',
        storyId: 's-1',
        errorMessage: NARRATION_AUDIO_REMOVED_MESSAGE,
      });
      expect(notifications.notifyNarrationFailed).not.toHaveBeenCalled();
      expect(prisma.audio.delete).toHaveBeenCalledWith({ where: { id: 'audio-1' } });
      const flipOrder = prisma.storyNarration.updateMany.mock.invocationCallOrder[0];
      const deleteOrder = prisma.audio.delete.mock.invocationCallOrder[0];
      expect(flipOrder).toBeLessThan(deleteOrder);
    });

    it('stores and sends the removal message in the UI language of each owner', async () => {
      prisma.audio.findUnique.mockResolvedValue({
        id: 'audio-1',
        audioUrl: null,
        segments: [],
      });
      prisma.storyNarration.findMany.mockResolvedValue([
        { id: 'n-1', userId: OTHER, storyId: 's-1' },
        { id: 'n-2', userId: USER, storyId: 's-1' },
      ]);
      (prisma as any).userPreferences.findMany.mockResolvedValue([{ userId: USER, uiLanguage: 'en' }]);
      prisma.storyNarration.updateMany.mockResolvedValue({ count: 1 });

      await service.adminDeleteAudio('audio-1');

      const english = serverText(NARRATION_AUDIO_REMOVED_MESSAGE_KEY, 'en');
      expect(english).not.toBe(NARRATION_AUDIO_REMOVED_MESSAGE);
      expect(prisma.storyNarration.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { audioId: 'audio-1', id: { in: ['n-1'] } },
          data: expect.objectContaining({ errorMessage: NARRATION_AUDIO_REMOVED_MESSAGE }),
        }),
      );
      expect(prisma.storyNarration.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { audioId: 'audio-1', id: { in: ['n-2'] } },
          data: expect.objectContaining({ errorMessage: english }),
        }),
      );
      expect(gateway.sendToUser).toHaveBeenCalledWith(USER, 'narration_status', expect.objectContaining({ errorMessage: english }));
      expect(gateway.sendToUser).toHaveBeenCalledWith(OTHER, 'narration_status', expect.objectContaining({ errorMessage: NARRATION_AUDIO_REMOVED_MESSAGE }));
    });
  });

  // ==========================================================================
  // Library listing
  // ==========================================================================

  describe('getUserAudioLibrary', () => {
    it('is scoped to the caller, filters by status and returns the paginated envelope', async () => {
      prisma.audio.findMany.mockResolvedValue([
        {
          id: 'audio-1',
          title: 't',
          status: 'READY',
          duration: 120,
          totalSegments: 2,
          readySegments: 1,
          voiceProfile: { id: VOICE, name: 'Anne', profileIcon: null },
          createdAt: new Date(),
          completedAt: null,
          audioUrl: 'secret-url',
        },
      ]);
      prisma.audio.count.mockResolvedValue(41);

      const page = await service.getUserAudioLibrary(USER, { page: 2, limit: 20, status: 'READY' } as any);

      expect(prisma.audio.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER, status: 'READY' }, skip: 20, take: 20 }),
      );
      expect(page).toMatchObject({ total: 41, page: 2, limit: 20, totalPages: 3 });
      expect(page.data[0]).toMatchObject({ id: 'audio-1', progress: 50 });
      expect((page.data[0] as any).audioUrl).toBeUndefined();
    });
  });

  // ==========================================================================
  // Processor callbacks
  // ==========================================================================

  describe('onSegmentComplete', () => {
    it('marks the segment READY and does not finalize while segments are outstanding', async () => {
      prisma.audio.update.mockResolvedValue({ readySegments: 1, totalSegments: 3 });
      const finalize = jest.spyOn(service, 'finalizeAudio').mockResolvedValue(undefined);

      await service.onSegmentComplete('audio-1', 0, 'url-0', 12);

      expect(prisma.audioSegment.updateMany).toHaveBeenCalledWith({
        where: { audioId: 'audio-1', index: 0 },
        data: { status: 'READY', audioUrl: 'url-0', duration: 12 },
      });
      expect(prisma.audio.update).toHaveBeenCalledWith({
        where: { id: 'audio-1' },
        data: { readySegments: { increment: 1 } },
      });
      expect(finalize).not.toHaveBeenCalled();
    });

    it('the last segment triggers the merge exactly once', async () => {
      prisma.audio.update.mockResolvedValue({ readySegments: 3, totalSegments: 3 });
      const finalize = jest.spyOn(service, 'finalizeAudio').mockResolvedValue(undefined);

      await service.onSegmentComplete('audio-1', 2, 'url-2', 12);

      expect(finalize).toHaveBeenCalledTimes(1);
      expect(finalize).toHaveBeenCalledWith('audio-1');
    });
  });

  describe('onSegmentFailed', () => {
    beforeEach(() => {
      prisma.audio.findUnique.mockResolvedValue({
        id: 'audio-1',
        userId: USER,
        title: 'Audio title',
        status: 'GENERATING',
      });
    });

    it('marks segment + audio FAILED (raw error admin-only) and the narration FAILED with the Turkish message', async () => {
      prisma.storyNarration.findMany.mockResolvedValue([
        { id: 'narr-1', userId: USER, storyId: 'story-1', story: { title: 'Keloglan' } },
      ]);

      await service.onSegmentFailed('audio-1', 1, 'Cartesia 500: upstream exploded');

      expect(prisma.audioSegment.updateMany).toHaveBeenCalledWith({
        where: { audioId: 'audio-1', index: 1 },
        data: { status: 'FAILED' },
      });
      expect(prisma.audio.update).toHaveBeenCalledWith({
        where: { id: 'audio-1' },
        data: { status: 'FAILED', errorMessage: 'Segment 1 failed: Cartesia 500: upstream exploded' },
      });
      expect(prisma.storyNarration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { audioId: 'audio-1', status: { not: 'FAILED' } } }),
      );
      expect(prisma.storyNarration.updateMany).toHaveBeenCalledWith({
        where: { id: 'narr-1', status: { not: 'FAILED' } },
        data: { status: 'FAILED', errorMessage: NARRATION_FAILED_MESSAGE },
      });
      expect(notifications.notifyNarrationFailed).toHaveBeenCalledWith(
        USER,
        'Keloglan',
        'narr-1',
        'story-1',
        NARRATION_FAILED_MESSAGE,
      );
      // The raw provider error never reaches the user.
      expect(JSON.stringify(notifications.notifyNarrationFailed.mock.calls)).not.toContain('Cartesia');
    });

    it('a second failing segment does not re-notify an already FAILED narration', async () => {
      // A narration flipped by a concurrent failure: the conditional update matches nothing.
      prisma.storyNarration.findMany.mockResolvedValue([
        { id: 'narr-1', userId: USER, storyId: 'story-1', story: { title: 'Keloglan' } },
      ]);
      prisma.storyNarration.updateMany.mockResolvedValue({ count: 0 });

      await service.onSegmentFailed('audio-1', 2, 'again');

      expect(notifications.notifyNarrationFailed).not.toHaveBeenCalled();
    });

    it('standalone audio (no narration): only the audio is marked FAILED', async () => {
      prisma.storyNarration.findMany.mockResolvedValue(undefined);
      await service.onSegmentFailed('audio-1', 0, 'boom');
      expect(prisma.audio.update).toHaveBeenCalled();
      expect(notifications.notifyNarrationFailed).not.toHaveBeenCalled();
    });

    it('audio deleted meanwhile: no writes, no throw', async () => {
      prisma.audio.findUnique.mockResolvedValue(null);
      await expect(service.onSegmentFailed('audio-1', 0, 'boom')).resolves.toBeUndefined();
      expect(prisma.audio.update).not.toHaveBeenCalled();
    });

    it('a notification failure does not break the failure path', async () => {
      prisma.storyNarration.findMany.mockResolvedValue([
        { id: 'narr-1', userId: USER, storyId: 'story-1', story: null },
      ]);
      notifications.notifyNarrationFailed.mockRejectedValue(new Error('fcm down'));

      await expect(service.onSegmentFailed('audio-1', 0, 'boom')).resolves.toBeUndefined();
      // Falls back to the audio title when the story relation is missing.
      expect(notifications.notifyNarrationFailed.mock.calls[0][1]).toBe('Audio title');
    });
  });

  // ==========================================================================
  // finalizeAudio (merge)
  // ==========================================================================

  describe('finalizeAudio', () => {
    const setAudio = (segments: any[], overrides: Partial<any> = {}) => {
      prisma.audio.findUnique.mockImplementation(async (args: any) => {
        const base = { id: 'audio-1', userId: USER, title: 'Audio title', status: 'GENERATING', ...overrides };
        return args?.include ? { ...base, segments } : base;
      });
    };
    const linkedNarration = () =>
      prisma.storyNarration.findMany.mockResolvedValue([
        { id: 'narr-1', userId: USER, storyId: 'story-1', story: { title: 'Keloglan' } },
      ]);

    it('throws when the audio row is gone', async () => {
      prisma.audio.findUnique.mockResolvedValue(null);
      await expect(service.finalizeAudio('audio-1')).rejects.toThrow('not found');
    });

    it('no READY segments -> audio + narration FAILED', async () => {
      setAudio([segmentRow(0, { status: 'FAILED', audioUrl: null })]);
      linkedNarration();

      await service.finalizeAudio('audio-1');

      expect(prisma.audio.update).toHaveBeenCalledWith({
        where: { id: 'audio-1' },
        data: { status: 'FAILED', errorMessage: 'No ready segments to merge' },
      });
      expect(notifications.notifyNarrationFailed).toHaveBeenCalled();
      expect(mockedFfmpeg).not.toHaveBeenCalled();
    });

    it('single segment: READY without ffmpeg, narration READY + ready notification', async () => {
      setAudio([segmentRow(0)]);
      linkedNarration();

      await service.finalizeAudio('audio-1');

      expect(mockedFfmpeg).not.toHaveBeenCalled();
      expect(prisma.audio.update).toHaveBeenCalledWith({
        where: { id: 'audio-1' },
        data: expect.objectContaining({
          status: 'READY',
          audioUrl: `${BUCKET_URL}/audio/audio-1/segments/0.mp3`,
          duration: 10,
          completedAt: expect.any(Date),
        }),
      });
      expect(prisma.storyNarration.updateMany).toHaveBeenCalledWith({
        where: { id: 'narr-1', status: { not: 'READY' } },
        data: { status: 'READY', completedAt: expect.any(Date) },
      });
      expect(notifications.notifyNarrationReady).toHaveBeenCalledWith(USER, 'Keloglan', 'narr-1', 'story-1');
    });

    it('multiple segments: downloads in index order, merges, uploads full.mp3, sums durations, cleans up', async () => {
      // Deliberately out of order + one FAILED segment that must be skipped.
      setAudio([segmentRow(1), segmentRow(0), segmentRow(2, { status: 'FAILED' })]);
      linkedNarration();

      await service.finalizeAudio('audio-1');

      // Our own objects are read through the authenticated storage client
      // (the bucket is private: the plain https URL answers 403), never HTTP.
      const downloaded = storage.downloadFile.mock.calls.map((c: any[]) => c[0]);
      expect(downloaded).toEqual([
        'audio/audio-1/segments/0.mp3',
        'audio/audio-1/segments/1.mp3',
      ]);
      expect(mockedAxios).not.toHaveBeenCalled();
      // One concat list in chunk-index order (not the DB order), streams copied.
      const cmd = mockFfmpegState.commands[0];
      expect(cmd.inputs.map((p: string) => p.replace(/\\/g, '/').split('/').pop())).toEqual(['concat.txt']);
      expect(cmd.inputOpts).toEqual(['-f', 'concat', '-safe', '0']);
      expect(cmd.outputOpts).toEqual(['-c', 'copy']);
      expect(cmd.mergeToFile).not.toHaveBeenCalled();
      const listWrite = (fs.promises.writeFile as unknown as jest.Mock).mock.calls.find((c: any[]) =>
        String(c[0]).replace(/\\/g, '/').endsWith('/concat.txt'),
      );
      const listed = String(listWrite[1])
        .trim()
        .split('\n')
        .map((line) => line.replace(/^file '(.*)'$/, '$1').split('/').pop());
      expect(listed).toEqual(['chunk-0.mp3', 'chunk-1.mp3']);
      expect(storage.uploadFile).toHaveBeenCalledWith(
        Buffer.from('merged-mp3'),
        'audio/audio-1/full.mp3',
        'audio/mpeg',
      );
      expect(prisma.audio.update).toHaveBeenCalledWith({
        where: { id: 'audio-1' },
        data: expect.objectContaining({
          status: 'READY',
          audioUrl: `${BUCKET_URL}/audio/audio-1/full.mp3`,
          duration: 21, // 11 + 10, FAILED segment excluded
        }),
      });
      // Segment files are removed after a successful merge.
      expect(storage.deleteFile.mock.calls.map((c: any[]) => c[0]).sort()).toEqual([
        'audio/audio-1/segments/0.mp3',
        'audio/audio-1/segments/1.mp3',
      ]);
      expect(notifications.notifyNarrationReady).toHaveBeenCalledTimes(1);
      // Temp dir removed.
      expect(fs.promises.rm).toHaveBeenCalledWith(expect.stringContaining('sesly-merge-audio-1-'), {
        recursive: true,
        force: true,
      });
    });

    it('ffmpeg error -> audio + narration FAILED, never rethrown, temp dir still removed', async () => {
      mockFfmpegState.behavior = 'error';
      setAudio([segmentRow(0), segmentRow(1)]);
      linkedNarration();

      await expect(service.finalizeAudio('audio-1')).resolves.toBeUndefined();

      expect(prisma.audio.update).toHaveBeenCalledWith({
        where: { id: 'audio-1' },
        data: { status: 'FAILED', errorMessage: 'Audio merge failed: ffmpeg exploded' },
      });
      expect(prisma.storyNarration.updateMany).toHaveBeenCalledWith({
        where: { id: 'narr-1', status: { not: 'FAILED' } },
        data: { status: 'FAILED', errorMessage: NARRATION_FAILED_MESSAGE },
      });
      expect(notifications.notifyNarrationReady).not.toHaveBeenCalled();
      expect(storage.uploadFile).not.toHaveBeenCalled();
      expect(fs.promises.rm).toHaveBeenCalled();
    });

    it('segment download failure -> FAILED with a named error', async () => {
      storage.downloadFile.mockRejectedValueOnce(new Error('No such object'));
      setAudio([segmentRow(0), segmentRow(1)]);

      await service.finalizeAudio('audio-1');

      const failed = prisma.audio.update.mock.calls.find((c: any[]) => c[0].data.status === 'FAILED');
      expect(failed[0].data.errorMessage).toContain('Failed to download segment 0');
      expect(mockedFfmpeg).not.toHaveBeenCalled();
    });

    it('a segment URL outside our storage is downloaded over HTTP', async () => {
      setAudio([
        segmentRow(0, { audioUrl: 'https://cdn.example.com/a/0.mp3' }),
        segmentRow(1),
      ]);
      linkedNarration();

      await service.finalizeAudio('audio-1');

      expect(mockedAxios.mock.calls.map((c: any[]) => c[0].url)).toEqual(['https://cdn.example.com/a/0.mp3']);
      expect(storage.downloadFile.mock.calls.map((c: any[]) => c[0])).toEqual(['audio/audio-1/segments/1.mp3']);
    });

    it('upload failure of the merged file -> FAILED', async () => {
      storage.uploadFile.mockRejectedValueOnce(new Error('bucket gone'));
      setAudio([segmentRow(0), segmentRow(1)]);

      await service.finalizeAudio('audio-1');

      const failed = prisma.audio.update.mock.calls.find((c: any[]) => c[0].data.status === 'FAILED');
      expect(failed[0].data.errorMessage).toContain('Failed to upload merged audio');
    });

    it('a hanging ffmpeg is killed after 5 minutes and the audio is marked FAILED', async () => {
      jest.useFakeTimers();
      mockFfmpegState.behavior = 'hang';
      setAudio([segmentRow(0), segmentRow(1)]);
      linkedNarration();

      const done = service.finalizeAudio('audio-1');
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
      await done;

      expect(mockFfmpegState.commands[0].kill).toHaveBeenCalledWith('SIGKILL');
      const failed = prisma.audio.update.mock.calls.find((c: any[]) => c[0].data.status === 'FAILED');
      expect(failed[0].data.errorMessage).toContain('timed out');
      expect(notifications.notifyNarrationFailed).toHaveBeenCalledTimes(1);
    });

    it('standalone audio (no narration) finalizes without notifying', async () => {
      setAudio([segmentRow(0)]);
      prisma.storyNarration.findMany.mockResolvedValue([]);

      await service.finalizeAudio('audio-1');

      expect(prisma.storyNarration.updateMany).not.toHaveBeenCalled();
      expect(notifications.notifyNarrationReady).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Admin list
  // ==========================================================================

  describe('adminListAudio', () => {
    it('resolves user emails in one batch and presigns only READY audio', async () => {
      prisma.audio.findMany.mockResolvedValue([
        {
          id: 'a1',
          userId: USER,
          title: 't1',
          status: 'READY',
          duration: 60,
          totalSegments: 1,
          readySegments: 1,
          audioUrl: `${BUCKET_URL}/audio/a1/full.mp3`,
          createdAt: new Date(),
          voiceProfile: { id: VOICE, name: 'Anne' },
        },
        {
          id: 'a2',
          userId: 'ghost',
          title: 't2',
          status: 'GENERATING',
          duration: null,
          totalSegments: 0,
          readySegments: 0,
          audioUrl: null,
          createdAt: new Date(),
          voiceProfile: null,
        },
      ]);
      prisma.audio.count.mockResolvedValue(2);
      prisma.user.findMany.mockResolvedValue([{ id: USER, email: 'a@b.c' }]);

      const page = await service.adminListAudio({ page: 1, limit: 20 } as any);

      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
      expect(page.data[0]).toMatchObject({ user: { id: USER, email: 'a@b.c' }, progress: 100 });
      expect(page.data[0].url).toBe(`signed:${BUCKET_URL}/audio/a1/full.mp3`);
      expect(page.data[1]).toMatchObject({ user: null, voiceProfile: null, url: null, progress: 0 });
    });

    it('empty page does not query users', async () => {
      prisma.audio.findMany.mockResolvedValue([]);
      prisma.audio.count.mockResolvedValue(0);
      const page = await service.adminListAudio({} as any);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(page).toEqual({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    });
  });
});
