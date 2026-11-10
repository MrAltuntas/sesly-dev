import { NotFoundException } from '@nestjs/common';
import { NarrationCacheService } from './narration-cache.service';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createSettingsStub } from '../../test-utils/settings-stub';

const url = (k: string) => `https://storage.googleapis.com/b/${k}`;

describe('NarrationCacheService', () => {
  let prisma: MockPrismaService;
  let audio: { adminDeleteAudio: jest.Mock };
  let service: NarrationCacheService;

  const narrations = [
    {
      status: 'READY',
      audio: {
        id: 'a1',
        status: 'READY',
        audioUrl: url('audio/a1/full.mp3'),
        segmentationVersion: 2,
        segments: [{ audioUrl: url('audio/a1/segments/0.mp3') }, { audioUrl: url('audio/a1/segments/1.mp3') }],
      },
    },
    {
      status: 'READY',
      audio: {
        id: 'a2',
        status: 'READY',
        audioUrl: url('audio/a2/segments/0.mp3'),
        segmentationVersion: 1,
        segments: [{ audioUrl: url('audio/a2/segments/0.mp3') }],
      },
    },
    {
      status: 'GENERATING',
      audio: {
        id: 'a3',
        status: 'GENERATING',
        audioUrl: null,
        segmentationVersion: null,
        segments: [{ audioUrl: url('audio/a3/segments/0.mp3') }, { audioUrl: null }],
      },
    },
    { status: 'FAILED', audio: null },
  ];

  beforeEach(() => {
    prisma = createMockPrismaService();
    audio = { adminDeleteAudio: jest.fn().mockResolvedValue({}) };
    service = new NarrationCacheService(prisma as any, audio as any, createSettingsStub() as any);
    prisma.story.findUnique.mockResolvedValue({ id: 's1', segmentationVersion: 2 });
    prisma.storyNarration.findMany.mockResolvedValue(narrations);
    prisma.audio.findMany.mockResolvedValue([]);
  });

  it('404 for a missing story', async () => {
    prisma.story.findUnique.mockResolvedValue(null);
    await expect(service.summary('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('summary: narrations with audio of every user, stale audio and stored files', async () => {
    await expect(service.summary('s1')).resolves.toEqual({
      storyId: 's1',
      segmentationVersion: 2,
      narrations: 4,
      readyNarrations: 2,
      generatingNarrations: 1,
      audios: 3,
      sharedAudios: 0,
      sharedNarrations: 0,
      sharingEnabled: true,
      staleAudios: 2,
      // a1: merged file only (segment files were removed at merge); a2: one
      // file shared by the audio and its only segment; a3: one segment file.
      files: 3,
    });
    expect(prisma.storyNarration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storyId: 's1', audioId: { not: null } } }),
    );
  });

  it('clear deletes every audio through the admin delete (files, rows, FAILED + free regeneration) and reports', async () => {
    audio.adminDeleteAudio.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('gone')).mockResolvedValueOnce({});

    const result = await service.clear('s1', 'segments edited');

    expect(audio.adminDeleteAudio.mock.calls.map((c) => c[0])).toEqual(['a1', 'a2', 'a3']);
    expect(result).toMatchObject({ narrations: 4, audios: 3, files: 3, removedAudios: 2, failedAudios: 1 });
  });

  it('nothing cached: nothing deleted', async () => {
    prisma.storyNarration.findMany.mockResolvedValue([]);
    await expect(service.clear('s1', 'x')).resolves.toMatchObject({ audios: 0, removedAudios: 0, files: 0 });
    expect(audio.adminDeleteAudio).not.toHaveBeenCalled();
  });

  describe('shared ready-made voice audio', () => {
    const shared = (id: string, extra: Partial<any> = {}) => ({
      id,
      shared: true,
      status: 'READY',
      audioUrl: url(`shared-audio/${id}/full.mp3`),
      segmentationVersion: 2,
      segments: [{ audioUrl: url(`shared-audio/${id}/segments/0.mp3`) }, { audioUrl: url(`shared-audio/${id}/segments/1.mp3`) }],
      ...extra,
    });

    it('counts a shared audio once however many narrations use it, plus shared audios nobody uses any more', async () => {
      prisma.storyNarration.findMany.mockResolvedValue([
        { status: 'READY', audio: shared('s-a') },
        { status: 'READY', audio: shared('s-a') },
        { status: 'GENERATING', audio: shared('s-a') },
        narrations[1],
      ]);
      prisma.audio.findMany.mockResolvedValue([shared('s-a'), shared('s-old', { segmentationVersion: 1 })]);

      const summary = await service.summary('s1');

      expect(summary).toMatchObject({
        narrations: 4,
        audios: 3,
        sharedAudios: 2,
        sharedNarrations: 3,
        staleAudios: 2,
        files: 3,
      });
      expect(prisma.audio.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { storyId: 's1', shared: true } }),
      );
    });

    it('clear deletes each shared audio once (its narrations turn FAILED with a free regeneration)', async () => {
      prisma.storyNarration.findMany.mockResolvedValue([
        { status: 'READY', audio: shared('s-a') },
        { status: 'READY', audio: shared('s-a') },
      ]);
      prisma.audio.findMany.mockResolvedValue([shared('s-a'), shared('s-b')]);

      const result = await service.clear('s1', 'segments edited');

      expect(audio.adminDeleteAudio.mock.calls.map((c) => c[0])).toEqual(['s-a', 's-b']);
      expect(result).toMatchObject({ sharedAudios: 2, sharedNarrations: 2, removedAudios: 2 });
    });

    it('reports the sharing setting', async () => {
      service = new NarrationCacheService(
        prisma as any,
        audio as any,
        createSettingsStub({ 'tts.sharePresetAudio': false }) as any,
      );
      prisma.storyNarration.findMany.mockResolvedValue(undefined);
      prisma.audio.findMany.mockResolvedValue(undefined);
      await expect(service.summary('s1')).resolves.toMatchObject({ sharingEnabled: false, audios: 0 });
    });
  });
});