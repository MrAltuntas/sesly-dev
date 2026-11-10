import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { StorySegmentationService } from './story-segmentation.service';
import { LlmContentDriftError } from '../llm-preprocessing/llm-preprocessing.service';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';

const CONTENT = 'Bir varmış bir yokmuş. Küçük bir tavşan varmış.';

function storyRow(overrides: Partial<any> = {}) {
  return {
    id: 'story-1',
    content: CONTENT,
    language: 'tr',
    preprocessedSegments: null,
    preprocessedModel: null,
    segmentationVersion: 0,
    ...overrides,
  };
}

describe('StorySegmentationService', () => {
  let prisma: MockPrismaService;
  let llm: { isConfigured: jest.Mock; preprocessStory: jest.Mock };
  let service: StorySegmentationService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    llm = {
      isConfigured: jest.fn().mockReturnValue(true),
      preprocessStory: jest.fn().mockResolvedValue({
        segments: [
          { text: 'Bir varmış bir yokmuş. ', emotion: 'peaceful', speed: 0.82 },
          { text: 'Küçük bir tavşan varmış.', emotion: 'calm', speed: 0.8 },
        ],
        modelUsed: 'gemini-3-flash-preview',
        warnings: [],
      }),
    };
    service = new StorySegmentationService(prisma as any, llm as any);
    service.pollMs = 1;
    service.claimMs = 50;
    prisma.story.findUnique.mockResolvedValue(storyRow());
    prisma.story.updateMany.mockResolvedValue({ count: 1 });
  });

  it('404 for a missing story', async () => {
    prisma.story.findUnique.mockResolvedValue(null);
    await expect(service.ensureSegments('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stored segments are reused: no claim, no Gemini', async () => {
    prisma.story.findUnique.mockResolvedValue(
      storyRow({ preprocessedSegments: [{ text: 'Hazır.', emotion: 'calm' }], preprocessedModel: 'import', segmentationVersion: 1 }),
    );

    await expect(service.ensureSegments('story-1')).resolves.toEqual({
      segments: [{ text: 'Hazır.', emotion: 'calm' }],
      version: 1,
      source: 'import',
    });
    expect(prisma.story.updateMany).not.toHaveBeenCalled();
    expect(llm.preprocessStory).not.toHaveBeenCalled();
  });

  it('first request: claims against the version read, asks Gemini once, stores version + 1', async () => {
    const result = await service.ensureSegments('story-1');

    const claim = prisma.story.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: 'story-1', segmentationVersion: 0 });
    expect(claim.where.OR).toEqual([
      { segmentationLockedUntil: null },
      { segmentationLockedUntil: { lt: expect.any(Date) } },
    ]);
    expect(claim.data.segmentationLockedUntil).toBeInstanceOf(Date);
    expect(llm.preprocessStory).toHaveBeenCalledWith(CONTENT, 'tr');

    const write = prisma.story.updateMany.mock.calls[1][0];
    expect(write.where).toEqual({ id: 'story-1', segmentationVersion: 0 });
    expect(write.data).toMatchObject({
      preprocessedModel: 'gemini-3-flash-preview',
      segmentationVersion: 1,
      segmentationLockedUntil: null,
      preprocessedSegments: [
        { text: 'Bir varmış bir yokmuş. ', emotion: 'peaceful', speed: 0.82 },
        { text: 'Küçük bir tavşan varmış.', emotion: 'calm', speed: 0.8 },
      ],
    });
    expect(result).toMatchObject({ version: 1, source: 'gemini-3-flash-preview' });
    expect(result.segments).toHaveLength(2);
  });

  it('Gemini warnings are logged, the segments still stored', async () => {
    llm.preprocessStory.mockResolvedValueOnce({
      segments: [{ text: CONTENT, emotion: 'calm' }],
      modelUsed: 'm',
      warnings: ['1 kisa segment birlestirildi.'],
    });
    await expect(service.ensureSegments('story-1')).resolves.toMatchObject({ version: 1, source: 'm' });
  });

  it('a concurrent request waits for the holder and reuses its result (Gemini called once)', async () => {
    prisma.story.findUnique
      .mockResolvedValueOnce(storyRow())
      .mockResolvedValueOnce(storyRow())
      .mockResolvedValueOnce(
        storyRow({ preprocessedSegments: [{ text: CONTENT, emotion: 'calm' }], preprocessedModel: 'm', segmentationVersion: 1 }),
      );
    prisma.story.updateMany.mockResolvedValue({ count: 0 }); // claim held by someone else

    await expect(service.ensureSegments('story-1')).resolves.toEqual({
      segments: [{ text: CONTENT, emotion: 'calm' }],
      version: 1,
      source: 'm',
    });
    expect(llm.preprocessStory).not.toHaveBeenCalled();
  });

  it('a claim that never resolves: after the wait the narration uses the free split (not stored)', async () => {
    prisma.story.updateMany.mockResolvedValue({ count: 0 });
    service.claimMs = 5;

    const result = await service.ensureSegments('story-1');

    expect(result).toEqual({ segments: [{ text: CONTENT }], version: null, source: null });
    expect(llm.preprocessStory).not.toHaveBeenCalled();
  });

  it('Gemini not configured: free split for this narration only, claim released', async () => {
    llm.isConfigured.mockReturnValue(false);

    const result = await service.ensureSegments('story-1');

    expect(result).toEqual({ segments: [{ text: CONTENT }], version: null, source: null });
    expect(prisma.story.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'story-1' },
      data: { segmentationLockedUntil: null },
    });
  });

  it('a provider error is not stored (the next request tries Gemini again); a failed release is only logged', async () => {
    llm.preprocessStory.mockRejectedValue(new ServiceUnavailableException('Gemini 503'));
    prisma.story.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('db blip'));

    await expect(service.ensureSegments('story-1')).resolves.toMatchObject({ version: null });
    expect(prisma.story.updateMany).toHaveBeenCalledTimes(2);
  });

  it('content drift: the deterministic split is stored as fallback-split', async () => {
    llm.preprocessStory.mockRejectedValue(new LlmContentDriftError('drift', 3, 'x'));

    const result = await service.ensureSegments('story-1');

    expect(result).toEqual({ segments: [{ text: CONTENT }], version: 1, source: 'fallback-split' });
    expect(prisma.story.updateMany.mock.calls[1][0].data).toMatchObject({
      preprocessedModel: 'fallback-split',
      segmentationVersion: 1,
    });
  });

  it('unusable Gemini segments count as drift', async () => {
    llm.preprocessStory.mockResolvedValue({
      segments: [{ text: CONTENT, emotion: 'joyful' }],
      modelUsed: 'm',
      warnings: [],
    });

    await expect(service.ensureSegments('story-1')).resolves.toMatchObject({ source: 'fallback-split', version: 1 });
  });

  it('losing the write (an admin saved meanwhile): releases and reads the stored segments', async () => {
    prisma.story.findUnique
      .mockResolvedValueOnce(storyRow())
      .mockResolvedValueOnce(
        storyRow({ preprocessedSegments: [{ text: 'Elle.' }], preprocessedModel: 'manual', segmentationVersion: 1 }),
      );
    prisma.story.updateMany
      .mockResolvedValueOnce({ count: 1 }) // claim
      .mockResolvedValueOnce({ count: 0 }) // conditional write lost
      .mockResolvedValueOnce({ count: 1 }); // release

    await expect(service.ensureSegments('story-1')).resolves.toEqual({
      segments: [{ text: 'Elle.' }],
      version: 1,
      source: 'manual',
    });
  });
});
