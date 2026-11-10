import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StoryLlmProcessor, StoryLlmTaskError } from './story-llm.processor';
import { LEVEL_IS_MANUAL_MESSAGE, STORY_LLM_ATTEMPTS } from './story-llm.constants';
import { LlmOutputRejectedError } from '../llm-preprocessing/translation-guards';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const BUCKET = 'sesly-test';
const BUCKET_URL = `https://storage.googleapis.com/${BUCKET}`;

const EN_CONTENT = 'Once upon a time there was a boy.\n\nHe went to the forest.';

const job = (over: Record<string, any> = {}) =>
  ({ data: { taskId: 'task-1' }, attemptsMade: 0, opts: { attempts: STORY_LLM_ATTEMPTS }, ...over }) as any;

const taskRow = (over: Record<string, any> = {}) => ({
  id: 'task-1',
  storyId: 's1',
  type: 'ASSESS_LEVEL',
  targetLanguage: null,
  status: 'PENDING',
  force: false,
  startedAt: null,
  ...over,
});

const sourceStory = (over: Record<string, any> = {}) => ({
  id: 's1',
  title: 'Keloğlan',
  summary: 'Keloğlan ormana gider.',
  content: 'Bir varmış bir yokmuş.\n\nOrmana gitmiş.',
  language: 'tr',
  slug: 'keloglan',
  status: 'PUBLISHED',
  category: 'TURKISH_CLASSICS',
  ageGroup: 'THREE_TO_SIX',
  isPremium: true,
  coverImageUrl: null,
  defaultEmotion: 'peaceful',
  defaultSpeed: 0.8,
  cartesiaPronunciationDictId: 'dict-tr',
  preprocessedSegments: [{ text: 'x' }],
  originalTitle: null,
  originalLanguage: null,
  authorName: 'Anonim',
  authorDeathYear: null,
  collectorName: 'Pertev Naili Boratav',
  collectorDeathYear: 1998,
  translatorName: 'Bir Çevirmen',
  translatorDeathYear: 1970,
  adaptedBy: 'Sesly',
  firstPublishedYear: 1950,
  editionYear: 1969,
  sourceName: 'Az Gittik Uz Gittik',
  sourceUrl: 'https://example.org/kaynak',
  origin: 'FOLK_ANONYMOUS',
  textFidelity: 'RETOLD',
  sourceRetrievedAt: new Date('2026-01-01T00:00:00.000Z'),
  rightsBasis: 'FOLK_NO_AUTHOR',
  rightsNote: 'Anonim halk masalı.',
  licenseUrl: null,
  rightsVerifiedAt: new Date('2026-02-01T00:00:00.000Z'),
  rightsVerifiedBy: 'admin@sesly.app',
  translationGroupId: null,
  translatedFromId: null,
  translationMethod: null,
  languageLevel: 'B1',
  languageLevelSource: 'MANUAL',
  ...over,
});

const translation = (over: Record<string, any> = {}) => ({
  title: 'Keloglan',
  summary: 'Keloglan goes to the forest.',
  content: EN_CONTENT,
  modelUsed: 'gemini-test',
  durationMs: 1200,
  sourceParagraphs: 2,
  translatedParagraphs: 2,
  lengthRatio: 1.31,
  ...over,
});

describe('StoryLlmProcessor', () => {
  let prisma: MockPrismaService;
  let llm: { isConfigured: jest.Mock; assessLanguageLevel: jest.Mock; translateStory: jest.Mock };
  let storage: { getBucketName: jest.Mock; downloadFile: jest.Mock; uploadFile: jest.Mock };
  let tasks: { triggerAutoAssess: jest.Mock };
  let processor: StoryLlmProcessor;

  /** Every write to the task row, in order: [where, data]. */
  const taskWrites = () => prisma.storyLlmTask.updateMany.mock.calls.map((c: any[]) => c[0]);
  const lastTaskWrite = () => taskWrites()[taskWrites().length - 1];

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    prisma = createMockPrismaService();
    llm = {
      isConfigured: jest.fn().mockReturnValue(true),
      assessLanguageLevel: jest.fn().mockResolvedValue({
        level: 'A2',
        confidence: 0.82,
        note: 'Kelimeler gündelik, cümleler kısa.',
        modelUsed: 'gemini-test',
      }),
      translateStory: jest.fn().mockResolvedValue(translation()),
    };
    storage = {
      getBucketName: jest.fn().mockReturnValue(BUCKET),
      downloadFile: jest.fn().mockResolvedValue(Buffer.from('img')),
      uploadFile: jest.fn(async (_file: Buffer, key: string) => `${BUCKET_URL}/${key}`),
    };
    tasks = { triggerAutoAssess: jest.fn().mockResolvedValue(undefined) };
    processor = new StoryLlmProcessor(prisma as any, llm as any, storage as any, tasks as any);

    prisma.storyLlmTask.findUnique.mockResolvedValue(taskRow());
    prisma.storyLlmTask.updateMany.mockResolvedValue({ count: 1 });
    prisma.story.findUnique.mockResolvedValue(sourceStory({ languageLevel: null, languageLevelSource: null }));
    prisma.story.findFirst.mockResolvedValue(null);
    prisma.story.updateMany.mockResolvedValue({ count: 1 });
    prisma.story.update.mockResolvedValue({});
    prisma.story.create.mockResolvedValue({ id: 'new-story' });
    prisma.storyChunk.deleteMany.mockResolvedValue({ count: 1 });
    prisma.storyChunk.createMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------------
  describe('task state transitions', () => {
    it('PENDING becomes RUNNING (attempt counted, start stamped), then DONE with the result', async () => {
      await processor.handle(job());

      expect(taskWrites()).toEqual([
        {
          where: { id: 'task-1', status: { in: ['PENDING', 'RUNNING'] } },
          data: { status: 'RUNNING', startedAt: NOW, attempts: { increment: 1 }, error: null },
        },
        {
          where: { id: 'task-1', status: 'RUNNING' },
          data: {
            status: 'DONE',
            error: null,
            resultStoryId: null,
            result: { level: 'A2', confidence: 0.82, note: 'Kelimeler gündelik, cümleler kısa.' },
            model: 'gemini-test',
            finishedAt: NOW,
          },
        },
      ]);
    });

    it('a retry keeps the original start time', async () => {
      const startedAt = new Date('2026-10-13T11:00:00.000Z');
      prisma.storyLlmTask.findUnique.mockResolvedValue(taskRow({ status: 'RUNNING', startedAt }));

      await processor.handle(job({ attemptsMade: 1 }));

      expect(taskWrites()[0].data.startedAt).toBe(startedAt);
      expect(lastTaskWrite().data.status).toBe('DONE');
    });

    it('a task that no longer exists is skipped', async () => {
      prisma.storyLlmTask.findUnique.mockResolvedValue(null);

      await expect(processor.handle(job())).resolves.toBeUndefined();

      expect(prisma.storyLlmTask.updateMany).not.toHaveBeenCalled();
      expect(llm.assessLanguageLevel).not.toHaveBeenCalled();
    });

    it.each(['DONE', 'FAILED'])('a %s task is never run again', async (status) => {
      prisma.storyLlmTask.findUnique.mockResolvedValue(taskRow({ status }));

      await processor.handle(job());

      expect(prisma.storyLlmTask.updateMany).not.toHaveBeenCalled();
      expect(llm.assessLanguageLevel).not.toHaveBeenCalled();
    });

    it('a task that could not be claimed (failed as stuck meanwhile) is not run', async () => {
      prisma.storyLlmTask.updateMany.mockResolvedValueOnce({ count: 0 });

      await processor.handle(job());

      expect(llm.assessLanguageLevel).not.toHaveBeenCalled();
      expect(prisma.storyLlmTask.updateMany).toHaveBeenCalledTimes(1);
    });

    it('a late finish does not resurrect a task that was failed as stuck', async () => {
      prisma.storyLlmTask.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      await expect(processor.handle(job())).resolves.toBeUndefined();

      // The final write is conditional on RUNNING; nothing else is attempted.
      expect(lastTaskWrite().where).toEqual({ id: 'task-1', status: 'RUNNING' });
      expect(prisma.storyLlmTask.updateMany).toHaveBeenCalledTimes(2);
    });

    it('a missing API key fails the task at once (permanent, no retry)', async () => {
      llm.isConfigured.mockReturnValue(false);

      await expect(processor.handle(job())).resolves.toBeUndefined();

      expect(lastTaskWrite().data).toEqual({
        status: 'FAILED',
        error: 'Gemini API anahtarı sunucuda tanımlı değil.',
        finishedAt: NOW,
      });
      expect(llm.assessLanguageLevel).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  describe('retry and failure', () => {
    it.each([
      [
        'rate limit / overload',
        new ServiceUnavailableException('Gemini 429: quota'),
        'Gemini şu anda yanıt vermiyor ya da istek sınırına takıldı (Gemini 429: quota).',
      ],
      [
        'bad gateway',
        new BadGatewayException('Gemini 500: internal'),
        'Gemini beklenmeyen bir yanıt verdi (Gemini 500: internal).',
      ],
      [
        'timeout',
        Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }),
        'Gemini isteği zaman aşımına uğradı.',
      ],
      ['network', new TypeError('fetch failed'), 'Beklenmeyen hata (fetch failed).'],
    ])('transient (%s): back to PENDING with the reason, re-thrown so Bull retries', async (_l, error, reason) => {
      llm.assessLanguageLevel.mockRejectedValue(error);

      await expect(processor.handle(job({ attemptsMade: 0 }))).rejects.toBe(error);

      expect(lastTaskWrite()).toEqual({
        where: { id: 'task-1', status: 'RUNNING' },
        data: {
          status: 'PENDING',
          error: `Geçici hata, yeniden denenecek (deneme 1/3): ${reason}`,
        },
      });
    });

    it('the last attempt of a transient error marks the task FAILED and does not throw', async () => {
      llm.assessLanguageLevel.mockRejectedValue(new ServiceUnavailableException('Gemini 503: overloaded'));

      await expect(processor.handle(job({ attemptsMade: 2 }))).resolves.toBeUndefined();

      expect(lastTaskWrite()).toEqual({
        where: { id: 'task-1', status: 'RUNNING' },
        data: {
          status: 'FAILED',
          error: 'Gemini şu anda yanıt vermiyor ya da istek sınırına takıldı (Gemini 503: overloaded).',
          finishedAt: NOW,
        },
      });
    });

    it('falls back to the default attempt count when the job carries none', async () => {
      llm.assessLanguageLevel.mockRejectedValue(new Error('boom'));

      await expect(processor.handle({ data: { taskId: 'task-1' } } as any)).rejects.toThrow('boom');
      expect(lastTaskWrite().data.error).toContain('(deneme 1/3)');
    });

    it('rejected model output is permanent: FAILED with the readable reason on the first attempt', async () => {
      llm.assessLanguageLevel.mockRejectedValue(
        new LlmOutputRejectedError('INVALID_ANSWER', 'Model geçerli bir seviye yanıtı vermedi (açıklama boş).'),
      );

      await expect(processor.handle(job({ attemptsMade: 0 }))).resolves.toBeUndefined();

      expect(lastTaskWrite().data).toEqual({
        status: 'FAILED',
        error: 'Model geçerli bir seviye yanıtı vermedi (açıklama boş).',
        finishedAt: NOW,
      });
    });

    it('a 4xx answer of the provider (bad model, depleted credits) is permanent too', async () => {
      llm.assessLanguageLevel.mockRejectedValue(
        new BadGatewayException('Gemini 402: Your prepayment credits are depleted.'),
      );

      await expect(processor.handle(job({ attemptsMade: 0 }))).resolves.toBeUndefined();

      expect(lastTaskWrite().data).toEqual({
        status: 'FAILED',
        error: 'Gemini beklenmeyen bir yanıt verdi (Gemini 402: Your prepayment credits are depleted.).',
        finishedAt: NOW,
      });
    });

    it('a thrown non-error and a very long message are stored readably', async () => {
      llm.assessLanguageLevel.mockRejectedValueOnce('boom');
      await processor.handle(job({ attemptsMade: 2 }));
      expect(lastTaskWrite().data.error).toBe('Beklenmeyen hata (boom).');

      llm.assessLanguageLevel.mockRejectedValueOnce(new Error('x'.repeat(5000)));
      await processor.handle(job({ attemptsMade: 2 }));
      expect(lastTaskWrite().data.error).toHaveLength(1000);

      llm.assessLanguageLevel.mockRejectedValueOnce(new Error('y'.repeat(5000)));
      await expect(processor.handle(job({ attemptsMade: 0 }))).rejects.toThrow();
      expect(lastTaskWrite().data.error).toHaveLength(1000);
    });

    it('StoryLlmTaskError carries its name', () => {
      expect(new StoryLlmTaskError('x').name).toBe('StoryLlmTaskError');
    });
  });

  // ---------------------------------------------------------------------
  describe('level assessment', () => {
    it('writes level, source AI, note with confidence and the time; never touches a MANUAL row', async () => {
      await processor.handle(job());

      expect(llm.assessLanguageLevel).toHaveBeenCalledWith(expect.stringContaining('Bir varmış'), 'tr');
      expect(prisma.story.updateMany).toHaveBeenCalledWith({
        where: {
          id: 's1',
          OR: [{ languageLevelSource: null }, { languageLevelSource: 'AI' }],
        },
        data: {
          languageLevel: 'A2',
          languageLevelSource: 'AI',
          languageLevelNote: 'Kelimeler gündelik, cümleler kısa. (Güven: %82)',
          languageLevelAssessedAt: NOW,
        },
      });
    });

    it('the story language is passed to the model', async () => {
      prisma.story.findUnique.mockResolvedValue(
        sourceStory({ language: 'en', content: EN_CONTENT, languageLevelSource: 'AI' }),
      );

      await processor.handle(job());

      expect(llm.assessLanguageLevel).toHaveBeenCalledWith(EN_CONTENT, 'en');
    });

    it('a MANUAL level is protected: the model is not even called', async () => {
      prisma.story.findUnique.mockResolvedValue(sourceStory({ languageLevelSource: 'MANUAL' }));

      await processor.handle(job());

      expect(llm.assessLanguageLevel).not.toHaveBeenCalled();
      expect(prisma.story.updateMany).not.toHaveBeenCalled();
      expect(lastTaskWrite().data).toEqual({ status: 'FAILED', error: LEVEL_IS_MANUAL_MESSAGE, finishedAt: NOW });
    });

    it('a level set by hand while the model was thinking is not overwritten', async () => {
      prisma.story.updateMany.mockResolvedValue({ count: 0 });

      await processor.handle(job());

      expect(llm.assessLanguageLevel).toHaveBeenCalledTimes(1);
      expect(lastTaskWrite().data).toEqual({ status: 'FAILED', error: LEVEL_IS_MANUAL_MESSAGE, finishedAt: NOW });
    });

    it('force overwrites a MANUAL level', async () => {
      prisma.storyLlmTask.findUnique.mockResolvedValue(taskRow({ force: true }));
      prisma.story.findUnique.mockResolvedValue(sourceStory({ languageLevelSource: 'MANUAL' }));

      await processor.handle(job());

      expect(prisma.story.updateMany.mock.calls[0][0].where).toEqual({ id: 's1' });
      expect(prisma.story.updateMany.mock.calls[0][0].data.languageLevelSource).toBe('AI');
      expect(lastTaskWrite().data.status).toBe('DONE');
    });

    it('a deleted story fails the task without a retry', async () => {
      prisma.story.findUnique.mockResolvedValue(null);

      await expect(processor.handle(job())).resolves.toBeUndefined();

      expect(lastTaskWrite().data.error).toBe('Masal bulunamadı (silinmiş olabilir).');
    });
  });

  // ---------------------------------------------------------------------
  describe('translation', () => {
    beforeEach(() => {
      prisma.storyLlmTask.findUnique.mockResolvedValue(taskRow({ type: 'TRANSLATE', targetLanguage: 'en' }));
      prisma.story.findUnique.mockResolvedValue(sourceStory());
    });

    const created = () => prisma.story.create.mock.calls[0][0].data;

    it('copies the content warnings (enum values) of the source; none stays none', async () => {
      prisma.story.findUnique.mockResolvedValue(sourceStory({ contentWarnings: ['SCARY', 'LONELINESS'] }));
      await processor.handle(job());
      expect(created().contentWarnings).toEqual(['SCARY', 'LONELINESS']);

      prisma.story.create.mockClear();
      prisma.story.findUnique.mockResolvedValue(sourceStory({ contentWarnings: undefined }));
      await processor.handle(job());
      expect(created().contentWarnings).toEqual([]);
    });

    it('creates a DRAFT machine translation next to the source and queues its level assessment', async () => {
      await processor.handle(job());

      expect(llm.translateStory).toHaveBeenCalledWith(
        {
          title: 'Keloğlan',
          summary: 'Keloğlan ormana gider.',
          content: 'Bir varmış bir yokmuş.\n\nOrmana gitmiş.',
          language: 'tr',
        },
        'en',
      );

      const data = created();
      expect(data).toMatchObject({
        title: 'Keloglan',
        summary: 'Keloglan goes to the forest.',
        content: EN_CONTENT,
        language: 'en',
        slug: 'keloglan',
        status: 'DRAFT',
        translationMethod: 'MACHINE',
        textFidelity: 'TRANSLATED',
        translatedFromId: 's1',
        estimatedDuration: 1,
        coverImageUrl: null,
        // copied
        category: 'TURKISH_CLASSICS',
        ageGroup: 'THREE_TO_SIX',
        isPremium: true,
        defaultEmotion: 'peaceful',
        defaultSpeed: 0.8,
        authorName: 'Anonim',
        collectorName: 'Pertev Naili Boratav',
        collectorDeathYear: 1998,
        adaptedBy: 'Sesly',
        firstPublishedYear: 1950,
        editionYear: 1969,
        sourceName: 'Az Gittik Uz Gittik',
        sourceUrl: 'https://example.org/kaynak',
        origin: 'FOLK_ANONYMOUS',
        rightsBasis: 'FOLK_NO_AUTHOR',
        rightsNote: 'Anonim halk masalı.',
        // the source text becomes the "original" of the translation
        originalTitle: 'Keloğlan',
        originalLanguage: 'tr',
      });
      expect(data.chunks).toEqual({ create: [{ chunkIndex: 0, content: EN_CONTENT }] });

      // Not copied: the human translator of the source, the rights
      // verification, language specific TTS data, and the level.
      for (const key of [
        'translatorName',
        'translatorDeathYear',
        'rightsVerifiedAt',
        'rightsVerifiedBy',
        'cartesiaPronunciationDictId',
        'preprocessedSegments',
        'languageLevel',
        'languageLevelSource',
        'publishedAt',
        'id',
      ]) {
        expect(data).not.toHaveProperty(key);
      }

      expect(tasks.triggerAutoAssess).toHaveBeenCalledWith('new-story', 'translation');
      expect(lastTaskWrite().data).toEqual({
        status: 'DONE',
        error: null,
        resultStoryId: 'new-story',
        result: {
          title: 'Keloglan',
          sourceParagraphs: 2,
          translatedParagraphs: 2,
          lengthRatio: 1.31,
          replaced: false,
        },
        model: 'gemini-test',
        finishedAt: NOW,
      });
    });

    it('a source without a translation group gets a new one, shared with the translation', async () => {
      await processor.handle(job());

      const groupId = created().translationGroupId;
      expect(groupId).toMatch(/^[0-9a-f-]{36}$/);
      expect(prisma.story.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { translationGroupId: groupId },
      });
    });

    it('a source that already has a group keeps it; an existing original title is kept', async () => {
      prisma.story.findUnique.mockResolvedValue(
        sourceStory({ translationGroupId: 'g1', originalTitle: 'Rotkäppchen', originalLanguage: 'de' }),
      );

      await processor.handle(job());

      expect(prisma.story.update).not.toHaveBeenCalled();
      expect(created()).toMatchObject({
        translationGroupId: 'g1',
        originalTitle: 'Rotkäppchen',
        originalLanguage: 'de',
      });
      expect(prisma.story.findFirst).toHaveBeenCalledWith({
        where: { translationGroupId: 'g1', language: 'en' },
        select: { id: true, title: true, status: true, translationMethod: true },
      });
    });

    it('the slug is generated from the translated title and made unique in the target language', async () => {
      prisma.story.findFirst.mockImplementation(async ({ where }: any) =>
        where.slug === 'keloglan' || where.slug === 'keloglan-2' ? { id: 'taken' } : null,
      );

      await processor.handle(job());

      expect(created().slug).toBe('keloglan-3');
      expect(prisma.story.findFirst).toHaveBeenCalledWith({
        where: { slug: 'keloglan', language: 'en' },
        select: { id: true },
      });
    });

    it('a title without Latin letters falls back to the source slug plus the language', async () => {
      prisma.storyLlmTask.findUnique.mockResolvedValue(taskRow({ type: 'TRANSLATE', targetLanguage: 'ru' }));
      llm.translateStory.mockResolvedValue(translation({ title: 'Келоглан' }));

      await processor.handle(job());
      expect(created().slug).toBe('keloglan-ru');

      prisma.story.create.mockClear();
      prisma.story.findUnique.mockResolvedValue(sourceStory({ slug: null }));
      await processor.handle(job());
      expect(created().slug).toBe('masal');
    });

    it('the translation gets its own copy of the cover (deleting one story must not remove the other cover)', async () => {
      prisma.story.findUnique.mockResolvedValue(
        sourceStory({
          coverImageUrl: `${BUCKET_URL}/stories/cover/11111111-1111-4111-8111-111111111111-kelo.PNG`,
        }),
      );

      await processor.handle(job());

      expect(storage.downloadFile).toHaveBeenCalledWith(
        'stories/cover/11111111-1111-4111-8111-111111111111-kelo.PNG',
      );
      const [file, key, contentType] = storage.uploadFile.mock.calls[0];
      expect(file).toEqual(Buffer.from('img'));
      expect(key).toMatch(/^stories\/cover\/[0-9a-f-]{36}-kelo\.PNG$/);
      expect(key).not.toContain('11111111-1111-4111-8111-111111111111');
      expect(contentType).toBe('image/png');
      expect(created().coverImageUrl).toBe(`${BUCKET_URL}/${key}`);
    });

    it('cover edge cases: unknown extension, external URL, junk, and a failed copy never fail the task', async () => {
      prisma.story.findUnique.mockResolvedValue(sourceStory({ coverImageUrl: 'stories/cover/kapak.bin' }));
      await processor.handle(job());
      expect(storage.uploadFile.mock.calls[0][2]).toBe('application/octet-stream');

      prisma.story.create.mockClear();
      prisma.story.findUnique.mockResolvedValue(
        sourceStory({ coverImageUrl: 'https://cdn.example.com/c.png', coverCredit: { illustrator: 'Ada' } }),
      );
      await processor.handle(job());
      expect(created().coverImageUrl).toBe('https://cdn.example.com/c.png');
      // The credit of the picture goes with its copy.
      expect(created().coverCredit).toEqual({ illustrator: 'Ada' });

      prisma.story.create.mockClear();
      prisma.story.findUnique.mockResolvedValue(
        sourceStory({ coverImageUrl: 'gs://another-bucket/c.png', coverCredit: { illustrator: 'Ada' } }),
      );
      await processor.handle(job());
      expect(created().coverImageUrl).toBeNull();
      expect(created().coverCredit).toBeUndefined();

      prisma.story.create.mockClear();
      storage.downloadFile.mockRejectedValue(new Error('gcs down'));
      prisma.story.findUnique.mockResolvedValue(sourceStory({ coverImageUrl: 'stories/cover/kapak.jpg' }));
      await processor.handle(job());
      expect(created().coverImageUrl).toBeNull();
      expect(lastTaskWrite().data.status).toBe('DONE');
    });

    it('a failed guard fails the task with the readable reason and saves nothing', async () => {
      llm.translateStory.mockRejectedValue(
        new LlmOutputRejectedError(
          'TRANSLATION_GUARD',
          'Çeviri reddedildi: paragraf sayısı tutmuyor (kaynak 2, çeviri 1).',
        ),
      );

      await expect(processor.handle(job())).resolves.toBeUndefined();

      expect(prisma.story.create).not.toHaveBeenCalled();
      expect(prisma.story.update).not.toHaveBeenCalled();
      expect(tasks.triggerAutoAssess).not.toHaveBeenCalled();
      expect(lastTaskWrite().data).toEqual({
        status: 'FAILED',
        error: 'Çeviri reddedildi: paragraf sayısı tutmuyor (kaynak 2, çeviri 1).',
        finishedAt: NOW,
      });
    });

    it('a sibling that appeared meanwhile is never overwritten by an ordinary task', async () => {
      prisma.story.findUnique.mockResolvedValue(sourceStory({ translationGroupId: 'g1' }));
      prisma.story.findFirst.mockResolvedValue({
        id: 's-en',
        title: 'Keloglan',
        status: 'DRAFT',
        translationMethod: 'MACHINE',
      });

      await processor.handle(job());

      expect(llm.translateStory).not.toHaveBeenCalled();
      expect(lastTaskWrite().data.error).toBe('Bu masalın İngilizce çevirisi zaten var: Keloglan.');
    });

    it.each([
      ['published', { status: 'PUBLISHED', translationMethod: 'MACHINE' }],
      ['human', { status: 'DRAFT', translationMethod: 'HUMAN' }],
    ])('a forced task never replaces a %s sibling', async (_label, sibling) => {
      prisma.storyLlmTask.findUnique.mockResolvedValue(
        taskRow({ type: 'TRANSLATE', targetLanguage: 'en', force: true }),
      );
      prisma.story.findUnique.mockResolvedValue(sourceStory({ translationGroupId: 'g1' }));
      prisma.story.findFirst.mockResolvedValue({ id: 's-en', title: 'Keloglan', ...sibling });

      await processor.handle(job());

      expect(llm.translateStory).not.toHaveBeenCalled();
      expect(prisma.story.updateMany).not.toHaveBeenCalled();
      expect(lastTaskWrite().data.status).toBe('FAILED');
    });

    describe('replaceDraft (forced task, sibling is a DRAFT machine translation)', () => {
      beforeEach(() => {
        prisma.storyLlmTask.findUnique.mockResolvedValue(
          taskRow({ type: 'TRANSLATE', targetLanguage: 'en', force: true }),
        );
        prisma.story.findUnique.mockResolvedValue(sourceStory({ translationGroupId: 'g1' }));
        prisma.story.findFirst.mockResolvedValue({
          id: 's-en',
          title: 'Old',
          status: 'DRAFT',
          translationMethod: 'MACHINE',
        });
      });

      it('overwrites the draft in place, resets what was written against the old text, rebuilds chunks', async () => {
        await processor.handle(job());

        expect(prisma.story.create).not.toHaveBeenCalled();
        expect(prisma.story.updateMany).toHaveBeenCalledWith({
          where: { id: 's-en', status: 'DRAFT', translationMethod: 'MACHINE' },
          data: {
            title: 'Keloglan',
            summary: 'Keloglan goes to the forest.',
            content: EN_CONTENT,
            estimatedDuration: 1,
            preprocessedSegments: Prisma.JsonNull,
            preprocessedAt: null,
            preprocessedModel: null,
            languageLevel: null,
            languageLevelSource: null,
            languageLevelNote: null,
            languageLevelAssessedAt: null,
          },
        });
        expect(prisma.storyChunk.deleteMany).toHaveBeenCalledWith({ where: { storyId: 's-en' } });
        expect(prisma.storyChunk.createMany).toHaveBeenCalledWith({
          data: [{ storyId: 's-en', chunkIndex: 0, content: EN_CONTENT }],
        });
        expect(tasks.triggerAutoAssess).toHaveBeenCalledWith('s-en', 'translation');
        expect(lastTaskWrite().data).toMatchObject({
          status: 'DONE',
          resultStoryId: 's-en',
          result: expect.objectContaining({ replaced: true }),
        });
      });

      it('a draft that was published or edited by hand meanwhile is left alone', async () => {
        prisma.story.updateMany.mockResolvedValue({ count: 0 });

        await processor.handle(job());

        expect(prisma.storyChunk.deleteMany).not.toHaveBeenCalled();
        expect(lastTaskWrite().data.error).toBe(
          'Değiştirilecek taslak çeviri bu sırada yayınlandı, elle düzenlendi ya da silindi. Üzerine yazılmadı.',
        );
      });
    });

    it('a unique clash on create (another translation won the race) is a readable permanent failure', async () => {
      prisma.story.create.mockRejectedValue(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));

      await expect(processor.handle(job())).resolves.toBeUndefined();

      expect(lastTaskWrite().data.error).toBe(
        'Bu masalın İngilizce çevirisi bu sırada başka bir yoldan oluşturuldu.',
      );
    });

    it('any other database error on create is transient (retried)', async () => {
      const error = new Error('connection reset');
      prisma.story.create.mockRejectedValue(error);

      await expect(processor.handle(job())).rejects.toBe(error);
      expect(lastTaskWrite().data.status).toBe('PENDING');
    });

    it.each([
      ['no target language', taskRow({ type: 'TRANSLATE', targetLanguage: null }), sourceStory(), 'Çeviri görevinde hedef dil yok.'],
      ['a deleted story', taskRow({ type: 'TRANSLATE', targetLanguage: 'en' }), null, 'Masal bulunamadı (silinmiş olabilir).'],
      [
        'a story that is now in the target language',
        taskRow({ type: 'TRANSLATE', targetLanguage: 'en' }),
        sourceStory({ language: 'en' }),
        'Masal zaten İngilizce.',
      ],
    ])('%s fails the task without calling the model', async (_label, task, story, reason) => {
      prisma.storyLlmTask.findUnique.mockResolvedValue(task);
      prisma.story.findUnique.mockResolvedValue(story);

      await expect(processor.handle(job())).resolves.toBeUndefined();

      expect(llm.translateStory).not.toHaveBeenCalled();
      expect(lastTaskWrite().data).toEqual({ status: 'FAILED', error: reason, finishedAt: NOW });
    });
  });
});
