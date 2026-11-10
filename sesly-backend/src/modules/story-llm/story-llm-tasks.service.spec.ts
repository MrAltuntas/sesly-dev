import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { StoryLlmTasksService } from './story-llm-tasks.service';
import {
  LEVEL_IS_MANUAL_MESSAGE,
  STORY_LLM_ATTEMPTS,
  STORY_LLM_BACKOFF_MS,
  STORY_LLM_BATCH_MAX,
  STORY_LLM_JOB,
  STORY_LLM_ORPHAN_MESSAGE,
  STORY_LLM_ORPHAN_PENDING_MS,
  STORY_LLM_QUEUE,
  STORY_LLM_QUEUE_FAILED_MESSAGE,
  STORY_LLM_STALE_MESSAGE,
  STORY_LLM_STALE_RUNNING_MS,
  storyLlmJobOptions,
} from './story-llm.constants';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createSettingsStub, SettingsStub } from '../../test-utils/settings-stub';

const NOW = new Date('2026-10-13T12:00:00.000Z');

const storyRow = (over: Record<string, any> = {}) => ({
  id: 's1',
  title: 'Keloğlan',
  content: 'Bir varmış bir yokmuş.',
  language: 'tr',
  translationGroupId: null,
  languageLevel: null,
  languageLevelSource: null,
  ...over,
});

const coded = async (promise: Promise<unknown>) => {
  const error: any = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e) => e,
  );
  return { error, body: error.getResponse?.() as Record<string, any> };
};

describe('StoryLlmTasksService', () => {
  let prisma: MockPrismaService;
  let settings: SettingsStub;
  let llm: { isConfigured: jest.Mock };
  let queue: { add: jest.Mock; getJob: jest.Mock };
  let service: StoryLlmTasksService;
  let taskSeq: number;

  const createdTask = (n = 0) => prisma.storyLlmTask.create.mock.calls[n][0].data;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    prisma = createMockPrismaService();
    settings = createSettingsStub();
    llm = { isConfigured: jest.fn().mockReturnValue(true) };
    queue = { add: jest.fn().mockResolvedValue({}), getJob: jest.fn().mockResolvedValue({ id: 'job' }) };
    service = new StoryLlmTasksService(prisma as any, settings as any, llm as any, queue as any);
    taskSeq = 0;

    prisma.story.findUnique.mockResolvedValue(storyRow());
    prisma.story.findFirst.mockResolvedValue(null);
    prisma.story.findMany.mockResolvedValue([]);
    prisma.story.count.mockResolvedValue(0);
    prisma.storyLlmTask.findFirst.mockResolvedValue(null);
    prisma.storyLlmTask.updateMany.mockResolvedValue({ count: 0 });
    prisma.storyLlmTask.update.mockResolvedValue({});
    prisma.storyLlmTask.create.mockImplementation(async ({ data }: any) => ({
      id: `task-${++taskSeq}`,
      status: 'PENDING',
      error: null,
      resultStoryId: null,
      result: null,
      attempts: 0,
      model: null,
      startedAt: null,
      finishedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      ...data,
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('job options: one job per task, 3 attempts with exponential backoff', () => {
    expect(STORY_LLM_QUEUE).toBe('story-llm');
    expect(storyLlmJobOptions('task-9')).toEqual({
      jobId: 'task-9',
      attempts: STORY_LLM_ATTEMPTS,
      backoff: { type: 'exponential', delay: STORY_LLM_BACKOFF_MS },
      removeOnComplete: true,
      removeOnFail: 100,
    });
    expect(STORY_LLM_ATTEMPTS).toBe(3);
  });

  // ---------------------------------------------------------------------
  describe('requestTranslation', () => {
    it('creates a PENDING task, enqueues it and returns it', async () => {
      const task = await service.requestTranslation('s1', 'en', { adminId: 'admin-1' });

      expect(createdTask()).toEqual({
        storyId: 's1',
        type: 'TRANSLATE',
        targetLanguage: 'en',
        force: false,
        createdByAdminId: 'admin-1',
      });
      expect(task).toMatchObject({ id: 'task-1', status: 'PENDING', type: 'TRANSLATE', targetLanguage: 'en' });
      expect(queue.add).toHaveBeenCalledWith(STORY_LLM_JOB, { taskId: 'task-1' }, storyLlmJobOptions('task-1'));
    });

    it('503 LLM_NOT_CONFIGURED when Gemini has no key; nothing is read or written', async () => {
      llm.isConfigured.mockReturnValue(false);

      const { error, body } = await coded(service.requestTranslation('s1', 'en'));

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(body).toEqual({
        code: 'LLM_NOT_CONFIGURED',
        message: 'Gemini API anahtarı sunucuda tanımlı değil. Görev başlatılamadı.',
      });
      expect(prisma.story.findUnique).not.toHaveBeenCalled();
      expect(prisma.storyLlmTask.create).not.toHaveBeenCalled();
    });

    it('404 when the story does not exist', async () => {
      prisma.story.findUnique.mockResolvedValue(null);

      const { error, body } = await coded(service.requestTranslation('nope', 'en'));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(body).toEqual({ code: 'STORY_NOT_FOUND', message: 'Masal bulunamadı.' });
    });

    it('400 TRANSLATE_SAME_LANGUAGE when the target is the story language', async () => {
      const { error, body } = await coded(service.requestTranslation('s1', 'tr'));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(body).toEqual({
        code: 'TRANSLATE_SAME_LANGUAGE',
        message: 'Masal zaten Türkçe. Hedef dil kaynak dilden farklı olmalıdır.',
      });
      expect(prisma.storyLlmTask.create).not.toHaveBeenCalled();
    });

    it.each(['', '   \n'])('400 STORY_EMPTY for a story without text (%p)', async (content) => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ content }));

      const { body } = await coded(service.requestTranslation('s1', 'en'));

      expect(body).toEqual({ code: 'STORY_EMPTY', message: 'Masalın metni boş.' });
    });

    it('a story without a translation group has no sibling to look for', async () => {
      await service.requestTranslation('s1', 'en');
      expect(prisma.story.findFirst).not.toHaveBeenCalled();
    });

    it('409 TRANSLATION_EXISTS when a sibling in that language exists (human or published)', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ translationGroupId: 'g1' }));
      prisma.story.findFirst.mockResolvedValue({
        id: 's-en',
        title: 'Keloglan',
        status: 'PUBLISHED',
        translationMethod: 'MACHINE',
      });

      const { error, body } = await coded(service.requestTranslation('s1', 'en', { replaceDraft: true }));

      expect(error).toBeInstanceOf(ConflictException);
      expect(body).toEqual({
        code: 'TRANSLATION_EXISTS',
        message: 'Bu masalın İngilizce çevirisi zaten var: Keloglan.',
        storyId: 's-en',
        replaceable: false,
      });
      expect(prisma.story.findFirst).toHaveBeenCalledWith({
        where: { translationGroupId: 'g1', language: 'en' },
        select: { id: true, title: true, status: true, translationMethod: true },
      });
      expect(prisma.storyLlmTask.create).not.toHaveBeenCalled();
    });

    it.each([
      ['a human draft', { status: 'DRAFT', translationMethod: 'HUMAN' }],
      ['a draft without a method', { status: 'DRAFT', translationMethod: null }],
      ['an archived machine translation', { status: 'ARCHIVED', translationMethod: 'MACHINE' }],
    ])('replaceDraft never replaces %s', async (_label, sibling) => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ translationGroupId: 'g1' }));
      prisma.story.findFirst.mockResolvedValue({ id: 's-en', title: 'Keloglan', ...sibling });

      const { body } = await coded(service.requestTranslation('s1', 'en', { replaceDraft: true }));

      expect(body.code).toBe('TRANSLATION_EXISTS');
      expect(body.replaceable).toBe(false);
    });

    it('a DRAFT machine translation: 409 says it is replaceable, replaceDraft queues a forced task', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ translationGroupId: 'g1' }));
      prisma.story.findFirst.mockResolvedValue({
        id: 's-en',
        title: 'Keloglan',
        status: 'DRAFT',
        translationMethod: 'MACHINE',
      });

      const { body } = await coded(service.requestTranslation('s1', 'en'));
      expect(body).toEqual({
        code: 'TRANSLATION_EXISTS',
        message:
          'Bu masalın İngilizce taslak makine çevirisi zaten var: Keloglan. ' +
          'Yeniden üretilmesi için taslağın değiştirilmesine izin verilmelidir.',
        storyId: 's-en',
        replaceable: true,
      });

      const task = await service.requestTranslation('s1', 'en', { replaceDraft: true });
      expect(task.force).toBe(true);
      expect(createdTask().createdByAdminId).toBeNull();
    });

    it('replaceDraft without a sibling is an ordinary (not forced) task', async () => {
      const task = await service.requestTranslation('s1', 'en', { replaceDraft: true });
      expect(task.force).toBe(false);
    });

    it('409 STORY_LLM_TASK_ACTIVE while the same translation is queued or running', async () => {
      prisma.storyLlmTask.findFirst.mockResolvedValue({ id: 'task-old', status: 'RUNNING', createdAt: NOW });

      const { error, body } = await coded(service.requestTranslation('s1', 'en'));

      expect(error).toBeInstanceOf(ConflictException);
      expect(body).toEqual({
        code: 'STORY_LLM_TASK_ACTIVE',
        message: 'Bu masal için aynı dile bir çeviri görevi zaten sırada ya da çalışıyor.',
        taskId: 'task-old',
      });
      expect(prisma.storyLlmTask.findFirst).toHaveBeenCalledWith({
        where: { storyId: 's1', type: 'TRANSLATE', targetLanguage: 'en', status: { in: ['PENDING', 'RUNNING'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, createdAt: true },
      });
      expect(prisma.storyLlmTask.create).not.toHaveBeenCalled();
    });

    it('a queue failure marks the task FAILED and answers 503', async () => {
      queue.add.mockRejectedValue(new Error('redis down'));

      const { error, body } = await coded(service.requestTranslation('s1', 'en'));

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(body.code).toBe('STORY_LLM_QUEUE_UNAVAILABLE');
      expect(prisma.storyLlmTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'FAILED', error: STORY_LLM_QUEUE_FAILED_MESSAGE, finishedAt: NOW },
      });
    });

    it('still answers 503 when the FAILED mark itself cannot be written', async () => {
      queue.add.mockRejectedValue(new Error('redis down'));
      prisma.storyLlmTask.update.mockRejectedValue(new Error('db down'));

      const { body } = await coded(service.requestTranslation('s1', 'en'));

      expect(body.code).toBe('STORY_LLM_QUEUE_UNAVAILABLE');
    });
  });

  // ---------------------------------------------------------------------
  describe('stuck and orphaned tasks never block a new one forever', () => {
    it('a RUNNING task that went silent is failed before the active check', async () => {
      prisma.storyLlmTask.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.requestTranslation('s1', 'en');

      expect(prisma.storyLlmTask.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'RUNNING',
          updatedAt: { lt: new Date(NOW.getTime() - STORY_LLM_STALE_RUNNING_MS) },
        },
        data: { status: 'FAILED', error: STORY_LLM_STALE_MESSAGE, finishedAt: NOW },
      });
      expect(prisma.storyLlmTask.create).toHaveBeenCalledTimes(1);
      expect(STORY_LLM_STALE_RUNNING_MS).toBe(30 * 60_000);
    });

    it('an old PENDING task whose Bull job is gone is failed and replaced', async () => {
      const createdAt = new Date(NOW.getTime() - STORY_LLM_ORPHAN_PENDING_MS - 1);
      prisma.storyLlmTask.findFirst.mockResolvedValue({ id: 'task-lost', status: 'PENDING', createdAt });
      queue.getJob.mockResolvedValue(null);

      const task = await service.requestTranslation('s1', 'en');

      expect(queue.getJob).toHaveBeenCalledWith('task-lost');
      expect(prisma.storyLlmTask.updateMany).toHaveBeenCalledWith({
        where: { id: 'task-lost', status: 'PENDING' },
        data: { status: 'FAILED', error: STORY_LLM_ORPHAN_MESSAGE, finishedAt: NOW },
      });
      expect(task.id).toBe('task-1');
    });

    it('an old PENDING task whose job still exists keeps blocking', async () => {
      const createdAt = new Date(NOW.getTime() - 60 * 60_000);
      prisma.storyLlmTask.findFirst.mockResolvedValue({ id: 'task-waiting', status: 'PENDING', createdAt });

      const { body } = await coded(service.requestTranslation('s1', 'en'));

      expect(body.taskId).toBe('task-waiting');
    });

    it('a fresh PENDING task is not checked against the queue (it may not be added yet)', async () => {
      prisma.storyLlmTask.findFirst.mockResolvedValue({ id: 'task-new', status: 'PENDING', createdAt: NOW });
      queue.getJob.mockResolvedValue(null);

      const { body } = await coded(service.requestTranslation('s1', 'en'));

      expect(body.code).toBe('STORY_LLM_TASK_ACTIVE');
      expect(queue.getJob).not.toHaveBeenCalled();
    });

    it('when the queue cannot be asked, the task keeps counting as active', async () => {
      const createdAt = new Date(NOW.getTime() - 60 * 60_000);
      prisma.storyLlmTask.findFirst.mockResolvedValue({ id: 'task-x', status: 'PENDING', createdAt });
      queue.getJob.mockRejectedValue(new Error('redis down'));

      const { body } = await coded(service.requestTranslation('s1', 'en'));

      expect(body.code).toBe('STORY_LLM_TASK_ACTIVE');
    });
  });

  // ---------------------------------------------------------------------
  describe('requestTranslationBatch', () => {
    it('queues every eligible story and reports the others with the reason', async () => {
      prisma.story.findMany.mockResolvedValue([
        storyRow({ id: 'ok-1' }),
        storyRow({ id: 'same', language: 'en' }),
        storyRow({ id: 'has', translationGroupId: 'g1' }),
        storyRow({ id: 'empty', content: ' ' }),
        storyRow({ id: 'ok-2' }),
      ]);
      prisma.story.findFirst.mockResolvedValue({
        id: 'sib',
        title: 'Sibling',
        status: 'DRAFT',
        translationMethod: 'MACHINE',
      });

      const result = await service.requestTranslationBatch(
        ['ok-1', 'same', 'has', 'missing', 'empty', 'ok-2', 'ok-1'],
        'en',
        'admin-1',
      );

      expect(prisma.story.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['ok-1', 'same', 'has', 'missing', 'empty', 'ok-2'] } },
        select: expect.any(Object),
      });
      expect(result.targetLanguage).toBe('en');
      expect(result.queued).toEqual([
        { storyId: 'ok-1', taskId: 'task-1' },
        { storyId: 'ok-2', taskId: 'task-2' },
      ]);
      expect(result.skipped).toEqual([
        {
          storyId: 'same',
          code: 'TRANSLATE_SAME_LANGUAGE',
          reason: 'Masal zaten İngilizce. Hedef dil kaynak dilden farklı olmalıdır.',
        },
        // A batch never replaces a draft, even a replaceable one.
        {
          storyId: 'has',
          code: 'TRANSLATION_EXISTS',
          reason: expect.stringContaining('taslak makine çevirisi zaten var: Sibling'),
        },
        { storyId: 'missing', code: 'STORY_NOT_FOUND', reason: 'Masal bulunamadı.' },
        { storyId: 'empty', code: 'STORY_EMPTY', reason: 'Masalın metni boş.' },
      ]);
      expect(createdTask(0).createdByAdminId).toBe('admin-1');
      expect(queue.add).toHaveBeenCalledTimes(2);
    });

    it('an unexpected error on one story does not stop the batch', async () => {
      prisma.story.findMany.mockResolvedValue([storyRow({ id: 'a' }), storyRow({ id: 'b' })]);
      prisma.storyLlmTask.create.mockRejectedValueOnce(new Error('db hiccup'));

      const result = await service.requestTranslationBatch(['a', 'b'], 'en');

      expect(result.skipped).toEqual([{ storyId: 'a', code: 'ERROR', reason: 'Beklenmeyen bir hata oluştu.' }]);
      expect(result.queued).toEqual([{ storyId: 'b', taskId: 'task-1' }]);
      expect(createdTask(1).createdByAdminId).toBeNull();
    });

    it('a coded error without a code is reported as ERROR with its message', async () => {
      prisma.story.findMany.mockResolvedValue([storyRow({ id: 'a' })]);
      prisma.storyLlmTask.create.mockRejectedValueOnce(new BadRequestException('düz mesaj'));

      const result = await service.requestTranslationBatch(['a'], 'en');

      expect(result.skipped).toEqual([{ storyId: 'a', code: 'ERROR', reason: 'düz mesaj' }]);
    });

    it('503 for the whole batch when Gemini is not configured', async () => {
      llm.isConfigured.mockReturnValue(false);
      await expect(service.requestTranslationBatch(['a'], 'en')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(prisma.story.findMany).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  describe('requestLevelAssessment', () => {
    it('queues an assessment for a story without a level or with an AI level', async () => {
      const task = await service.requestLevelAssessment('s1', { adminId: 'admin-1' });
      expect(createdTask()).toEqual({
        storyId: 's1',
        type: 'ASSESS_LEVEL',
        targetLanguage: null,
        force: false,
        createdByAdminId: 'admin-1',
      });
      expect(task.type).toBe('ASSESS_LEVEL');

      prisma.story.findUnique.mockResolvedValue(storyRow({ languageLevel: 'A2', languageLevelSource: 'AI' }));
      await expect(service.requestLevelAssessment('s1')).resolves.toMatchObject({ id: 'task-2' });
    });

    it('a MANUAL level is protected: 409 LEVEL_IS_MANUAL unless forced', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ languageLevel: 'B1', languageLevelSource: 'MANUAL' }));

      const { error, body } = await coded(service.requestLevelAssessment('s1'));
      expect(error).toBeInstanceOf(ConflictException);
      expect(body).toEqual({ code: 'LEVEL_IS_MANUAL', message: LEVEL_IS_MANUAL_MESSAGE });
      expect(prisma.storyLlmTask.create).not.toHaveBeenCalled();

      const forced = await service.requestLevelAssessment('s1', { force: true });
      expect(forced.force).toBe(true);
    });

    it('409 while an assessment is queued or running; 404, 400 and 503 like translation', async () => {
      prisma.storyLlmTask.findFirst.mockResolvedValueOnce({ id: 'task-old', status: 'PENDING', createdAt: NOW });
      const active = await coded(service.requestLevelAssessment('s1'));
      expect(active.body).toEqual({
        code: 'STORY_LLM_TASK_ACTIVE',
        message: 'Bu masal için bir seviye değerlendirmesi zaten sırada ya da çalışıyor.',
        taskId: 'task-old',
      });
      expect(prisma.storyLlmTask.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { storyId: 's1', type: 'ASSESS_LEVEL', targetLanguage: null, status: { in: ['PENDING', 'RUNNING'] } },
        }),
      );

      prisma.story.findUnique.mockResolvedValueOnce(null);
      await expect(service.requestLevelAssessment('nope')).rejects.toBeInstanceOf(NotFoundException);

      prisma.story.findUnique.mockResolvedValueOnce(storyRow({ content: '' }));
      expect((await coded(service.requestLevelAssessment('s1'))).body.code).toBe('STORY_EMPTY');

      llm.isConfigured.mockReturnValue(false);
      await expect(service.requestLevelAssessment('s1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  // ---------------------------------------------------------------------
  describe('requestLevelAssessmentBatch', () => {
    it('no filter: every story, oldest first, capped; manual levels are reported as skipped', async () => {
      prisma.story.findMany.mockResolvedValue([
        storyRow({ id: 'a' }),
        storyRow({ id: 'm', languageLevel: 'B2', languageLevelSource: 'MANUAL' }),
        storyRow({ id: 'b', languageLevel: 'A1', languageLevelSource: 'AI' }),
      ]);
      prisma.story.count.mockResolvedValue(3);

      const result = await service.requestLevelAssessmentBatch({}, 'admin-1');

      expect(prisma.story.findMany).toHaveBeenCalledWith({
        where: {},
        select: expect.any(Object),
        orderBy: { createdAt: 'asc' },
        take: STORY_LLM_BATCH_MAX,
      });
      expect(result).toEqual({
        matched: 3,
        queued: [
          { storyId: 'a', taskId: 'task-1' },
          { storyId: 'b', taskId: 'task-2' },
        ],
        skipped: [{ storyId: 'm', code: 'LEVEL_IS_MANUAL', reason: LEVEL_IS_MANUAL_MESSAGE }],
      });
      expect(createdTask(0)).toMatchObject({ force: false, createdByAdminId: 'admin-1' });
    });

    it('language and onlyMissing narrow the query', async () => {
      await service.requestLevelAssessmentBatch({ language: 'en', onlyMissing: true });

      expect(prisma.story.findMany.mock.calls[0][0].where).toEqual({ language: 'en', languageLevel: null });
      expect(prisma.story.count).toHaveBeenCalledWith({ where: { language: 'en', languageLevel: null } });
    });

    it('storyIds: only those; an id that is missing or filtered out is reported', async () => {
      prisma.story.findMany.mockResolvedValue([storyRow({ id: 'a' })]);
      prisma.story.count.mockResolvedValue(1);

      const result = await service.requestLevelAssessmentBatch({ storyIds: ['a', 'gone', 'a'], onlyMissing: true });

      expect(prisma.story.findMany.mock.calls[0][0].where).toEqual({
        id: { in: ['a', 'gone'] },
        languageLevel: null,
      });
      expect(result.queued).toEqual([{ storyId: 'a', taskId: 'task-1' }]);
      expect(result.skipped).toEqual([
        { storyId: 'gone', code: 'NOT_MATCHED', reason: 'Masal bulunamadı ya da seçilen filtreye uymuyor.' },
      ]);
      expect(createdTask().createdByAdminId).toBeNull();
    });

    it('an empty storyIds list means "every story"', async () => {
      await service.requestLevelAssessmentBatch({ storyIds: [] });
      expect(prisma.story.findMany.mock.calls[0][0].where).toEqual({});
    });

    it('503 when Gemini is not configured', async () => {
      llm.isConfigured.mockReturnValue(false);
      await expect(service.requestLevelAssessmentBatch({})).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  // ---------------------------------------------------------------------
  describe('automatic triggers never throw', () => {
    it('queues an assessment with no admin and only PENDING tasks blocking', async () => {
      await expect(service.triggerAutoAssess('s1', 'story created')).resolves.toBeUndefined();

      expect(createdTask()).toEqual({
        storyId: 's1',
        type: 'ASSESS_LEVEL',
        targetLanguage: null,
        force: false,
        createdByAdminId: null,
      });
      // A RUNNING task may be reading the old text, so it does not block.
      expect(prisma.storyLlmTask.findFirst.mock.calls[0][0].where.status).toEqual({ in: ['PENDING'] });
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('does nothing when llm.autoAssessLevel is off', async () => {
      settings.values = { 'llm.autoAssessLevel': false };

      await service.triggerAutoAssess('s1', 'story created');
      await service.triggerAutoAssessMissing('seed');

      expect(prisma.story.findUnique).not.toHaveBeenCalled();
      expect(prisma.story.findMany).not.toHaveBeenCalled();
      expect(prisma.storyLlmTask.create).not.toHaveBeenCalled();
    });

    it('does nothing when Gemini is not configured', async () => {
      llm.isConfigured.mockReturnValue(false);

      await service.triggerAutoAssess('s1', 'story created');
      await service.triggerAutoAssessMissing('seed');

      expect(prisma.storyLlmTask.create).not.toHaveBeenCalled();
    });

    it('the setting is read at call time, so a panel change applies at once', async () => {
      await service.triggerAutoAssess('s1', 'a');
      settings.values['llm.autoAssessLevel'] = false;
      await service.triggerAutoAssess('s1', 'b');
      expect(prisma.storyLlmTask.create).toHaveBeenCalledTimes(1);
    });

    it('never touches a MANUAL level, a missing story or an empty text', async () => {
      prisma.story.findUnique.mockResolvedValueOnce(storyRow({ languageLevel: 'B1', languageLevelSource: 'MANUAL' }));
      await expect(service.triggerAutoAssess('s1', 'content changed')).resolves.toBeUndefined();

      prisma.story.findUnique.mockResolvedValueOnce(null);
      await expect(service.triggerAutoAssess('gone', 'content changed')).resolves.toBeUndefined();

      prisma.story.findUnique.mockResolvedValueOnce(storyRow({ content: '' }));
      await expect(service.triggerAutoAssess('s1', 'content changed')).resolves.toBeUndefined();

      expect(prisma.storyLlmTask.create).not.toHaveBeenCalled();
    });

    it.each([
      ['the database is down', () => prisma.story.findUnique.mockRejectedValue(new Error('db down'))],
      ['the queue is down', () => queue.add.mockRejectedValue(new Error('redis down'))],
      ['a task is already queued', () => prisma.storyLlmTask.findFirst.mockResolvedValue({ id: 't', status: 'PENDING', createdAt: NOW })],
      ['something throws a non-error', () => prisma.story.findUnique.mockRejectedValue('boom')],
    ])('swallows every failure: %s', async (_label, arrange) => {
      arrange();
      await expect(service.triggerAutoAssess('s1', 'story created')).resolves.toBeUndefined();
    });

    it('after seeding: every story without a level gets a task; one failure does not stop the rest', async () => {
      prisma.story.findMany.mockResolvedValue([storyRow({ id: 'a' }), storyRow({ id: 'b' }), storyRow({ id: 'c' })]);
      prisma.storyLlmTask.create.mockRejectedValueOnce(new Error('db hiccup'));

      await expect(service.triggerAutoAssessMissing('seed')).resolves.toBeUndefined();

      expect(prisma.story.findMany).toHaveBeenCalledWith({
        where: { languageLevel: null },
        select: expect.any(Object),
        orderBy: { createdAt: 'asc' },
        take: STORY_LLM_BATCH_MAX,
      });
      expect(queue.add).toHaveBeenCalledTimes(2);
    });

    it('after seeding: a database failure is swallowed', async () => {
      prisma.story.findMany.mockRejectedValue(new Error('db down'));
      await expect(service.triggerAutoAssessMissing('seed')).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------
  describe('listTasks', () => {
    beforeEach(() => {
      prisma.storyLlmTask.findMany.mockResolvedValue([{ id: 'task-1' }]);
      prisma.storyLlmTask.count.mockResolvedValue(41);
    });

    it('newest first, standard pagination envelope, with the story and the result story', async () => {
      const result = await service.listTasks({ page: 2, limit: 20 });

      expect(prisma.storyLlmTask.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
        skip: 20,
        take: 20,
        include: {
          story: { select: { id: true, title: true, language: true } },
          resultStory: { select: { id: true, title: true, language: true, status: true } },
        },
      });
      expect(result).toEqual({ data: [{ id: 'task-1' }], total: 41, page: 2, limit: 20, totalPages: 3 });
    });

    it('filters by story, status and type; defaults to page 1 of 20', async () => {
      await service.listTasks({ storyId: 's1', status: 'FAILED', type: 'TRANSLATE' });
      expect(prisma.storyLlmTask.findMany.mock.calls[0][0]).toMatchObject({
        where: { storyId: 's1', status: 'FAILED', type: 'TRANSLATE' },
        skip: 0,
        take: 20,
      });

      await service.listTasks();
      expect(prisma.storyLlmTask.findMany.mock.calls[1][0].where).toEqual({});
    });

    it('stuck RUNNING tasks are failed first, so the list never shows them as in progress forever', async () => {
      await service.listTasks();

      expect(prisma.storyLlmTask.updateMany).toHaveBeenCalledWith({
        where: { status: 'RUNNING', updatedAt: { lt: new Date(NOW.getTime() - STORY_LLM_STALE_RUNNING_MS) } },
        data: { status: 'FAILED', error: STORY_LLM_STALE_MESSAGE, finishedAt: NOW },
      });
      expect(prisma.storyLlmTask.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.storyLlmTask.findMany.mock.invocationCallOrder[0],
      );
    });
  });

  it('every message shown to the admin follows the workspace copy rules', () => {
    for (const message of [
      LEVEL_IS_MANUAL_MESSAGE,
      STORY_LLM_STALE_MESSAGE,
      STORY_LLM_ORPHAN_MESSAGE,
      STORY_LLM_QUEUE_FAILED_MESSAGE,
    ]) {
      expect(message).toMatch(/^[\p{L}\p{N} ,.:()]+$/u);
    }
  });
});
