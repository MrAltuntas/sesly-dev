import {
  BadGatewayException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { LlmPreprocessingService } from '../llm-preprocessing/llm-preprocessing.service';
import { LlmOutputRejectedError } from '../llm-preprocessing/translation-guards';
import {
  estimateDurationMinutes,
  turkishLanguageName,
} from '../../common/constants/content-languages';
import {
  AgeGroupSource,
  LanguageLevelSource,
  StoryLlmTaskStatus,
  StoryLlmTaskType,
  StoryStatus,
  StoryTextFidelity,
  TranslationMethod,
} from '../../common/enums/prisma.enums';
import { SLUG_FALLBACK, findFreeSlug, slugify } from '../../common/utils/slug';
import { splitStoryIntoChunks } from '../../common/utils/story-chunks';
import { extractStorageKey } from '../../common/utils/storage-key';
import { StoryLlmTasksService } from './story-llm-tasks.service';
import {
  AGE_GROUP_IS_MANUAL_MESSAGE,
  LEVEL_IS_MANUAL_MESSAGE,
  STORY_LLM_ATTEMPTS,
  STORY_LLM_JOB,
  STORY_LLM_QUEUE,
  StoryLlmJob,
} from './story-llm.constants';

/**
 * The task cannot succeed however often it is retried (story deleted, a
 * human translation appeared meanwhile, level set by hand). The message is
 * Turkish and is stored as the task's error.
 */
export class StoryLlmTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoryLlmTaskError';
  }
}

interface TaskRow {
  id: string;
  storyId: string;
  type: string;
  targetLanguage: string | null;
  status: string;
  force: boolean;
  startedAt: Date | null;
}

interface TaskOutcome {
  resultStoryId?: string;
  result: Record<string, unknown>;
  model: string;
}

const ERROR_MAX_CHARS = 1000;

const COVER_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

/**
 * Runs the tasks of the `story-llm` queue one at a time.
 *
 * State: PENDING -> RUNNING -> DONE | FAILED. A transient provider error
 * (429, 5xx, timeout, network) puts the task back to PENDING with the reason
 * and re-throws so Bull retries it (3 attempts, exponential backoff); the
 * last attempt marks it FAILED. Rejected model output (a failed translation
 * guard, an invalid level answer), a 4xx answer of the provider (bad model
 * name, depleted credits) and StoryLlmTaskError are permanent: the task is
 * FAILED at once and Bull does not retry.
 *
 * Every final write is conditional on the task still being RUNNING, so a
 * task that was swept as stuck is not resurrected by a late worker.
 */
@Processor(STORY_LLM_QUEUE)
export class StoryLlmProcessor {
  private readonly logger = new Logger(StoryLlmProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmPreprocessingService,
    private readonly storage: StorageService,
    private readonly tasks: StoryLlmTasksService,
  ) {}

  @Process(STORY_LLM_JOB)
  async handle(job: Job<StoryLlmJob>): Promise<void> {
    const { taskId } = job.data;
    const task = (await this.prisma.storyLlmTask.findUnique({
      where: { id: taskId },
    })) as TaskRow | null;

    if (!task) {
      this.logger.warn(`Story LLM task ${taskId} no longer exists, skipping`);
      return;
    }
    if (task.status === StoryLlmTaskStatus.DONE || task.status === StoryLlmTaskStatus.FAILED) {
      // Finished by an earlier attempt, or failed as stuck / orphaned.
      this.logger.warn(`Story LLM task ${taskId} is ${task.status}, skipping`);
      return;
    }

    const claimed = await this.prisma.storyLlmTask.updateMany({
      where: {
        id: taskId,
        status: { in: [StoryLlmTaskStatus.PENDING, StoryLlmTaskStatus.RUNNING] },
      },
      data: {
        status: StoryLlmTaskStatus.RUNNING,
        startedAt: task.startedAt ?? new Date(),
        attempts: { increment: 1 },
        error: null,
      },
    });
    if (claimed.count !== 1) return;

    try {
      if (!this.llm.isConfigured()) {
        throw new StoryLlmTaskError('Gemini API anahtarı sunucuda tanımlı değil.');
      }
      const outcome = await this.run(task);

      const finished = await this.prisma.storyLlmTask.updateMany({
        where: { id: taskId, status: StoryLlmTaskStatus.RUNNING },
        data: {
          status: StoryLlmTaskStatus.DONE,
          error: null,
          resultStoryId: outcome.resultStoryId ?? null,
          result: outcome.result as Prisma.InputJsonValue,
          model: outcome.model,
          finishedAt: new Date(),
        },
      });
      if (finished.count !== 1) {
        this.logger.warn(`Story LLM task ${taskId} finished after it was marked as stuck`);
      }
      this.logger.log(`Story LLM task ${taskId} (${task.type}) done`);
    } catch (error) {
      await this.handleFailure(job, task, error);
    }
  }

  private run(task: TaskRow): Promise<TaskOutcome> {
    switch (task.type) {
      case StoryLlmTaskType.TRANSLATE:
        return this.translate(task);
      case StoryLlmTaskType.ASSESS_AGE_GROUP:
        return this.assessAgeGroup(task);
      default:
        return this.assessLevel(task);
    }
  }

  // ---------------------------------------------------------------------
  // Failure handling
  // ---------------------------------------------------------------------

  private async handleFailure(job: Job<StoryLlmJob>, task: TaskRow, error: unknown): Promise<void> {
    const permanent =
      error instanceof LlmOutputRejectedError ||
      error instanceof StoryLlmTaskError ||
      this.isProviderClientError(error);
    const attempt = (job.attemptsMade ?? 0) + 1;
    const attempts = job.opts?.attempts ?? STORY_LLM_ATTEMPTS;
    const reason = this.readableError(error);

    if (!permanent && attempt < attempts) {
      await this.prisma.storyLlmTask.updateMany({
        where: { id: task.id, status: StoryLlmTaskStatus.RUNNING },
        data: {
          status: StoryLlmTaskStatus.PENDING,
          error: `Geçici hata, yeniden denenecek (deneme ${attempt}/${attempts}): ${reason}`.slice(
            0,
            ERROR_MAX_CHARS,
          ),
        },
      });
      this.logger.warn(`Story LLM task ${task.id} attempt ${attempt}/${attempts} failed: ${reason}`);
      // Re-thrown so Bull schedules the retry with backoff.
      throw error;
    }

    await this.prisma.storyLlmTask.updateMany({
      where: { id: task.id, status: StoryLlmTaskStatus.RUNNING },
      data: {
        status: StoryLlmTaskStatus.FAILED,
        error: reason.slice(0, ERROR_MAX_CHARS),
        finishedAt: new Date(),
      },
    });
    this.logger.error(`Story LLM task ${task.id} (${task.type}) failed: ${reason}`);
  }

  /**
   * Gemini answered 4xx (bad model name, depleted credits, revoked key):
   * the same request will fail again, so the task fails at once. 429 never
   * gets here (the client maps it to ServiceUnavailableException).
   */
  private isProviderClientError(error: unknown): boolean {
    return error instanceof BadGatewayException && /^Gemini 4\d\d:/.test(error.message);
  }

  private readableError(error: unknown): string {
    if (error instanceof LlmOutputRejectedError || error instanceof StoryLlmTaskError) {
      return error.message;
    }
    const message = (error as Error)?.message ?? String(error);
    if ((error as Error)?.name === 'AbortError') {
      return 'Gemini isteği zaman aşımına uğradı.';
    }
    if (error instanceof ServiceUnavailableException) {
      return `Gemini şu anda yanıt vermiyor ya da istek sınırına takıldı (${message}).`;
    }
    if (error instanceof BadGatewayException) {
      return `Gemini beklenmeyen bir yanıt verdi (${message}).`;
    }
    return `Beklenmeyen hata (${message}).`;
  }

  // ---------------------------------------------------------------------
  // Level assessment
  // ---------------------------------------------------------------------

  private async assessLevel(task: TaskRow): Promise<TaskOutcome> {
    const story = await this.prisma.story.findUnique({
      where: { id: task.storyId },
      select: { id: true, content: true, language: true, languageLevelSource: true },
    });
    if (!story) throw new StoryLlmTaskError('Masal bulunamadı (silinmiş olabilir).');
    if (story.languageLevelSource === LanguageLevelSource.MANUAL && !task.force) {
      throw new StoryLlmTaskError(LEVEL_IS_MANUAL_MESSAGE);
    }

    const assessment = await this.llm.assessLanguageLevel(story.content, story.language);

    // The level may have been set by hand while the model was thinking: the
    // write itself refuses to touch a MANUAL row unless the task is forced.
    const written = await this.prisma.story.updateMany({
      where: {
        id: story.id,
        ...(task.force
          ? {}
          : { OR: [{ languageLevelSource: null }, { languageLevelSource: LanguageLevelSource.AI }] }),
      },
      data: {
        languageLevel: assessment.level,
        languageLevelSource: LanguageLevelSource.AI,
        languageLevelNote: `${assessment.note} (Güven: %${Math.round(assessment.confidence * 100)})`,
        languageLevelAssessedAt: new Date(),
      },
    });
    if (written.count !== 1) {
      throw new StoryLlmTaskError(LEVEL_IS_MANUAL_MESSAGE);
    }

    return {
      result: {
        level: assessment.level,
        confidence: assessment.confidence,
        note: assessment.note,
      },
      model: assessment.modelUsed,
    };
  }

  // ---------------------------------------------------------------------
  // Age group assessment
  // ---------------------------------------------------------------------

  private async assessAgeGroup(task: TaskRow): Promise<TaskOutcome> {
    const story = await this.prisma.story.findUnique({
      where: { id: task.storyId },
      select: { id: true, content: true, language: true, ageGroupSource: true },
    });
    if (!story) throw new StoryLlmTaskError('Masal bulunamadı (silinmiş olabilir).');
    if (story.ageGroupSource === AgeGroupSource.MANUAL && !task.force) {
      throw new StoryLlmTaskError(AGE_GROUP_IS_MANUAL_MESSAGE);
    }

    const assessment = await this.llm.assessAgeGroup(story.content, story.language);

    // Same rule as the level: an age group chosen by hand while the model
    // was thinking is not overwritten unless the task is forced.
    const written = await this.prisma.story.updateMany({
      where: {
        id: story.id,
        ...(task.force
          ? {}
          : { OR: [{ ageGroupSource: null }, { ageGroupSource: AgeGroupSource.AI }] }),
      },
      data: {
        ageGroup: assessment.ageGroup,
        ageGroupSource: AgeGroupSource.AI,
        ageGroupNote: `${assessment.note} (Güven: %${Math.round(assessment.confidence * 100)})`,
        ageGroupAssessedAt: new Date(),
      },
    });
    if (written.count !== 1) {
      throw new StoryLlmTaskError(AGE_GROUP_IS_MANUAL_MESSAGE);
    }

    return {
      result: {
        ageGroup: assessment.ageGroup,
        confidence: assessment.confidence,
        note: assessment.note,
      },
      model: assessment.modelUsed,
    };
  }

  // ---------------------------------------------------------------------
  // Translation
  // ---------------------------------------------------------------------

  private async translate(task: TaskRow): Promise<TaskOutcome> {
    const target = task.targetLanguage;
    if (!target) throw new StoryLlmTaskError('Çeviri görevinde hedef dil yok.');

    const source = await this.prisma.story.findUnique({ where: { id: task.storyId } });
    if (!source) throw new StoryLlmTaskError('Masal bulunamadı (silinmiş olabilir).');
    if (source.language === target) {
      throw new StoryLlmTaskError(`Masal zaten ${turkishLanguageName(target)}.`);
    }

    // Checked again here: the request was accepted minutes (or a retry) ago.
    const replace = await this.replaceableSibling(source.translationGroupId, target, task.force);

    const translation = await this.llm.translateStory(
      {
        title: source.title,
        summary: source.summary,
        content: source.content,
        language: source.language,
      },
      target,
    );

    const result = {
      title: translation.title,
      sourceParagraphs: translation.sourceParagraphs,
      translatedParagraphs: translation.translatedParagraphs,
      lengthRatio: translation.lengthRatio,
      replaced: !!replace,
    };

    let storyId: string;
    try {
      storyId = replace
        ? await this.replaceDraft(replace.id, translation, target)
        : await this.createTranslation(source, translation, target);
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        // unique (translationGroupId, language): another translation won the race.
        throw new StoryLlmTaskError(
          `Bu masalın ${turkishLanguageName(target)} çevirisi bu sırada başka bir yoldan oluşturuldu.`,
        );
      }
      throw error;
    }

    // A fresh text needs a level. Not awaited: the trigger never throws.
    void this.tasks.triggerAutoAssess(storyId, 'translation');

    return { resultStoryId: storyId, result, model: translation.modelUsed };
  }

  /**
   * The story of the source's group that already is in the target language
   * and may be overwritten, or null when there is none. Throws when one
   * exists that must not be touched (anything but a DRAFT machine
   * translation, or the request did not ask for a replacement).
   */
  private async replaceableSibling(
    groupId: string | null,
    target: string,
    force: boolean,
  ): Promise<{ id: string } | null> {
    if (!groupId) return null;
    const sibling = await this.prisma.story.findFirst({
      where: { translationGroupId: groupId, language: target },
      select: { id: true, title: true, status: true, translationMethod: true },
    });
    if (!sibling) return null;
    const replaceable =
      sibling.status === StoryStatus.DRAFT && sibling.translationMethod === TranslationMethod.MACHINE;
    if (!(replaceable && force)) {
      throw new StoryLlmTaskError(
        `Bu masalın ${turkishLanguageName(target)} çevirisi zaten var: ${sibling.title}.`,
      );
    }
    return { id: sibling.id };
  }

  private async createTranslation(
    source: Record<string, any>,
    translation: { title: string; summary: string | null; content: string },
    target: string,
  ): Promise<string> {
    // The translation joins the source's group; a source without one starts it.
    let groupId: string | null = source.translationGroupId;
    if (!groupId) {
      groupId = uuidv4();
      await this.prisma.story.update({
        where: { id: source.id },
        data: { translationGroupId: groupId },
      });
    }

    const slug = await this.freeSlug(translation.title, target, source.slug);
    const coverImageUrl = await this.copyCover(source.coverImageUrl);

    const story = await this.prisma.story.create({
      data: {
        title: translation.title,
        summary: translation.summary,
        content: translation.content,
        language: target,
        slug,
        // A human reviews a machine translation before it is published.
        status: StoryStatus.DRAFT,
        translationMethod: TranslationMethod.MACHINE,
        textFidelity: StoryTextFidelity.TRANSLATED,
        translatedFromId: source.id,
        translationGroupId: groupId,
        estimatedDuration: estimateDurationMinutes(translation.content, target),
        coverImageUrl,
        // The credit belongs to the picture copied above.
        ...(coverImageUrl && source.coverCredit ? { coverCredit: source.coverCredit } : {}),
        // Copied from the source.
        category: source.category,
        // The age band of a tale does not depend on its language: copied
        // together with who chose it, and not assessed again.
        ageGroup: source.ageGroup,
        ageGroupSource: source.ageGroupSource ?? null,
        ageGroupNote: source.ageGroupNote ?? null,
        ageGroupAssessedAt: source.ageGroupAssessedAt ?? null,
        // What happens in the tale does not change with the language either.
        contentWarnings: source.contentWarnings ?? [],
        isPremium: source.isPremium,
        defaultEmotion: source.defaultEmotion,
        defaultSpeed: source.defaultSpeed,
        originalTitle: source.originalTitle ?? source.title,
        originalLanguage: source.originalLanguage ?? source.language,
        authorName: source.authorName,
        authorDeathYear: source.authorDeathYear,
        collectorName: source.collectorName,
        collectorDeathYear: source.collectorDeathYear,
        adaptedBy: source.adaptedBy,
        firstPublishedYear: source.firstPublishedYear,
        editionYear: source.editionYear,
        sourceName: source.sourceName,
        sourceUrl: source.sourceUrl,
        origin: source.origin,
        sourceRetrievedAt: source.sourceRetrievedAt,
        rightsBasis: source.rightsBasis,
        rightsNote: source.rightsNote,
        licenseUrl: source.licenseUrl,
        licenseName: source.licenseName,
        sourceEdition: source.sourceEdition,
        attribution: source.attribution,
        tags: source.tags,
        // Deliberately NOT copied: translatorName / translatorDeathYear (the
        // source's human translator did not write this text), rightsVerifiedAt
        // / rightsVerifiedBy (a human verifies the new text), the pronunciation
        // dictionary and the preprocessed segments (both language specific).
        // Written with the story in one statement, so a retry never finds a
        // translation without its chunks.
        chunks: {
          create: splitStoryIntoChunks(translation.content).map((content, chunkIndex) => ({
            chunkIndex,
            content,
          })),
        },
      } as any,
    });

    return story.id;
  }

  /** Overwrites a DRAFT machine translation with a new one, keeping its id and slug. */
  private async replaceDraft(
    storyId: string,
    translation: { title: string; summary: string | null; content: string },
    target: string,
  ): Promise<string> {
    const replaced = await this.prisma.story.updateMany({
      // Conditional on the row still being a draft machine translation.
      where: { id: storyId, status: StoryStatus.DRAFT, translationMethod: TranslationMethod.MACHINE },
      data: {
        title: translation.title,
        summary: translation.summary,
        content: translation.content,
        estimatedDuration: estimateDurationMinutes(translation.content, target),
        // Written against the old text.
        preprocessedSegments: Prisma.JsonNull,
        preprocessedAt: null,
        preprocessedModel: null,
        languageLevel: null,
        languageLevelSource: null,
        languageLevelNote: null,
        languageLevelAssessedAt: null,
      },
    });
    if (replaced.count !== 1) {
      throw new StoryLlmTaskError(
        'Değiştirilecek taslak çeviri bu sırada yayınlandı, elle düzenlendi ya da silindi. Üzerine yazılmadı.',
      );
    }
    await this.prisma.storyChunk.deleteMany({ where: { storyId } });
    await this.prisma.storyChunk.createMany({
      data: splitStoryIntoChunks(translation.content).map((content, chunkIndex) => ({
        storyId,
        chunkIndex,
        content,
      })),
    });
    return storyId;
  }

  /**
   * Slug from the translated title. A title without Latin letters (Arabic,
   * Russian) has no usable slug of its own, so the source slug plus the
   * language code is used.
   */
  private async freeSlug(title: string, language: string, sourceSlug: string | null): Promise<string> {
    let base = slugify(title);
    if (base === SLUG_FALLBACK && sourceSlug) base = `${sourceSlug}-${language}`;
    return findFreeSlug(base, async (candidate) => {
      const hit = await this.prisma.story.findFirst({
        where: { slug: candidate, language },
        select: { id: true },
      });
      return !!hit;
    });
  }

  /**
   * The translation gets its OWN copy of the cover: deleting a story deletes
   * its cover object, which must not take the source's cover with it. An
   * external cover URL is shared as is. Never fails the task.
   */
  private async copyCover(coverImageUrl: string | null): Promise<string | null> {
    if (!coverImageUrl) return null;
    const key = extractStorageKey(coverImageUrl, this.storage.getBucketName());
    if (!key) {
      return /^https?:\/\//i.test(coverImageUrl) ? coverImageUrl : null;
    }
    try {
      const file = await this.storage.downloadFile(key);
      const name = (key.split('/').pop() as string).replace(/^[0-9a-f-]{36}-/i, '');
      const extension = (name.split('.').pop() as string).toLowerCase();
      return await this.storage.uploadFile(
        file,
        `stories/cover/${uuidv4()}-${name}`,
        COVER_CONTENT_TYPES[extension] ?? 'application/octet-stream',
      );
    } catch (error) {
      this.logger.warn(`Cover of the source story could not be copied: ${(error as Error)?.message}`);
      return null;
    }
  }
}
