import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';
import {
  NarrationCacheClearResult,
  NarrationCacheService,
  NarrationCacheSummary,
} from '@modules/audio/narration-cache.service';
import {
  SEGMENTATION_SOURCE,
  StorySegment,
  compareSegmentsWithContent,
  normalizeStoredSegments,
  segmentProblems,
  segmentVocabulary,
  toStoredSegments,
} from '@modules/story-segmentation/story-segments';

const STORY_NOT_FOUND = 'Story not found';

export interface StorySegmentsView {
  storyId: string;
  /** Story.segmentationVersion (0: never segmented). */
  version: number;
  /** 'import' | 'manual' | 'fallback-split' | Gemini model id | null. */
  source: string | null;
  segmentedAt: Date | null;
  /** False: nothing stored yet, the first narration request segments the story. */
  stored: boolean;
  segments: StorySegment[];
  /** Whether the segments read the story text exactly (whitespace ignored). */
  matchesContent: boolean;
  contentDiff: string | null;
  defaultEmotion: string | null;
  defaultSpeed: number | null;
  vocabulary: ReturnType<typeof segmentVocabulary>;
  cache: NarrationCacheSummary;
}

/**
 * Admin segment editor and narration cache of a story
 * (`/admin/stories/:id/segments`, `/admin/stories/:id/narration-cache`).
 *
 * Saving segments bumps `segmentationVersion` and clears the story's
 * narration cache: every stored narration was made from the old segments.
 */
@Injectable()
export class AdminStorySegmentsService {
  private readonly logger = new Logger(AdminStorySegmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly narrationCache: NarrationCacheService,
  ) {}

  async getSegments(storyId: string): Promise<StorySegmentsView> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: {
        id: true,
        content: true,
        preprocessedSegments: true,
        preprocessedModel: true,
        preprocessedAt: true,
        segmentationVersion: true,
        defaultEmotion: true,
        defaultSpeed: true,
      },
    });
    if (!story) throw new NotFoundException(STORY_NOT_FOUND);

    const segments = normalizeStoredSegments(story.preprocessedSegments);
    const match = segments.length > 0 ? compareSegmentsWithContent(segments, story.content) : { matches: true };
    return {
      storyId,
      version: story.segmentationVersion,
      source: segments.length > 0 ? story.preprocessedModel : null,
      segmentedAt: segments.length > 0 ? story.preprocessedAt : null,
      stored: segments.length > 0,
      segments,
      matchesContent: match.matches,
      contentDiff: match.diff ?? null,
      defaultEmotion: story.defaultEmotion ?? null,
      defaultSpeed: story.defaultSpeed ?? null,
      vocabulary: segmentVocabulary(),
      cache: await this.narrationCache.summary(storyId),
    };
  }

  /**
   * Replaces the segments (the editor sends the whole list after a split,
   * merge, reorder or text / tag edit). `expectedVersion`, when sent, must
   * be the version the editor loaded: 409 SEGMENTS_VERSION_CONFLICT when
   * someone (or the first narration request) wrote segments meanwhile.
   */
  async saveSegments(
    storyId: string,
    segments: StorySegment[],
    expectedVersion?: number,
  ): Promise<StorySegmentsView & { cacheCleared: NarrationCacheClearResult }> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, segmentationVersion: true },
    });
    if (!story) throw new NotFoundException(STORY_NOT_FOUND);

    const problems = segmentProblems(segments);
    if (problems.length > 0) {
      throw new BadRequestException({
        code: 'SEGMENTS_INVALID',
        message: `Segmentler kaydedilemedi: ${problems[0]}`,
        problems,
      });
    }
    if (expectedVersion !== undefined && expectedVersion !== story.segmentationVersion) {
      throw this.versionConflict(story.segmentationVersion);
    }

    const written = await this.prisma.story.updateMany({
      where: { id: storyId, segmentationVersion: story.segmentationVersion },
      data: {
        preprocessedSegments: toStoredSegments(segments) as any,
        preprocessedAt: new Date(),
        preprocessedModel: SEGMENTATION_SOURCE.MANUAL,
        segmentationVersion: story.segmentationVersion + 1,
        segmentationLockedUntil: null,
      },
    });
    if (written.count === 0) {
      const current = await this.prisma.story.findUnique({
        where: { id: storyId },
        select: { segmentationVersion: true },
      });
      throw this.versionConflict(current?.segmentationVersion ?? story.segmentationVersion);
    }
    this.logger.log(
      `Story ${storyId} segments saved by hand: ${segments.length} segments, version ${story.segmentationVersion + 1}`,
    );

    const cacheCleared = await this.narrationCache.clear(storyId, 'segments edited');
    return { ...(await this.getSegments(storyId)), cacheCleared };
  }

  async cacheSummary(storyId: string): Promise<NarrationCacheSummary> {
    return this.narrationCache.summary(storyId);
  }

  async clearCache(storyId: string, adminLabel?: string | null): Promise<NarrationCacheClearResult> {
    return this.narrationCache.clear(storyId, `admin request by ${adminLabel ?? 'unknown'}`);
  }

  private versionConflict(current: number) {
    return new ConflictException({
      code: 'SEGMENTS_VERSION_CONFLICT',
      message: 'Segmentler bu sırada değişti. Sayfayı yenileyip yeniden düzenleyin.',
      currentVersion: current,
    });
  }
}
