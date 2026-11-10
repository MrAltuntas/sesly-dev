import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LlmContentDriftError,
  LlmPreprocessingService,
} from '../llm-preprocessing/llm-preprocessing.service';
import {
  SEGMENTATION_SOURCE,
  StorySegment,
  normalizeStoredSegments,
  segmentProblems,
  splitStoryForTts,
  toStoredSegments,
} from './story-segments';

export interface ResolvedSegmentation {
  segments: StorySegment[];
  /** Story.segmentationVersion of these segments; null when not persisted. */
  version: number | null;
  /** 'import' | 'manual' | 'fallback-split' | Gemini model id. */
  source: string | null;
}

/** How long a first request may hold the segmentation claim. */
export const SEGMENTATION_CLAIM_MS = 3 * 60 * 1000;
/** How often a waiting request looks again. */
export const SEGMENTATION_POLL_MS = 2000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Segments of a story for narration, created on the first request.
 *
 * A story imported or created without segments is segmented the first
 * time someone asks for a narration: Gemini (the existing preprocessing
 * prompt, which also tags every segment with an emotion and a speed), and
 * the result is stored on the story and reused by every later request.
 *
 * Concurrency: the first request claims the story with a conditional
 * update (`segmentationLockedUntil`, compared with the version it read).
 * A concurrent request sees the claim and waits for the stored result, so
 * Gemini is called once. A claim older than SEGMENTATION_CLAIM_MS (a
 * crashed worker) is taken over. The write is conditional on the version
 * too, so an admin edit made meanwhile wins.
 *
 * Without Gemini (no key, provider error) the free deterministic splitter
 * is used for that narration and NOT stored, so a later request tries
 * Gemini again. When Gemini changed the text (content drift), the split
 * IS stored (as 'fallback-split'): asking again would cost the same and
 * fail the same; an admin can re-run Gemini or edit by hand.
 */
@Injectable()
export class StorySegmentationService {
  private readonly logger = new Logger(StorySegmentationService.name);

  /** Overridable in tests. */
  pollMs = SEGMENTATION_POLL_MS;
  claimMs = SEGMENTATION_CLAIM_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmPreprocessingService,
  ) {}

  async ensureSegments(storyId: string): Promise<ResolvedSegmentation> {
    const deadline = Date.now() + this.claimMs + this.pollMs;
    for (;;) {
      const story = await this.prisma.story.findUnique({
        where: { id: storyId },
        select: {
          id: true,
          content: true,
          language: true,
          preprocessedSegments: true,
          preprocessedModel: true,
          segmentationVersion: true,
        },
      });
      if (!story) throw new NotFoundException('Masal bulunamadı.');

      const stored = normalizeStoredSegments(story.preprocessedSegments);
      if (stored.length > 0) {
        return { segments: stored, version: story.segmentationVersion, source: story.preprocessedModel };
      }

      const now = new Date();
      const claim = await this.prisma.story.updateMany({
        where: {
          id: storyId,
          segmentationVersion: story.segmentationVersion,
          OR: [{ segmentationLockedUntil: null }, { segmentationLockedUntil: { lt: now } }],
        },
        data: { segmentationLockedUntil: new Date(now.getTime() + this.claimMs) },
      });
      if (claim.count === 1) {
        const result = await this.segmentClaimed(story);
        if (result) return result;
        continue; // someone else wrote segments meanwhile: read them
      }

      if (Date.now() > deadline) {
        // The holder neither finished nor released: narrate with the free
        // split rather than fail the user's request.
        this.logger.warn(`Segmentation of story ${storyId} still claimed; using the split for this narration`);
        return { segments: splitStoryForTts(story.content), version: null, source: null };
      }
      await sleep(this.pollMs);
    }
  }

  /**
   * Runs segmentation while holding the claim. Returns null when the write
   * lost against another writer (the caller reads the stored result).
   */
  private async segmentClaimed(story: {
    id: string;
    content: string;
    language: string;
    segmentationVersion: number;
  }): Promise<ResolvedSegmentation | null> {
    let segments: StorySegment[] | null = null;
    let source: string | null = null;
    let persist = true;

    try {
      if (!this.llm.isConfigured()) throw new Error('Gemini is not configured');
      const result = await this.llm.preprocessStory(story.content, story.language);
      segments = result.segments.map((s) => ({ ...s }));
      source = result.modelUsed;
      const problems = segmentProblems(segments);
      if (problems.length > 0) {
        throw new LlmContentDriftError(`Gemini segments unusable: ${problems[0]}`, 0, '');
      }
      if (result.warnings.length > 0) {
        this.logger.log(`Gemini segmentation of ${story.id}: ${result.warnings.join(' ')}`);
      }
    } catch (err: any) {
      segments = splitStoryForTts(story.content);
      source = SEGMENTATION_SOURCE.FALLBACK;
      persist = err instanceof LlmContentDriftError;
      this.logger.warn(
        `Gemini segmentation of story ${story.id} failed (${err?.message ?? err}); ` +
          (persist ? 'storing the deterministic split' : 'using the deterministic split for this narration only'),
      );
    }

    if (!persist) {
      await this.release(story.id);
      return { segments, version: null, source: null };
    }

    const written = await this.prisma.story.updateMany({
      where: { id: story.id, segmentationVersion: story.segmentationVersion },
      data: {
        preprocessedSegments: toStoredSegments(segments) as any,
        preprocessedAt: new Date(),
        preprocessedModel: source,
        segmentationVersion: story.segmentationVersion + 1,
        segmentationLockedUntil: null,
      },
    });
    if (written.count === 0) {
      await this.release(story.id);
      return null;
    }
    this.logger.log(
      `Story ${story.id} segmented on first narration: ${segments.length} segments (${source}), version ${story.segmentationVersion + 1}`,
    );
    return { segments, version: story.segmentationVersion + 1, source };
  }

  private async release(storyId: string): Promise<void> {
    await this.prisma.story
      .updateMany({ where: { id: storyId }, data: { segmentationLockedUntil: null } })
      .catch((err) => this.logger.warn(`Could not release segmentation claim of ${storyId}: ${err?.message ?? err}`));
  }
}
