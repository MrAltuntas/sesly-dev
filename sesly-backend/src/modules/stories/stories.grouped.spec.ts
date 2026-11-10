import { StoriesService } from './stories.service';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createSettingsStub, SettingsStub } from '../../test-utils/settings-stub';

/**
 * One story per list unless a language is chosen: grouped lists, several
 * languages at once, the content language preference, grouped favourites and
 * the group fields of the detail. Requests that send none of the new
 * parameters are pinned in stories.catalogue.spec.ts and must not change.
 */

const USER = 'user-1';
const T = (day: number) => new Date(Date.UTC(2026, 8, day, 12));

const row = (over: Record<string, any> = {}) => ({
  id: 's1',
  title: 'Masal',
  content: 'Bir varmış bir yokmuş.',
  summary: null,
  ageGroup: 'THREE_TO_SIX',
  category: 'BEDTIME',
  language: 'tr',
  languageLevel: null,
  status: 'PUBLISHED',
  estimatedDuration: 4,
  coverImageUrl: null,
  isPremium: false,
  translationGroupId: null,
  originalLanguage: null,
  translatedFromId: null,
  createdAt: T(1),
  updatedAt: T(1),
  ...over,
});

/** A catalogue of three tales: one in tr + en, one English only, one Turkish only. */
const CANDIDATES = [
  row({ id: 'parmak-tr', translationGroupId: 'parmak' }),
  row({ id: 'parmak-en', language: 'en', translationGroupId: 'parmak', translatedFromId: 'parmak-tr' }),
  row({ id: 'duckling-en', language: 'en' }),
  row({ id: 'keloglan-tr' }),
];

describe('StoriesService (one story per list)', () => {
  let prisma: MockPrismaService;
  let settings: SettingsStub;
  let translationRequests: { requestedLanguages: jest.Mock };
  let service: StoriesService;

  /** where of the page query (the second story.findMany in a grouped request). */
  const pageWhere = (call: number) => prisma.story.findMany.mock.calls[call][0].where;

  beforeEach(() => {
    prisma = createMockPrismaService();
    settings = createSettingsStub({
      'content.enabledLanguages': ['tr', 'en', 'de'],
      'content.defaultLanguage': 'tr',
    });
    translationRequests = { requestedLanguages: jest.fn().mockResolvedValue([]) };
    service = new StoriesService(
      prisma as any,
      {} as any,
      { getReadUrl: jest.fn(async (v: string | null) => v) } as any,
      {} as any,
      settings as any,
      translationRequests as any,
    );
    prisma.subscription.findUnique.mockResolvedValue({ plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: null });
    prisma.userPreferences.findUnique.mockResolvedValue(null);
    prisma.story.findMany.mockResolvedValue([]);
    prisma.story.count.mockResolvedValue(0);
    prisma.favoriteStory.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([{ id: 'parmak-en' }, { id: 'parmak-tr' }]);
  });

  // ---------------------------------------------------------------------
  describe('GET /stories?grouped=true', () => {
    it('reads the published stories of the enabled languages, then pages over the chosen version of each tale', async () => {
      prisma.story.findMany
        .mockResolvedValueOnce(CANDIDATES)
        .mockResolvedValueOnce([CANDIDATES[0], CANDIDATES[2], CANDIDATES[3]])
        .mockResolvedValueOnce([CANDIDATES[0], CANDIDATES[1]]);
      prisma.story.count.mockResolvedValue(3);

      const page = await service.getStories(undefined, { grouped: true, page: 1, limit: 20 } as any);

      expect(prisma.story.findMany.mock.calls[0][0]).toEqual({
        where: { status: 'PUBLISHED', language: { in: ['tr', 'en', 'de'] } },
        select: {
          id: true,
          language: true,
          translationGroupId: true,
          originalLanguage: true,
          translatedFromId: true,
          createdAt: true,
        },
      });
      // Anonymous, no prefer: the default content language is preferred.
      expect(pageWhere(1)).toEqual({
        status: 'PUBLISHED',
        id: { in: ['parmak-tr', 'duckling-en', 'keloglan-tr'] },
        // An anonymous caller is on the free plan.
        isPremium: false,
      });
      // Totals count tales, not rows.
      expect(prisma.story.count).toHaveBeenCalledWith({ where: pageWhere(1) });
      expect(page.total).toBe(3);
      expect(page.data.map((item) => [item.id, item.language, item.availableLanguages])).toEqual([
        ['parmak-tr', 'tr', ['tr', 'en']],
        ['duckling-en', 'en', ['en']],
        ['keloglan-tr', 'tr', ['tr']],
      ]);
    });

    it('an anonymous caller can name the language to prefer', async () => {
      prisma.story.findMany.mockResolvedValueOnce(CANDIDATES);

      await service.getStories(undefined, { grouped: true, prefer: 'en' } as any);

      expect(pageWhere(1).id).toEqual({ in: ['parmak-en', 'duckling-en', 'keloglan-tr'] });
      expect(prisma.userPreferences.findUnique).not.toHaveBeenCalled();
    });

    it('a signed-in user gets the stored content language', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue({ contentLanguage: 'en' });
      prisma.story.findMany.mockResolvedValueOnce(CANDIDATES);

      await service.getStories(USER, { grouped: true } as any);

      expect(prisma.userPreferences.findUnique).toHaveBeenCalledWith({
        where: { userId: USER },
        select: { contentLanguage: true },
      });
      expect(pageWhere(1).id).toEqual({ in: ['parmak-en', 'duckling-en', 'keloglan-tr'] });
    });

    it('prefer wins over the stored preference; a language that is switched off is skipped at each step', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue({ contentLanguage: 'en' });
      prisma.story.findMany.mockResolvedValue(CANDIDATES);

      await service.getStories(USER, { grouped: true, prefer: 'tr' } as any);
      expect(pageWhere(1).id.in[0]).toBe('parmak-tr');

      // prefer is not enabled: the stored one is used.
      prisma.story.findMany.mockClear();
      await service.getStories(USER, { grouped: true, prefer: 'fr' } as any);
      expect(pageWhere(1).id.in[0]).toBe('parmak-en');

      // The stored one is not enabled either: the default language.
      prisma.story.findMany.mockClear();
      prisma.userPreferences.findUnique.mockResolvedValue({ contentLanguage: 'fr' });
      await service.getStories(USER, { grouped: true, prefer: 'fr' } as any);
      expect(pageWhere(1).id.in[0]).toBe('parmak-tr');

      // No stored preference (row exists, value null).
      prisma.story.findMany.mockClear();
      prisma.userPreferences.findUnique.mockResolvedValue({ contentLanguage: null });
      await service.getStories(USER, { grouped: true } as any);
      expect(pageWhere(1).id.in[0]).toBe('parmak-tr');
    });

    it('filters, sort and the plan apply to the chosen version', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null); // FREE
      prisma.story.findMany.mockResolvedValueOnce(CANDIDATES);

      await service.getStories(USER, {
        grouped: true,
        languageLevel: ['A1', 'A2'],
        ageGroup: 'THREE_TO_SIX',
        category: 'BEDTIME',
        sort: 'title',
        page: 2,
        limit: 5,
      } as any);

      const args = prisma.story.findMany.mock.calls[1][0];
      expect(args.where).toEqual({
        status: 'PUBLISHED',
        id: { in: ['parmak-tr', 'duckling-en', 'keloglan-tr'] },
        languageLevel: { in: ['A1', 'A2'] },
        ageGroup: 'THREE_TO_SIX',
        category: 'BEDTIME',
        isPremium: false,
      });
      expect(args).toMatchObject({ skip: 5, take: 5, orderBy: [{ title: 'asc' }, { createdAt: 'desc' }] });
    });

    it('isFavoriteAnyLanguage: a favourite saved on the other language version is seen', async () => {
      prisma.story.findMany
        .mockResolvedValueOnce(CANDIDATES)
        .mockResolvedValueOnce([CANDIDATES[0]])
        .mockResolvedValueOnce([CANDIDATES[0], CANDIDATES[1]]);
      prisma.favoriteStory.findMany.mockResolvedValue([{ storyId: 'parmak-en' }]);

      const page = await service.getStories(USER, { grouped: true } as any);

      expect(prisma.favoriteStory.findMany).toHaveBeenCalledWith({
        where: { userId: USER, storyId: { in: ['parmak-tr', 'parmak-en'] } },
        select: { storyId: true },
      });
      expect(page.data[0]).toMatchObject({ id: 'parmak-tr', isFavorite: false, isFavoriteAnyLanguage: true });
    });

    it('grouped=false is the default list', async () => {
      await service.getStories(undefined, { grouped: false } as any);

      expect(prisma.story.findMany).toHaveBeenCalledTimes(1);
      expect(pageWhere(0)).toMatchObject({ status: 'PUBLISHED', language: 'tr' });
    });
  });

  // ---------------------------------------------------------------------
  describe('GET /stories?language=tr,en (flat)', () => {
    it('one row per story per selected language; each row still carries availableLanguages', async () => {
      prisma.story.findMany
        .mockResolvedValueOnce([CANDIDATES[0], CANDIDATES[1], CANDIDATES[2]])
        .mockResolvedValueOnce([CANDIDATES[0], CANDIDATES[1]]);
      prisma.story.count.mockResolvedValue(4);

      const page = await service.getStories(undefined, { language: ['tr', 'en'] } as any);

      expect(pageWhere(0)).toMatchObject({ status: 'PUBLISHED', language: { in: ['tr', 'en'] } });
      expect(page.total).toBe(4);
      expect(page.data.map((item) => [item.id, item.availableLanguages])).toEqual([
        ['parmak-tr', ['tr', 'en']],
        ['parmak-en', ['en', 'tr']],
        ['duckling-en', ['en']],
      ]);
    });

    it('a language wins over grouped=true', async () => {
      await service.getStories(undefined, { language: ['tr', 'en'], grouped: true } as any);
      expect(prisma.story.findMany).toHaveBeenCalledTimes(1);
      expect(pageWhere(0).language).toEqual({ in: ['tr', 'en'] });

      prisma.story.findMany.mockClear();
      await service.getStories(undefined, { language: ['en'], grouped: true } as any);
      expect(pageWhere(0).language).toBe('en');
    });

    it('languages that are switched off are left out; none left means an empty page and no query', async () => {
      await service.getStories(undefined, { language: ['en', 'fr'] } as any);
      expect(pageWhere(0).language).toEqual({ in: ['en'] });

      prisma.story.findMany.mockClear();
      const page = await service.getStories(undefined, { language: ['fr', 'es'], page: 3, limit: 7 } as any);
      expect(page).toEqual({ data: [], total: 0, page: 3, limit: 7, totalPages: 0 });
      expect(prisma.story.findMany).not.toHaveBeenCalled();
    });

    it('one language, as a list or as a plain string, is the same filter as before', async () => {
      await service.getStories(undefined, { language: ['en'] } as any);
      await service.getStories(undefined, { language: 'en' } as any);

      expect(pageWhere(0)).toMatchObject({ status: 'PUBLISHED', language: 'en' });
      expect(pageWhere(1)).toMatchObject({ status: 'PUBLISHED', language: 'en' });
    });
  });

  // ---------------------------------------------------------------------
  describe('GET /stories/search', () => {
    it('grouped: the text is searched in the chosen version of each tale', async () => {
      prisma.story.findMany.mockResolvedValueOnce(CANDIDATES).mockResolvedValueOnce([CANDIDATES[1]]);
      prisma.story.count.mockResolvedValue(1);

      const page = await service.searchStories(undefined, 'thumb', {
        page: 1,
        limit: 20,
        grouped: true,
        prefer: 'en',
        languageLevel: ['A2'],
      });

      // The text matches are intersected with the chosen versions, so the
      // Turkish version of the same tale (parmak-tr) is not listed twice.
      expect(pageWhere(1)).toEqual({
        status: 'PUBLISHED',
        id: { in: ['parmak-en', 'duckling-en', 'keloglan-tr'] },
        AND: [{ id: { in: ['parmak-en', 'parmak-tr'] } }],
        languageLevel: { in: ['A2'] },
        isPremium: false,
      });
      expect(page.total).toBe(1);
      expect(page.data[0].id).toBe('parmak-en');
    });

    it('several languages: flat; a language that is off: empty; no parameter: the default language', async () => {
      await service.searchStories(USER, 'ay', { page: 1, limit: 20, language: ['tr', 'de'] });
      expect(pageWhere(0)).toMatchObject({ status: 'PUBLISHED', language: { in: ['tr', 'de'] } });

      prisma.story.findMany.mockClear();
      await expect(service.searchStories(USER, 'ay', { page: 1, limit: 20, language: ['fr'] })).resolves.toEqual({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });
      expect(prisma.story.findMany).not.toHaveBeenCalled();

      await service.searchStories(USER, 'ay', { page: 1, limit: 20 });
      expect(pageWhere(0)).toMatchObject({ status: 'PUBLISHED', language: 'tr' });
    });
  });

  // ---------------------------------------------------------------------
  describe('GET /stories/:id', () => {
    it('adds availableLanguages, isFavoriteAnyLanguage and the languages the caller asked for', async () => {
      prisma.story.findUnique.mockResolvedValue(CANDIDATES[0]);
      prisma.story.findMany
        .mockResolvedValueOnce([CANDIDATES[0], CANDIDATES[1]]) // group info
        .mockResolvedValueOnce([{ id: 'parmak-en', language: 'en', title: 'Thumbelina' }]); // translations
      prisma.favoriteStory.findMany.mockResolvedValue([{ storyId: 'parmak-en' }]);
      translationRequests.requestedLanguages.mockResolvedValue(['de']);

      const detail = await service.getStory(USER, 'parmak-tr');

      expect(translationRequests.requestedLanguages).toHaveBeenCalledWith(USER, CANDIDATES[0]);
      expect(detail).toMatchObject({
        id: 'parmak-tr',
        availableLanguages: ['tr', 'en'],
        isFavorite: false,
        isFavoriteAnyLanguage: true,
        requestedLanguages: ['de'],
        translations: [{ id: 'parmak-en', language: 'en', title: 'Thumbelina' }],
      });
    });
  });

  // ---------------------------------------------------------------------
  describe('GET /stories/favorites', () => {
    const favorite = (storyId: string, language: string, group: string | null, day: number) => ({
      storyId,
      createdAt: T(day),
      story: { id: storyId, language, translationGroupId: group },
    });

    it('flat (no grouped): one item per saved story, each with availableLanguages', async () => {
      prisma.favoriteStory.findMany.mockResolvedValue([
        { createdAt: T(9), story: CANDIDATES[1] },
        { createdAt: T(8), story: CANDIDATES[0] },
      ]);
      prisma.favoriteStory.count.mockResolvedValue(2);
      prisma.story.findMany.mockResolvedValue([CANDIDATES[0], CANDIDATES[1]]);

      const page = await service.getFavorites(USER, 1, 20);

      expect(page.total).toBe(2);
      expect(page.data.map((item: any) => [item.id, item.isFavorite, item.availableLanguages])).toEqual([
        ['parmak-en', true, ['en', 'tr']],
        ['parmak-tr', true, ['tr', 'en']],
      ]);
      expect(page.data[0]).not.toHaveProperty('favoriteStoryIds');
    });

    it('grouped: a tale saved in two languages is one item, in the content language when that one is saved', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue({ contentLanguage: 'tr' });
      prisma.favoriteStory.findMany.mockResolvedValue([
        favorite('parmak-en', 'en', 'parmak', 9),
        favorite('keloglan-tr', 'tr', null, 8),
        favorite('parmak-tr', 'tr', 'parmak', 7),
      ]);
      prisma.story.findMany
        .mockResolvedValueOnce([CANDIDATES[3], CANDIDATES[0]]) // page stories, any order
        .mockResolvedValueOnce([CANDIDATES[0], CANDIDATES[1]]); // group info

      const page = await service.getFavorites(USER, 1, 20, { grouped: true });

      expect(prisma.favoriteStory.findMany).toHaveBeenCalledWith({
        where: { userId: USER },
        select: {
          storyId: true,
          createdAt: true,
          story: { select: { id: true, language: true, translationGroupId: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(prisma.story.findMany.mock.calls[0][0]).toEqual({
        where: { id: { in: ['parmak-tr', 'keloglan-tr'] } },
      });
      // Tales, not rows.
      expect(page).toMatchObject({ total: 2, page: 1, limit: 20, totalPages: 1 });
      expect(page.data).toHaveLength(2);
      expect(page.data[0]).toMatchObject({
        id: 'parmak-tr',
        isFavorite: true,
        isFavoriteAnyLanguage: true,
        availableLanguages: ['tr', 'en'],
        // Ordered by the most recent save of the tale.
        favoritedAt: T(9),
        favoriteStoryIds: ['parmak-en', 'parmak-tr'],
        favoriteLanguages: ['en', 'tr'],
      });
      expect(page.data[1]).toMatchObject({
        id: 'keloglan-tr',
        favoritedAt: T(8),
        favoriteStoryIds: ['keloglan-tr'],
        favoriteLanguages: ['tr'],
      });
    });

    it('grouped: without a saved version in the content language the most recently saved one is shown', async () => {
      prisma.favoriteStory.findMany.mockResolvedValue([
        favorite('parmak-en', 'en', 'parmak', 9),
        favorite('parmak-tr', 'tr', 'parmak', 7),
      ]);
      prisma.story.findMany.mockResolvedValueOnce([CANDIDATES[1]]).mockResolvedValueOnce([]);

      const page = await service.getFavorites(USER, 1, 20, { grouped: true, prefer: 'de' });

      expect(page.data.map((item: any) => item.id)).toEqual(['parmak-en']);
    });

    it('grouped: pages are cut over tales; a story deleted between the reads is left out', async () => {
      prisma.favoriteStory.findMany.mockResolvedValue([
        favorite('a', 'tr', null, 9),
        favorite('b', 'tr', null, 8),
        favorite('c', 'tr', null, 7),
      ]);
      prisma.story.findMany.mockResolvedValueOnce([row({ id: 'c' })]);

      const second = await service.getFavorites(USER, 2, 2, { grouped: true });
      expect(prisma.story.findMany.mock.calls[0][0]).toEqual({ where: { id: { in: ['c'] } } });
      expect(second).toMatchObject({ total: 3, page: 2, limit: 2, totalPages: 2 });
      expect(second.data.map((item: any) => item.id)).toEqual(['c']);

      prisma.story.findMany.mockReset().mockResolvedValueOnce([row({ id: 'a' })]);
      const first = await service.getFavorites(USER, 1, 2, { grouped: true });
      expect(first.data.map((item: any) => item.id)).toEqual(['a']);
    });

    it('grouped: no favourites is an empty page without a story query', async () => {
      prisma.favoriteStory.findMany.mockResolvedValue([]);

      await expect(service.getFavorites(USER, 1, 20, { grouped: true })).resolves.toEqual({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });
      expect(prisma.story.findMany).not.toHaveBeenCalled();
    });
  });
});
