import { NotFoundException } from '@nestjs/common';
import { StoriesService } from './stories.service';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createSettingsStub, SettingsStub } from '../../test-utils/settings-stub';

const USER = 'user-1';

function storyRow(overrides: Partial<any> = {}) {
  return {
    id: 'story-1',
    title: 'Keloğlan',
    content: 'Bir varmış bir yokmuş. '.repeat(20),
    summary: null,
    ageGroup: 'SIX_TO_TEN',
    category: 'TURKISH_CLASSICS',
    language: 'tr',
    languageLevel: null,
    status: 'PUBLISHED',
    estimatedDuration: 5,
    coverImageUrl: null,
    isPremium: false,
    hasPreGeneratedNarration: false,
    translationGroupId: null,
    rightsNote: 'gizli hak notu',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * The multi-language catalogue: content language is an explicit parameter,
 * lists show only PUBLISHED stories, and app versions in the field (which
 * send none of the new parameters) keep seeing Turkish.
 */
describe('StoriesService (multi-language catalogue)', () => {
  let prisma: MockPrismaService;
  let settings: SettingsStub;
  let service: StoriesService;

  const translationRequests = { requestedLanguages: jest.fn().mockResolvedValue([]) };

  const listWhere = () => prisma.story.findMany.mock.calls[0][0].where;

  beforeEach(() => {
    prisma = createMockPrismaService();
    settings = createSettingsStub({
      'content.enabledLanguages': ['tr', 'en', 'de'],
      'content.defaultLanguage': 'tr',
    });
    service = new StoriesService(
      prisma as any,
      {} as any,
      { getReadUrl: jest.fn(async (v: string | null) => v) } as any,
      {} as any,
      settings as any,
      translationRequests as any,
    );
    prisma.subscription.findUnique.mockResolvedValue({ plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: null });
    prisma.story.findMany.mockResolvedValue([]);
    prisma.story.count.mockResolvedValue(0);
    prisma.favoriteStory.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([{ id: 'story-1' }]);
  });

  describe('GET /stories: default language for old clients', () => {
    it('a client that sends no parameters sees published Turkish stories, newest first', async () => {
      await service.getStories(USER, {} as any);

      expect(prisma.story.findMany).toHaveBeenCalledWith({
        where: { status: 'PUBLISHED', language: 'tr' },
        skip: 0,
        take: 20,
        orderBy: [{ createdAt: 'desc' }],
      });
      expect(prisma.story.count).toHaveBeenCalledWith({ where: { status: 'PUBLISHED', language: 'tr' } });
    });

    it('keeps seeing Turkish after more languages are enabled', async () => {
      settings.values['content.enabledLanguages'] = ['tr', 'en', 'de', 'fr', 'es'];

      await service.getStories(undefined, {} as any);

      expect(listWhere()).toMatchObject({ status: 'PUBLISHED', language: 'tr' });
    });

    it('the default is the content.defaultLanguage setting, read on every request', async () => {
      settings.values['content.defaultLanguage'] = 'en';
      await service.getStories(USER, {} as any);
      expect(listWhere().language).toBe('en');
    });

    it('content language never comes from the UI language setting', async () => {
      (settings.values as any)['i18n.defaultLocale'] = 'en';
      await service.getStories(USER, {} as any);
      expect(listWhere().language).toBe('tr');
    });

    it('never lists DRAFT or ARCHIVED stories, whatever the filters', async () => {
      await service.getStories(USER, { isPremium: true, category: 'BEDTIME', languageLevel: ['A1'] } as any);
      expect(listWhere().status).toBe('PUBLISHED');
    });
  });

  describe('GET /stories: language, level and sort', () => {
    it('an explicit language lists that language', async () => {
      await service.getStories(USER, { language: 'en' } as any);
      expect(listWhere()).toEqual({ status: 'PUBLISHED', language: 'en' });
    });

    it('a language that is switched off returns an empty page without touching the database', async () => {
      const res = await service.getStories(USER, { language: 'fr', page: 2, limit: 10 } as any);

      expect(res).toEqual({ data: [], total: 0, page: 2, limit: 10, totalPages: 0 });
      expect(prisma.story.findMany).not.toHaveBeenCalled();
      expect(prisma.story.count).not.toHaveBeenCalled();
      expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
    });

    it('filters by one or several CEFR levels', async () => {
      await service.getStories(USER, { languageLevel: ['A1'] } as any);
      expect(listWhere().languageLevel).toEqual({ in: ['A1'] });

      prisma.story.findMany.mockClear();
      await service.getStories(USER, { language: 'de', languageLevel: ['A2', 'B1'] } as any);
      expect(listWhere()).toEqual({
        status: 'PUBLISHED',
        language: 'de',
        languageLevel: { in: ['A2', 'B1'] },
      });
    });

    it('no level filter (absent or empty) leaves stories without a level in the list', async () => {
      await service.getStories(USER, { languageLevel: [] } as any);
      expect(listWhere()).not.toHaveProperty('languageLevel');
    });

    it('combines with the existing filters and the FREE premium rule', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await service.getStories(USER, {
        language: 'en',
        languageLevel: ['B2'],
        ageGroup: 'TEN_PLUS',
        category: 'WORLD_CLASSICS',
      } as any);

      expect(listWhere()).toEqual({
        status: 'PUBLISHED',
        language: 'en',
        languageLevel: { in: ['B2'] },
        ageGroup: 'TEN_PLUS',
        category: 'WORLD_CLASSICS',
        isPremium: false,
      });
    });

    it.each([
      ['newest', [{ createdAt: 'desc' }]],
      ['oldest', [{ createdAt: 'asc' }]],
      ['title', [{ title: 'asc' }, { createdAt: 'desc' }]],
      ['duration', [{ estimatedDuration: 'asc' }, { createdAt: 'desc' }]],
      ['level', [{ languageLevel: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }]],
    ])('sort=%s', async (sort, orderBy) => {
      await service.getStories(USER, { sort } as any);
      expect(prisma.story.findMany.mock.calls[0][0].orderBy).toEqual(orderBy);
    });

    it('items carry language, languageLevel, summary and credit, never the audit fields', async () => {
      prisma.story.findMany.mockResolvedValue([
        storyRow({ language: 'en', languageLevel: 'A2', summary: 'A boy outwits a giant.', authorName: 'Anon' }),
      ]);
      prisma.story.count.mockResolvedValue(1);

      const res = await service.getStories(USER, { language: 'en' } as any);
      const item: any = res.data[0];

      expect(item).toMatchObject({
        language: 'en',
        languageLevel: 'A2',
        summary: 'A boy outwits a giant.',
        description: 'A boy outwits a giant.',
      });
      expect(item.credit.authorName).toBe('Anon');
      expect(JSON.stringify(item)).not.toContain('gizli hak notu');
      expect(item).not.toHaveProperty('status');
      expect(item).not.toHaveProperty('translationGroupId');
    });
  });

  describe('GET /stories/search', () => {
    it('an old client (q only) searches published Turkish stories', async () => {
      await service.searchStories(USER, 'kelo', { page: 1, limit: 20 });

      expect(listWhere()).toEqual({
        status: 'PUBLISHED',
        language: 'tr',
        AND: [{ id: { in: ['story-1'] } }],
      });
    });

    it('takes the same language and level filters as the list', async () => {
      await service.searchStories(USER, 'wolf', {
        page: 1,
        limit: 20,
        language: 'de',
        languageLevel: ['A2', 'B1'],
      });

      expect(listWhere()).toMatchObject({
        status: 'PUBLISHED',
        language: 'de',
        languageLevel: { in: ['A2', 'B1'] },
      });
      expect(prisma.story.count.mock.calls[0][0].where).toEqual(listWhere());
    });

    it('an empty level list is no filter', async () => {
      await service.searchStories(USER, 'x', { page: 1, limit: 20, languageLevel: [] });
      expect(listWhere()).not.toHaveProperty('languageLevel');
    });

    it('a language that is switched off returns an empty page', async () => {
      const res = await service.searchStories(USER, 'x', { page: 1, limit: 20, language: 'fr' });

      expect(res).toEqual({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
      expect(prisma.story.findMany).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('GET /stories/:id', () => {
    it('a DRAFT story is a 404', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ status: 'DRAFT' }));

      await expect(service.getStory(USER, 'story-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('an ARCHIVED story still resolves (old favourites and narrations point at it)', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ status: 'ARCHIVED' }));

      const res: any = await service.getStory(USER, 'story-1');

      expect(res.id).toBe('story-1');
      expect(res.translations).toEqual([]);
    });

    it('a story of a language that is switched off still resolves by id', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ language: 'fr' }));

      await expect(service.getStory(USER, 'story-1')).resolves.toMatchObject({ language: 'fr' });
    });

    it('a story without a translation group has no translations and runs no sibling query', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow());

      const res: any = await service.getStory(USER, 'story-1');

      expect(res.translations).toEqual([]);
      expect(prisma.story.findMany).not.toHaveBeenCalled();
    });

    it('translations are the published siblings of the group in enabled languages, as {id, language, title}', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ translationGroupId: 'group-1' }));
      prisma.story.findMany.mockResolvedValue([
        { id: 'story-de', language: 'de', title: 'Rotkäppchen', content: 'never sent' },
        { id: 'story-en', language: 'en', title: 'Little Red Riding Hood', content: 'never sent' },
      ]);

      const res: any = await service.getStory(USER, 'story-1');

      expect(prisma.story.findMany).toHaveBeenCalledWith({
        where: {
          translationGroupId: 'group-1',
          id: { not: 'story-1' },
          status: 'PUBLISHED',
          language: { in: ['tr', 'en', 'de'] },
        },
        select: { id: true, language: true, title: true },
        orderBy: { language: 'asc' },
      });
      expect(res.translations).toEqual([
        { id: 'story-de', language: 'de', title: 'Rotkäppchen' },
        { id: 'story-en', language: 'en', title: 'Little Red Riding Hood' },
      ]);
      expect(res).not.toHaveProperty('translationGroupId');
      expect(JSON.stringify(res)).not.toContain('gizli hak notu');
    });
  });

  describe('GET /stories/languages', () => {
    it('returns the enabled languages with native name, published count and the levels present', async () => {
      prisma.story.groupBy.mockResolvedValue([
        { language: 'tr', languageLevel: null, _count: { _all: 20 } },
        { language: 'tr', languageLevel: 'B1', _count: { _all: 6 } },
        { language: 'tr', languageLevel: 'A2', _count: { _all: 4 } },
        { language: 'en', languageLevel: 'C1', _count: { _all: 1 } },
        { language: 'en', languageLevel: 'A1', _count: { _all: 2 } },
      ]);

      const res = await service.getLanguages();

      expect(prisma.story.groupBy).toHaveBeenCalledWith({
        by: ['language', 'languageLevel'],
        where: { status: 'PUBLISHED', language: { in: ['tr', 'en', 'de'] } },
        _count: { _all: true },
      });
      expect(res).toEqual({
        defaultLanguage: 'tr',
        languages: [
          { code: 'tr', nativeName: 'Türkçe', englishName: 'Turkish', isDefault: true, storyCount: 30, levels: ['A2', 'B1'] },
          { code: 'en', nativeName: 'English', englishName: 'English', isDefault: false, storyCount: 3, levels: ['A1', 'C1'] },
          { code: 'de', nativeName: 'Deutsch', englishName: 'German', isDefault: false, storyCount: 0, levels: [] },
        ],
      });
    });

    it('with the code defaults it is Turkish only', async () => {
      settings.values = {};
      prisma.story.groupBy.mockResolvedValue([]);

      const res = await service.getLanguages();

      expect(res.defaultLanguage).toBe('tr');
      expect(res.languages.map((l) => l.code)).toEqual(['tr']);
    });
  });

  describe('favourites', () => {
    it('a DRAFT story cannot be favourited', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ status: 'DRAFT' }));

      await expect(service.addToFavorites(USER, 'story-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.favoriteStory.upsert).not.toHaveBeenCalled();
    });

    it('an ARCHIVED story can still be favourited and stays in the favourites list', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ status: 'ARCHIVED' }));
      prisma.favoriteStory.upsert.mockResolvedValue({ id: 'f1', storyId: 'story-1', createdAt: new Date() });
      await expect(service.addToFavorites(USER, 'story-1')).resolves.toMatchObject({
        favorite: { storyId: 'story-1' },
      });

      prisma.favoriteStory.findMany.mockResolvedValue([
        { createdAt: new Date(), story: storyRow({ status: 'ARCHIVED', language: 'en' }) },
      ]);
      prisma.favoriteStory.count.mockResolvedValue(1);
      const favorites = await service.getFavorites(USER);

      // Favourites are not filtered by language or status.
      expect(prisma.favoriteStory.findMany.mock.calls[0][0].where).toEqual({ userId: USER });
      expect(favorites.data).toHaveLength(1);
    });
  });
});
