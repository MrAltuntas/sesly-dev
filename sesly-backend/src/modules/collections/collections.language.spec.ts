import { ConflictException, NotFoundException } from '@nestjs/common';
import { CollectionsService } from './collections.service';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createSettingsStub, SettingsStub } from '../../test-utils/settings-stub';

const COLL_ID = 'coll-1';

const row = (over: Record<string, any> = {}) => ({
  id: COLL_ID,
  slug: 'sleep',
  language: 'tr',
  title: 'Uyku Vakti',
  subtitle: null,
  description: null,
  tone: 'TRUST',
  coverImageUrl: null,
  isActive: true,
  sortOrder: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  _count: { stories: 2 },
  ...over,
});

const visible = (language: string) => ({ story: { status: 'PUBLISHED', language } });
const publicCount = (language: string) => ({
  _count: { select: { stories: { where: visible(language) } } },
});

/** Collections are per content language; the language is an explicit parameter. */
describe('CollectionsService (content language)', () => {
  let prisma: MockPrismaService;
  let settings: SettingsStub;
  let service: CollectionsService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    settings = createSettingsStub({
      'content.enabledLanguages': ['tr', 'en'],
      'content.defaultLanguage': 'tr',
    });
    service = new CollectionsService(
      prisma as any,
      { getReadUrl: jest.fn(async (v: string | null) => v) } as any,
      settings as any,
    );
    prisma.collection.findMany.mockResolvedValue([]);
    prisma.collection.count.mockResolvedValue(0);
    prisma.storyOnCollection.findMany.mockResolvedValue([]);
    prisma.storyOnCollection.count.mockResolvedValue(0);
  });

  describe('list', () => {
    it('an old client that sends no language gets the default language', async () => {
      await service.list();

      const args = prisma.collection.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ isActive: true, language: 'tr' });
      expect(args.include).toEqual(publicCount('tr'));
    });

    it('the default follows the content.defaultLanguage setting', async () => {
      settings.values['content.defaultLanguage'] = 'en';

      await service.list();

      expect(prisma.collection.findMany.mock.calls[0][0].where).toEqual({ isActive: true, language: 'en' });
    });

    it('an explicit language lists that language; storyCount counts only its published stories', async () => {
      prisma.collection.findMany.mockResolvedValue([row({ language: 'en', _count: { stories: 7 } })]);

      const [dto] = await service.list('en');

      const args = prisma.collection.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ isActive: true, language: 'en' });
      expect(args.include).toEqual(publicCount('en'));
      expect(dto.language).toBe('en');
      expect(dto.storyCount).toBe(7);
    });

    it('a language that is switched off has no collections and reads nothing', async () => {
      await expect(service.list('de')).resolves.toEqual([]);
      expect(prisma.collection.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getBySlug', () => {
    it('resolves the slug inside the requested language', async () => {
      prisma.collection.findUnique.mockResolvedValue(row({ language: 'en' }));

      const dto = await service.getBySlug('sleep', 'en');

      expect(prisma.collection.findUnique).toHaveBeenCalledWith({
        where: { slug_language: { slug: 'sleep', language: 'en' } },
        include: publicCount('en'),
      });
      expect(dto.language).toBe('en');
    });

    it('404 without a query for a language that is switched off', async () => {
      await expect(service.getBySlug('sleep', 'de')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.collection.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('getStories', () => {
    it('lists only published stories of the collection language', async () => {
      prisma.collection.findUnique.mockResolvedValue({ id: COLL_ID, isActive: true });

      await service.getStories('sleep', 1, 20, undefined, 'en');

      expect(prisma.collection.findUnique.mock.calls[0][0].where).toEqual({
        slug_language: { slug: 'sleep', language: 'en' },
      });
      const where = { collectionId: COLL_ID, ...visible('en') };
      expect(prisma.storyOnCollection.findMany.mock.calls[0][0].where).toEqual(where);
      expect(prisma.storyOnCollection.count).toHaveBeenCalledWith({ where });
    });

    it('404 for a language that is switched off', async () => {
      await expect(service.getStories('sleep', 1, 20, 'user-1', 'de')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.collection.findUnique).not.toHaveBeenCalled();
      expect(prisma.storyOnCollection.findMany).not.toHaveBeenCalled();
    });
  });

  describe('admin', () => {
    it('listAdmin filters by language and still counts every attached story', async () => {
      await service.listAdmin(1, 20, undefined, 'en');

      const args = prisma.collection.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ language: 'en' });
      expect(args.include).toEqual({ _count: { select: { stories: true } } });
      expect(prisma.collection.count).toHaveBeenCalledWith({ where: { language: 'en' } });
    });

    it('listAdmin combines language and search', async () => {
      await service.listAdmin(1, 20, 'sleep', 'de');

      expect(prisma.collection.findMany.mock.calls[0][0].where).toEqual({
        language: 'de',
        OR: [
          { title: { contains: 'sleep', mode: 'insensitive' } },
          { slug: { contains: 'sleep', mode: 'insensitive' } },
          { subtitle: { contains: 'sleep', mode: 'insensitive' } },
        ],
      });
    });

    it('create: the same slug is free in another language', async () => {
      prisma.collection.findUnique.mockResolvedValue(null);
      prisma.collection.create.mockResolvedValue(row({ language: 'en' }));

      const dto = await service.create({ slug: 'sleep', title: 'Bedtime', tone: 'TRUST', language: 'en' } as any);

      expect(prisma.collection.findUnique).toHaveBeenCalledWith({
        where: { slug_language: { slug: 'sleep', language: 'en' } },
        select: { id: true },
      });
      expect(prisma.collection.create.mock.calls[0][0].data).toMatchObject({ slug: 'sleep', language: 'en' });
      expect(dto.language).toBe('en');
    });

    it('create: 409 names the language when the slug is taken in it', async () => {
      prisma.collection.findUnique.mockResolvedValue({ id: 'other' });

      const err = await service
        .create({ slug: 'sleep', title: 'Bedtime', tone: 'TRUST', language: 'en' } as any)
        .catch((e) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe('Collection slug "sleep" already exists for language "en"');
    });

    it('update: moving a collection to another language checks the slug in that language', async () => {
      prisma.collection.findUnique.mockResolvedValue({ id: COLL_ID, slug: 'sleep', language: 'tr' });
      prisma.collection.findFirst.mockResolvedValue({ id: 'other' });

      await expect(service.update(COLL_ID, { language: 'en' } as any)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.collection.findFirst).toHaveBeenCalledWith({
        where: { slug: 'sleep', language: 'en', NOT: { id: COLL_ID } },
        select: { id: true },
      });
      expect(prisma.collection.update).not.toHaveBeenCalled();
    });

    it('update: writes the new language when the pair is free', async () => {
      prisma.collection.findUnique.mockResolvedValue({ id: COLL_ID, slug: 'sleep', language: 'tr' });
      prisma.collection.findFirst.mockResolvedValue(null);
      prisma.collection.update.mockResolvedValue(row({ language: 'en' }));

      await service.update(COLL_ID, { language: 'en' } as any);

      expect(prisma.collection.update.mock.calls[0][0].data).toEqual({ language: 'en' });
    });

    it('update: a patch without slug or language runs no conflict query', async () => {
      prisma.collection.findUnique.mockResolvedValue({ id: COLL_ID, slug: 'sleep', language: 'tr' });
      prisma.collection.update.mockResolvedValue(row());

      await service.update(COLL_ID, { title: 'Yeni' } as any);

      expect(prisma.collection.findFirst).not.toHaveBeenCalled();
    });
  });
});
