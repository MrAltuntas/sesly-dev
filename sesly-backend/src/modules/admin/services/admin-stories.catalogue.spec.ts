import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AdminStoriesService } from './admin-stories.service';
import { createMockPrismaService, MockPrismaService } from '../../../test-utils/prisma-mock';
import { createSettingsStub, SettingsStub } from '../../../test-utils/settings-stub';

const NOW = new Date('2026-10-13T09:00:00.000Z');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const words = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`).join(' ');

/**
 * Admin side of the multi-language catalogue: list filters, slug, publish
 * rule, manual language level, translation groups and the meta endpoint.
 */
describe('AdminStoriesService (catalogue)', () => {
  let prisma: MockPrismaService;
  let settings: SettingsStub;
  let service: AdminStoriesService;

  const storyRow = (over: Record<string, any> = {}) => ({
    id: 's1',
    title: 'Kırmızı Başlıklı Kız',
    content: 'Bir varmış bir yokmuş.',
    slug: 'kirmizi-baslikli-kiz',
    language: 'tr',
    status: 'DRAFT',
    publishedAt: null,
    origin: null,
    textFidelity: null,
    rightsBasis: null,
    sourceName: null,
    sourceUrl: null,
    authorName: null,
    collectorName: null,
    rightsVerifiedBy: null,
    translationGroupId: null,
    translatedFromId: null,
    coverImageUrl: null,
    isPremium: false,
    chunks: [],
    _count: { userProgress: 0, favoritedBy: 0 },
    ...over,
  });

  const createDto = (over: Record<string, any> = {}) =>
    ({
      title: 'Kırmızı Başlıklı Kız',
      content: 'Bir varmış bir yokmuş.',
      ageGroup: 'THREE_TO_SIX',
      category: 'WORLD_CLASSICS',
      ...over,
    }) as any;

  const created = () => prisma.story.create.mock.calls[0][0].data;
  const updated = () => prisma.story.update.mock.calls[0][0].data;

  let storyLlmTasks: { triggerAutoAssess: jest.Mock; triggerAutoAssessAgeGroup: jest.Mock };
  let translationRequests: { summaryForStories: jest.Mock; fulfilForStory: jest.Mock };

  beforeEach(() => {
    storyLlmTasks = {
      triggerAutoAssess: jest.fn().mockResolvedValue(undefined),
      triggerAutoAssessAgeGroup: jest.fn().mockResolvedValue(undefined),
    };
    translationRequests = {
      summaryForStories: jest.fn().mockResolvedValue(new Map()),
      fulfilForStory: jest.fn().mockResolvedValue(undefined),
    };
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout', 'setInterval'] });
    prisma = createMockPrismaService();
    settings = createSettingsStub();
    service = new AdminStoriesService(
      prisma as any,
      { uploadFile: jest.fn(), generatePresignedUrl: jest.fn(), deleteFile: jest.fn() } as any,
      { splitTextIntoSegments: jest.fn() } as any,
      { preprocessStory: jest.fn() } as any,
      settings as any,
      storyLlmTasks as any,
      translationRequests as any,
    );

    prisma.story.findUnique.mockResolvedValue(storyRow());
    prisma.story.findFirst.mockResolvedValue(null);
    prisma.story.findMany.mockResolvedValue([]);
    prisma.story.count.mockResolvedValue(0);
    prisma.story.create.mockImplementation(async ({ data }: any) => ({ id: 's1', ...data }));
    prisma.story.update.mockImplementation(async ({ data }: any) => ({ id: 's1', ...data }));
    prisma.story.updateMany.mockResolvedValue({ count: 0 });
    prisma.storyChunk.create.mockResolvedValue({});
    prisma.storyChunk.deleteMany.mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------
  describe('GET /admin/stories filters', () => {
    const where = () => prisma.story.findMany.mock.calls[0][0].where;

    it('no filter lists everything (all languages, all statuses), newest first, 1/20', async () => {
      await service.getAllStories();

      expect(prisma.story.findMany.mock.calls[0][0]).toMatchObject({
        where: {},
        skip: 0,
        take: 20,
        orderBy: [{ createdAt: 'desc' }],
      });
      expect(prisma.story.count).toHaveBeenCalledWith({ where: {} });
    });

    it('language, status, languageLevel, category, ageGroup and origin are plain column filters', async () => {
      await service.getAllStories({
        language: 'en',
        status: 'DRAFT',
        languageLevel: ['A1', 'A2'],
        category: 'BEDTIME',
        ageGroup: 'SIX_TO_TEN',
        origin: 'PUBLIC_DOMAIN',
      } as any);

      expect(where()).toEqual({
        language: 'en',
        status: 'DRAFT',
        languageLevel: { in: ['A1', 'A2'] },
        category: 'BEDTIME',
        ageGroup: 'SIX_TO_TEN',
        origin: 'PUBLIC_DOMAIN',
      });
      expect(prisma.story.count).toHaveBeenCalledWith({ where: where() });
    });

    it('imported, importBatch, reviewed and the created day range (last day included)', async () => {
      await service.getAllStories({
        imported: true,
        importBatch: 'import-batch1.json',
        reviewed: false,
        createdFrom: '2026-09-01',
        createdTo: '2026-09-30',
      } as any);
      expect(where()).toEqual({
        importedAt: { not: null },
        importBatch: 'import-batch1.json',
        reviewedAt: null,
        createdAt: { gte: new Date('2026-09-01T00:00:00.000Z'), lt: new Date('2026-10-01T00:00:00.000Z') },
      });

      prisma.story.findMany.mockClear();
      await service.getAllStories({ imported: false, reviewed: true, createdTo: '2026-09-27' } as any);
      expect(where()).toEqual({
        importedAt: null,
        reviewedAt: { not: null },
        createdAt: { lt: new Date('2026-09-28T00:00:00.000Z') },
      });

      prisma.story.findMany.mockClear();
      await service.getAllStories({ createdFrom: '2026-10-21' } as any);
      expect(where()).toEqual({ createdAt: { gte: new Date('2026-10-21T00:00:00.000Z') } });
    });

    it('an empty level list is no filter', async () => {
      await service.getAllStories({ languageLevel: [] } as any);
      expect(where()).toEqual({});
    });

    it('q searches title and content, trimmed, case-insensitive; blank q is no filter', async () => {
      await service.getAllStories({ q: '  kurt ' } as any);
      expect(where()).toEqual({
        AND: [
          {
            OR: [
              { title: { contains: 'kurt', mode: 'insensitive' } },
              { content: { contains: 'kurt', mode: 'insensitive' } },
            ],
          },
        ],
      });

      prisma.story.findMany.mockClear();
      await service.getAllStories({ q: '   ' } as any);
      expect(where()).toEqual({});
    });

    it('missingLanguage: stories not in that language whose group has no story in it', async () => {
      prisma.story.findMany.mockResolvedValueOnce([
        { translationGroupId: 'g-covered-1' },
        { translationGroupId: 'g-covered-2' },
      ]);
      prisma.story.findMany.mockResolvedValueOnce([]);

      await service.getAllStories({ missingLanguage: 'en' } as any);

      // 1st query: the groups that already have an English story.
      expect(prisma.story.findMany.mock.calls[0][0]).toEqual({
        where: { language: 'en', translationGroupId: { not: null } },
        select: { translationGroupId: true },
      });
      // 2nd query: the list itself.
      expect(prisma.story.findMany.mock.calls[1][0].where).toEqual({
        AND: [
          { language: { not: 'en' } },
          {
            OR: [
              { translationGroupId: null },
              { translationGroupId: { notIn: ['g-covered-1', 'g-covered-2'] } },
            ],
          },
        ],
      });
    });

    it('missingLanguage with no group covering it: every story of another language', async () => {
      await service.getAllStories({ missingLanguage: 'de', language: 'tr' } as any);

      expect(prisma.story.findMany.mock.calls[1][0].where).toEqual({
        language: 'tr',
        AND: [{ language: { not: 'de' } }],
      });
    });

    it.each([
      ['oldest', [{ createdAt: 'asc' }]],
      ['title', [{ title: 'asc' }, { createdAt: 'desc' }]],
      ['duration', [{ estimatedDuration: 'asc' }, { createdAt: 'desc' }]],
      ['level', [{ languageLevel: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }]],
    ])('sort=%s', async (sort, orderBy) => {
      await service.getAllStories({ sort } as any);
      expect(prisma.story.findMany.mock.calls[0][0].orderBy).toEqual(orderBy);
    });

    it('each row carries the languages of its translation group and its siblings', async () => {
      prisma.story.findMany.mockResolvedValueOnce([
        storyRow({ id: 'tr-1', language: 'tr', translationGroupId: 'g1' }),
        storyRow({ id: 'solo', language: 'en', translationGroupId: null }),
      ]);
      prisma.story.count.mockResolvedValue(2);
      prisma.story.findMany.mockResolvedValueOnce([
        { id: 'de-1', language: 'de', title: 'Rotkäppchen', status: 'DRAFT', translationGroupId: 'g1' },
        { id: 'tr-1', language: 'tr', title: 'Kırmızı Başlıklı Kız', status: 'PUBLISHED', translationGroupId: 'g1' },
        { id: 'en-1', language: 'en', title: 'Little Red Riding Hood', status: 'PUBLISHED', translationGroupId: 'g1' },
      ]);

      const res = await service.getAllStories();

      expect(prisma.story.findMany.mock.calls[1][0]).toEqual({
        where: { translationGroupId: { in: ['g1'] } },
        select: { id: true, language: true, title: true, status: true, translationGroupId: true },
      });
      const [grouped, solo] = res.data as any[];
      expect(grouped.groupLanguages).toEqual(['tr', 'en', 'de']);
      expect(grouped.translations).toEqual([
        { id: 'en-1', language: 'en', title: 'Little Red Riding Hood', status: 'PUBLISHED' },
        { id: 'de-1', language: 'de', title: 'Rotkäppchen', status: 'DRAFT' },
      ]);
      expect(solo.groupLanguages).toEqual(['en']);
      expect(solo.translations).toEqual([]);
    });

    it('a page without any group runs no sibling query; unknown language codes sort last', async () => {
      prisma.story.findMany.mockResolvedValueOnce([storyRow({ id: 'a' })]);
      await service.getAllStories();
      expect(prisma.story.findMany).toHaveBeenCalledTimes(1);

      prisma.story.findMany.mockReset();
      prisma.story.findMany.mockResolvedValueOnce([storyRow({ id: 'x', language: 'xx', translationGroupId: 'g' })]);
      prisma.story.findMany.mockResolvedValueOnce([
        { id: 'y', language: 'yy', title: 'Y', status: 'DRAFT', translationGroupId: 'g' },
        { id: 't', language: 'tr', title: 'T', status: 'DRAFT', translationGroupId: 'g' },
      ]);
      const res = await service.getAllStories();
      expect((res.data[0] as any).groupLanguages[0]).toBe('tr');
      expect((res.data[0] as any).groupLanguages).toHaveLength(3);
    });

    it('getStoryById also returns translations and groupLanguages', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ translationGroupId: 'g1' }));
      prisma.story.findMany.mockResolvedValue([
        { id: 'en-1', language: 'en', title: 'Little Red Riding Hood', status: 'PUBLISHED', translationGroupId: 'g1' },
      ]);

      const story: any = await service.getStoryById('s1');

      expect(story.groupLanguages).toEqual(['tr', 'en']);
      expect(story.translations).toEqual([
        { id: 'en-1', language: 'en', title: 'Little Red Riding Hood', status: 'PUBLISHED' },
      ]);
    });
  });

  // -------------------------------------------------------------------
  describe('GET /admin/stories/meta', () => {
    it('lists every language with its enabled flag, the enabled codes and the default', () => {
      settings.values['content.enabledLanguages'] = ['tr', 'en'];
      settings.values['content.defaultLanguage'] = 'en';

      const meta = service.getStoriesMeta();

      expect(meta.languages.all).toHaveLength(10);
      expect(meta.languages.all[0]).toEqual({
        code: 'tr',
        nativeName: 'Türkçe',
        englishName: 'Turkish',
        wordsPerMinute: 150,
        enabled: true,
      });
      expect(meta.languages.all.filter((l) => l.enabled).map((l) => l.code)).toEqual(['tr', 'en']);
      expect(meta.languages.enabled).toEqual(['tr', 'en']);
      expect(meta.languages.default).toBe('en');
    });

    it('returns every story enum with Turkish labels, in declaration order', () => {
      const meta = service.getStoriesMeta();

      expect(Object.keys(meta.enums)).toEqual([
        'status',
        'origin',
        'textFidelity',
        'rightsBasis',
        'languageLevel',
        'languageLevelSource',
        'translationMethod',
        'category',
        'ageGroup',
        'contentWarning',
        'ageGroupSource',
        'llmTaskType',
        'llmTaskStatus',
      ]);
      expect(meta.enums.contentWarning.map((o: any) => o.value)).toEqual([
        'SCARY',
        'VIOLENCE',
        'DEATH',
        'SAD_ENDING',
        'BAD_EXAMPLE',
        'OLD_LANGUAGE',
        'LONELINESS',
      ]);
      expect(meta.enums.contentWarning[0]).toEqual({ value: 'SCARY', label: 'Korkutucu sahne' });
      expect(meta.enums.llmTaskType).toEqual([
        { value: 'TRANSLATE', label: 'Çeviri' },
        { value: 'ASSESS_LEVEL', label: 'Dil seviyesi değerlendirmesi' },
        { value: 'ASSESS_AGE_GROUP', label: 'Yaş grubu değerlendirmesi' },
      ]);
      expect(meta.enums.ageGroupSource).toEqual([
        { value: 'AI', label: 'Yapay zeka' },
        { value: 'MANUAL', label: 'Elle' },
      ]);
      expect(meta.enums.llmTaskStatus.map((o) => o.value)).toEqual(['PENDING', 'RUNNING', 'DONE', 'FAILED']);
      expect(meta.enums.status).toEqual([
        { value: 'DRAFT', label: 'Taslak' },
        { value: 'PUBLISHED', label: 'Yayında' },
        { value: 'ARCHIVED', label: 'Arşivlendi' },
      ]);
      expect(meta.enums.origin.map((o) => o.value)).toEqual([
        'PUBLIC_DOMAIN',
        'FOLK_ANONYMOUS',
        'LICENSED',
        'ORIGINAL_HUMAN',
        'AI_GENERATED',
      ]);
      expect(meta.enums.textFidelity).toHaveLength(5);
      expect(meta.enums.rightsBasis).toHaveLength(7);
      expect(meta.enums.languageLevel.map((o) => o.value)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
      expect(meta.enums.languageLevelSource.map((o) => o.value)).toEqual(['AI', 'MANUAL']);
      expect(meta.enums.translationMethod.map((o) => o.value)).toEqual(['HUMAN', 'MACHINE']);
      expect(meta.enums.category).toHaveLength(4);
      expect(meta.enums.ageGroup).toHaveLength(4);
      expect(meta.sorts.map((o) => o.value)).toEqual(['newest', 'oldest', 'title', 'duration', 'level']);
      expect(meta.publishRules).toEqual({
        always: ['origin', 'textFidelity'],
        rightsRequiredOrigins: ['PUBLIC_DOMAIN', 'FOLK_ANONYMOUS', 'LICENSED'],
        ccByRequires: ['attribution', 'licenseName'],
      });
    });
  });

  // -------------------------------------------------------------------
  describe('create: defaults, slug, duration', () => {
    it('a story created without the new fields is a Turkish DRAFT with a slug generated from the title', async () => {
      await service.createStory(createDto(), undefined as any);

      expect(created()).toMatchObject({
        language: 'tr',
        status: 'DRAFT',
        slug: 'kirmizi-baslikli-kiz',
        isPremium: false,
      });
      expect(created()).not.toHaveProperty('publishedAt');
      expect(prisma.story.findFirst).toHaveBeenCalledWith({
        where: { slug: 'kirmizi-baslikli-kiz', language: 'tr' },
        select: { id: true },
      });
    });

    it('a generated slug that is taken in that language gets -2, -3', async () => {
      prisma.story.findFirst
        .mockResolvedValueOnce({ id: 'other' })
        .mockResolvedValueOnce({ id: 'other-2' })
        .mockResolvedValueOnce(null);

      await service.createStory(createDto({ language: 'en', title: 'The Wolf' }), undefined as any);

      expect(created().slug).toBe('the-wolf-3');
      expect(prisma.story.findFirst.mock.calls.map((c) => c[0].where)).toEqual([
        { slug: 'the-wolf', language: 'en' },
        { slug: 'the-wolf-2', language: 'en' },
        { slug: 'the-wolf-3', language: 'en' },
      ]);
    });

    it('an explicit slug is kept; when taken in that language it is a coded 409', async () => {
      await service.createStory(createDto({ slug: 'ozel-kisa-ad' }), undefined as any);
      expect(created().slug).toBe('ozel-kisa-ad');

      prisma.story.findFirst.mockResolvedValue({ id: 'other' });
      const err = await service.createStory(createDto({ slug: 'ozel-kisa-ad' }), undefined as any).catch((e) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toEqual({
        code: 'STORY_SLUG_TAKEN',
        message: '"ozel-kisa-ad" kısa adı "tr" dilinde başka bir masalda kullanılıyor.',
      });
      expect(prisma.story.create).toHaveBeenCalledTimes(1);
    });

    it('estimatedDuration is computed with the words-per-minute figure of the story language', async () => {
      const content = words(1650);

      await service.createStory(createDto({ content, language: 'tr' }), undefined as any);
      await service.createStory(createDto({ content, language: 'en' }), undefined as any);
      await service.createStory(createDto({ content, language: 'ar' }), undefined as any);
      await service.createStory(createDto({ content, language: 'en', estimatedDuration: 4 }), undefined as any);

      expect(prisma.story.create.mock.calls.map((c) => c[0].data.estimatedDuration)).toEqual([11, 10, 13, 4]);
    });

    it('writes the credit and audit fields; dates become Date objects', async () => {
      await service.createStory(
        createDto({
          summary: 'Kısa özet',
          authorName: 'Charles Perrault',
          authorDeathYear: 1703,
          firstPublishedYear: 1697,
          sourceName: 'Histoires ou contes du temps passé',
          sourceUrl: 'https://example.org/perrault',
          originalLanguage: 'fr',
          sourceRetrievedAt: '2026-10-01',
          rightsNote: 'Kamu malı',
          translationMethod: 'HUMAN',
        }),
        undefined as any,
      );

      expect(created()).toMatchObject({
        summary: 'Kısa özet',
        authorName: 'Charles Perrault',
        authorDeathYear: 1703,
        firstPublishedYear: 1697,
        sourceName: 'Histoires ou contes du temps passé',
        sourceUrl: 'https://example.org/perrault',
        originalLanguage: 'fr',
        sourceRetrievedAt: new Date('2026-10-01'),
        rightsNote: 'Kamu malı',
        translationMethod: 'HUMAN',
      });
    });

    it('rights marked verified without a name are attributed to the acting admin', async () => {
      await service.createStory(createDto({ rightsVerifiedAt: '2026-10-13T08:00:00.000Z' }), undefined as any, 'admin@sesly.app');
      expect(created()).toMatchObject({
        rightsVerifiedAt: new Date('2026-10-13T08:00:00.000Z'),
        rightsVerifiedBy: 'admin@sesly.app',
      });

      prisma.story.create.mockClear();
      await service.createStory(
        createDto({ rightsVerifiedAt: '2026-10-13T08:00:00.000Z', rightsVerifiedBy: 'Hukuk danışmanı' }),
        undefined as any,
        'admin@sesly.app',
      );
      expect(created().rightsVerifiedBy).toBe('Hukuk danışmanı');

      prisma.story.create.mockClear();
      await service.createStory(createDto({ rightsVerifiedAt: '2026-10-13T08:00:00.000Z' }), undefined as any);
      expect(created()).not.toHaveProperty('rightsVerifiedBy');

      prisma.story.create.mockClear();
      await service.createStory(createDto({ rightsVerifiedAt: null, sourceRetrievedAt: null }), undefined as any, 'x');
      expect(created()).toMatchObject({ rightsVerifiedAt: null, sourceRetrievedAt: null });
      expect(created()).not.toHaveProperty('rightsVerifiedBy');
    });
  });

  // -------------------------------------------------------------------
  describe('publish rule', () => {
    it('create as PUBLISHED without origin and textFidelity: coded 400 in Turkish, nothing written', async () => {
      const err = await service.createStory(createDto({ status: 'PUBLISHED' }), undefined as any).catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toEqual({
        code: 'STORY_PUBLISH_REQUIREMENTS',
        message: 'Masal yayınlanamaz. Eksik alanlar: Köken, Metin sadakati.',
        missing: ['origin', 'textFidelity'],
      });
      expect(prisma.story.create).not.toHaveBeenCalled();
      expect(prisma.story.findFirst).not.toHaveBeenCalled();
    });

    it('create as PUBLISHED with our own text: published now', async () => {
      await service.createStory(
        createDto({ status: 'PUBLISHED', origin: 'AI_GENERATED', textFidelity: 'RETOLD' }),
        undefined as any,
      );

      expect(created()).toMatchObject({ status: 'PUBLISHED', publishedAt: NOW });
    });

    it.each(['PUBLIC_DOMAIN', 'FOLK_ANONYMOUS', 'LICENSED'])(
      'create as PUBLISHED with origin %s needs the rights data',
      async (origin) => {
        const err = await service
          .createStory(createDto({ status: 'PUBLISHED', origin, textFidelity: 'VERBATIM' }), undefined as any)
          .catch((e) => e);

        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.getResponse().code).toBe('STORY_PUBLISH_REQUIREMENTS');
        expect(err.getResponse().missing).toEqual(
          origin === 'FOLK_ANONYMOUS' ? ['rightsBasis', 'source'] : ['rightsBasis', 'source', 'attribution'],
        );
      },
    );

    it('create as PUBLISHED public-domain story with full rights data passes', async () => {
      await service.createStory(
        createDto({
          status: 'PUBLISHED',
          origin: 'PUBLIC_DOMAIN',
          textFidelity: 'SPELLING_MODERNISED',
          rightsBasis: 'AUTHOR_LIFE_PLUS_70',
          sourceUrl: 'https://example.org/eser',
          authorName: 'Ömer Seyfettin',
        }),
        undefined as any,
      );

      expect(created()).toMatchObject({ status: 'PUBLISHED', origin: 'PUBLIC_DOMAIN', publishedAt: NOW });
    });

    it('a DRAFT can be saved with nothing filled in', async () => {
      await expect(service.createStory(createDto({ status: 'DRAFT' }), undefined as any)).resolves.toBeDefined();
      await expect(
        service.createStory(createDto({ status: 'ARCHIVED', origin: 'PUBLIC_DOMAIN' }), undefined as any),
      ).resolves.toBeDefined();
    });

    it('update: moving a draft to PUBLISHED checks the row as it will be after the update', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ origin: 'PUBLIC_DOMAIN', textFidelity: 'VERBATIM' }));

      const err = await service
        .updateStory('s1', { status: 'PUBLISHED', rightsBasis: 'CC0' } as any, undefined as any)
        .catch((e) => e);

      expect(err.getResponse()).toEqual({
        code: 'STORY_PUBLISH_REQUIREMENTS',
        message:
          'Masal yayınlanamaz. Eksik alanlar: Kaynak (kaynak adı ya da kaynak bağlantısı), Yazar ya da derleyen.',
        missing: ['source', 'attribution'],
      });
      expect(prisma.story.update).not.toHaveBeenCalled();
    });

    it('update: publishing a complete draft stamps publishedAt once', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ origin: 'AI_GENERATED', textFidelity: 'RETOLD' }));
      await service.updateStory('s1', { status: 'PUBLISHED' } as any, undefined as any);
      expect(updated()).toMatchObject({ status: 'PUBLISHED', publishedAt: NOW });

      prisma.story.update.mockClear();
      const first = new Date('2026-01-01T00:00:00Z');
      prisma.story.findUnique.mockResolvedValue(
        storyRow({ status: 'ARCHIVED', publishedAt: first, origin: 'AI_GENERATED', textFidelity: 'RETOLD' }),
      );
      await service.updateStory('s1', { status: 'PUBLISHED' } as any, undefined as any);
      expect(updated()).not.toHaveProperty('publishedAt');
    });

    it('update: a legacy published row (AI_GENERATED + RETOLD) can be edited by a client that sends no new field', async () => {
      prisma.story.findUnique.mockResolvedValue(
        storyRow({ status: 'PUBLISHED', publishedAt: NOW, origin: 'AI_GENERATED', textFidelity: 'RETOLD' }),
      );

      await service.updateStory('s1', { title: 'Yeni başlık', isPremium: true } as any, undefined as any);

      expect(updated()).toEqual({ title: 'Yeni başlık', isPremium: true, coverImageUrl: null });
    });

    it('update: a published story cannot be edited into an unpublishable state', async () => {
      prisma.story.findUnique.mockResolvedValue(
        storyRow({ status: 'PUBLISHED', publishedAt: NOW, origin: 'AI_GENERATED', textFidelity: 'RETOLD' }),
      );

      await expect(
        service.updateStory('s1', { origin: 'LICENSED' } as any, undefined as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.updateStory('s1', { textFidelity: null } as any, undefined as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.story.update).not.toHaveBeenCalled();
    });

    it('update: archiving or un-publishing needs nothing', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ status: 'PUBLISHED', publishedAt: NOW }));

      await service.updateStory('s1', { status: 'ARCHIVED' } as any, undefined as any);

      expect(updated()).toMatchObject({ status: 'ARCHIVED' });
    });
  });

  // -------------------------------------------------------------------
  describe('language level', () => {
    it('setting a level by hand marks the source MANUAL and stamps the assessment time', async () => {
      await service.createStory(createDto({ languageLevel: 'B1', languageLevelNote: 'Uzun cümleler' }), undefined as any);
      expect(created()).toMatchObject({
        languageLevel: 'B1',
        languageLevelSource: 'MANUAL',
        languageLevelAssessedAt: NOW,
        languageLevelNote: 'Uzun cümleler',
      });

      prisma.story.findUnique.mockResolvedValue(storyRow({ languageLevel: 'A1', languageLevelSource: 'AI' }));
      await service.updateStory('s1', { languageLevel: 'A2' } as any, undefined as any);
      expect(updated()).toMatchObject({
        languageLevel: 'A2',
        languageLevelSource: 'MANUAL',
        languageLevelAssessedAt: NOW,
      });
    });

    it('clearing the level clears the source and the assessment time', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ languageLevel: 'A1', languageLevelSource: 'AI' }));

      await service.updateStory('s1', { languageLevel: null } as any, undefined as any);

      expect(updated()).toMatchObject({
        languageLevel: null,
        languageLevelSource: null,
        languageLevelAssessedAt: null,
      });
    });

    it('PATCH with the same level keeps source AI and assessedAt (a full form save is not a new assessment)', async () => {
      prisma.story.findUnique.mockResolvedValue(
        storyRow({
          languageLevel: 'B1',
          languageLevelSource: 'AI',
          languageLevelAssessedAt: new Date('2026-09-01T10:00:00.000Z'),
        }),
      );

      await service.updateStory('s1', { title: 'Yazım düzeltildi', languageLevel: 'B1' } as any, undefined as any);

      expect(updated()).toMatchObject({ title: 'Yazım düzeltildi' });
      expect(updated()).not.toHaveProperty('languageLevel');
      expect(updated()).not.toHaveProperty('languageLevelSource');
      expect(updated()).not.toHaveProperty('languageLevelAssessedAt');
    });

    it('PATCH with a different level turns an AI assessment into a MANUAL one made now', async () => {
      prisma.story.findUnique.mockResolvedValue(
        storyRow({
          languageLevel: 'B1',
          languageLevelSource: 'AI',
          languageLevelAssessedAt: new Date('2026-09-01T10:00:00.000Z'),
        }),
      );

      await service.updateStory('s1', { languageLevel: 'B2' } as any, undefined as any);

      expect(updated()).toMatchObject({
        languageLevel: 'B2',
        languageLevelSource: 'MANUAL',
        languageLevelAssessedAt: NOW,
      });
    });

    it('PATCH with an empty level on a story that has none writes no assessment fields', async () => {
      await service.updateStory('s1', { languageLevel: null, languageLevelNote: 'Henüz bakılmadı' } as any, undefined as any);

      expect(updated()).toMatchObject({ languageLevelNote: 'Henüz bakılmadı' });
      expect(updated()).not.toHaveProperty('languageLevel');
      expect(updated()).not.toHaveProperty('languageLevelSource');
      expect(updated()).not.toHaveProperty('languageLevelAssessedAt');
    });

    it('an update that does not mention the level leaves an AI assessment alone', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ languageLevel: 'A1', languageLevelSource: 'AI' }));

      await service.updateStory('s1', { title: 'Yeni' } as any, undefined as any);

      expect(updated()).not.toHaveProperty('languageLevel');
      expect(updated()).not.toHaveProperty('languageLevelSource');
      expect(updated()).not.toHaveProperty('languageLevelAssessedAt');
    });
  });

  // -------------------------------------------------------------------
  describe('update: slug and language', () => {
    it('a story that has no slug yet gets one from its (new) title', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ slug: null }));

      await service.updateStory('s1', { title: 'Üç Küçük Domuz' } as any, undefined as any);

      expect(updated().slug).toBe('uc-kucuk-domuz');
      expect(prisma.story.findFirst).toHaveBeenCalledWith({
        where: { slug: 'uc-kucuk-domuz', language: 'tr', NOT: { id: 's1' } },
        select: { id: true },
      });
    });

    it('an existing slug is stable: a title change does not touch it', async () => {
      await service.updateStory('s1', { title: 'Başka Başlık' } as any, undefined as any);

      expect(updated()).not.toHaveProperty('slug');
      expect(prisma.story.findFirst).not.toHaveBeenCalled();
    });

    it('an explicit new slug is written; taken by another story it is a 409', async () => {
      await service.updateStory('s1', { slug: 'yeni-kisa-ad' } as any, undefined as any);
      expect(updated().slug).toBe('yeni-kisa-ad');

      prisma.story.update.mockClear();
      prisma.story.findFirst.mockResolvedValue({ id: 'other' });
      await expect(
        service.updateStory('s1', { slug: 'yeni-kisa-ad' } as any, undefined as any),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.story.update).not.toHaveBeenCalled();
    });

    it('changing the language keeps the slug when it is free there, else suffixes it', async () => {
      await service.updateStory('s1', { language: 'en' } as any, undefined as any);
      expect(updated()).toMatchObject({ language: 'en', slug: 'kirmizi-baslikli-kiz' });

      prisma.story.update.mockClear();
      prisma.story.findFirst.mockResolvedValueOnce({ id: 'other' }).mockResolvedValueOnce(null);
      await service.updateStory('s1', { language: 'en' } as any, undefined as any);
      expect(updated().slug).toBe('kirmizi-baslikli-kiz-2');
    });

    it('changing the language of a grouped story is rejected when the group already has that language', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ translationGroupId: 'g1' }));
      prisma.story.findFirst.mockResolvedValueOnce({ id: 'en-1', title: 'Little Red Riding Hood' });

      const err = await service.updateStory('s1', { language: 'en' } as any, undefined as any).catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toEqual({
        code: 'TRANSLATION_LANGUAGE_TAKEN',
        message: 'Bu çeviri grubunda "en" dilinde zaten bir masal var: Little Red Riding Hood.',
        storyId: 'en-1',
      });
      expect(prisma.story.findFirst.mock.calls[0][0].where).toEqual({
        translationGroupId: 'g1',
        language: 'en',
        NOT: { id: 's1' },
      });
      expect(prisma.story.update).not.toHaveBeenCalled();
    });

    it('new content recomputes the duration with the pace of the (new) language', async () => {
      await service.updateStory('s1', { content: words(1650), language: 'ar' } as any, undefined as any);
      expect(updated().estimatedDuration).toBe(13);
    });

    it('rights verified on update are attributed to the acting admin unless a name is already stored', async () => {
      await service.updateStory('s1', { rightsVerifiedAt: '2026-10-13T08:00:00.000Z' } as any, undefined as any, 'admin@sesly.app');
      expect(updated()).toMatchObject({ rightsVerifiedBy: 'admin@sesly.app' });

      prisma.story.update.mockClear();
      prisma.story.findUnique.mockResolvedValue(storyRow({ rightsVerifiedBy: 'Hukuk' }));
      await service.updateStory('s1', { rightsVerifiedAt: '2026-10-13T08:00:00.000Z' } as any, undefined as any, 'admin@sesly.app');
      expect(updated()).not.toHaveProperty('rightsVerifiedBy');
    });
  });

  // -------------------------------------------------------------------
  describe('translatedFromId (create / update)', () => {
    it('create: joins the group of the source story', async () => {
      prisma.story.findUnique.mockResolvedValueOnce({ id: 'tr-1', language: 'tr', translationGroupId: 'g1' });

      await service.createStory(createDto({ language: 'en', translatedFromId: 'tr-1' }), undefined as any);

      expect(created()).toMatchObject({ translatedFromId: 'tr-1', translationGroupId: 'g1', language: 'en' });
      // The group must not already hold an English story.
      expect(prisma.story.findFirst.mock.calls.map((c) => c[0].where)).toContainEqual({
        translationGroupId: 'g1',
        language: 'en',
      });
    });

    it('create: a source without a group gets a new one, shared with the translation', async () => {
      prisma.story.findUnique.mockResolvedValueOnce({ id: 'tr-1', language: 'tr', translationGroupId: null });

      await service.createStory(createDto({ language: 'en', translatedFromId: 'tr-1' }), undefined as any);

      const sourceUpdate = prisma.story.update.mock.calls[0][0];
      expect(sourceUpdate.where).toEqual({ id: 'tr-1' });
      expect(sourceUpdate.data.translationGroupId).toMatch(UUID);
      expect(created().translationGroupId).toBe(sourceUpdate.data.translationGroupId);
    });

    it('create: 404 when the source does not exist', async () => {
      prisma.story.findUnique.mockResolvedValueOnce(null);

      const err = await service
        .createStory(createDto({ language: 'en', translatedFromId: 'ghost' }), undefined as any)
        .catch((e) => e);

      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('Çevirinin kaynağı olan masal bulunamadı.');
      expect(prisma.story.create).not.toHaveBeenCalled();
    });

    it('create: a translation cannot be in the language of its source', async () => {
      prisma.story.findUnique.mockResolvedValueOnce({ id: 'tr-1', language: 'tr', translationGroupId: null });

      const err = await service.createStory(createDto({ translatedFromId: 'tr-1' }), undefined as any).catch((e) => e);

      expect(err.getResponse()).toEqual({
        code: 'TRANSLATION_SAME_LANGUAGE',
        message: 'Bir masal kendi dilindeki bir masalın çevirisi olamaz.',
      });
      expect(prisma.story.create).not.toHaveBeenCalled();
    });

    it('create: rejected when the group already has a story in that language', async () => {
      prisma.story.findUnique.mockResolvedValueOnce({ id: 'tr-1', language: 'tr', translationGroupId: 'g1' });
      prisma.story.findFirst
        .mockResolvedValueOnce(null) // slug is free
        .mockResolvedValueOnce({ id: 'en-1', title: 'Little Red Riding Hood' });

      const err = await service
        .createStory(createDto({ language: 'en', translatedFromId: 'tr-1' }), undefined as any)
        .catch((e) => e);

      expect(err.getResponse().code).toBe('TRANSLATION_LANGUAGE_TAKEN');
      expect(prisma.story.create).not.toHaveBeenCalled();
    });

    it('update: a story cannot be its own translation', async () => {
      const err = await service.updateStory('s1', { translatedFromId: 's1' } as any, undefined as any).catch((e) => e);

      expect(err.getResponse()).toEqual({
        code: 'TRANSLATION_SELF',
        message: 'Bir masal kendisinin çevirisi olamaz.',
      });
    });

    it('update: setting a source moves the story into the source group (itself excluded from the clash check)', async () => {
      prisma.story.findUnique
        .mockResolvedValueOnce(storyRow({ id: 's1', language: 'en' }))
        .mockResolvedValueOnce({ id: 'tr-1', language: 'tr', translationGroupId: 'g1' });

      await service.updateStory('s1', { translatedFromId: 'tr-1' } as any, undefined as any);

      expect(prisma.story.findFirst.mock.calls[0][0].where).toEqual({
        translationGroupId: 'g1',
        language: 'en',
        NOT: { id: 's1' },
      });
      expect(updated()).toMatchObject({ translatedFromId: 'tr-1', translationGroupId: 'g1' });
    });

    it('update: null clears the source but leaves the group (use the unlink endpoint for that)', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ translatedFromId: 'tr-1', translationGroupId: 'g1' }));

      await service.updateStory('s1', { translatedFromId: null } as any, undefined as any);

      expect(updated()).toMatchObject({ translatedFromId: null });
      expect(updated()).not.toHaveProperty('translationGroupId');
    });

    /** Data of the update that wrote story `id` (the source may be written first). */
    const writeOf = (id: string) =>
      prisma.story.update.mock.calls.map((c) => c[0]).find((c) => c.where.id === id)?.data;

    it('update: re-sending the stored source is a no-op, so a story unlinked by hand stays unlinked', async () => {
      // B was a translation of tr-1 and was taken out of the group with the
      // unlink endpoint; the form still carries translatedFromId on save.
      prisma.story.findUnique.mockResolvedValue(
        storyRow({ language: 'en', translatedFromId: 'tr-1', translationGroupId: null }),
      );

      await service.updateStory('s1', { title: 'Little Red', translatedFromId: 'tr-1' } as any, undefined as any);

      expect(prisma.story.update).toHaveBeenCalledTimes(1);
      expect(updated()).toMatchObject({ title: 'Little Red' });
      expect(updated()).not.toHaveProperty('translationGroupId');
      expect(updated()).not.toHaveProperty('translatedFromId');
      // The source story is not even read: existing row, then the detail.
      expect(prisma.story.findUnique.mock.calls.map((c) => c[0].where)).toEqual([{ id: 's1' }, { id: 's1' }]);
      expect(prisma.story.findFirst).not.toHaveBeenCalled();
      expect(prisma.story.updateMany).not.toHaveBeenCalled();
    });

    it('update: an empty source on a story that has none writes nothing about translations', async () => {
      await service.updateStory('s1', { translatedFromId: null } as any, undefined as any);

      expect(updated()).not.toHaveProperty('translatedFromId');
      expect(updated()).not.toHaveProperty('translationGroupId');
    });

    it('update: a grouped story keeps its group and pulls an ungrouped source into it', async () => {
      // en (s1) and de are linked by hand in g1; the Turkish source has no group.
      prisma.story.findUnique
        .mockResolvedValueOnce(storyRow({ language: 'en', translationGroupId: 'g1' }))
        .mockResolvedValueOnce({ id: 'tr-1', language: 'tr', title: 'Kırmızı Başlıklı Kız', translationGroupId: null });

      await service.updateStory('s1', { translatedFromId: 'tr-1' } as any, undefined as any);

      // The group must not already hold a Turkish story.
      expect(prisma.story.findFirst.mock.calls.map((c) => c[0].where)).toEqual([
        { translationGroupId: 'g1', language: 'tr', NOT: { id: 'tr-1' } },
      ]);
      expect(writeOf('tr-1')).toEqual({ translationGroupId: 'g1' });
      expect(writeOf('s1')).toMatchObject({ translatedFromId: 'tr-1', translationGroupId: 'g1' });
      // Nobody else is moved: the German sibling stays in g1 with both.
      expect(prisma.story.updateMany).not.toHaveBeenCalled();
    });

    it('update: an ungrouped source cannot join when the story group already has its language', async () => {
      prisma.story.findUnique
        .mockResolvedValueOnce(storyRow({ language: 'en', translationGroupId: 'g1' }))
        .mockResolvedValueOnce({ id: 'tr-1', language: 'tr', title: 'Kırmızı Başlıklı Kız', translationGroupId: null });
      prisma.story.findFirst.mockResolvedValueOnce({ id: 'tr-2', title: 'Kırmızı Şapkalı Kız' });

      const err = await service.updateStory('s1', { translatedFromId: 'tr-1' } as any, undefined as any).catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toEqual({
        code: 'TRANSLATION_LANGUAGE_TAKEN',
        message: 'Bu çeviri grubunda "tr" dilinde zaten bir masal var: Kırmızı Şapkalı Kız.',
        storyId: 'tr-2',
      });
      expect(prisma.story.update).not.toHaveBeenCalled();
    });

    it('update: a source in another group merges the two groups into the story group', async () => {
      const self = { id: 's1', language: 'en', title: 'Little Red Riding Hood', translationGroupId: 'g1' };
      const de = { id: 'de-1', language: 'de', title: 'Rotkäppchen', translationGroupId: 'g1' };
      const tr = { id: 'tr-1', language: 'tr', title: 'Kırmızı Başlıklı Kız', translationGroupId: 'g2' };
      const fr = { id: 'fr-1', language: 'fr', title: 'Le Petit Chaperon rouge', translationGroupId: 'g2' };
      prisma.story.findUnique.mockResolvedValueOnce(storyRow(self)).mockResolvedValueOnce(tr);
      prisma.story.findMany.mockResolvedValueOnce([self, de, tr, fr]);

      await service.updateStory('s1', { translatedFromId: 'tr-1' } as any, undefined as any);

      expect(prisma.story.findMany.mock.calls[0][0].where).toEqual({ translationGroupId: { in: ['g1', 'g2'] } });
      expect(prisma.story.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['s1', 'tr-1', 'de-1', 'fr-1'] } },
        data: { translationGroupId: 'g1' },
      });
      expect(writeOf('s1')).toMatchObject({ translatedFromId: 'tr-1', translationGroupId: 'g1' });
    });

    it('update: two groups that overlap in a language are not merged, nothing is written', async () => {
      const self = { id: 's1', language: 'en', title: 'Little Red Riding Hood', translationGroupId: 'g1' };
      const de = { id: 'de-1', language: 'de', title: 'Rotkäppchen', translationGroupId: 'g1' };
      const tr = { id: 'tr-1', language: 'tr', title: 'Kırmızı Başlıklı Kız', translationGroupId: 'g2' };
      const de2 = { id: 'de-2', language: 'de', title: 'Das Rotkäppchen', translationGroupId: 'g2' };
      prisma.story.findUnique.mockResolvedValueOnce(storyRow(self)).mockResolvedValueOnce(tr);
      prisma.story.findMany.mockResolvedValueOnce([self, de, tr, de2]);

      const err = await service.updateStory('s1', { translatedFromId: 'tr-1' } as any, undefined as any).catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toEqual({
        code: 'TRANSLATION_LANGUAGE_TAKEN',
        message: 'Bu iki masal bağlanamaz: grupta "de" dilinde iki masal olurdu (Rotkäppchen, Das Rotkäppchen).',
        storyIds: ['de-1', 'de-2'],
      });
      expect(prisma.story.updateMany).not.toHaveBeenCalled();
      expect(prisma.story.update).not.toHaveBeenCalled();
    });

    it('update: a merge is checked with the language the story is about to get, not the stored one', async () => {
      // s1 is stored as English and becomes Spanish in the same request. The
      // source group already has an English story, which is fine for Spanish.
      const stored = { id: 's1', language: 'en', title: 'Caperucita Roja', translationGroupId: 'g1' };
      const tr = { id: 'tr-1', language: 'tr', title: 'Kırmızı Başlıklı Kız', translationGroupId: 'g2' };
      const en = { id: 'en-1', language: 'en', title: 'Little Red Riding Hood', translationGroupId: 'g2' };
      prisma.story.findUnique.mockResolvedValueOnce(storyRow(stored)).mockResolvedValueOnce(tr);
      prisma.story.findMany.mockResolvedValueOnce([stored, tr, en]);

      await service.updateStory('s1', { language: 'es', translatedFromId: 'tr-1' } as any, undefined as any);

      // Its own group is checked for the new language first.
      expect(prisma.story.findFirst.mock.calls[0][0].where).toEqual({
        translationGroupId: 'g1',
        language: 'es',
        NOT: { id: 's1' },
      });
      expect(prisma.story.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['s1', 'tr-1', 'en-1'] } },
        data: { translationGroupId: 'g1' },
      });
      expect(writeOf('s1')).toMatchObject({ language: 'es', translationGroupId: 'g1', translatedFromId: 'tr-1' });
    });

    it('update: a source that is already in the same group only records the source', async () => {
      prisma.story.findUnique
        .mockResolvedValueOnce(storyRow({ language: 'en', translationGroupId: 'g1' }))
        .mockResolvedValueOnce({ id: 'tr-1', language: 'tr', title: 'Kırmızı Başlıklı Kız', translationGroupId: 'g1' });

      await service.updateStory('s1', { translatedFromId: 'tr-1' } as any, undefined as any);

      expect(prisma.story.update).toHaveBeenCalledTimes(1);
      expect(prisma.story.updateMany).not.toHaveBeenCalled();
      expect(updated()).toMatchObject({ translatedFromId: 'tr-1', translationGroupId: 'g1' });
    });

    it('update: changing the source to another story does join that story group', async () => {
      prisma.story.findUnique
        .mockResolvedValueOnce(storyRow({ language: 'en', translatedFromId: 'tr-1' }))
        .mockResolvedValueOnce({ id: 'tr-9', language: 'tr', title: 'Başka', translationGroupId: 'g9' });

      await service.updateStory('s1', { translatedFromId: 'tr-9' } as any, undefined as any);

      expect(updated()).toMatchObject({ translatedFromId: 'tr-9', translationGroupId: 'g9' });
    });
  });

  // -------------------------------------------------------------------
  describe('POST /admin/stories/:id/link-translation', () => {
    const tr = (over: Record<string, any> = {}) => ({ id: 'tr-1', language: 'tr', title: 'Kırmızı Başlıklı Kız', translationGroupId: null, ...over });
    const en = (over: Record<string, any> = {}) => ({ id: 'en-1', language: 'en', title: 'Little Red Riding Hood', translationGroupId: null, ...over });

    /** findUnique: the two stories of the link, then the detail read at the end. */
    const stories = (a: any, b: any) => {
      prisma.story.findUnique
        .mockResolvedValueOnce(a)
        .mockResolvedValueOnce(b)
        .mockResolvedValue(storyRow({ id: a?.id ?? 's1' }));
    };

    it('a story cannot be linked to itself', async () => {
      const err = await service.linkTranslation('tr-1', 'tr-1').catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toEqual({ code: 'TRANSLATION_SELF', message: 'Bir masal kendisiyle eşleştirilemez.' });
      expect(prisma.story.findUnique).not.toHaveBeenCalled();
    });

    it.each([
      ['the story', null, en()],
      ['the other story', tr(), null],
    ])('404 when %s does not exist', async (_label, a, b) => {
      stories(a, b);
      await expect(service.linkTranslation('tr-1', 'en-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.story.updateMany).not.toHaveBeenCalled();
    });

    it('rejects two stories of the same language', async () => {
      stories(tr(), tr({ id: 'tr-2', title: 'Kırmızı Şapkalı Kız' }));

      const err = await service.linkTranslation('tr-1', 'tr-2').catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toEqual({
        code: 'TRANSLATION_SAME_LANGUAGE',
        message: 'Aynı dildeki iki masal birbirinin çevirisi olarak bağlanamaz.',
      });
      expect(prisma.story.updateMany).not.toHaveBeenCalled();
    });

    it('two ungrouped stories get a new group', async () => {
      stories(tr(), en());

      await service.linkTranslation('tr-1', 'en-1');

      const call = prisma.story.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: { in: ['tr-1', 'en-1'] } });
      expect(call.data.translationGroupId).toMatch(UUID);
      // No group existed, so no member lookup was needed.
      expect(prisma.story.findMany).toHaveBeenCalledTimes(0);
    });

    it('an ungrouped story joins the existing group of the other', async () => {
      stories(tr(), en({ translationGroupId: 'g1' }));
      prisma.story.findMany.mockResolvedValueOnce([
        en({ translationGroupId: 'g1' }),
        { id: 'de-1', language: 'de', title: 'Rotkäppchen', translationGroupId: 'g1' },
      ]);

      await service.linkTranslation('tr-1', 'en-1');

      expect(prisma.story.findMany.mock.calls[0][0].where).toEqual({ translationGroupId: { in: ['g1'] } });
      expect(prisma.story.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['tr-1', 'en-1', 'de-1'] } },
        data: { translationGroupId: 'g1' },
      });
    });

    it('rejects joining a group that already has a story in that language', async () => {
      stories(tr(), en({ translationGroupId: 'g1' }));
      prisma.story.findMany.mockResolvedValueOnce([
        en({ translationGroupId: 'g1' }),
        tr({ id: 'tr-9', title: 'Eski Türkçe Sürüm', translationGroupId: 'g1' }),
      ]);

      const err = await service.linkTranslation('tr-1', 'en-1').catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toEqual({
        code: 'TRANSLATION_LANGUAGE_TAKEN',
        message:
          'Bu iki masal bağlanamaz: grupta "tr" dilinde iki masal olurdu (Kırmızı Başlıklı Kız, Eski Türkçe Sürüm).',
        storyIds: ['tr-1', 'tr-9'],
      });
      expect(prisma.story.updateMany).not.toHaveBeenCalled();
    });

    it('two different groups are merged into the first story group when their languages do not overlap', async () => {
      stories(tr({ translationGroupId: 'g1' }), en({ translationGroupId: 'g2' }));
      prisma.story.findMany.mockResolvedValueOnce([
        tr({ translationGroupId: 'g1' }),
        { id: 'de-1', language: 'de', title: 'Rotkäppchen', translationGroupId: 'g1' },
        en({ translationGroupId: 'g2' }),
        { id: 'fr-1', language: 'fr', title: 'Le Petit Chaperon rouge', translationGroupId: 'g2' },
      ]);

      await service.linkTranslation('tr-1', 'en-1');

      expect(prisma.story.findMany.mock.calls[0][0].where).toEqual({ translationGroupId: { in: ['g1', 'g2'] } });
      const call = prisma.story.updateMany.mock.calls[0][0];
      expect([...call.where.id.in].sort()).toEqual(['de-1', 'en-1', 'fr-1', 'tr-1']);
      expect(call.data).toEqual({ translationGroupId: 'g1' });
    });

    it('two groups that overlap in a language cannot be merged', async () => {
      stories(tr({ translationGroupId: 'g1' }), en({ translationGroupId: 'g2' }));
      prisma.story.findMany.mockResolvedValueOnce([
        tr({ translationGroupId: 'g1' }),
        { id: 'de-1', language: 'de', title: 'Rotkäppchen', translationGroupId: 'g1' },
        en({ translationGroupId: 'g2' }),
        { id: 'de-2', language: 'de', title: 'Rotkäppchen (neu)', translationGroupId: 'g2' },
      ]);

      const err = await service.linkTranslation('tr-1', 'en-1').catch((e) => e);

      expect(err.getResponse().code).toBe('TRANSLATION_LANGUAGE_TAKEN');
      expect(err.getResponse().storyIds).toEqual(['de-1', 'de-2']);
      expect(prisma.story.updateMany).not.toHaveBeenCalled();
    });

    it('already in the same group: idempotent, nothing written', async () => {
      stories(tr({ translationGroupId: 'g1' }), en({ translationGroupId: 'g1' }));

      await expect(service.linkTranslation('tr-1', 'en-1')).resolves.toMatchObject({ id: 'tr-1' });
      expect(prisma.story.updateMany).not.toHaveBeenCalled();
    });

    it('returns the story detail with its translations', async () => {
      stories(tr(), en());
      prisma.story.findUnique.mockResolvedValue(storyRow({ id: 'tr-1', translationGroupId: 'g-new' }));
      prisma.story.findMany.mockResolvedValue([
        { id: 'en-1', language: 'en', title: 'Little Red Riding Hood', status: 'DRAFT', translationGroupId: 'g-new' },
      ]);

      const res: any = await service.linkTranslation('tr-1', 'en-1');

      expect(res.groupLanguages).toEqual(['tr', 'en']);
      expect(res.translations).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------
  describe('DELETE /admin/stories/:id/translation-link', () => {
    it('404 when the story does not exist', async () => {
      prisma.story.findUnique.mockResolvedValue(null);
      await expect(service.unlinkTranslation('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a story without a group is returned unchanged', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow());

      await expect(service.unlinkTranslation('s1')).resolves.toMatchObject({ id: 's1' });
      expect(prisma.story.update).not.toHaveBeenCalled();
    });

    it('takes the story out; a group that still has two or more members stays', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ translationGroupId: 'g1' }));
      prisma.story.findMany.mockResolvedValueOnce([{ id: 'en-1' }, { id: 'de-1' }]);

      await service.unlinkTranslation('s1');

      expect(prisma.story.update).toHaveBeenCalledTimes(1);
      // translatedFromId is kept: it records provenance, not group membership.
      expect(prisma.story.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { translationGroupId: null } });
      expect(prisma.story.findMany.mock.calls[0][0]).toEqual({
        where: { translationGroupId: 'g1' },
        select: { id: true },
      });
    });

    it('a group left with a single story is dissolved', async () => {
      prisma.story.findUnique.mockResolvedValue(storyRow({ translationGroupId: 'g1' }));
      prisma.story.findMany.mockResolvedValueOnce([{ id: 'en-1' }]);

      await service.unlinkTranslation('s1');

      expect(prisma.story.update).toHaveBeenCalledTimes(2);
      expect(prisma.story.update).toHaveBeenLastCalledWith({
        where: { id: 'en-1' },
        data: { translationGroupId: null },
      });
    });
  });
});
