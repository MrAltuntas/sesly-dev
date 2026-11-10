import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CollectionsService } from './collections.service';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createSettingsStub, SettingsStub } from '../../test-utils/settings-stub';

const USER = 'user-1';
const COLL_ID = 'coll-1';

const COLLECTION_KEYS = [
  'coverImageUrl',
  'createdAt',
  'description',
  'id',
  'isActive',
  'language',
  'slug',
  'sortOrder',
  'storyCount',
  'subtitle',
  'title',
  'tone',
  'updatedAt',
].sort();

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

function collectionRow(overrides: Partial<any> = {}) {
  return {
    id: COLL_ID,
    slug: 'sleep',
    language: 'tr',
    title: 'Uyku Vakti',
    subtitle: 'Sakin masallar',
    description: 'Uzun aciklama',
    tone: 'TRUST',
    coverImageUrl: 'collections/sleep.png',
    isActive: true,
    sortOrder: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    _count: { stories: 4 },
    ...overrides,
  };
}

function storyRow(overrides: Partial<any> = {}) {
  return {
    id: 'story-1',
    title: 'Keloglan',
    content: 'Bir varmis bir yokmus. '.repeat(20),
    ageGroup: 'SIX_TO_TEN',
    category: 'TURKISH_CLASSICS',
    language: 'tr',
    estimatedDuration: 5,
    coverImageUrl: 'stories/covers/story-1.png',
    isPremium: false,
    hasPreGeneratedNarration: false,
    preprocessedSegments: [{ text: 'secret full text' }],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function linkRow(storyId: string, position: number, storyOverrides: Partial<any> = {}) {
  return {
    collectionId: COLL_ID,
    storyId,
    position,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    story: storyRow({ id: storyId, ...storyOverrides }),
  };
}

/** What a client may see of a collection: published stories in the collection language. */
const VISIBLE_TR = { story: { status: 'PUBLISHED', language: 'tr' } };
const PUBLIC_COUNT_TR = { _count: { select: { stories: { where: VISIBLE_TR } } } };

describe('CollectionsService', () => {
  let prisma: MockPrismaService;
  let storage: { getReadUrl: jest.Mock };
  let service: CollectionsService;
  let settings: SettingsStub;

  beforeEach(() => {
    prisma = createMockPrismaService();
    storage = {
      getReadUrl: jest.fn(async (v: string | null) => (v ? `signed:${v}` : null)),
    };
    settings = createSettingsStub();
    service = new CollectionsService(prisma as any, storage as any, settings as any);

    prisma.collection.findMany.mockResolvedValue([]);
    prisma.collection.count.mockResolvedValue(0);
    prisma.storyOnCollection.findMany.mockResolvedValue([]);
    prisma.storyOnCollection.count.mockResolvedValue(0);
    prisma.favoriteStory.findMany.mockResolvedValue([]);
  });

  // -----------------------------------------------------------------
  // Public
  // -----------------------------------------------------------------
  describe('list (public)', () => {
    it('only queries active collections, ordered by sortOrder then createdAt, with story counts', async () => {
      await service.list();

      expect(prisma.collection.findMany).toHaveBeenCalledWith({
        where: { isActive: true, language: 'tr' },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: PUBLIC_COUNT_TR,
      });
    });

    it('maps rows to the response DTO with presigned cover and storyCount', async () => {
      const row = collectionRow();
      prisma.collection.findMany.mockResolvedValue([row]);

      const [dto] = await service.list();

      expect(Object.keys(dto).sort()).toEqual(COLLECTION_KEYS);
      expect(dto).toEqual({
        id: COLL_ID,
        slug: 'sleep',
        language: 'tr',
        title: 'Uyku Vakti',
        subtitle: 'Sakin masallar',
        description: 'Uzun aciklama',
        tone: 'TRUST',
        coverImageUrl: 'signed:collections/sleep.png',
        isActive: true,
        sortOrder: 1,
        storyCount: 4,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
      expect(dto).not.toHaveProperty('_count');
      expect(storage.getReadUrl).toHaveBeenCalledWith('collections/sleep.png');
    });

    it('storyCount defaults to 0 and a missing cover maps to null', async () => {
      const row: any = collectionRow({ coverImageUrl: null });
      delete row._count;
      prisma.collection.findMany.mockResolvedValue([row]);

      const [dto] = await service.list();

      expect(dto.storyCount).toBe(0);
      expect(dto.coverImageUrl).toBeNull();
    });
  });

  describe('getBySlug (public)', () => {
    it('404 when the slug does not exist', async () => {
      prisma.collection.findUnique.mockResolvedValue(null);

      await expect(service.getBySlug('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 when the collection is inactive (hidden from public)', async () => {
      prisma.collection.findUnique.mockResolvedValue(collectionRow({ isActive: false }));

      await expect(service.getBySlug('sleep')).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.getReadUrl).not.toHaveBeenCalled();
    });

    it('returns the DTO for an active collection', async () => {
      prisma.collection.findUnique.mockResolvedValue(collectionRow());

      const dto = await service.getBySlug('sleep');

      expect(prisma.collection.findUnique).toHaveBeenCalledWith({
        where: { slug_language: { slug: 'sleep', language: 'tr' } },
        include: PUBLIC_COUNT_TR,
      });
      expect(Object.keys(dto).sort()).toEqual(COLLECTION_KEYS);
      expect(dto.coverImageUrl).toBe('signed:collections/sleep.png');
    });
  });

  describe('getStories (public)', () => {
    beforeEach(() => {
      prisma.collection.findUnique.mockResolvedValue({ id: COLL_ID, isActive: true });
    });

    it('404 when the slug does not exist', async () => {
      prisma.collection.findUnique.mockResolvedValue(null);

      await expect(service.getStories('nope', 1, 20)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.storyOnCollection.findMany).not.toHaveBeenCalled();
    });

    it('404 for an inactive collection; stories are never read', async () => {
      prisma.collection.findUnique.mockResolvedValue({ id: COLL_ID, isActive: false });

      await expect(service.getStories('sleep', 1, 20, USER)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.storyOnCollection.findMany).not.toHaveBeenCalled();
    });

    it('reads links of that collection ordered by position, paginated', async () => {
      await service.getStories('sleep', 2, 10);

      expect(prisma.collection.findUnique).toHaveBeenCalledWith({
        where: { slug_language: { slug: 'sleep', language: 'tr' } },
        select: { id: true, isActive: true },
      });
      expect(prisma.storyOnCollection.findMany).toHaveBeenCalledWith({
        where: { collectionId: COLL_ID, ...VISIBLE_TR },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        skip: 10,
        take: 10,
        include: { story: true },
      });
      expect(prisma.storyOnCollection.count).toHaveBeenCalledWith({
        where: { collectionId: COLL_ID, ...VISIBLE_TR },
      });
    });

    it('normalizes out-of-range pagination (page < 1 -> 1, limit > 100 -> 100)', async () => {
      const res = await service.getStories('sleep', 0, 500);

      const args = prisma.storyOnCollection.findMany.mock.calls[0][0];
      expect(args.skip).toBe(0);
      expect(args.take).toBe(100);
      expect(res).toMatchObject({ page: 1, limit: 100 });
    });

    it('items are story list items + position: no content, presigned cover', async () => {
      prisma.storyOnCollection.findMany.mockResolvedValue([linkRow('s1', 0), linkRow('s2', 1, { isPremium: true })]);
      prisma.storyOnCollection.count.mockResolvedValue(2);

      const res = await service.getStories('sleep', 1, 20);

      expect(Object.keys(res).sort()).toEqual(['data', 'limit', 'page', 'total', 'totalPages']);
      expect(res).toMatchObject({ total: 2, page: 1, limit: 20, totalPages: 1 });
      for (const item of res.data as any[]) {
        expect(Object.keys(item).sort()).toEqual([...STORY_LIST_ITEM_KEYS, 'position'].sort());
        expect(item).not.toHaveProperty('content');
        expect(item).not.toHaveProperty('preprocessedSegments');
        expect(item.coverImageUrl).toBe('signed:stories/covers/story-1.png');
      }
      expect(res.data.map((i: any) => [i.id, i.position, i.isPremium])).toEqual([
        ['s1', 0, false],
        ['s2', 1, true],
      ]);
      expect(JSON.stringify(res)).not.toContain('secret full text');
    });

    it('items carry availableLanguages; a favourite on another language version sets isFavoriteAnyLanguage', async () => {
      prisma.storyOnCollection.findMany.mockResolvedValue([
        linkRow('s1', 0, { translationGroupId: 'g1' }),
        linkRow('s2', 1),
      ]);
      prisma.storyOnCollection.count.mockResolvedValue(2);
      prisma.story.findMany.mockResolvedValue([
        { id: 's1', language: 'tr', translationGroupId: 'g1' },
        { id: 's1-en', language: 'en', translationGroupId: 'g1' },
      ]);
      prisma.favoriteStory.findMany.mockResolvedValue([{ storyId: 's1-en' }]);

      const res = await service.getStories('sleep', 1, 20, USER);

      expect(prisma.favoriteStory.findMany).toHaveBeenCalledWith({
        where: { userId: USER, storyId: { in: ['s1', 's1-en', 's2'] } },
        select: { storyId: true },
      });
      expect(
        res.data.map((i: any) => [i.id, i.position, i.availableLanguages, i.isFavorite, i.isFavoriteAnyLanguage]),
      ).toEqual([
        ['s1', 0, ['tr', 'en'], false, true],
        ['s2', 1, ['tr'], false, false],
      ]);
    });

    it('anonymous caller: no favorites lookup, isFavorite false', async () => {
      prisma.storyOnCollection.findMany.mockResolvedValue([linkRow('s1', 0)]);
      prisma.storyOnCollection.count.mockResolvedValue(1);

      const res = await service.getStories('sleep', 1, 20);

      expect(prisma.favoriteStory.findMany).not.toHaveBeenCalled();
      expect(res.data[0].isFavorite).toBe(false);
    });

    it('authenticated caller: isFavorite computed from a userId-scoped lookup', async () => {
      prisma.storyOnCollection.findMany.mockResolvedValue([linkRow('s1', 0), linkRow('s2', 1)]);
      prisma.storyOnCollection.count.mockResolvedValue(2);
      prisma.favoriteStory.findMany.mockResolvedValue([{ storyId: 's2' }]);

      const res = await service.getStories('sleep', 1, 20, USER);

      expect(prisma.favoriteStory.findMany).toHaveBeenCalledWith({
        where: { userId: USER, storyId: { in: ['s1', 's2'] } },
        select: { storyId: true },
      });
      expect(res.data.map((i: any) => i.isFavorite)).toEqual([false, true]);
    });

    it('authenticated caller with an empty collection skips the favorites query', async () => {
      await service.getStories('sleep', 1, 20, USER);

      expect(prisma.favoriteStory.findMany).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------
  // Admin read
  // -----------------------------------------------------------------
  describe('listAdmin', () => {
    it('includes inactive collections (no isActive filter) and paginates', async () => {
      prisma.collection.findMany.mockResolvedValue([
        collectionRow({ id: 'a', isActive: true }),
        collectionRow({ id: 'b', isActive: false }),
      ]);
      prisma.collection.count.mockResolvedValue(2);

      const res = await service.listAdmin(1, 20);

      expect(prisma.collection.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        skip: 0,
        take: 20,
        include: { _count: { select: { stories: true } } },
      });
      expect(prisma.collection.count).toHaveBeenCalledWith({ where: {} });
      expect(res).toMatchObject({ total: 2, page: 1, limit: 20, totalPages: 1 });
      expect(res.data.map((c) => [c.id, c.isActive])).toEqual([
        ['a', true],
        ['b', false],
      ]);
      expect(Object.keys(res.data[0]).sort()).toEqual(COLLECTION_KEYS);
    });

    it('search is trimmed and matches title/slug/subtitle case-insensitively', async () => {
      await service.listAdmin(2, 5, '  uyku  ');

      const expectedWhere = {
        OR: [
          { title: { contains: 'uyku', mode: 'insensitive' } },
          { slug: { contains: 'uyku', mode: 'insensitive' } },
          { subtitle: { contains: 'uyku', mode: 'insensitive' } },
        ],
      };
      const args = prisma.collection.findMany.mock.calls[0][0];
      expect(args.where).toEqual(expectedWhere);
      expect(args.skip).toBe(5);
      expect(args.take).toBe(5);
      expect(prisma.collection.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it('whitespace-only search means no filter', async () => {
      await service.listAdmin(1, 20, '   ');

      expect(prisma.collection.findMany.mock.calls[0][0].where).toEqual({});
    });
  });

  describe('getStoriesAdmin', () => {
    it('404 when the collection id does not exist', async () => {
      prisma.collection.findUnique.mockResolvedValue(null);

      await expect(service.getStoriesAdmin('nope', 1, 20)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.storyOnCollection.findMany).not.toHaveBeenCalled();
    });

    it('works for inactive collections (existence check by id only)', async () => {
      prisma.collection.findUnique.mockResolvedValue({ id: COLL_ID });

      await service.getStoriesAdmin(COLL_ID, 1, 20);

      expect(prisma.collection.findUnique).toHaveBeenCalledWith({ where: { id: COLL_ID }, select: { id: true } });
      expect(prisma.storyOnCollection.findMany).toHaveBeenCalled();
    });

    it('selects a narrow story subset and returns the admin item shape with presigned cover', async () => {
      prisma.collection.findUnique.mockResolvedValue({ id: COLL_ID });
      prisma.storyOnCollection.findMany.mockResolvedValue([
        {
          position: 3,
          story: {
            id: 's1',
            title: 'Keloglan',
            category: 'TURKISH_CLASSICS',
            ageGroup: 'SIX_TO_TEN',
            language: 'tr',
            status: 'DRAFT',
            isPremium: true,
            coverImageUrl: 'stories/covers/s1.png',
          },
        },
      ]);
      prisma.storyOnCollection.count.mockResolvedValue(1);

      const res = await service.getStoriesAdmin(COLL_ID, 1, 20);

      const args = prisma.storyOnCollection.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ collectionId: COLL_ID });
      expect(args.orderBy).toEqual([{ position: 'asc' }, { createdAt: 'asc' }]);
      expect(args.include.story.select).toEqual({
        id: true,
        title: true,
        category: true,
        ageGroup: true,
        language: true,
        status: true,
        isPremium: true,
        coverImageUrl: true,
      });
      expect(res.data).toEqual([
        {
          id: 's1',
          title: 'Keloglan',
          category: 'TURKISH_CLASSICS',
          ageGroup: 'SIX_TO_TEN',
          language: 'tr',
          status: 'DRAFT',
          isPremium: true,
          coverImageUrl: 'signed:stories/covers/s1.png',
          position: 3,
        },
      ]);
      expect(res).toMatchObject({ total: 1, page: 1, limit: 20, totalPages: 1 });
    });
  });

  // -----------------------------------------------------------------
  // Admin write
  // -----------------------------------------------------------------
  describe('create', () => {
    const dto = { slug: 'sleep', title: 'Uyku Vakti', tone: 'TRUST' } as any;

    it('409 when the slug is already taken; nothing is created', async () => {
      prisma.collection.findUnique.mockResolvedValue({ id: 'other' });

      await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.collection.findUnique).toHaveBeenCalledWith({
        where: { slug_language: { slug: 'sleep', language: 'tr' } },
        select: { id: true },
      });
      expect(prisma.collection.create).not.toHaveBeenCalled();
    });

    it('applies defaults for optional fields (active by default, sortOrder 0, nulls)', async () => {
      prisma.collection.findUnique.mockResolvedValue(null);
      prisma.collection.create.mockResolvedValue(collectionRow({ _count: { stories: 0 } }));

      const res = await service.create(dto);

      expect(prisma.collection.create).toHaveBeenCalledWith({
        data: {
          slug: 'sleep',
          language: 'tr',
          title: 'Uyku Vakti',
          subtitle: null,
          description: null,
          tone: 'TRUST',
          coverImageUrl: null,
          isActive: true,
          sortOrder: 0,
        },
        include: { _count: { select: { stories: true } } },
      });
      expect(Object.keys(res).sort()).toEqual(COLLECTION_KEYS);
      expect(res.storyCount).toBe(0);
    });

    it('passes explicit optional values through (including isActive false)', async () => {
      prisma.collection.findUnique.mockResolvedValue(null);
      prisma.collection.create.mockResolvedValue(collectionRow());

      await service.create({
        ...dto,
        subtitle: 'alt',
        description: 'desc',
        coverImageUrl: 'collections/x.png',
        isActive: false,
        sortOrder: 7,
      });

      expect(prisma.collection.create.mock.calls[0][0].data).toMatchObject({
        subtitle: 'alt',
        description: 'desc',
        coverImageUrl: 'collections/x.png',
        isActive: false,
        sortOrder: 7,
      });
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.collection.findUnique.mockResolvedValue({ id: COLL_ID, slug: 'sleep', language: 'tr' });
      prisma.collection.findFirst.mockResolvedValue(null);
      prisma.collection.update.mockResolvedValue(collectionRow());
    });

    it('404 when the collection does not exist; nothing is updated', async () => {
      prisma.collection.findUnique.mockResolvedValue(null);

      await expect(service.update('nope', { title: 'x' } as any)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.collection.update).not.toHaveBeenCalled();
    });

    it('409 when the new slug belongs to another collection', async () => {
      prisma.collection.findFirst.mockResolvedValue({ id: 'other' });

      await expect(service.update(COLL_ID, { slug: 'taken' } as any)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.collection.findFirst).toHaveBeenCalledWith({
        where: { slug: 'taken', language: 'tr', NOT: { id: COLL_ID } },
        select: { id: true },
      });
      expect(prisma.collection.update).not.toHaveBeenCalled();
    });

    it('keeping the same slug is not a conflict (self excluded)', async () => {
      await expect(service.update(COLL_ID, { slug: 'sleep' } as any)).resolves.toBeDefined();
      expect(prisma.collection.update.mock.calls[0][0].data).toEqual({ slug: 'sleep' });
    });

    it('no slug in the patch -> no slug conflict query', async () => {
      await service.update(COLL_ID, { title: 'Yeni' } as any);

      expect(prisma.collection.findFirst).not.toHaveBeenCalled();
    });

    it('only writes the fields present in the patch', async () => {
      await service.update(COLL_ID, { isActive: false, sortOrder: 3 } as any);

      expect(prisma.collection.update).toHaveBeenCalledWith({
        where: { id: COLL_ID },
        data: { isActive: false, sortOrder: 3 },
        include: { _count: { select: { stories: true } } },
      });
    });

    it('null clears the nullable text fields (subtitle, description, cover)', async () => {
      await service.update(COLL_ID, { subtitle: null, description: null, coverImageUrl: null } as any);

      expect(prisma.collection.update.mock.calls[0][0].data).toEqual({
        subtitle: null,
        description: null,
        coverImageUrl: null,
      });
    });

    it('can write every field', async () => {
      const full = {
        slug: 'new-slug',
        title: 'T',
        subtitle: 'S',
        description: 'D',
        tone: 'SUN',
        coverImageUrl: 'c.png',
        isActive: true,
        sortOrder: 2,
      };

      const res = await service.update(COLL_ID, full as any);

      expect(prisma.collection.update.mock.calls[0][0].data).toEqual(full);
      expect(Object.keys(res).sort()).toEqual(COLLECTION_KEYS);
    });
  });

  describe('remove', () => {
    it('404 when the collection does not exist; nothing is deleted', async () => {
      prisma.collection.findUnique.mockResolvedValue(null);

      await expect(service.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.collection.delete).not.toHaveBeenCalled();
    });

    it('deletes by id and returns {success:true}', async () => {
      prisma.collection.findUnique.mockResolvedValue({ id: COLL_ID });
      prisma.collection.delete.mockResolvedValue({});

      await expect(service.remove(COLL_ID)).resolves.toEqual({ success: true });
      expect(prisma.collection.delete).toHaveBeenCalledWith({ where: { id: COLL_ID } });
    });
  });

  describe('addStories', () => {
    beforeEach(() => {
      prisma.collection.findUnique.mockResolvedValue({ id: COLL_ID, language: 'tr' });
      prisma.story.findMany.mockResolvedValue([
        { id: 's1', title: 'Bir', language: 'tr' },
        { id: 's2', title: 'İki', language: 'tr' },
      ]);
      prisma.storyOnCollection.findFirst.mockResolvedValue({ position: 4 });
      prisma.storyOnCollection.createMany.mockResolvedValue({ count: 2 });
    });

    it('404 when the collection does not exist', async () => {
      prisma.collection.findUnique.mockResolvedValue(null);

      await expect(service.addStories('nope', { storyIds: ['s1'] })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.storyOnCollection.createMany).not.toHaveBeenCalled();
    });

    it('404 listing the missing story ids; nothing is linked', async () => {
      prisma.story.findMany.mockResolvedValue([{ id: 's1', title: 'Bir', language: 'tr' }]);

      const err = await service.addStories(COLL_ID, { storyIds: ['s1', 'ghost-a', 'ghost-b'] }).catch((e) => e);

      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toContain('ghost-a');
      expect(err.message).toContain('ghost-b');
      expect(err.message).not.toContain('s1,');
      expect(prisma.story.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['s1', 'ghost-a', 'ghost-b'] } },
        select: { id: true, title: true, language: true },
      });
      expect(prisma.storyOnCollection.createMany).not.toHaveBeenCalled();
    });

    it('400 (coded, Turkish) when a story is written in another language; nothing is linked', async () => {
      prisma.story.findMany.mockResolvedValue([
        { id: 's1', title: 'Bir', language: 'tr' },
        { id: 's2', title: 'Little Red Riding Hood', language: 'en' },
      ]);

      const err = await service.addStories(COLL_ID, { storyIds: ['s1', 's2'] }).catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toEqual({
        code: 'COLLECTION_LANGUAGE_MISMATCH',
        message:
          'Bu koleksiyonun dili "tr". Farklı dildeki masallar eklenemez: Little Red Riding Hood (en).',
        storyIds: ['s2'],
      });
      expect(prisma.storyOnCollection.createMany).not.toHaveBeenCalled();
    });

    it('appends after the current max position, idempotent via skipDuplicates', async () => {
      const res = await service.addStories(COLL_ID, { storyIds: ['s1', 's2'] });

      expect(prisma.storyOnCollection.findFirst).toHaveBeenCalledWith({
        where: { collectionId: COLL_ID },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      expect(prisma.storyOnCollection.createMany).toHaveBeenCalledWith({
        data: [
          { collectionId: COLL_ID, storyId: 's1', position: 5 },
          { collectionId: COLL_ID, storyId: 's2', position: 6 },
        ],
        skipDuplicates: true,
      });
      expect(res).toEqual({ added: 2 });
    });

    it('starts at position 0 for an empty collection', async () => {
      prisma.storyOnCollection.findFirst.mockResolvedValue(null);

      await service.addStories(COLL_ID, { storyIds: ['s1', 's2'] });

      const data = prisma.storyOnCollection.createMany.mock.calls[0][0].data;
      expect(data.map((d: any) => d.position)).toEqual([0, 1]);
    });

    it('re-adding existing stories reports only rows actually inserted', async () => {
      prisma.storyOnCollection.createMany.mockResolvedValue({ count: 0 });

      await expect(service.addStories(COLL_ID, { storyIds: ['s1', 's2'] })).resolves.toEqual({ added: 0 });
    });
  });

  describe('removeStory', () => {
    it('404 when the collection does not exist', async () => {
      prisma.collection.findUnique.mockResolvedValue(null);

      await expect(service.removeStory('nope', 's1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.storyOnCollection.delete).not.toHaveBeenCalled();
    });

    it('404 when the story is not linked to the collection', async () => {
      prisma.collection.findUnique.mockResolvedValue({ id: COLL_ID });
      prisma.storyOnCollection.delete.mockRejectedValue(new Error('Record to delete does not exist'));

      await expect(service.removeStory(COLL_ID, 's9')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes the link by composite key', async () => {
      prisma.collection.findUnique.mockResolvedValue({ id: COLL_ID });
      prisma.storyOnCollection.delete.mockResolvedValue({});

      await expect(service.removeStory(COLL_ID, 's1')).resolves.toEqual({ success: true });
      expect(prisma.storyOnCollection.delete).toHaveBeenCalledWith({
        where: { collectionId_storyId: { collectionId: COLL_ID, storyId: 's1' } },
      });
    });
  });

  describe('reorder', () => {
    beforeEach(() => {
      prisma.collection.findUnique.mockResolvedValue({ id: COLL_ID });
      prisma.storyOnCollection.findMany.mockResolvedValue([{ storyId: 's1' }, { storyId: 's2' }, { storyId: 's3' }]);
      prisma.storyOnCollection.update.mockImplementation((args: any) => ({ __op: 'update', args }));
      prisma.$transaction.mockImplementation(async (ops: any[]) => ops);
    });

    it('404 when the collection does not exist', async () => {
      prisma.collection.findUnique.mockResolvedValue(null);

      await expect(service.reorder('nope', { storyIds: ['s1'] })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('404 when a story id is not in the collection; nothing is written', async () => {
      const err = await service.reorder(COLL_ID, { storyIds: ['s2', 'intruder'] }).catch((e) => e);

      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toContain('intruder');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('assigns array index as position inside one transaction', async () => {
      const res = await service.reorder(COLL_ID, { storyIds: ['s3', 's1', 's2'] });

      expect(prisma.storyOnCollection.findMany).toHaveBeenCalledWith({
        where: { collectionId: COLL_ID },
        select: { storyId: true },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const ops = prisma.$transaction.mock.calls[0][0];
      expect(ops.map((o: any) => o.args)).toEqual([
        { where: { collectionId_storyId: { collectionId: COLL_ID, storyId: 's3' } }, data: { position: 0 } },
        { where: { collectionId_storyId: { collectionId: COLL_ID, storyId: 's1' } }, data: { position: 1 } },
        { where: { collectionId_storyId: { collectionId: COLL_ID, storyId: 's2' } }, data: { position: 2 } },
      ]);
      expect(res).toEqual({ reordered: 3 });
    });

    it('a partial list only repositions the listed stories', async () => {
      const res = await service.reorder(COLL_ID, { storyIds: ['s2'] });

      const ops = prisma.$transaction.mock.calls[0][0];
      expect(ops).toHaveLength(1);
      expect(ops[0].args.data).toEqual({ position: 0 });
      expect(res).toEqual({ reordered: 1 });
    });
  });
});
