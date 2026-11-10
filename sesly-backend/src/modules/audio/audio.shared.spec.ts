import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as fs from 'fs';
import { AudioService, SHARED_AUDIO_STALE_MS } from './audio.service';
import { buildSharedAudioParams, sharedAudioKey } from './shared-audio-key';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createSettingsStub, SettingsStub } from '../../test-utils/settings-stub';
import { NARRATION_FAILED_MESSAGE_KEY } from '../../common/constants/messages.constants';
import { serverText } from '../../common/i18n/server-text';

const NARRATION_FAILED_MESSAGE = serverText(NARRATION_FAILED_MESSAGE_KEY, 'tr');

jest.mock('fluent-ffmpeg', () => {
  const factory: any = jest.fn(() => {
    const handlers: Record<string, (...args: any[]) => void> = {};
    const cmd: any = {
      input: jest.fn(() => cmd),
      on: jest.fn((event: string, handler: (...args: any[]) => void) => {
        handlers[event] = handler;
        return cmd;
      }),
      kill: jest.fn(),
      inputOptions: jest.fn(() => cmd),
      outputOptions: jest.fn(() => cmd),
      output: jest.fn(() => cmd),
      run: jest.fn(() => {
        handlers.end?.();
        return cmd;
      }),
    };
    return cmd;
  });
  factory.setFfmpegPath = jest.fn();
  return { __esModule: true, default: factory };
});
jest.mock('ffmpeg-static', () => ({ __esModule: true, default: '/fake/bin/ffmpeg' }));
jest.mock('axios', () => ({ __esModule: true, default: jest.fn(async () => ({ data: Buffer.from('x') })) }));

const USER = 'user-1';
const VOICE = 'voice-1';
const BUCKET_URL = 'https://storage.googleapis.com/sesly-bucket';

const presetVoice = (overrides: Partial<any> = {}) => ({
  id: VOICE,
  userId: USER,
  provider: 'GOOGLE',
  kind: 'PRESET',
  voiceId: 'tr-TR-Chirp3-HD-Achernar',
  language: 'tr-TR',
  status: 'READY',
  ...overrides,
});

const storyRow = (overrides: Partial<any> = {}) => ({
  id: 'story-1',
  title: 'Keloğlan',
  content: 'Bir varmış. Bir yokmuş.',
  language: 'tr',
  segmentationVersion: 2,
  preprocessedSegments: [{ text: 'Bir varmış.' }, { text: 'Bir yokmuş.' }],
  defaultEmotion: null,
  defaultSpeed: null,
  cartesiaPronunciationDictId: null,
  ...overrides,
});

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['shareKey'] },
  });

describe('AudioService (shared ready-made voice audio)', () => {
  let prisma: MockPrismaService;
  let storage: {
    uploadFile: jest.Mock;
    deleteFile: jest.Mock;
    generatePresignedUrl: jest.Mock;
    downloadFile: jest.Mock;
  };
  let notifications: { notifyNarrationReady: jest.Mock; notifyNarrationFailed: jest.Mock };
  let gateway: { sendToUser: jest.Mock };
  let queue: { add: jest.Mock };
  let segmentation: { ensureSegments: jest.Mock };
  let settings: SettingsStub;
  let service: AudioService;
  let tx: { audio: { create: jest.Mock }; storyNarration: { update: jest.Mock } };

  const generate = (overrides: Partial<any> = {}) =>
    service.generateAudio({
      text: 'ignored',
      voiceProfileId: VOICE,
      userId: USER,
      storyId: 'story-1',
      narrationId: 'narr-1',
      share: true,
      ...overrides,
    });

  beforeEach(() => {
    prisma = createMockPrismaService();
    storage = {
      uploadFile: jest.fn(async (_b: Buffer, key: string) => `${BUCKET_URL}/${key}`),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      generatePresignedUrl: jest.fn(async (key: string) => `signed:${key}`),
      // The merge reads our segments through the storage client.
      downloadFile: jest.fn(async (key: string) => Buffer.from(`bytes-of-${key}`)),
    };
    notifications = {
      notifyNarrationReady: jest.fn().mockResolvedValue(undefined),
      notifyNarrationFailed: jest.fn().mockResolvedValue(undefined),
    };
    gateway = { sendToUser: jest.fn() };
    queue = { add: jest.fn().mockResolvedValue({}) };
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

    tx = {
      audio: { create: jest.fn(async ({ data }: any) => ({ id: 'shared-1', ...data })) },
      storyNarration: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
    prisma.voiceProfile.findFirst.mockResolvedValue(presetVoice());
    prisma.story.findUnique.mockResolvedValue(storyRow());
    prisma.audio.findUnique.mockResolvedValue(null);
    prisma.audio.update.mockResolvedValue({});
    let seg = 0;
    prisma.audioSegment.create.mockImplementation(async ({ data }: any) => ({ id: `seg-${seg++}`, ...data }));
    prisma.storyNarration.update.mockResolvedValue({});
    prisma.storyNarration.updateMany.mockResolvedValue({ count: 1 });
    prisma.storyNarration.findMany.mockResolvedValue([]);
  });

  describe('who shares', () => {
    it('a cloned voice never uses the shared path', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(presetVoice({ provider: 'CARTESIA', kind: 'CLONE', voiceId: 'c-1' }));
      prisma.audio.create.mockImplementation(async ({ data }: any) => ({ id: 'own-1', ...data }));

      const result = await generate();

      expect(result).toEqual({ audioId: 'own-1', status: 'GENERATING', shared: false });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.audio.create.mock.calls[0][0].data).toMatchObject({ userId: USER, voiceProfileId: VOICE });
    });

    it('sharing switched off (tts.sharePresetAudio false): per-user audio as before', async () => {
      settings.values['tts.sharePresetAudio'] = false;
      prisma.audio.create.mockImplementation(async ({ data }: any) => ({ id: 'own-1', ...data }));
      await expect(generate()).resolves.toMatchObject({ shared: false });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('a caller that does not ask for sharing (POST /audio/generate) gets owned audio', async () => {
      prisma.audio.create.mockImplementation(async ({ data }: any) => ({ id: 'own-1', ...data }));
      await expect(generate({ share: undefined })).resolves.toMatchObject({ shared: false });
    });
  });

  describe('first request for a key', () => {
    it('creates one shared audio (no user, no voice profile) and links the narration in one transaction, then queues', async () => {
      const result = await generate();

      expect(result).toEqual({ audioId: 'shared-1', status: 'GENERATING', shared: true });
      const params = buildSharedAudioParams(storyRow(), presetVoice(), settings, true);
      expect(prisma.audio.findUnique).toHaveBeenCalledWith({ where: { shareKey: sharedAudioKey(params) } });
      const data = tx.audio.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        shared: true,
        shareKey: sharedAudioKey(params),
        storyId: 'story-1',
        status: 'PENDING',
        title: 'Keloğlan',
      });
      expect(data).not.toHaveProperty('userId');
      expect(data).not.toHaveProperty('voiceProfileId');
      expect(tx.storyNarration.update).toHaveBeenCalledWith({
        where: { id: 'narr-1' },
        data: { audioId: 'shared-1', status: 'GENERATING', errorMessage: null, completedAt: null, freeRegeneration: false },
      });
      // The link is committed before any job is queued.
      expect(tx.storyNarration.update.mock.invocationCallOrder[0]).toBeLessThan(queue.add.mock.invocationCallOrder[0]);
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add.mock.calls[0][1]).toMatchObject({
        audioId: 'shared-1',
        voiceProfileId: null,
        voice: { provider: 'GOOGLE', voiceId: 'tr-TR-Chirp3-HD-Achernar' },
        shared: true,
        language: 'tr',
        content: 'Bir varmış. Bir yokmuş.',
      });
    });

    it('a story without stored segments: the shared audio starts GENERATING with a lazy key and a prepare job', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ preprocessedSegments: null, segmentationVersion: 0 }));

      await generate();

      expect(tx.audio.create.mock.calls[0][0].data.status).toBe('GENERATING');
      expect(tx.audio.create.mock.calls[0][0].data.shareParams.segmentation).toBe('lazy-v0');
      expect(queue.add).toHaveBeenCalledWith(
        'prepare-audio',
        expect.objectContaining({
          audioId: 'shared-1',
          voiceProfileId: null,
          voice: { provider: 'GOOGLE', voiceId: 'tr-TR-Chirp3-HD-Achernar' },
          shareParams: expect.objectContaining({ segmentation: 'lazy-v0' }),
        }),
      );
    });

    it('a simultaneous first request loses on the unique key and attaches to the winner (no second synthesis)', async () => {
      prisma.$transaction.mockRejectedValueOnce(p2002());
      prisma.audio.findUnique
        .mockResolvedValueOnce(null) // first look: nothing yet
        .mockResolvedValueOnce({ id: 'shared-1', status: 'PENDING', updatedAt: new Date(), audioUrl: null }) // after P2002
        .mockResolvedValueOnce({ status: 'GENERATING' }); // settle

      const result = await generate();

      expect(result).toEqual({ audioId: 'shared-1', status: 'GENERATING', shared: true });
      expect(prisma.storyNarration.update).toHaveBeenCalledWith({
        where: { id: 'narr-1' },
        data: expect.objectContaining({ audioId: 'shared-1', status: 'GENERATING' }),
      });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('any other error of the create is not swallowed', async () => {
      prisma.$transaction.mockRejectedValueOnce(new Error('db down'));
      await expect(generate()).rejects.toThrow('db down');
    });

    it('the winner vanished between P2002 and the read (admin clear): the request fails', async () => {
      prisma.$transaction.mockRejectedValueOnce(p2002());
      await expect(generate()).rejects.toThrow('vanished');
    });

    it('queue down: the shared audio and its narrations fail, the error reaches the caller (unit refunded there)', async () => {
      queue.add.mockRejectedValue(new Error('redis down'));
      prisma.audio.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'shared-1', userId: null, title: 'Keloğlan', status: 'PENDING' });
      prisma.storyNarration.findMany.mockResolvedValue([
        { id: 'narr-1', userId: USER, storyId: 'story-1', story: { title: 'Keloğlan' } },
      ]);

      await expect(generate()).rejects.toThrow('redis down');
      expect(prisma.audio.update).toHaveBeenCalledWith({
        where: { id: 'shared-1' },
        data: { status: 'FAILED', errorMessage: 'Shared generation could not start: redis down' },
      });
      expect(notifications.notifyNarrationFailed).toHaveBeenCalledWith(
        USER,
        'Keloğlan',
        'narr-1',
        'story-1',
        NARRATION_FAILED_MESSAGE,
      );
    });
  });

  describe('existing shared audio', () => {
    it('READY: the narration is READY at once, a socket event, no push and no TTS', async () => {
      prisma.audio.findUnique
        .mockResolvedValueOnce({ id: 'shared-1', status: 'READY', updatedAt: new Date(), audioUrl: 'u' })
        .mockResolvedValueOnce({ status: 'READY' });
      prisma.storyNarration.findUnique.mockResolvedValue({ userId: USER, storyId: 'story-1' });

      const result = await generate();

      expect(result).toEqual({ audioId: 'shared-1', status: 'READY', shared: true });
      expect(prisma.storyNarration.updateMany).toHaveBeenCalledWith({
        where: { id: 'narr-1', status: { in: ['PENDING', 'GENERATING'] } },
        data: { status: 'READY', completedAt: expect.any(Date) },
      });
      expect(gateway.sendToUser).toHaveBeenCalledWith(USER, 'narration_status', {
        status: 'READY',
        narrationId: 'narr-1',
        storyId: 'story-1',
      });
      expect(notifications.notifyNarrationReady).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('READY but the narration was settled meanwhile: no second event; a socket error is only logged', async () => {
      prisma.audio.findUnique
        .mockResolvedValueOnce({ id: 'shared-1', status: 'READY', updatedAt: new Date(), audioUrl: 'u' })
        .mockResolvedValueOnce({ status: 'READY' });
      prisma.storyNarration.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(generate()).resolves.toMatchObject({ status: 'READY' });
      expect(gateway.sendToUser).not.toHaveBeenCalled();

      prisma.audio.findUnique
        .mockResolvedValueOnce({ id: 'shared-1', status: 'READY', updatedAt: new Date(), audioUrl: 'u' })
        .mockResolvedValueOnce({ status: 'READY' });
      prisma.storyNarration.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.storyNarration.findUnique.mockResolvedValue({ userId: USER, storyId: 'story-1' });
      gateway.sendToUser.mockImplementation(() => {
        throw new Error('socket down');
      });
      await expect(generate()).resolves.toMatchObject({ status: 'READY' });
    });

    it('GENERATING: the narration attaches and waits for the same completion', async () => {
      prisma.audio.findUnique
        .mockResolvedValueOnce({ id: 'shared-1', status: 'GENERATING', updatedAt: new Date(), audioUrl: null })
        .mockResolvedValueOnce({ status: 'GENERATING' });

      await expect(generate()).resolves.toEqual({ audioId: 'shared-1', status: 'GENERATING', shared: true });
      expect(queue.add).not.toHaveBeenCalled();
      expect(prisma.audio.updateMany).not.toHaveBeenCalled();
    });

    it('failed between the attach and the re-read: the narration is told FAILED', async () => {
      prisma.audio.findUnique
        .mockResolvedValueOnce({ id: 'shared-1', status: 'GENERATING', updatedAt: new Date(), audioUrl: null })
        .mockResolvedValueOnce({ status: 'FAILED' });
      prisma.storyNarration.findMany.mockResolvedValue([
        { id: 'narr-1', userId: USER, storyId: 'story-1', story: { title: 'Keloğlan' } },
      ]);

      await expect(generate()).resolves.toEqual({ audioId: 'shared-1', status: 'FAILED', shared: true });
      expect(prisma.storyNarration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { audioId: 'shared-1', status: { not: 'FAILED' }, id: 'narr-1' } }),
      );
      expect(notifications.notifyNarrationFailed).toHaveBeenCalledTimes(1);
    });

    it('FAILED: the first request claims the retry (conditional), drops old segments, detaches failed narrations, regenerates once', async () => {
      const updatedAt = new Date('2026-10-21T10:00:00Z');
      prisma.audio.findUnique.mockResolvedValueOnce({ id: 'shared-1', status: 'FAILED', updatedAt, audioUrl: null });
      prisma.audio.updateMany.mockResolvedValue({ count: 1 });
      prisma.audioSegment.findMany.mockResolvedValue([
        { audioUrl: `${BUCKET_URL}/shared-audio/shared-1/segments/0.mp3` },
        { audioUrl: null },
      ]);

      const result = await generate();

      expect(result).toEqual({ audioId: 'shared-1', status: 'GENERATING', shared: true });
      expect(prisma.audio.updateMany).toHaveBeenCalledWith({
        where: { id: 'shared-1', status: 'FAILED', updatedAt },
        data: expect.objectContaining({ status: 'GENERATING', errorMessage: null, totalSegments: 0, readySegments: 0 }),
      });
      expect(storage.deleteFile).toHaveBeenCalledWith('shared-audio/shared-1/segments/0.mp3');
      expect(prisma.audioSegment.deleteMany).toHaveBeenCalledWith({ where: { audioId: 'shared-1' } });
      expect(prisma.storyNarration.updateMany).toHaveBeenCalledWith({
        where: { audioId: 'shared-1', status: 'FAILED' },
        data: { audioId: null },
      });
      expect(prisma.storyNarration.update).toHaveBeenCalledWith({
        where: { id: 'narr-1' },
        data: expect.objectContaining({ audioId: 'shared-1', status: 'GENERATING' }),
      });
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('FAILED but another request claimed the retry first: this one only attaches', async () => {
      prisma.audio.findUnique
        .mockResolvedValueOnce({ id: 'shared-1', status: 'FAILED', updatedAt: new Date(), audioUrl: null })
        .mockResolvedValueOnce({ status: 'GENERATING' });
      prisma.audio.updateMany.mockResolvedValue({ count: 0 });

      await expect(generate()).resolves.toMatchObject({ status: 'GENERATING' });
      expect(queue.add).not.toHaveBeenCalled();
      expect(prisma.audioSegment.deleteMany).not.toHaveBeenCalled();
    });

    it('a generation stuck longer than the stale limit is generated again; a recent one is not', async () => {
      const old = new Date(Date.now() - SHARED_AUDIO_STALE_MS - 1000);
      prisma.audio.findUnique.mockResolvedValueOnce({ id: 'shared-1', status: 'GENERATING', updatedAt: old, audioUrl: null });
      prisma.audio.updateMany.mockResolvedValue({ count: 1 });
      prisma.audioSegment.findMany.mockResolvedValue(undefined);

      await generate();
      expect(prisma.audio.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'shared-1', status: 'GENERATING', updatedAt: old } }),
      );
      expect(queue.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('prepare (story segmented on the first request)', () => {
    const lazyParams = () =>
      buildSharedAudioParams(storyRow({ segmentationVersion: 0 }), presetVoice(), settings, false);
    const job = () => ({
      audioId: 'shared-1',
      storyId: 'story-1',
      voiceProfileId: null,
      voice: { provider: 'GOOGLE' as const, voiceId: 'tr-TR-Chirp3-HD-Achernar' },
      shareParams: lazyParams(),
      globalEmotion: null,
      globalSpeed: null,
      globalVolume: null,
      pronunciationDictId: null,
      language: 'tr',
    });

    beforeEach(() => {
      prisma.audio.findUnique.mockResolvedValue({ id: 'shared-1' });
    });

    it('stored segments: the key moves to the stored version (later requests reuse it) and the shared jobs are queued', async () => {
      segmentation.ensureSegments.mockResolvedValue({ segments: [{ text: 'Bir.' }], version: 1, source: 'gemini' });

      await service.prepareStoryAudio(job());

      const stored = buildSharedAudioParams(storyRow({ segmentationVersion: 1 }), presetVoice(), settings, true);
      expect(prisma.audio.update).toHaveBeenCalledWith({
        where: { id: 'shared-1' },
        data: { shareKey: sharedAudioKey(stored), shareParams: expect.objectContaining({ segmentation: 'v1' }) },
      });
      expect(prisma.voiceProfile.findUnique).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledWith(
        'generate-segment',
        expect.objectContaining({ voiceProfileId: null, shared: true, voice: job().voice }),
      );
    });

    it('unstored segments (free split): the key is dropped, the audio serves only the narrations attached now', async () => {
      segmentation.ensureSegments.mockResolvedValue({ segments: [{ text: 'Bir.' }], version: null, source: null });
      await service.prepareStoryAudio(job());
      expect(prisma.audio.update).toHaveBeenCalledWith({ where: { id: 'shared-1' }, data: { shareKey: null } });
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('the stored-version key is already taken: the lazy key stays and the synthesis goes on', async () => {
      segmentation.ensureSegments.mockResolvedValue({ segments: [{ text: 'Bir.' }], version: 1, source: 'gemini' });
      prisma.audio.update.mockRejectedValueOnce(p2002()).mockResolvedValue({});
      await service.prepareStoryAudio(job());
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('another rekey error fails the audio', async () => {
      segmentation.ensureSegments.mockResolvedValue({ segments: [{ text: 'Bir.' }], version: 1, source: 'gemini' });
      prisma.audio.update.mockRejectedValueOnce(new Error('db down')).mockResolvedValue({});
      prisma.audio.findUnique
        .mockResolvedValueOnce({ id: 'shared-1' })
        .mockResolvedValueOnce({ id: 'shared-1', userId: null, title: 'T', status: 'GENERATING' });
      await service.prepareStoryAudio(job());
      expect(prisma.audio.update).toHaveBeenCalledWith({
        where: { id: 'shared-1' },
        data: { status: 'FAILED', errorMessage: 'Segmentation failed: db down' },
      });
    });

    it('a shared prepare job without key parameters skips the rekey', async () => {
      segmentation.ensureSegments.mockResolvedValue({ segments: [{ text: 'Bir.' }], version: 1, source: 'gemini' });
      await service.prepareStoryAudio({ ...job(), shareParams: undefined });
      expect(prisma.audio.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { shareKey: null } }));
      expect(queue.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('access, release and storage', () => {
    it('stream URL of a shared audio: only for a user with a narration pointing at it', async () => {
      prisma.audio.findUnique.mockResolvedValue({
        id: 'shared-1',
        userId: null,
        shared: true,
        status: 'READY',
        audioUrl: `${BUCKET_URL}/shared-audio/shared-1/full.mp3`,
      });
      prisma.storyNarration.findFirst.mockResolvedValueOnce({ id: 'narr-1' });
      await expect(service.getStreamUrl('shared-1', USER)).resolves.toBe('signed:shared-audio/shared-1/full.mp3');
      expect(prisma.storyNarration.findFirst).toHaveBeenCalledWith({
        where: { audioId: 'shared-1', userId: USER },
        select: { id: true },
      });

      prisma.storyNarration.findFirst.mockResolvedValueOnce(null);
      await expect(service.getStreamUrl('shared-1', 'stranger')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('metadata of a shared audio follows the same rule', async () => {
      prisma.audio.findUnique.mockResolvedValue({
        id: 'shared-1',
        userId: null,
        shared: true,
        status: 'READY',
        totalSegments: 1,
        readySegments: 1,
      });
      prisma.storyNarration.findFirst.mockResolvedValueOnce(null);
      await expect(service.getAudioByIdForUser('shared-1', 'stranger')).rejects.toBeInstanceOf(ForbiddenException);
      prisma.storyNarration.findFirst.mockResolvedValueOnce({ id: 'narr-1' });
      await expect(service.getAudioByIdForUser('shared-1', USER)).resolves.toMatchObject({ id: 'shared-1', progress: 100 });
    });

    it('releasing a shared audio keeps it; an owned one is deleted; a missing one is ignored', async () => {
      const del = jest.spyOn(service, 'deleteAudio').mockResolvedValue({ message: 'ok' });
      prisma.audio.findUnique.mockResolvedValueOnce({ id: 'shared-1', shared: true });
      await service.releaseAudio('shared-1', USER);
      expect(del).not.toHaveBeenCalled();
      expect(prisma.audio.delete).not.toHaveBeenCalled();

      prisma.audio.findUnique.mockResolvedValueOnce({ id: 'own-1', shared: false });
      await service.releaseAudio('own-1', USER);
      expect(del).toHaveBeenCalledWith('own-1', USER);

      prisma.audio.findUnique.mockResolvedValueOnce(null);
      await expect(service.releaseAudio('gone', USER)).resolves.toBeUndefined();
    });

    it('a user can not delete a shared audio through DELETE /audio/:id', async () => {
      prisma.audio.findUnique.mockResolvedValue({ id: 'shared-1', userId: null, shared: true, segments: [] });
      await expect(service.deleteAudio('shared-1', USER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('the merged file of a shared audio is uploaded under shared-audio/ (no user id in the path)', async () => {
      const spies = [
        jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined as any),
        jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined as any),
        jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('merged') as any),
        jest.spyOn(fs.promises, 'rm').mockResolvedValue(undefined as any),
      ];
      prisma.audio.findUnique.mockResolvedValue({
        id: 'shared-1',
        userId: null,
        shared: true,
        title: 'Keloğlan',
        segments: [0, 1].map((index) => ({
          index,
          status: 'READY',
          audioUrl: `${BUCKET_URL}/shared-audio/shared-1/segments/${index}.mp3`,
          duration: 5,
        })),
      });
      prisma.storyNarration.findMany.mockResolvedValue([
        { id: 'narr-a', userId: 'user-a', storyId: 'story-1', story: { title: 'Keloğlan' } },
        { id: 'narr-b', userId: 'user-b', storyId: 'story-1', story: null },
      ]);
      prisma.storyNarration.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

      await service.finalizeAudio('shared-1');

      expect(storage.uploadFile).toHaveBeenCalledWith(Buffer.from('merged'), 'shared-audio/shared-1/full.mp3', 'audio/mpeg');
      // narr-b was READY already (conditional update matched nothing): one notification.
      expect(notifications.notifyNarrationReady).toHaveBeenCalledTimes(1);
      expect(notifications.notifyNarrationReady).toHaveBeenCalledWith('user-a', 'Keloğlan', 'narr-a', 'story-1');
      spies.forEach((s) => s.mockRestore());
    });

    it('admin list marks shared audio with its narration count and no user', async () => {
      prisma.audio.findMany.mockResolvedValue([
        {
          id: 'shared-1',
          userId: null,
          shared: true,
          title: 'Keloğlan',
          status: 'GENERATING',
          duration: null,
          totalSegments: 0,
          readySegments: 0,
          audioUrl: null,
          createdAt: new Date(),
          voiceProfile: null,
          _count: { narrations: 3 },
        },
      ]);
      prisma.audio.count.mockResolvedValue(1);

      const page = await service.adminListAudio({ page: 1, limit: 20 } as any);

      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(page.data[0]).toMatchObject({ shared: true, narrationCount: 3, user: null, userId: null });
    });
  });
});
