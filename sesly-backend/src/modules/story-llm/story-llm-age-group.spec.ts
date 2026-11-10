import { StoryLlmTasksService } from './story-llm-tasks.service';
import { StoryLlmProcessor } from './story-llm.processor';
import { AGE_GROUP_IS_MANUAL_MESSAGE, STORY_LLM_ATTEMPTS, STORY_LLM_JOB } from './story-llm.constants';
import { LlmOutputRejectedError } from '../llm-preprocessing/translation-guards';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createSettingsStub, SettingsStub } from '../../test-utils/settings-stub';

/**
 * The third story LLM task type: ASSESS_AGE_GROUP. Same life cycle as a
 * level assessment (story-llm-tasks.service.spec.ts, story-llm.processor.spec.ts);
 * this file covers what is specific to the age group.
 */

const NOW = new Date('2026-10-14T09:00:00.000Z');

const storyRow = (over: Record<string, any> = {}) => ({
  id: 's1',
  title: 'Keloğlan',
  content: 'Bir varmış bir yokmuş.',
  language: 'tr',
  translationGroupId: null,
  languageLevel: null,
  languageLevelSource: null,
  ageGroupSource: null,
  ...over,
});

const coded = async (promise: Promise<unknown>) => {
  const error: any = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e) => e,
  );
  return { status: error.getStatus?.(), body: error.getResponse?.() as Record<string, any> };
};

describe('age group assessment tasks', () => {
  let prisma: MockPrismaService;
  let settings: SettingsStub;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    prisma = createMockPrismaService();
    settings = createSettingsStub();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------------
  describe('StoryLlmTasksService', () => {
    let llm: { isConfigured: jest.Mock };
    let queue: { add: jest.Mock; getJob: jest.Mock };
    let service: StoryLlmTasksService;

    const createdTask = () => prisma.storyLlmTask.create.mock.calls[0][0].data;

    beforeEach(() => {
      llm = { isConfigured: jest.fn().mockReturnValue(true) };
      queue = { add: jest.fn().mockResolvedValue({}), getJob: jest.fn().mockResolvedValue({ id: 'job' }) };
      service = new StoryLlmTasksService(prisma as any, settings as any, llm as any, queue as any);

      prisma.story.findUnique.mockResolvedValue(storyRow());
      prisma.storyLlmTask.findFirst.mockResolvedValue(null);
      prisma.storyLlmTask.updateMany.mockResolvedValue({ count: 0 });
      prisma.storyLlmTask.create.mockImplementation(async ({ data }: any) => ({
        id: 'task-1',
        status: 'PENDING',
        createdAt: NOW,
        ...data,
      }));
    });

    it('requestAgeGroupAssessment queues an ASSESS_AGE_GROUP task for a story without a manual choice', async () => {
      for (const ageGroupSource of [null, 'AI']) {
        prisma.storyLlmTask.create.mockClear();
        prisma.story.findUnique.mockResolvedValue(storyRow({ ageGroupSource }));

        const task = await service.requestAgeGroupAssessment('s1', { adminId: 'admin-1' });

        expect(createdTask()).toEqual({
          storyId: 's1',
          type: 'ASSESS_AGE_GROUP',
          targetLanguage: null,
          force: false,
          createdByAdminId: 'admin-1',
        });
        expect(task.id).toBe('task-1');
      }
      expect(queue.add).toHaveBeenCalledWith(STORY_LLM_JOB, { taskId: 'task-1' }, expect.objectContaining({ jobId: 'task-1' }));
      // The story is read with the column the rule needs.
      expect(prisma.story.findUnique.mock.calls[0][0].select.ageGroupSource).toBe(true);
    });

    it('a MANUAL age group is protected: 409 AGE_GROUP_IS_MANUAL unless forced', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ ageGroupSource: 'MANUAL' }));

      const { status, body } = await coded(service.requestAgeGroupAssessment('s1'));
      expect(status).toBe(409);
      expect(body).toEqual({ code: 'AGE_GROUP_IS_MANUAL', message: AGE_GROUP_IS_MANUAL_MESSAGE });
      expect(prisma.storyLlmTask.create).not.toHaveBeenCalled();

      await service.requestAgeGroupAssessment('s1', { force: true });
      expect(createdTask()).toMatchObject({ type: 'ASSESS_AGE_GROUP', force: true, createdByAdminId: null });
    });

    it('409 while an age group assessment is queued or running (a level task does not block it)', async () => {
      prisma.storyLlmTask.findFirst.mockResolvedValue({ id: 'task-0', status: 'RUNNING', createdAt: NOW });

      const { status, body } = await coded(service.requestAgeGroupAssessment('s1'));

      expect(prisma.storyLlmTask.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            storyId: 's1',
            type: 'ASSESS_AGE_GROUP',
            targetLanguage: null,
            status: { in: ['PENDING', 'RUNNING'] },
          },
        }),
      );
      expect(status).toBe(409);
      expect(body).toEqual({
        code: 'STORY_LLM_TASK_ACTIVE',
        message: 'Bu masal için bir yaş grubu değerlendirmesi zaten sırada ya da çalışıyor.',
        taskId: 'task-0',
      });
    });

    it('404, 400 and 503 like the other task types', async () => {
      prisma.story.findUnique.mockResolvedValue(null);
      expect((await coded(service.requestAgeGroupAssessment('nope'))).body.code).toBe('STORY_NOT_FOUND');

      prisma.story.findUnique.mockResolvedValue(storyRow({ content: '  ' }));
      expect((await coded(service.requestAgeGroupAssessment('s1'))).body.code).toBe('STORY_EMPTY');

      llm.isConfigured.mockReturnValue(false);
      expect((await coded(service.requestAgeGroupAssessment('s1'))).body.code).toBe('LLM_NOT_CONFIGURED');
    });

    describe('triggerAutoAssessAgeGroup', () => {
      it('queues a task with no admin; only a PENDING task blocks it', async () => {
        await service.triggerAutoAssessAgeGroup('s1', 'story created', { newStory: true });

        expect(createdTask()).toEqual({
          storyId: 's1',
          type: 'ASSESS_AGE_GROUP',
          targetLanguage: null,
          force: false,
          createdByAdminId: null,
        });
        expect(prisma.storyLlmTask.findFirst.mock.calls[0][0].where.status).toEqual({ in: ['PENDING'] });
      });

      it('does nothing when llm.autoAssessAgeGroup is off, read at call time', async () => {
        settings.values['llm.autoAssessAgeGroup'] = false;
        await service.triggerAutoAssessAgeGroup('s1', 'story created', { newStory: true });
        expect(prisma.story.findUnique).not.toHaveBeenCalled();

        settings.values['llm.autoAssessAgeGroup'] = true;
        await service.triggerAutoAssessAgeGroup('s1', 'story created', { newStory: true });
        expect(prisma.storyLlmTask.create).toHaveBeenCalledTimes(1);
      });

      it('is independent of the level setting and needs a Gemini key', async () => {
        settings.values['llm.autoAssessLevel'] = false;
        await service.triggerAutoAssessAgeGroup('s1', 'story created', { newStory: true });
        expect(prisma.storyLlmTask.create).toHaveBeenCalledTimes(1);

        llm.isConfigured.mockReturnValue(false);
        await service.triggerAutoAssessAgeGroup('s1', 'story created', { newStory: true });
        expect(prisma.storyLlmTask.create).toHaveBeenCalledTimes(1);
      });

      it('a text change never re-assesses an age group of unknown origin (rows older than the source column)', async () => {
        // Legacy row: an editor picked the age group, no source was recorded
        // and the model was never asked.
        prisma.story.findUnique.mockResolvedValue(storyRow({ ageGroupSource: null }));
        prisma.storyLlmTask.findFirst.mockResolvedValue(null);

        await service.triggerAutoAssessAgeGroup('s1', 'content changed');

        expect(prisma.storyLlmTask.create).not.toHaveBeenCalled();
        expect(queue.add).not.toHaveBeenCalled();
        // The only lookup is "was the model ever asked for this story".
        expect(prisma.storyLlmTask.findFirst).toHaveBeenCalledTimes(1);
        expect(prisma.storyLlmTask.findFirst.mock.calls[0][0].where).toEqual({
          storyId: 's1',
          type: 'ASSESS_AGE_GROUP',
        });
      });

      it('a text change re-assesses an age group the model decided', async () => {
        prisma.story.findUnique.mockResolvedValue(storyRow({ ageGroupSource: 'AI' }));

        await service.triggerAutoAssessAgeGroup('s1', 'content changed');

        expect(createdTask()).toMatchObject({ storyId: 's1', type: 'ASSESS_AGE_GROUP', force: false });
        expect(queue.add).toHaveBeenCalledTimes(1);
      });

      it('a text change re-assesses a story without a source the model was asked about before', async () => {
        // Created without an age group; the first assessment failed, so the
        // placeholder is still there with no source.
        prisma.story.findUnique.mockResolvedValue(storyRow({ ageGroupSource: null }));
        prisma.storyLlmTask.findFirst
          .mockResolvedValueOnce({ id: 'old-task' }) // asked before
          .mockResolvedValueOnce(null); // nothing pending now

        await service.triggerAutoAssessAgeGroup('s1', 'content changed');

        expect(createdTask()).toMatchObject({ storyId: 's1', type: 'ASSESS_AGE_GROUP', createdByAdminId: null });
      });

      it('a new story without an age group is assessed whatever its source says', async () => {
        prisma.story.findUnique.mockResolvedValue(storyRow({ ageGroupSource: null }));

        await service.triggerAutoAssessAgeGroup('s1', 'story created', { newStory: true });

        expect(prisma.storyLlmTask.create).toHaveBeenCalledTimes(1);
      });

      it('never throws and never touches a MANUAL age group or a missing story', async () => {
        prisma.story.findUnique.mockResolvedValue(storyRow({ ageGroupSource: 'MANUAL' }));
        await expect(service.triggerAutoAssessAgeGroup('s1', 'content changed')).resolves.toBeUndefined();

        prisma.story.findUnique.mockResolvedValue(null);
        await expect(service.triggerAutoAssessAgeGroup('gone', 'content changed')).resolves.toBeUndefined();

        prisma.story.findUnique.mockRejectedValue(new Error('db down'));
        await expect(service.triggerAutoAssessAgeGroup('s1', 'content changed')).resolves.toBeUndefined();

        expect(prisma.storyLlmTask.create).not.toHaveBeenCalled();
      });
    });
  });

  // ---------------------------------------------------------------------
  describe('StoryLlmProcessor', () => {
    let llm: {
      isConfigured: jest.Mock;
      assessAgeGroup: jest.Mock;
      assessLanguageLevel: jest.Mock;
      translateStory: jest.Mock;
    };
    let processor: StoryLlmProcessor;

    const job = () => ({ data: { taskId: 'task-1' }, attemptsMade: 0, opts: { attempts: STORY_LLM_ATTEMPTS } }) as any;
    const taskRow = (over: Record<string, any> = {}) => ({
      id: 'task-1',
      storyId: 's1',
      type: 'ASSESS_AGE_GROUP',
      targetLanguage: null,
      status: 'PENDING',
      force: false,
      startedAt: null,
      ...over,
    });
    const lastTaskWrite = () => {
      const calls = prisma.storyLlmTask.updateMany.mock.calls;
      return calls[calls.length - 1][0];
    };

    beforeEach(() => {
      llm = {
        isConfigured: jest.fn().mockReturnValue(true),
        assessAgeGroup: jest.fn().mockResolvedValue({
          ageGroup: 'SIX_TO_TEN',
          confidence: 0.74,
          note: 'Olay örgüsü birkaç karakterli ve uzun.',
          modelUsed: 'gemini-test',
        }),
        assessLanguageLevel: jest.fn(),
        translateStory: jest.fn(),
      };
      processor = new StoryLlmProcessor(
        prisma as any,
        llm as any,
        {} as any,
        { triggerAutoAssess: jest.fn() } as any,
      );
      prisma.storyLlmTask.findUnique.mockResolvedValue(taskRow());
      prisma.storyLlmTask.updateMany.mockResolvedValue({ count: 1 });
      prisma.story.findUnique.mockResolvedValue({
        id: 's1',
        content: 'Bir varmış bir yokmuş.',
        language: 'tr',
        ageGroupSource: null,
      });
      prisma.story.updateMany.mockResolvedValue({ count: 1 });
    });

    it('writes the proposed age group as an AI assessment with the note and the confidence', async () => {
      await processor.handle(job());

      expect(llm.assessAgeGroup).toHaveBeenCalledWith('Bir varmış bir yokmuş.', 'tr');
      expect(llm.assessLanguageLevel).not.toHaveBeenCalled();
      expect(prisma.story.updateMany).toHaveBeenCalledWith({
        // Conditional: an age group chosen by hand meanwhile is not replaced.
        where: { id: 's1', OR: [{ ageGroupSource: null }, { ageGroupSource: 'AI' }] },
        data: {
          ageGroup: 'SIX_TO_TEN',
          ageGroupSource: 'AI',
          ageGroupNote: 'Olay örgüsü birkaç karakterli ve uzun. (Güven: %74)',
          ageGroupAssessedAt: NOW,
        },
      });
      expect(lastTaskWrite()).toEqual({
        where: { id: 'task-1', status: 'RUNNING' },
        data: {
          status: 'DONE',
          error: null,
          resultStoryId: null,
          result: { ageGroup: 'SIX_TO_TEN', confidence: 0.74, note: 'Olay örgüsü birkaç karakterli ve uzun.' },
          model: 'gemini-test',
          finishedAt: NOW,
        },
      });
    });

    it('a MANUAL age group fails the task at once, without calling the model', async () => {
      prisma.story.findUnique.mockResolvedValue({ id: 's1', content: 'x', language: 'tr', ageGroupSource: 'MANUAL' });

      await processor.handle(job());

      expect(llm.assessAgeGroup).not.toHaveBeenCalled();
      expect(prisma.story.updateMany).not.toHaveBeenCalled();
      expect(lastTaskWrite().data).toMatchObject({ status: 'FAILED', error: AGE_GROUP_IS_MANUAL_MESSAGE });
    });

    it('a forced task overwrites a MANUAL age group (unconditional write)', async () => {
      prisma.storyLlmTask.findUnique.mockResolvedValue(taskRow({ force: true }));
      prisma.story.findUnique.mockResolvedValue({ id: 's1', content: 'x', language: 'tr', ageGroupSource: 'MANUAL' });

      await processor.handle(job());

      expect(prisma.story.updateMany.mock.calls[0][0].where).toEqual({ id: 's1' });
      expect(lastTaskWrite().data.status).toBe('DONE');
    });

    it('an age group chosen by hand while the model was running survives', async () => {
      prisma.story.updateMany.mockResolvedValue({ count: 0 });

      await processor.handle(job());

      expect(lastTaskWrite().data).toMatchObject({ status: 'FAILED', error: AGE_GROUP_IS_MANUAL_MESSAGE });
    });

    it('a deleted story and a rejected answer fail the task with a Turkish reason, without a retry', async () => {
      prisma.story.findUnique.mockResolvedValue(null);
      await processor.handle(job());
      expect(lastTaskWrite().data).toMatchObject({
        status: 'FAILED',
        error: 'Masal bulunamadı (silinmiş olabilir).',
      });

      prisma.story.findUnique.mockResolvedValue({ id: 's1', content: 'x', language: 'tr', ageGroupSource: null });
      llm.assessAgeGroup.mockRejectedValue(
        new LlmOutputRejectedError('INVALID_ANSWER', 'Model geçerli bir yaş grubu yanıtı vermedi (açıklama boş).'),
      );
      await expect(processor.handle(job())).resolves.toBeUndefined();
      expect(lastTaskWrite().data).toMatchObject({
        status: 'FAILED',
        error: 'Model geçerli bir yaş grubu yanıtı vermedi (açıklama boş).',
      });
    });

    it('the message shown to the admin follows the workspace copy rules', () => {
      expect(AGE_GROUP_IS_MANUAL_MESSAGE).toMatch(/yaş grubu elle belirlenmiş/);
      expect(AGE_GROUP_IS_MANUAL_MESSAGE).not.toMatch(/[—–…→]|\p{Extended_Pictographic}/u);
    });
  });
});
