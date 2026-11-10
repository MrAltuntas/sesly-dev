import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { StoriesService, PREMIUM_STORY_MESSAGE, RELATED_CATEGORY_LIMIT } from './stories.service';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createSettingsStub, SettingsStub } from '../../test-utils/settings-stub';

/** Every list is limited to published stories of the requested (default: Turkish) language. */
const LIVE = { status: 'PUBLISHED', language: 'tr' };
const DETAIL_KEYS = ['translations', 'requestedLanguages', 'part', 'translation'];

const USER = 'user-1';
const NOW = new Date('2026-09-28T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const STORY_LIST_ITEM_KEYS = [
  'ageGroup',
  'availableLanguages',
  'category',
  'coverImageUrl',
  'coverKey',
  'createdAt',
  'credit',
  'description',
  'estimatedDuration',
  'hasPreGeneratedNarration',
  'id',
  'isFavorite',
  'isFavoriteAnyLanguage',
  'isMachineTranslation',
  'contentWarnings',
  'isPremium',
  'language',
  'languageLevel',
  'summary',
  'title',
  'updatedAt',
].sort();

function storyRow(overrides: Partial<any> = {}) {
  return {
    id: 'story-1',
    title: 'Keloglan',
    content: 'Bir varmis bir yokmus. '.repeat(20),
    ageGroup: 'SIX_TO_TEN',
    category: 'TURKISH_CLASSICS',
    language: 'tr',
    estimatedDuration: 5,
    coverImageUrl: 'https://storage.googleapis.com/bucket/stories/covers/story-1.png',
    isPremium: false,
    hasPreGeneratedNarration: false,
    preprocessedSegments: [{ text: 'secret full text' }],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Subscription rows for the effective-plan matrix. */
const subs = {
  proActive: { plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY) },
  creatorActive: { plan: 'CREATOR', status: 'ACTIVE', currentPeriodEnd: null },
  // Admin grant: only currentPeriodEnd, no store billing ids, date passed.
  proExpiredAdminGrant: {
    plan: 'PRO',
    status: 'ACTIVE',
    currentPeriodEnd: new Date(NOW.getTime() - 60 * 1000),
    stripeSubscriptionId: null,
    appleTransactionId: null,
    googlePurchaseToken: null,
  },
  proStatusExpired: { plan: 'PRO', status: 'EXPIRED', currentPeriodEnd: new Date(NOW.getTime() + DAY) },
  // Store-billed PRO whose period ended 1h ago is still within the 24h grace.
  proStoreInGrace: {
    plan: 'PRO',
    status: 'ACTIVE',
    currentPeriodEnd: new Date(NOW.getTime() - 60 * 60 * 1000),
    appleTransactionId: 'apple-tx',
  },
  free: { plan: 'FREE', status: 'ACTIVE', currentPeriodEnd: null },
};

describe('StoriesService', () => {
  let prisma: MockPrismaService;
  let storage: { getReadUrl: jest.Mock };
  let service: StoriesService;
  let settings: SettingsStub;
  let translationRequests: { requestedLanguages: jest.Mock };

  beforeAll(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout', 'setInterval'],
    });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    prisma = createMockPrismaService();
    storage = {
      getReadUrl: jest.fn(async (v: string | null) => (v ? `signed:${v}` : null)),
    };
    settings = createSettingsStub();
    translationRequests = { requestedLanguages: jest.fn().mockResolvedValue([]) };
    service = new StoriesService(
      prisma as any,
      {} as any,
      storage as any,
      {} as any,
      settings as any,
      translationRequests as any,
    );

    prisma.subscription.findUnique.mockResolvedValue(null);
    prisma.story.findMany.mockResolvedValue([]);
    prisma.story.count.mockResolvedValue(0);
    prisma.favoriteStory.findMany.mockResolvedValue([]);
  });

  // -------------------------------------------------------------
  // GET /stories
  // -------------------------------------------------------------
  describe('getStories', () => {
    it('anonymous caller: FREE visibility, no subscription or favorites lookup, isFavorite false', async () => {
      prisma.story.findMany.mockResolvedValue([storyRow({ id: 'a' }), storyRow({ id: 'b' })]);
      prisma.story.count.mockResolvedValue(2);

      const res = await service.getStories(undefined, {} as any);

      expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
      expect(prisma.favoriteStory.findMany).not.toHaveBeenCalled();
      const args = prisma.story.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ ...LIVE, isPremium: false });
      expect(prisma.story.count).toHaveBeenCalledWith({ where: { ...LIVE, isPremium: false } });
      expect(res.data.map((s: any) => s.isFavorite)).toEqual([false, false]);
    });

    it('authenticated user without a subscription row is FREE: premium stories hidden', async () => {
      await service.getStories(USER, {} as any);

      expect(prisma.subscription.findUnique).toHaveBeenCalledWith({ where: { userId: USER } });
      expect(prisma.story.findMany.mock.calls[0][0].where).toEqual({ ...LIVE, isPremium: false });
    });

    it.each([
      ['FREE plan row', subs.free],
      ['expired admin grant (PRO, period ended, no store billing)', subs.proExpiredAdminGrant],
      ['PRO with status EXPIRED', subs.proStatusExpired],
    ])('%s resolves to FREE: premium stories hidden', async (_label, sub) => {
      prisma.subscription.findUnique.mockResolvedValue(sub);

      await service.getStories(USER, {} as any);

      expect(prisma.story.findMany.mock.calls[0][0].where).toEqual({ ...LIVE, isPremium: false });
      expect(prisma.story.count.mock.calls[0][0].where).toEqual({ ...LIVE, isPremium: false });
    });

    it.each([
      ['active PRO', subs.proActive],
      ['active CREATOR', subs.creatorActive],
      ['store-billed PRO inside the 24h renewal grace', subs.proStoreInGrace],
    ])('%s sees premium stories (no isPremium filter)', async (_label, sub) => {
      prisma.subscription.findUnique.mockResolvedValue(sub);

      await service.getStories(USER, {} as any);

      expect(prisma.story.findMany.mock.calls[0][0].where).toEqual({ ...LIVE });
    });

    it('explicit isPremium=false is honoured for a paying user', async () => {
      prisma.subscription.findUnique.mockResolvedValue(subs.proActive);

      await service.getStories(USER, { isPremium: false } as any);

      expect(prisma.story.findMany.mock.calls[0][0].where).toEqual({ ...LIVE, isPremium: false });
    });

    it('explicit isPremium=true lets a FREE caller list (locked) premium stories; items carry isPremium and no content', async () => {
      // Current contract: the explicit filter wins over the FREE default so the
      // client can render a locked "Pro" shelf. Detail (GET /stories/:id) is
      // what enforces the 403.
      prisma.story.findMany.mockResolvedValue([storyRow({ id: 'p1', isPremium: true })]);
      prisma.story.count.mockResolvedValue(1);

      const res = await service.getStories(undefined, { isPremium: true } as any);

      expect(prisma.story.findMany.mock.calls[0][0].where).toEqual({ ...LIVE, isPremium: true });
      expect(res.data[0].isPremium).toBe(true);
      expect(res.data[0]).not.toHaveProperty('content');
    });

    it('passes ageGroup/category filters, pagination and newest-first ordering to prisma', async () => {
      prisma.subscription.findUnique.mockResolvedValue(subs.proActive);

      await service.getStories(USER, {
        ageGroup: 'THREE_TO_SIX',
        category: 'BEDTIME',
        page: 3,
        limit: 10,
      } as any);

      expect(prisma.story.findMany).toHaveBeenCalledWith({
        where: { ...LIVE, ageGroup: 'THREE_TO_SIX', category: 'BEDTIME' },
        skip: 20,
        take: 10,
        orderBy: [{ createdAt: 'desc' }],
      });
      expect(prisma.story.count).toHaveBeenCalledWith({
        where: { ...LIVE, ageGroup: 'THREE_TO_SIX', category: 'BEDTIME' },
      });
    });

    it('defaults to page 1 / limit 20', async () => {
      await service.getStories(undefined, {} as any);

      const args = prisma.story.findMany.mock.calls[0][0];
      expect(args.skip).toBe(0);
      expect(args.take).toBe(20);
    });

    it('returns the PaginatedResult envelope {data,total,page,limit,totalPages}', async () => {
      prisma.story.findMany.mockResolvedValue([storyRow({ id: 'a' })]);
      prisma.story.count.mockResolvedValue(41);

      const res = await service.getStories(undefined, { page: 2, limit: 20 } as any);

      expect(Object.keys(res).sort()).toEqual(['data', 'limit', 'page', 'total', 'totalPages']);
      expect(res).toMatchObject({ total: 41, page: 2, limit: 20, totalPages: 3 });
    });

    it('computes isFavorite per item for the authenticated user (lookup scoped by userId + page ids)', async () => {
      prisma.story.findMany.mockResolvedValue([
        storyRow({ id: 'a' }),
        storyRow({ id: 'b' }),
        storyRow({ id: 'c' }),
      ]);
      prisma.story.count.mockResolvedValue(3);
      prisma.favoriteStory.findMany.mockResolvedValue([{ storyId: 'b' }]);

      const res = await service.getStories(USER, {} as any);

      expect(prisma.favoriteStory.findMany).toHaveBeenCalledWith({
        where: { userId: USER, storyId: { in: ['a', 'b', 'c'] } },
        select: { storyId: true },
      });
      expect(res.data.map((s: any) => [s.id, s.isFavorite])).toEqual([
        ['a', false],
        ['b', true],
        ['c', false],
      ]);
    });

    it('skips the favorites query when the page is empty', async () => {
      await service.getStories(USER, {} as any);

      expect(prisma.favoriteStory.findMany).not.toHaveBeenCalled();
    });

    it('list items use the shared list shape: no content/preprocessedSegments, presigned cover', async () => {
      prisma.story.findMany.mockResolvedValue([storyRow()]);
      prisma.story.count.mockResolvedValue(1);

      const res = await service.getStories(undefined, {} as any);
      const item: any = res.data[0];

      expect(Object.keys(item).sort()).toEqual(STORY_LIST_ITEM_KEYS);
      expect(item).not.toHaveProperty('content');
      expect(item).not.toHaveProperty('preprocessedSegments');
      expect(storage.getReadUrl).toHaveBeenCalledWith(storyRow().coverImageUrl);
      expect(item.coverImageUrl).toBe(`signed:${storyRow().coverImageUrl}`);
      expect(item.description.length).toBeLessThanOrEqual(153);
    });
  });

  // -------------------------------------------------------------
  // GET /stories/search
  // -------------------------------------------------------------
  describe('searchStories', () => {
    beforeEach(() => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    });

    it('matches the folded title and content in SQL and hides premium for anonymous callers', async () => {
      await service.searchStories(undefined, 'kucuk', { page: 1, limit: 20 });

      const raw = prisma.$queryRaw.mock.calls[0][0];
      expect(raw.text).toContain('s."searchText" LIKE');
      expect(raw.text).toContain('sesly_search_fold(');
      expect(raw.values).toEqual(['kucuk']);

      expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
      expect(prisma.story.findMany).toHaveBeenCalledWith({
        where: {
          ...LIVE,
          AND: [{ id: { in: ['a', 'b'] } }],
          isPremium: false,
        },
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      });
      expect(prisma.story.count).toHaveBeenCalledWith({
        where: prisma.story.findMany.mock.calls[0][0].where,
      });
    });

    it('binds the trimmed term as typed: the SQL fold makes YILDIZ, yildiz and Yıldız equal', async () => {
      await service.searchStories(undefined, '  YILDIZ  ', { page: 1, limit: 20 });
      await service.searchStories(undefined, 'Yıldız', { page: 1, limit: 20 });

      expect(prisma.$queryRaw.mock.calls.map((c: any[]) => c[0].values)).toEqual([['YILDIZ'], ['Yıldız']]);
    });

    it('no match: an empty page, and neither the plan nor the page is loaded', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const res = await service.searchStories(USER, 'zzz', { page: 2, limit: 5 });

      expect(res).toEqual({ data: [], total: 0, page: 2, limit: 5, totalPages: 0 });
      expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
      expect(prisma.story.findMany).not.toHaveBeenCalled();
      expect(prisma.story.count).not.toHaveBeenCalled();
    });

    it('a term of only spaces matches nothing and runs no query', async () => {
      const res = await service.searchStories(USER, '   ', { page: 1, limit: 20 });

      expect(res).toEqual({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.story.findMany).not.toHaveBeenCalled();
    });

    it('hides premium for an expired admin grant', async () => {
      prisma.subscription.findUnique.mockResolvedValue(subs.proExpiredAdminGrant);

      await service.searchStories(USER, 'x', { page: 1, limit: 20 });

      expect(prisma.story.findMany.mock.calls[0][0].where.isPremium).toBe(false);
      expect(prisma.story.count.mock.calls[0][0].where.isPremium).toBe(false);
    });

    it('does not filter premium for an active PRO user', async () => {
      prisma.subscription.findUnique.mockResolvedValue(subs.proActive);

      await service.searchStories(USER, 'x', { page: 1, limit: 20 });

      expect(prisma.story.findMany.mock.calls[0][0].where).not.toHaveProperty('isPremium');
    });

    it('paginates and returns the envelope with list-shaped items and favorites for the user', async () => {
      prisma.subscription.findUnique.mockResolvedValue(subs.proActive);
      prisma.story.findMany.mockResolvedValue([storyRow({ id: 'a' }), storyRow({ id: 'b' })]);
      prisma.story.count.mockResolvedValue(12);
      prisma.favoriteStory.findMany.mockResolvedValue([{ storyId: 'a' }]);

      const res = await service.searchStories(USER, 'x', { page: 2, limit: 5 });

      const args = prisma.story.findMany.mock.calls[0][0];
      expect(args.skip).toBe(5);
      expect(args.take).toBe(5);
      expect(res).toMatchObject({ total: 12, page: 2, limit: 5, totalPages: 3 });
      expect(res.data.map((s: any) => s.isFavorite)).toEqual([true, false]);
      for (const item of res.data) {
        expect(Object.keys(item).sort()).toEqual(STORY_LIST_ITEM_KEYS);
      }
    });

    it('anonymous search never computes favorites', async () => {
      prisma.story.findMany.mockResolvedValue([storyRow({ id: 'a' })]);
      prisma.story.count.mockResolvedValue(1);

      const res = await service.searchStories(undefined, 'x', { page: 1, limit: 20 });

      expect(prisma.favoriteStory.findMany).not.toHaveBeenCalled();
      expect(res.data[0].isFavorite).toBe(false);
    });
  });

  // -------------------------------------------------------------
  // GET /stories/:id
  // -------------------------------------------------------------
  describe('getStory', () => {
    it('404 when the story does not exist', async () => {
      prisma.story.findUnique.mockResolvedValue(null);

      await expect(service.getStory(USER, 'missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.story.findUnique).toHaveBeenCalledWith({ where: { id: 'missing' } });
    });

    it.each([
      ['no subscription row', null],
      ['FREE plan row', subs.free],
      ['expired admin grant', subs.proExpiredAdminGrant],
      ['PRO with status EXPIRED', subs.proStatusExpired],
    ])('premium story for %s -> 403 PREMIUM_STORY', async (_label, sub) => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ isPremium: true }));
      prisma.subscription.findUnique.mockResolvedValue(sub);

      const err = await service.getStory(USER, 'story-1').catch((e) => e);

      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getStatus()).toBe(403);
      expect(err.getResponse()).toEqual({ code: 'PREMIUM_STORY', message: PREMIUM_STORY_MESSAGE });
      expect(prisma.subscription.findUnique).toHaveBeenCalledWith({ where: { userId: USER } });
      expect(storage.getReadUrl).not.toHaveBeenCalled();
    });

    it('premium story for an active PRO user returns the list-shaped item (no content)', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ isPremium: true }));
      prisma.subscription.findUnique.mockResolvedValue(subs.proActive);

      const res: any = await service.getStory(USER, 'story-1');

      expect(Object.keys(res).sort()).toEqual([...STORY_LIST_ITEM_KEYS, ...DETAIL_KEYS].sort());
      expect(res).not.toHaveProperty('content');
      expect(res).not.toHaveProperty('preprocessedSegments');
      expect(res.isPremium).toBe(true);
      expect(res.coverImageUrl).toBe(`signed:${storyRow().coverImageUrl}`);
    });

    it('free story skips the subscription lookup entirely', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ isPremium: false }));

      await service.getStory(USER, 'story-1');

      expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
    });

    it('isFavorite reflects the caller\'s favorite row', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow());
      prisma.favoriteStory.findMany.mockResolvedValue([{ storyId: 'story-1' }]);

      const res = await service.getStory(USER, 'story-1');

      expect(prisma.favoriteStory.findMany).toHaveBeenCalledWith({
        where: { userId: USER, storyId: { in: ['story-1'] } },
        select: { storyId: true },
      });
      expect(res.isFavorite).toBe(true);
    });

    it('isFavorite false when not favorited', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow());

      const res = await service.getStory(USER, 'story-1');

      expect(res.isFavorite).toBe(false);
    });
  });

  // -------------------------------------------------------------
  // GET /stories/:id/related
  // -------------------------------------------------------------
  describe('getRelatedStories', () => {
    const tale = storyRow({
      id: 'tr-2',
      title: 'Parmak Kız 2',
      category: 'WORLD_CLASSICS',
      translationGroupId: 'g-1',
      partGroupId: 'p-1',
      partNumber: 2,
    });
    /** What each of the three queries answers, told apart by their filter. */
    function answer(rows: { languages?: any[]; parts?: any[]; category?: any[] }) {
      prisma.story.findMany.mockImplementation(async (args: any) => {
        if (args.where?.translationGroupId === 'g-1') return rows.languages ?? [];
        if (args.where?.partGroupId === 'p-1') return rows.parts ?? [];
        if (args.where?.category) return rows.category ?? [];
        return [];
      });
    }
    const categoryCall = () =>
      prisma.story.findMany.mock.calls.map((c: any[]) => c[0]).find((args: any) => args.where?.category);

    beforeEach(() => {
      prisma.story.findUnique.mockResolvedValue(tale);
    });

    it('groups the other versions, the other parts and more of the category, list-shaped', async () => {
      answer({
        languages: [
          storyRow({ id: 'de-2', language: 'de', translationGroupId: 'g-1' }),
          storyRow({ id: 'en-2', language: 'en', translationGroupId: 'g-1' }),
        ],
        parts: [
          storyRow({ id: 'tr-1', partGroupId: 'p-1', partNumber: 1 }),
          storyRow({ id: 'tr-3', partGroupId: 'p-1', partNumber: 3 }),
        ],
        category: [storyRow({ id: 'other', category: 'WORLD_CLASSICS' })],
      });
      settings.values['content.enabledLanguages'] = ['tr', 'en', 'de'];

      const res = await service.getRelatedStories(USER, 'tr-2');

      // Catalogue order: English before German.
      expect(res.languages.map((s) => s.id)).toEqual(['en-2', 'de-2']);
      expect(res.parts.map((s) => [s.id, s.partNumber])).toEqual([
        ['tr-1', 1],
        ['tr-3', 3],
      ]);
      expect(res.category.map((s) => s.id)).toEqual(['other']);
      for (const item of [...res.languages, ...res.category]) {
        expect(Object.keys(item).sort()).toEqual(STORY_LIST_ITEM_KEYS);
      }
      expect(Object.keys(res.parts[0]).sort()).toEqual([...STORY_LIST_ITEM_KEYS, 'partNumber'].sort());
      expect(res.languages[0]).not.toHaveProperty('content');
    });

    it('asks only for published versions in enabled languages and published parts in part order', async () => {
      settings.values['content.enabledLanguages'] = ['tr', 'en'];
      answer({});
      await service.getRelatedStories(USER, 'tr-2');

      const calls = prisma.story.findMany.mock.calls.map((c: any[]) => c[0]);
      expect(calls).toContainEqual({
        where: {
          translationGroupId: 'g-1',
          id: { not: 'tr-2' },
          status: 'PUBLISHED',
          language: { in: ['tr', 'en'] },
        },
      });
      expect(calls).toContainEqual({
        where: { partGroupId: 'p-1', id: { not: 'tr-2' }, status: 'PUBLISHED' },
        orderBy: { partNumber: 'asc' },
      });
    });

    it('more of the category: same language, never this tale, only first parts, newest first, at most 12', async () => {
      answer({});
      await service.getRelatedStories(USER, 'tr-2');

      expect(categoryCall()).toEqual({
        where: {
          status: 'PUBLISHED',
          language: 'tr',
          category: 'WORLD_CLASSICS',
          id: { not: 'tr-2' },
          AND: [
            { OR: [{ partNumber: null }, { partNumber: 1 }] },
            { OR: [{ translationGroupId: null }, { translationGroupId: { not: 'g-1' } }] },
            { OR: [{ partGroupId: null }, { partGroupId: { not: 'p-1' } }] },
          ],
          isPremium: false,
        },
        take: RELATED_CATEGORY_LIMIT,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
      expect(RELATED_CATEGORY_LIMIT).toBe(12);
    });

    it('a paid plan gets premium stories of the category; a story of its own tale needs no group filter', async () => {
      prisma.subscription.findUnique.mockResolvedValue(subs.proActive);
      prisma.story.findUnique.mockResolvedValue(storyRow({ id: 'solo', category: 'BEDTIME' }));
      answer({});

      const res = await service.getRelatedStories(USER, 'solo');

      expect(categoryCall().where).toEqual({
        status: 'PUBLISHED',
        language: 'tr',
        category: 'BEDTIME',
        id: { not: 'solo' },
        AND: [{ OR: [{ partNumber: null }, { partNumber: 1 }] }],
      });
      // No group: neither the versions nor the parts are asked for.
      expect(prisma.story.findMany).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ languages: [], parts: [], category: [] });
    });

    it('a story in a language that was switched off offers no more of its category', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ id: 'ru-1', language: 'ru' }));
      answer({});

      const res = await service.getRelatedStories(USER, 'ru-1');

      expect(categoryCall()).toBeUndefined();
      expect(res.category).toEqual([]);
    });

    it('answers like the detail: 404 for a missing or draft story, 403 for a premium story on FREE', async () => {
      prisma.story.findUnique.mockResolvedValue(null);
      await expect(service.getRelatedStories(USER, 'missing')).rejects.toBeInstanceOf(NotFoundException);

      prisma.story.findUnique.mockResolvedValue(storyRow({ status: 'DRAFT' }));
      await expect(service.getRelatedStories(USER, 'story-1')).rejects.toBeInstanceOf(NotFoundException);

      prisma.story.findUnique.mockResolvedValue(storyRow({ isPremium: true }));
      const err = await service.getRelatedStories(USER, 'story-1').catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toEqual({ code: 'PREMIUM_STORY', message: PREMIUM_STORY_MESSAGE });
      // The plan is read once, for the premium check and the category alike.
      expect(prisma.subscription.findUnique).toHaveBeenCalledTimes(3);
    });

    it('marks the favourites of every group in one lookup', async () => {
      answer({
        languages: [storyRow({ id: 'en-2', language: 'en', translationGroupId: 'g-1' })],
        category: [storyRow({ id: 'other' })],
      });
      prisma.favoriteStory.findMany.mockResolvedValue([{ storyId: 'other' }]);

      const res = await service.getRelatedStories(USER, 'tr-2');

      expect(prisma.favoriteStory.findMany).toHaveBeenCalledTimes(1);
      expect(res.category[0].isFavorite).toBe(true);
      expect(res.languages[0].isFavorite).toBe(false);
    });
  });

  // -------------------------------------------------------------
  // PATCH /stories/:id/progress
  // -------------------------------------------------------------
  describe('updateProgress', () => {
    const VOICE = 'voice-1';
    const key = { userId_storyId_voiceProfileId: { userId: USER, storyId: 'story-1', voiceProfileId: VOICE } };

    beforeEach(() => {
      prisma.story.findUnique.mockResolvedValue(storyRow());
      prisma.voiceProfile.findFirst.mockResolvedValue({ id: VOICE, userId: USER });
      prisma.userStoryProgress.upsert.mockResolvedValue({ id: 'prog-1', lastChunkIndex: 4 });
      prisma.storyNarration.update.mockResolvedValue({});
    });

    it('404 when the story does not exist; nothing is written', async () => {
      prisma.story.findUnique.mockResolvedValue(null);

      await expect(service.updateProgress(USER, 'story-1', VOICE, 4)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.userStoryProgress.upsert).not.toHaveBeenCalled();
    });

    it('404 when the voice profile is not owned by the caller (lookup scoped by userId)', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(null);

      await expect(service.updateProgress(USER, 'story-1', 'someone-elses-voice', 4)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.voiceProfile.findFirst).toHaveBeenCalledWith({
        where: { id: 'someone-elses-voice', userId: USER },
      });
      expect(prisma.userStoryProgress.upsert).not.toHaveBeenCalled();
    });

    it('upserts on the (user, story, voice) key without completedAt', async () => {
      const res = await service.updateProgress(USER, 'story-1', VOICE, 4);

      expect(prisma.userStoryProgress.upsert).toHaveBeenCalledWith({
        where: key,
        create: { userId: USER, storyId: 'story-1', voiceProfileId: VOICE, lastChunkIndex: 4, completedAt: null },
        update: { lastChunkIndex: 4, updatedAt: NOW },
      });
      expect(res).toEqual({
        message: 'Progress updated successfully',
        progress: { id: 'prog-1', lastChunkIndex: 4 },
      });
    });

    it('stores completedAt as a Date on both create and update when provided', async () => {
      const iso = '2026-09-27T20:00:00.000Z';

      await service.updateProgress(USER, 'story-1', VOICE, 9, iso);

      const args = prisma.userStoryProgress.upsert.mock.calls[0][0];
      expect(args.create.completedAt).toEqual(new Date(iso));
      expect(args.update.completedAt).toEqual(new Date(iso));
    });

    it('touches the matching narration so it floats to the top of the library', async () => {
      await service.updateProgress(USER, 'story-1', VOICE, 4);

      expect(prisma.storyNarration.update).toHaveBeenCalledWith({
        where: key,
        data: { updatedAt: NOW },
      });
    });

    it('still succeeds when there is no narration row to touch', async () => {
      prisma.storyNarration.update.mockRejectedValue(new Error('Record to update not found'));

      await expect(service.updateProgress(USER, 'story-1', VOICE, 4)).resolves.toMatchObject({
        message: 'Progress updated successfully',
      });
    });
  });

  // -------------------------------------------------------------
  // Favorites
  // -------------------------------------------------------------
  describe('addToFavorites', () => {
    it('404 when the story does not exist; nothing is written', async () => {
      prisma.story.findUnique.mockResolvedValue(null);

      await expect(service.addToFavorites(USER, 'missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.favoriteStory.upsert).not.toHaveBeenCalled();
    });

    it('is idempotent: upsert on (userId, storyId) with an empty update', async () => {
      const createdAt = new Date('2026-09-01T00:00:00Z');
      prisma.story.findUnique.mockResolvedValue(storyRow());
      prisma.favoriteStory.upsert.mockResolvedValue({ id: 'fav-1', userId: USER, storyId: 'story-1', createdAt });

      const first = await service.addToFavorites(USER, 'story-1');
      const second = await service.addToFavorites(USER, 'story-1');

      expect(prisma.favoriteStory.upsert).toHaveBeenCalledWith({
        where: { userId_storyId: { userId: USER, storyId: 'story-1' } },
        create: { userId: USER, storyId: 'story-1' },
        update: {},
      });
      expect(prisma.favoriteStory.create).not.toHaveBeenCalled();
      expect(first).toEqual({
        message: 'Story added to favorites',
        favorite: { id: 'fav-1', storyId: 'story-1', addedAt: createdAt },
      });
      expect(second).toEqual(first);
    });
  });

  describe('removeFromFavorites', () => {
    it('deletes only the caller\'s favorite row', async () => {
      prisma.favoriteStory.deleteMany.mockResolvedValue({ count: 1 });

      const res = await service.removeFromFavorites(USER, 'story-1');

      expect(prisma.favoriteStory.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER, storyId: 'story-1' },
      });
      expect(res).toEqual({ message: 'Story removed from favorites' });
    });

    it('404 when the story is not in the caller\'s favorites', async () => {
      prisma.favoriteStory.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.removeFromFavorites(USER, 'story-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getFavorites', () => {
    it('lists only the caller\'s favorites, newest first, paginated', async () => {
      prisma.favoriteStory.findMany.mockResolvedValue([]);
      prisma.favoriteStory.count.mockResolvedValue(0);

      await service.getFavorites(USER, 3, 10);

      expect(prisma.favoriteStory.findMany).toHaveBeenCalledWith({
        where: { userId: USER },
        include: { story: true },
        skip: 20,
        take: 10,
        orderBy: { createdAt: 'desc' },
      });
      expect(prisma.favoriteStory.count).toHaveBeenCalledWith({ where: { userId: USER } });
    });

    it('defaults to page 1 / limit 20', async () => {
      prisma.favoriteStory.findMany.mockResolvedValue([]);
      prisma.favoriteStory.count.mockResolvedValue(0);

      const res = await service.getFavorites(USER);

      const args = prisma.favoriteStory.findMany.mock.calls[0][0];
      expect(args.skip).toBe(0);
      expect(args.take).toBe(20);
      expect(res).toEqual({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    });

    it('items are list-shaped + favoritedAt, isFavorite always true, no content, presigned cover', async () => {
      const favAt = new Date('2026-09-10T00:00:00Z');
      prisma.favoriteStory.findMany.mockResolvedValue([
        { id: 'fav-1', userId: USER, storyId: 'story-1', createdAt: favAt, story: storyRow() },
      ]);
      prisma.favoriteStory.count.mockResolvedValue(1);

      const res = await service.getFavorites(USER, 1, 20);
      const item: any = res.data[0];

      expect(Object.keys(item).sort()).toEqual([...STORY_LIST_ITEM_KEYS, 'favoritedAt'].sort());
      expect(item.isFavorite).toBe(true);
      expect(item.favoritedAt).toBe(favAt);
      expect(item).not.toHaveProperty('content');
      expect(item).not.toHaveProperty('preprocessedSegments');
      expect(item.coverImageUrl).toBe(`signed:${storyRow().coverImageUrl}`);
      expect(res).toMatchObject({ total: 1, page: 1, limit: 20, totalPages: 1 });
    });
  });
});
