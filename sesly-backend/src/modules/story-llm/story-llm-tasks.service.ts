import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { LlmPreprocessingService } from '../llm-preprocessing/llm-preprocessing.service';
import { PaginationHelper } from '../../common/utils/pagination.helper';
import { turkishLanguageName } from '../../common/constants/content-languages';
import {
  AgeGroupSource,
  LanguageLevelSource,
  StoryLlmTaskStatus,
  StoryLlmTaskType,
  StoryStatus,
  TranslationMethod,
} from '../../common/enums/prisma.enums';
import {
  AGE_GROUP_IS_MANUAL_MESSAGE,
  LEVEL_IS_MANUAL_MESSAGE,
  STORY_LLM_BATCH_MAX,
  STORY_LLM_JOB,
  STORY_LLM_ORPHAN_MESSAGE,
  STORY_LLM_ORPHAN_PENDING_MS,
  STORY_LLM_QUEUE,
  STORY_LLM_QUEUE_FAILED_MESSAGE,
  STORY_LLM_STALE_MESSAGE,
  STORY_LLM_STALE_RUNNING_MS,
  StoryLlmJob,
  storyLlmJobOptions,
} from './story-llm.constants';

/** A task as the admin API returns it. */
export interface StoryLlmTaskView {
  id: string;
  storyId: string;
  type: StoryLlmTaskType;
  targetLanguage: string | null;
  status: StoryLlmTaskStatus;
  error: string | null;
  resultStoryId: string | null;
  result: unknown;
  createdByAdminId: string | null;
  force: boolean;
  attempts: number;
  model: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BatchSkip {
  storyId: string;
  code: string;
  reason: string;
}

export interface BatchQueued {
  storyId: string;
  taskId: string;
}

export interface TaskListQuery {
  page?: number;
  limit?: number;
  storyId?: string;
  status?: StoryLlmTaskStatus;
  type?: StoryLlmTaskType;
}

interface StoryForTask {
  id: string;
  title: string;
  content: string;
  language: string;
  translationGroupId: string | null;
  languageLevel: string | null;
  languageLevelSource: string | null;
  ageGroupSource: string | null;
}

const STORY_FOR_TASK_SELECT = {
  id: true,
  title: true,
  content: true,
  language: true,
  translationGroupId: true,
  languageLevel: true,
  languageLevelSource: true,
  ageGroupSource: true,
} as const;

const ACTIVE: StoryLlmTaskStatus[] = [StoryLlmTaskStatus.PENDING, StoryLlmTaskStatus.RUNNING];

const ACTIVE_TASK_MESSAGES: Record<StoryLlmTaskType, string> = {
  TRANSLATE: 'Bu masal için aynı dile bir çeviri görevi zaten sırada ya da çalışıyor.',
  ASSESS_LEVEL: 'Bu masal için bir seviye değerlendirmesi zaten sırada ya da çalışıyor.',
  ASSESS_AGE_GROUP: 'Bu masal için bir yaş grubu değerlendirmesi zaten sırada ya da çalışıyor.',
};

const TASK_LIST_INCLUDE = {
  story: { select: { id: true, title: true, language: true } },
  resultStory: { select: { id: true, title: true, language: true, status: true } },
} as const;

/**
 * Bookkeeping of background LLM work on stories. A task is a row in
 * `story_llm_tasks` plus a Bull job that points at it; StoryLlmProcessor
 * runs it. This service decides whether a task may be created (the admin
 * endpoints), creates and enqueues it, lists tasks, and fires the automatic
 * level-assessment triggers.
 */
@Injectable()
export class StoryLlmTasksService {
  private readonly logger = new Logger(StoryLlmTasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly llm: LlmPreprocessingService,
    @InjectQueue(STORY_LLM_QUEUE) private readonly queue: Queue<StoryLlmJob>,
  ) {}

  // ---------------------------------------------------------------------
  // Translation
  // ---------------------------------------------------------------------

  /** POST /admin/stories/:id/translate */
  async requestTranslation(
    storyId: string,
    targetLanguage: string,
    options: { replaceDraft?: boolean; adminId?: string | null } = {},
  ): Promise<StoryLlmTaskView> {
    this.assertLlmConfigured();
    const story = await this.loadStory(storyId);
    return this.createTranslationTask(story, targetLanguage, options);
  }

  /**
   * POST /admin/stories/translate-batch. Every eligible story gets a task;
   * the others are reported with the reason they were skipped. A draft
   * machine translation is never replaced by a batch.
   */
  async requestTranslationBatch(
    storyIds: string[],
    targetLanguage: string,
    adminId?: string | null,
  ): Promise<{ targetLanguage: string; queued: BatchQueued[]; skipped: BatchSkip[] }> {
    this.assertLlmConfigured();
    const ids = [...new Set(storyIds)];
    const stories = await this.prisma.story.findMany({
      where: { id: { in: ids } },
      select: STORY_FOR_TASK_SELECT,
    });
    const byId = new Map(stories.map((s) => [s.id, s as StoryForTask]));

    const queued: BatchQueued[] = [];
    const skipped: BatchSkip[] = [];
    for (const id of ids) {
      const story = byId.get(id);
      if (!story) {
        skipped.push({ storyId: id, code: 'STORY_NOT_FOUND', reason: 'Masal bulunamadı.' });
        continue;
      }
      try {
        const task = await this.createTranslationTask(story, targetLanguage, { adminId });
        queued.push({ storyId: id, taskId: task.id });
      } catch (error) {
        skipped.push(this.toSkip(id, error));
      }
    }
    return { targetLanguage, queued, skipped };
  }

  private async createTranslationTask(
    story: StoryForTask,
    targetLanguage: string,
    options: { replaceDraft?: boolean; adminId?: string | null },
  ): Promise<StoryLlmTaskView> {
    if (story.language === targetLanguage) {
      throw new BadRequestException({
        code: 'TRANSLATE_SAME_LANGUAGE',
        message: `Masal zaten ${turkishLanguageName(targetLanguage)}. Hedef dil kaynak dilden farklı olmalıdır.`,
      });
    }
    this.assertHasContent(story);

    const sibling = story.translationGroupId
      ? await this.prisma.story.findFirst({
          where: { translationGroupId: story.translationGroupId, language: targetLanguage },
          select: { id: true, title: true, status: true, translationMethod: true },
        })
      : null;
    if (sibling) {
      const replaceable =
        sibling.status === StoryStatus.DRAFT &&
        sibling.translationMethod === TranslationMethod.MACHINE;
      if (!(replaceable && options.replaceDraft)) {
        const language = turkishLanguageName(targetLanguage);
        throw new ConflictException({
          code: 'TRANSLATION_EXISTS',
          message: replaceable
            ? `Bu masalın ${language} taslak makine çevirisi zaten var: ${sibling.title}. Yeniden üretilmesi için taslağın değiştirilmesine izin verilmelidir.`
            : `Bu masalın ${language} çevirisi zaten var: ${sibling.title}.`,
          storyId: sibling.id,
          replaceable,
        });
      }
    }

    await this.assertNoActiveTask(story.id, StoryLlmTaskType.TRANSLATE, targetLanguage, ACTIVE);

    return this.createAndEnqueue({
      storyId: story.id,
      type: StoryLlmTaskType.TRANSLATE,
      targetLanguage,
      force: !!(sibling && options.replaceDraft),
      createdByAdminId: options.adminId ?? null,
    });
  }

  // ---------------------------------------------------------------------
  // Level assessment
  // ---------------------------------------------------------------------

  /** POST /admin/stories/:id/level/assess */
  async requestLevelAssessment(
    storyId: string,
    options: { force?: boolean; adminId?: string | null } = {},
  ): Promise<StoryLlmTaskView> {
    this.assertLlmConfigured();
    const story = await this.loadStory(storyId);
    return this.createAssessmentTask(story, {
      force: !!options.force,
      adminId: options.adminId ?? null,
      blockOn: ACTIVE,
    });
  }

  /**
   * POST /admin/stories/level/assess-batch. With `storyIds` only those
   * stories are considered, otherwise every story (of `language` when
   * given). `onlyMissing` leaves out stories that already have a level. A
   * MANUAL level is never overwritten by a batch.
   */
  async requestLevelAssessmentBatch(
    filter: { storyIds?: string[]; language?: string; onlyMissing?: boolean },
    adminId?: string | null,
  ): Promise<{ matched: number; queued: BatchQueued[]; skipped: BatchSkip[] }> {
    this.assertLlmConfigured();
    const ids = filter.storyIds && filter.storyIds.length > 0 ? [...new Set(filter.storyIds)] : null;

    const where: Record<string, unknown> = {};
    if (ids) where.id = { in: ids };
    if (filter.language) where.language = filter.language;
    if (filter.onlyMissing) where.languageLevel = null;

    const [stories, matched] = await Promise.all([
      this.prisma.story.findMany({
        where,
        select: STORY_FOR_TASK_SELECT,
        orderBy: { createdAt: 'asc' },
        take: STORY_LLM_BATCH_MAX,
      }),
      this.prisma.story.count({ where }),
    ]);

    const queued: BatchQueued[] = [];
    const skipped: BatchSkip[] = [];

    if (ids) {
      const found = new Set(stories.map((s) => s.id));
      for (const id of ids) {
        if (!found.has(id)) {
          // Missing, or left out by the language / onlyMissing filter.
          skipped.push({
            storyId: id,
            code: 'NOT_MATCHED',
            reason: 'Masal bulunamadı ya da seçilen filtreye uymuyor.',
          });
        }
      }
    }

    for (const story of stories as StoryForTask[]) {
      try {
        const task = await this.createAssessmentTask(story, {
          force: false,
          adminId: adminId ?? null,
          blockOn: ACTIVE,
        });
        queued.push({ storyId: story.id, taskId: task.id });
      } catch (error) {
        skipped.push(this.toSkip(story.id, error));
      }
    }
    return { matched, queued, skipped };
  }

  private async createAssessmentTask(
    story: StoryForTask,
    options: { force: boolean; adminId: string | null; blockOn: StoryLlmTaskStatus[] },
  ): Promise<StoryLlmTaskView> {
    if (story.languageLevelSource === LanguageLevelSource.MANUAL && !options.force) {
      throw new ConflictException({ code: 'LEVEL_IS_MANUAL', message: LEVEL_IS_MANUAL_MESSAGE });
    }
    this.assertHasContent(story);
    await this.assertNoActiveTask(story.id, StoryLlmTaskType.ASSESS_LEVEL, null, options.blockOn);

    return this.createAndEnqueue({
      storyId: story.id,
      type: StoryLlmTaskType.ASSESS_LEVEL,
      targetLanguage: null,
      force: options.force,
      createdByAdminId: options.adminId,
    });
  }

  // ---------------------------------------------------------------------
  // Age group assessment
  // ---------------------------------------------------------------------

  /** POST /admin/stories/:id/age-group/assess */
  async requestAgeGroupAssessment(
    storyId: string,
    options: { force?: boolean; adminId?: string | null } = {},
  ): Promise<StoryLlmTaskView> {
    this.assertLlmConfigured();
    const story = await this.loadStory(storyId);
    return this.createAgeGroupTask(story, {
      force: !!options.force,
      adminId: options.adminId ?? null,
      blockOn: ACTIVE,
    });
  }

  private async createAgeGroupTask(
    story: StoryForTask,
    options: { force: boolean; adminId: string | null; blockOn: StoryLlmTaskStatus[] },
  ): Promise<StoryLlmTaskView> {
    if (story.ageGroupSource === AgeGroupSource.MANUAL && !options.force) {
      throw new ConflictException({ code: 'AGE_GROUP_IS_MANUAL', message: AGE_GROUP_IS_MANUAL_MESSAGE });
    }
    this.assertHasContent(story);
    await this.assertNoActiveTask(story.id, StoryLlmTaskType.ASSESS_AGE_GROUP, null, options.blockOn);

    return this.createAndEnqueue({
      storyId: story.id,
      type: StoryLlmTaskType.ASSESS_AGE_GROUP,
      targetLanguage: null,
      force: options.force,
      createdByAdminId: options.adminId,
    });
  }

  // ---------------------------------------------------------------------
  // Automatic triggers
  // ---------------------------------------------------------------------

  /**
   * Queue a level assessment for a story that was created, translated or
   * had its text changed. Fire and forget: callers do not await it and it
   * never throws, so it can neither fail nor slow the request that caused
   * it. Does nothing when the `llm.autoAssessLevel` setting is off, when
   * Gemini is not configured, or when the level was set by hand.
   *
   * A task that is already RUNNING does not block a new one here: it may
   * be reading the text as it was before the change.
   */
  async triggerAutoAssess(storyId: string, reason: string): Promise<void> {
    try {
      if (!this.autoAssessEnabled()) return;
      const story = (await this.prisma.story.findUnique({
        where: { id: storyId },
        select: STORY_FOR_TASK_SELECT,
      })) as StoryForTask | null;
      if (!story) return;
      await this.createAssessmentTask(story, {
        force: false,
        adminId: null,
        blockOn: [StoryLlmTaskStatus.PENDING],
      });
      this.logger.log(`Level assessment queued for story ${storyId} (${reason})`);
    } catch (error) {
      this.logSkippedTrigger(storyId, reason, error);
    }
  }

  /**
   * After seeding: queue a level assessment for every story that has no
   * level yet. Same guarantees as triggerAutoAssess.
   */
  async triggerAutoAssessMissing(reason: string): Promise<void> {
    try {
      if (!this.autoAssessEnabled()) return;
      const stories = (await this.prisma.story.findMany({
        where: { languageLevel: null },
        select: STORY_FOR_TASK_SELECT,
        orderBy: { createdAt: 'asc' },
        take: STORY_LLM_BATCH_MAX,
      })) as StoryForTask[];
      let queued = 0;
      for (const story of stories) {
        try {
          await this.createAssessmentTask(story, { force: false, adminId: null, blockOn: ACTIVE });
          queued++;
        } catch (error) {
          this.logSkippedTrigger(story.id, reason, error);
        }
      }
      this.logger.log(`Level assessment queued for ${queued}/${stories.length} stories without a level (${reason})`);
    } catch (error) {
      this.logSkippedTrigger('*', reason, error);
    }
  }

  /**
   * Queue an age group assessment for a story that was created without an
   * age group (`newStory`) or had its text changed. Called next to
   * triggerAutoAssess and with the same guarantees (fire and forget, never
   * throws). Governed by the `llm.autoAssessAgeGroup` setting.
   *
   * An age group chosen by hand is left alone, and so is one of unknown
   * origin: rows older than the `ageGroupSource` column carry an age group
   * an editor picked (in the panel or the seed file) with no source
   * recorded. A text change therefore only re-assesses a story whose age
   * group the model decided (source AI) or was asked to decide before (an
   * age group task exists for it, for example a story created without one
   * whose first assessment failed). Anything else needs an explicit request
   * from the panel.
   */
  async triggerAutoAssessAgeGroup(
    storyId: string,
    reason: string,
    options: { newStory?: boolean } = {},
  ): Promise<void> {
    try {
      if (this.settings.get('llm.autoAssessAgeGroup') !== true || !this.llm.isConfigured()) return;
      const story = (await this.prisma.story.findUnique({
        where: { id: storyId },
        select: STORY_FOR_TASK_SELECT,
      })) as StoryForTask | null;
      if (!story) return;
      if (!options.newStory && !(await this.ageGroupBelongsToModel(story))) {
        this.logger.debug(
          `Auto age group assessment skipped for ${storyId} (${reason}): the age group was not chosen by the model`,
        );
        return;
      }
      await this.createAgeGroupTask(story, {
        force: false,
        adminId: null,
        blockOn: [StoryLlmTaskStatus.PENDING],
      });
      this.logger.log(`Age group assessment queued for story ${storyId} (${reason})`);
    } catch (error) {
      this.logSkippedTrigger(storyId, reason, error);
    }
  }

  /** True when the model decided the age group, or was asked to and has not yet. */
  private async ageGroupBelongsToModel(story: StoryForTask): Promise<boolean> {
    if (story.ageGroupSource === AgeGroupSource.AI) return true;
    if (story.ageGroupSource) return false;
    const asked = await this.prisma.storyLlmTask.findFirst({
      where: { storyId: story.id, type: StoryLlmTaskType.ASSESS_AGE_GROUP },
      select: { id: true },
    });
    return !!asked;
  }

  private autoAssessEnabled(): boolean {
    return this.settings.get('llm.autoAssessLevel') === true && this.llm.isConfigured();
  }

  private logSkippedTrigger(storyId: string, reason: string, error: unknown): void {
    // A coded 4xx is an expected "not eligible" (manual level, task already
    // queued); anything else is worth a warning.
    if (error instanceof HttpException && error.getStatus() < 500) {
      this.logger.debug(`Auto assessment skipped for ${storyId} (${reason}): ${error.message}`);
      return;
    }
    this.logger.warn(
      `Auto assessment could not be queued for ${storyId} (${reason}): ${(error as Error)?.message ?? error}`,
    );
  }

  // ---------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------

  /** GET /admin/stories/llm-tasks, newest first. */
  async listTasks(query: TaskListQuery = {}) {
    await this.failStaleRunning();

    const { page, limit } = PaginationHelper.normalizePaginationParams(query.page, query.limit);
    const where: Record<string, unknown> = {};
    if (query.storyId) where.storyId = query.storyId;
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;

    const [tasks, total] = await Promise.all([
      this.prisma.storyLlmTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: PaginationHelper.calculateOffset(page, limit),
        take: limit,
        include: TASK_LIST_INCLUDE,
      }),
      this.prisma.storyLlmTask.count({ where }),
    ]);
    return PaginationHelper.createPaginatedResponse(tasks, total, page, limit);
  }

  // ---------------------------------------------------------------------
  // Shared
  // ---------------------------------------------------------------------

  private assertLlmConfigured(): void {
    if (!this.llm.isConfigured()) {
      throw new ServiceUnavailableException({
        code: 'LLM_NOT_CONFIGURED',
        message: 'Gemini API anahtarı sunucuda tanımlı değil. Görev başlatılamadı.',
      });
    }
  }

  private async loadStory(storyId: string): Promise<StoryForTask> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: STORY_FOR_TASK_SELECT,
    });
    if (!story) {
      throw new NotFoundException({ code: 'STORY_NOT_FOUND', message: 'Masal bulunamadı.' });
    }
    return story as StoryForTask;
  }

  private assertHasContent(story: StoryForTask): void {
    if (!story.content || !story.content.trim()) {
      throw new BadRequestException({ code: 'STORY_EMPTY', message: 'Masalın metni boş.' });
    }
  }

  /** Dead RUNNING tasks become FAILED so they stop showing as "in progress" and stop blocking. */
  private async failStaleRunning(): Promise<void> {
    const swept = await this.prisma.storyLlmTask.updateMany({
      where: {
        status: StoryLlmTaskStatus.RUNNING,
        updatedAt: { lt: new Date(Date.now() - STORY_LLM_STALE_RUNNING_MS) },
      },
      data: {
        status: StoryLlmTaskStatus.FAILED,
        error: STORY_LLM_STALE_MESSAGE,
        finishedAt: new Date(),
      },
    });
    if (swept.count > 0) {
      this.logger.warn(`${swept.count} stuck RUNNING story LLM task(s) marked FAILED`);
    }
  }

  /**
   * 409 when the same work is already queued or running. Dead tasks are
   * cleared first: a RUNNING one that went silent, and a PENDING one whose
   * Bull job is gone.
   */
  private async assertNoActiveTask(
    storyId: string,
    type: StoryLlmTaskType,
    targetLanguage: string | null,
    blockOn: StoryLlmTaskStatus[],
  ): Promise<void> {
    await this.failStaleRunning();

    const active = await this.prisma.storyLlmTask.findFirst({
      where: { storyId, type, targetLanguage, status: { in: blockOn } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, createdAt: true },
    });
    if (!active) return;

    if (active.status === StoryLlmTaskStatus.PENDING && (await this.isOrphan(active))) {
      await this.prisma.storyLlmTask.updateMany({
        where: { id: active.id, status: StoryLlmTaskStatus.PENDING },
        data: {
          status: StoryLlmTaskStatus.FAILED,
          error: STORY_LLM_ORPHAN_MESSAGE,
          finishedAt: new Date(),
        },
      });
      this.logger.warn(`Orphan PENDING story LLM task ${active.id} marked FAILED`);
      return;
    }

    throw new ConflictException({
      code: 'STORY_LLM_TASK_ACTIVE',
      message: ACTIVE_TASK_MESSAGES[type],
      taskId: active.id,
    });
  }

  /** A PENDING task that is old enough to have been picked up and has no Bull job any more. */
  private async isOrphan(task: { id: string; createdAt: Date }): Promise<boolean> {
    if (Date.now() - task.createdAt.getTime() < STORY_LLM_ORPHAN_PENDING_MS) return false;
    try {
      return !(await this.queue.getJob(task.id));
    } catch {
      // Queue unreachable: cannot tell, so the task keeps counting as active.
      return false;
    }
  }

  private async createAndEnqueue(data: {
    storyId: string;
    type: StoryLlmTaskType;
    targetLanguage: string | null;
    force: boolean;
    createdByAdminId: string | null;
  }): Promise<StoryLlmTaskView> {
    const task = await this.prisma.storyLlmTask.create({ data });
    try {
      await this.queue.add(STORY_LLM_JOB, { taskId: task.id }, storyLlmJobOptions(task.id));
    } catch (error) {
      this.logger.error(`Could not queue story LLM task ${task.id}`, error as Error);
      await this.prisma.storyLlmTask
        .update({
          where: { id: task.id },
          data: {
            status: StoryLlmTaskStatus.FAILED,
            error: STORY_LLM_QUEUE_FAILED_MESSAGE,
            finishedAt: new Date(),
          },
        })
        .catch(() => undefined);
      throw new ServiceUnavailableException({
        code: 'STORY_LLM_QUEUE_UNAVAILABLE',
        message: 'Görev şu anda kuyruğa eklenemiyor. Lütfen biraz sonra tekrar deneyin.',
      });
    }
    return task as StoryLlmTaskView;
  }

  private toSkip(storyId: string, error: unknown): BatchSkip {
    if (error instanceof HttpException) {
      const body = error.getResponse();
      const code =
        typeof body === 'object' && body !== null && typeof (body as any).code === 'string'
          ? (body as any).code
          : 'ERROR';
      return { storyId, code, reason: error.message };
    }
    this.logger.error(`Story ${storyId} could not be queued`, error as Error);
    return { storyId, code: 'ERROR', reason: 'Beklenmeyen bir hata oluştu.' };
  }
}
