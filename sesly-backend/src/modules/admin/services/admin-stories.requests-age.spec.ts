import { AGE_GROUP_PLACEHOLDER, AdminStoriesService } from './admin-stories.service';
import { createMockPrismaService, MockPrismaService } from '../../../test-utils/prisma-mock';
import { createSettingsStub } from '../../../test-utils/settings-stub';

const NOW = new Date('2026-10-14T09:00:00.000Z');
const words = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`).join(' ');

/**
 * Admin side of: age group by AI (source, placeholder, triggers), the
 * translation request summary on story rows, telling requesters when a
 * version is published, and the duration that follows text and language.
 */
describe('AdminStoriesService (age group, translation requests, duration)', () => {
  let prisma: MockPrismaService;
  let service: AdminStoriesService;
  let storyLlmTasks: { triggerAutoAssess: jest.Mock; triggerAutoAssessAgeGroup: jest.Mock };
  let translationRequests: { summaryForStories: jest.Mock; fulfilForStory: jest.Mock };

  const storyRow = (over: Record<string, any> = {}) => ({
    id: 's1',
    title: 'Kırmızı Başlıklı Kız',
    content: 'Bir varmış bir yokmuş.',
    slug: 'kirmizi-baslikli-kiz',
    language: 'tr',
    status: 'DRAFT',
    publishedAt: null,
    ageGroup: 'THREE_TO_SIX',
    ageGroupSource: null,
    ageGroupNote: null,
    ageGroupAssessedAt: null,
    languageLevel: null,
    origin: 'ORIGINAL_HUMAN',
    textFidelity: 'VERBATIM',
    translationGroupId: null,
    translatedFromId: null,
    coverImageUrl: null,
    isPremium: false,
    chunks: [],
    _count: { userProgress: 0, favoritedBy: 0 },
    ...over,
  });

  const createDto = (over: Record<string, any> = {}) =>
    ({ title: 'Kırmızı Başlıklı Kız', content: 'Bir varmış bir yokmuş.', category: 'WORLD_CLASSICS', ...over }) as any;

  const created = () => prisma.story.create.mock.calls[0][0].data;
  const updated = () => prisma.story.update.mock.calls[0][0].data;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout', 'setInterval'] });
    prisma = createMockPrismaService();
    storyLlmTasks = {
      triggerAutoAssess: jest.fn().mockResolvedValue(undefined),
      triggerAutoAssessAgeGroup: jest.fn().mockResolvedValue(undefined),
    };
    translationRequests = {
      summaryForStories: jest.fn().mockResolvedValue(new Map()),
      fulfilForStory: jest.fn().mockResolvedValue(undefined),
    };
    service = new AdminStoriesService(
      prisma as any,
      { uploadFile: jest.fn(), generatePresignedUrl: jest.fn(), deleteFile: jest.fn() } as any,
      { splitTextIntoSegments: jest.fn() } as any,
      { preprocessStory: jest.fn() } as any,
      createSettingsStub() as any,
      storyLlmTasks as any,
      translationRequests as any,
    );

    prisma.story.findUnique.mockResolvedValue(storyRow());
    prisma.story.findFirst.mockResolvedValue(null);
    prisma.story.findMany.mockResolvedValue([]);
    prisma.story.count.mockResolvedValue(0);
    prisma.story.create.mockImplementation(async ({ data }: any) => ({ id: 's1', ...data }));
    prisma.story.update.mockImplementation(async ({ data }: any) => ({ ...storyRow(), ...data }));
    prisma.story.updateMany.mockResolvedValue({ count: 0 });
    prisma.storyChunk.create.mockResolvedValue({});
    prisma.storyChunk.deleteMany.mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------
  describe('age group on create', () => {
    it('no age group: a placeholder is stored, no source, and the model is asked in the background', async () => {
      await service.createStory(createDto(), undefined as any);

      expect(AGE_GROUP_PLACEHOLDER).toBe('THREE_TO_SIX');
      expect(created().ageGroup).toBe('THREE_TO_SIX');
      expect(created().ageGroupSource).toBeUndefined();
      expect(storyLlmTasks.triggerAutoAssessAgeGroup).toHaveBeenCalledWith('s1', 'story created', {
        newStory: true,
      });
    });

    it('an age group chosen by the admin is a MANUAL choice made now and is not assessed', async () => {
      await service.createStory(createDto({ ageGroup: 'TEN_PLUS' }), undefined as any);

      expect(created()).toMatchObject({
        ageGroup: 'TEN_PLUS',
        ageGroupSource: 'MANUAL',
        ageGroupAssessedAt: NOW,
        ageGroupNote: null,
      });
      expect(storyLlmTasks.triggerAutoAssessAgeGroup).not.toHaveBeenCalled();
      // The level trigger is independent of it.
      expect(storyLlmTasks.triggerAutoAssess).toHaveBeenCalledWith('s1', 'story created');
    });
  });

  // -------------------------------------------------------------------
  describe('age group on update', () => {
    it('a different age group becomes MANUAL and drops the note of the AI assessment', async () => {
      prisma.story.findUnique.mockResolvedValue(
        storyRow({ ageGroup: 'THREE_TO_SIX', ageGroupSource: 'AI', ageGroupNote: 'Kısa ve yalın. (Güven: %80)' }),
      );

      await service.updateStory('s1', { ageGroup: 'SIX_TO_TEN' } as any, undefined as any);

      expect(updated()).toMatchObject({
        ageGroup: 'SIX_TO_TEN',
        ageGroupSource: 'MANUAL',
        ageGroupAssessedAt: NOW,
        ageGroupNote: null,
      });
    });

    it('re-sending the stored age group (a full form save) keeps the AI source, note and time', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ ageGroup: 'SIX_TO_TEN', ageGroupSource: 'AI' }));

      await service.updateStory('s1', { ageGroup: 'SIX_TO_TEN', title: 'Yeni başlık' } as any, undefined as any);

      const data = updated();
      expect(data.title).toBe('Yeni başlık');
      for (const key of ['ageGroup', 'ageGroupSource', 'ageGroupAssessedAt', 'ageGroupNote']) {
        expect(data).not.toHaveProperty(key);
      }
    });

    it('not sending it does not touch it', async () => {
      await service.updateStory('s1', { title: 'Yeni başlık' } as any, undefined as any);

      expect(updated()).not.toHaveProperty('ageGroupSource');
    });

    it('a changed text asks for a new age group; a language change alone does not', async () => {
      await service.updateStory('s1', { content: 'Yepyeni bir metin.' } as any, undefined as any);
      expect(storyLlmTasks.triggerAutoAssessAgeGroup).toHaveBeenCalledWith('s1', 'content changed');

      storyLlmTasks.triggerAutoAssessAgeGroup.mockClear();
      storyLlmTasks.triggerAutoAssess.mockClear();
      await service.updateStory(
        's1',
        { content: 'Bir varmış bir yokmuş.', language: 'en' } as any,
        undefined as any,
      );
      expect(storyLlmTasks.triggerAutoAssessAgeGroup).not.toHaveBeenCalled();
      // The level does depend on the language.
      expect(storyLlmTasks.triggerAutoAssess).toHaveBeenCalledWith('s1', 'content changed');
    });
  });

  // -------------------------------------------------------------------
  describe('duration follows the text and the language', () => {
    it('a language change without new text recalculates it with the pace of the new language', async () => {
      // 300 words: 2 minutes at the Turkish 150 wpm, 3 at the German 140 wpm.
      prisma.story.findUnique.mockResolvedValue(storyRow({ content: words(300), estimatedDuration: 2 }));

      await service.updateStory('s1', { language: 'de' } as any, undefined as any);

      expect(updated().estimatedDuration).toBe(3);
    });

    it('new text recalculates it; an unrelated edit leaves it alone; an explicit value still wins', async () => {
      await service.updateStory('s1', { content: words(301) } as any, undefined as any);
      expect(updated().estimatedDuration).toBe(3);

      prisma.story.update.mockClear();
      await service.updateStory('s1', { title: 'Yeni başlık' } as any, undefined as any);
      expect(updated()).not.toHaveProperty('estimatedDuration');

      prisma.story.update.mockClear();
      await service.updateStory('s1', { content: words(301), estimatedDuration: 9 } as any, undefined as any);
      expect(updated().estimatedDuration).toBe(9);
    });
  });

  // -------------------------------------------------------------------
  describe('translation requests on story rows', () => {
    it('GET /admin/stories: every row carries the open requests of its tale, zero when nobody asked', async () => {
      const rows = [storyRow({ id: 's1', translationGroupId: 'g1' }), storyRow({ id: 's2' })];
      prisma.story.findMany.mockResolvedValueOnce(rows).mockResolvedValue([]);
      prisma.story.count.mockResolvedValue(2);
      translationRequests.summaryForStories.mockResolvedValue(
        new Map([['s1', { total: 3, languages: [{ language: 'en', count: 2 }, { language: 'de', count: 1 }] }]]),
      );

      const page = await service.getAllStories();

      expect(translationRequests.summaryForStories).toHaveBeenCalledWith(rows);
      expect(page.data[0].translationRequests).toEqual({
        total: 3,
        languages: [
          { language: 'en', count: 2 },
          { language: 'de', count: 1 },
        ],
      });
      expect(page.data[1].translationRequests).toEqual({ total: 0, languages: [] });
    });

    it('GET /admin/stories/:id carries it too', async () => {
      translationRequests.summaryForStories.mockResolvedValue(
        new Map([['s1', { total: 1, languages: [{ language: 'en', count: 1 }] }]]),
      );

      const story = await service.getStoryById('s1');

      expect(story.translationRequests).toEqual({ total: 1, languages: [{ language: 'en', count: 1 }] });
    });
  });

  // -------------------------------------------------------------------
  describe('requesters are told when a version is published', () => {
    it('a story created as PUBLISHED', async () => {
      await service.createStory(createDto({ status: 'PUBLISHED', origin: 'ORIGINAL_HUMAN', textFidelity: 'VERBATIM' }), undefined as any);
      expect(translationRequests.fulfilForStory).toHaveBeenCalledWith('s1');
    });

    it('a story created as a draft tells nobody', async () => {
      await service.createStory(createDto(), undefined as any);
      expect(translationRequests.fulfilForStory).not.toHaveBeenCalled();
    });

    it('a draft that is published', async () => {
      await service.updateStory('s1', { status: 'PUBLISHED' } as any, undefined as any);
      expect(translationRequests.fulfilForStory).toHaveBeenCalledWith('s1');
    });

    it('an edit of a story that already was published tells nobody again', async () => {
      const publishedRow = storyRow({ status: 'PUBLISHED', publishedAt: NOW });
      prisma.story.update.mockImplementation(async ({ data }: any) => ({ ...publishedRow, ...data }));
      prisma.story.findUnique.mockResolvedValue(publishedRow);

      await service.updateStory('s1', { title: 'Yeni başlık' } as any, undefined as any);
      await service.updateStory('s1', { status: 'PUBLISHED', content: 'Yeni metin.' } as any, undefined as any);

      expect(translationRequests.fulfilForStory).not.toHaveBeenCalled();
    });

    it('a published story moved to another language, or into a tale, is checked again', async () => {
      const publishedRow = storyRow({ status: 'PUBLISHED', publishedAt: NOW });
      prisma.story.update.mockImplementation(async ({ data }: any) => ({ ...publishedRow, ...data }));
      prisma.story.findUnique.mockResolvedValue(publishedRow);
      await service.updateStory('s1', { language: 'en' } as any, undefined as any);
      expect(translationRequests.fulfilForStory).toHaveBeenCalledTimes(1);

      // Declared a translation of s2 (an ungrouped Turkish story): joins a new group.
      translationRequests.fulfilForStory.mockClear();
      prisma.story.findUnique
        .mockResolvedValueOnce(storyRow({ status: 'PUBLISHED', publishedAt: NOW, language: 'en' }))
        .mockResolvedValueOnce({ id: 's2', language: 'tr', title: 'Kaynak', translationGroupId: null })
        .mockResolvedValue(storyRow({ status: 'PUBLISHED', language: 'en' }));
      await service.updateStory('s1', { translatedFromId: 's2' } as any, undefined as any);
      expect(translationRequests.fulfilForStory).toHaveBeenCalledWith('s1');
    });

    it('archiving or keeping a draft tells nobody', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ status: 'PUBLISHED', publishedAt: NOW }));
      await service.updateStory('s1', { status: 'ARCHIVED' } as any, undefined as any);
      await service.updateStory('s1', { status: 'DRAFT' } as any, undefined as any);

      expect(translationRequests.fulfilForStory).not.toHaveBeenCalled();
    });

    it('linking two stories checks both (either may be the version someone asked for)', async () => {
      prisma.story.findUnique
        .mockResolvedValueOnce({ id: 's1', language: 'tr', title: 'A', translationGroupId: null })
        .mockResolvedValueOnce({ id: 's2', language: 'en', title: 'B', translationGroupId: null })
        .mockResolvedValue(storyRow());

      await service.linkTranslation('s1', 's2');

      expect(translationRequests.fulfilForStory).toHaveBeenCalledWith('s1');
      expect(translationRequests.fulfilForStory).toHaveBeenCalledWith('s2');
    });

    it('linking stories that already are linked changes nothing and tells nobody', async () => {
      prisma.story.findUnique
        .mockResolvedValueOnce({ id: 's1', language: 'tr', title: 'A', translationGroupId: 'g' })
        .mockResolvedValueOnce({ id: 's2', language: 'en', title: 'B', translationGroupId: 'g' })
        .mockResolvedValue(storyRow());

      await service.linkTranslation('s1', 's2');

      expect(translationRequests.fulfilForStory).not.toHaveBeenCalled();
    });
  });
});
