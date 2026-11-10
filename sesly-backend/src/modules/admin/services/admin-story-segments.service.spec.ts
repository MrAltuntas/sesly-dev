import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AdminStorySegmentsService } from './admin-story-segments.service';
import { createMockPrismaService, MockPrismaService } from '../../../test-utils/prisma-mock';

const CACHE = {
  storyId: 's1',
  segmentationVersion: 3,
  narrations: 2,
  readyNarrations: 2,
  generatingNarrations: 0,
  audios: 2,
  staleAudios: 0,
  files: 2,
};

describe('AdminStorySegmentsService', () => {
  let prisma: MockPrismaService;
  let cache: { summary: jest.Mock; clear: jest.Mock };
  let service: AdminStorySegmentsService;

  const row = (overrides: Partial<any> = {}) => ({
    id: 's1',
    content: 'Bir. Iki.',
    preprocessedSegments: [{ text: 'Bir. ', emotion: 'calm' }, { text: 'Iki.', pauseAfterMs: 400 }],
    preprocessedModel: 'import',
    preprocessedAt: new Date('2026-10-01T00:00:00Z'),
    segmentationVersion: 3,
    defaultEmotion: null,
    defaultSpeed: 0.85,
    ...overrides,
  });

  beforeEach(() => {
    prisma = createMockPrismaService();
    cache = {
      summary: jest.fn().mockResolvedValue(CACHE),
      clear: jest.fn().mockResolvedValue({ ...CACHE, removedAudios: 2, failedAudios: 0 }),
    };
    service = new AdminStorySegmentsService(prisma as any, cache as any);
    prisma.story.findUnique.mockResolvedValue(row());
    prisma.story.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('getSegments', () => {
    it('404 for a missing story', async () => {
      prisma.story.findUnique.mockResolvedValue(null);
      await expect(service.getSegments('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns segments with tags, version, source, the vocabulary and the cache summary', async () => {
      const view = await service.getSegments('s1');
      expect(view).toMatchObject({
        storyId: 's1',
        version: 3,
        source: 'import',
        stored: true,
        segments: [{ text: 'Bir. ', emotion: 'calm' }, { text: 'Iki.', pauseAfterMs: 400 }],
        matchesContent: true,
        contentDiff: null,
        defaultEmotion: null,
        defaultSpeed: 0.85,
        cache: CACHE,
      });
      expect(view.vocabulary.emotions.length).toBeGreaterThan(10);
    });

    it('a story without segments: nothing stored, no source', async () => {
      prisma.story.findUnique.mockResolvedValue(row({ preprocessedSegments: null, preprocessedModel: null, defaultSpeed: null }));
      await expect(service.getSegments('s1')).resolves.toMatchObject({
        stored: false,
        segments: [],
        source: null,
        segmentedAt: null,
        matchesContent: true,
        defaultSpeed: null,
      });
    });

    it('segments that read another text are flagged with the first difference', async () => {
      prisma.story.findUnique.mockResolvedValue(row({ preprocessedSegments: [{ text: 'Bambaşka.' }] }));
      const view = await service.getSegments('s1');
      expect(view.matchesContent).toBe(false);
      expect(view.contentDiff).toContain('Bambaşka');
    });
  });

  describe('saveSegments', () => {
    const segments = [{ text: 'Bir.', emotion: 'happy' }, { text: 'Iki.' }];

    it('404 for a missing story', async () => {
      prisma.story.findUnique.mockResolvedValue(null);
      await expect(service.saveSegments('nope', segments)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('invalid segments: 400 SEGMENTS_INVALID with every problem, nothing written', async () => {
      const err = await service.saveSegments('s1', [{ text: ' ' }, { text: 'a', emotion: 'joyful' }]).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({
        code: 'SEGMENTS_INVALID',
        problems: ['Segment 1: metin boş olamaz.', 'Segment 2: "joyful" desteklenen bir duygu değil.'],
      });
      expect(prisma.story.updateMany).not.toHaveBeenCalled();
    });

    it('a stale editor version: 409 SEGMENTS_VERSION_CONFLICT, nothing written', async () => {
      const err = await service.saveSegments('s1', segments, 2).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ code: 'SEGMENTS_VERSION_CONFLICT', currentVersion: 3 });
      expect(prisma.story.updateMany).not.toHaveBeenCalled();
    });

    it('saves as manual, bumps the version conditionally and clears the narration cache', async () => {
      const result = await service.saveSegments('s1', segments, 3);

      expect(prisma.story.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', segmentationVersion: 3 },
        data: {
          preprocessedSegments: [{ text: 'Bir.', emotion: 'happy' }, { text: 'Iki.' }],
          preprocessedAt: expect.any(Date),
          preprocessedModel: 'manual',
          segmentationVersion: 4,
          segmentationLockedUntil: null,
        },
      });
      expect(cache.clear).toHaveBeenCalledWith('s1', 'segments edited');
      expect(result.cacheCleared).toMatchObject({ removedAudios: 2 });
    });

    it('a write lost to a concurrent one is a 409 with the current version', async () => {
      prisma.story.updateMany.mockResolvedValue({ count: 0 });
      prisma.story.findUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce({ segmentationVersion: 4 });

      const err = await service.saveSegments('s1', segments).catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: 'SEGMENTS_VERSION_CONFLICT', currentVersion: 4 });
      expect(cache.clear).not.toHaveBeenCalled();
    });

    it('a write lost and the story deleted meanwhile: 409 with the version read before', async () => {
      prisma.story.updateMany.mockResolvedValue({ count: 0 });
      prisma.story.findUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce(null);

      const err = await service.saveSegments('s1', segments).catch((e) => e);
      expect(err.getResponse()).toMatchObject({ currentVersion: 3 });
    });
  });

  it('cache summary and clear go to the narration cache, clear names the admin', async () => {
    await expect(service.cacheSummary('s1')).resolves.toEqual(CACHE);
    await service.clearCache('s1', 'admin@sesly.app');
    expect(cache.clear).toHaveBeenCalledWith('s1', 'admin request by admin@sesly.app');
    await service.clearCache('s1');
    expect(cache.clear).toHaveBeenLastCalledWith('s1', 'admin request by unknown');
  });
});
