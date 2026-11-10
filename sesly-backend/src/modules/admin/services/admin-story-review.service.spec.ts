import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminStoryReviewService, coverKeyVariants, coverMatchKey, emotionSummary } from './admin-story-review.service';
import { pairGroupId, partGroupIdOf } from './admin-story-import.service';
import { createMockPrismaService, MockPrismaService } from '../../../test-utils/prisma-mock';

const ccBy = {
  origin: 'LICENSED',
  textFidelity: 'VERBATIM',
  rightsBasis: 'CC_BY',
  sourceUrl: 'https://www.africanstorybook.org/',
  authorName: 'Yazar',
  attribution: 'Book Dash, CC BY 4.0',
  licenseName: 'CC BY 4.0',
};

describe('AdminStoryReviewService', () => {
  let prisma: MockPrismaService;
  let stories: { buildAdminWhere: jest.Mock; getPresignedCoverImageUrl: jest.Mock; deleteStory: jest.Mock };
  let translationRequests: { fulfilForStory: jest.Mock };
  let service: AdminStoryReviewService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    stories = {
      buildAdminWhere: jest.fn(async (q: any) => ({ built: q })),
      getPresignedCoverImageUrl: jest.fn(async (s: any) => (s?.coverImageUrl ? `signed:${s.coverImageUrl}` : null)),
      deleteStory: jest.fn().mockResolvedValue({ message: 'Story deleted successfully' }),
    };
    translationRequests = { fulfilForStory: jest.fn().mockResolvedValue(undefined) };
    service = new AdminStoryReviewService(prisma as any, stories as any, translationRequests as any);
  });

  describe('helpers', () => {
    it('emotionSummary counts tags, most used first, untagged as the story default', () => {
      expect(
        emotionSummary([{ emotion: 'calm' }, { emotion: 'happy' }, { emotion: 'calm' }, {}, { emotion: 'zzz-unknown' }]),
      ).toEqual([
        { emotion: 'calm', label: expect.any(String), count: 2 },
        { emotion: null, label: 'Masal varsayılanı', count: 1 },
        { emotion: 'happy', label: expect.any(String), count: 1 },
        { emotion: 'zzz-unknown', label: 'zzz-unknown', count: 1 },
      ]);
      expect(emotionSummary([])).toEqual([]);
    });

    it('coverMatchKey: the file name without extension, lower case, Turkish letters folded', () => {
      expect(coverMatchKey('little-idas-flowers.jpg')).toBe('little-idas-flowers');
      expect(coverMatchKey(' Temiz Kedicik Tırmık.PNG ')).toBe('temiz-kedicik-tirmik');
      expect(coverMatchKey('Çirkin_Ördek  Yavrusu.webp')).toBe('cirkin-ordek-yavrusu');
      expect(coverMatchKey('İnci--Kız!.jpeg')).toBe('inci-kiz');
      expect(coverMatchKey('...')).toBe('');
    });

    it('coverKeyVariants: as it is, without the article, with "the-"', () => {
      expect(coverKeyVariants('woodcutter-of-gura')).toEqual(['woodcutter-of-gura', 'the-woodcutter-of-gura']);
      expect(coverKeyVariants('the-selfish-giant')).toEqual(['the-selfish-giant', 'selfish-giant']);
    });
  });

  describe('review list', () => {
    const row = (over: Record<string, any> = {}) => ({
      id: 'tr1',
      title: 'Tilki',
      language: 'tr',
      status: 'DRAFT',
      content: 'Bir varmış bir yokmuş.',
      category: 'BEDTIME',
      ageGroup: 'THREE_TO_SIX',
      contentWarnings: ['DEATH', 'bilinmeyen', 'SCARY'],
      translationMethod: 'MACHINE',
      translatedFromId: 'en1',
      translationGroupId: 'g1',
      partGroupId: 'p1',
      partNumber: 1,
      coverImageUrl: null,
      coverCredit: null,
      preprocessedSegments: [{ text: 'Bir varmış', emotion: 'calm' }, { text: 'bir yokmuş.' }],
      preprocessedModel: 'import',
      segmentationVersion: 1,
      reviewedAt: null,
      ...ccBy,
      ...over,
    });

    it('defaults to imported drafts in import order and builds one card per story', async () => {
      prisma.story.findMany
        .mockResolvedValueOnce([row()])
        .mockResolvedValueOnce([
          { id: 'tr1', title: 'Tilki', language: 'tr', status: 'DRAFT', translationGroupId: 'g1', partGroupId: 'p1', partNumber: 1, coverImageUrl: null },
          { id: 'en1', title: 'The Fox', language: 'en', status: 'DRAFT', reviewedAt: new Date(), translationGroupId: 'g1', partGroupId: null, partNumber: null, coverImageUrl: 'stories/cover/fox.png', coverCredit: { illustrator: 'Ada' } },
          { id: 'tr2', title: 'Tilki 2', language: 'tr', status: 'DRAFT', translationGroupId: null, partGroupId: 'p1', partNumber: 2, coverImageUrl: null },
        ]);
      prisma.story.count.mockResolvedValue(1);

      const res = await service.reviewList({});

      expect(stories.buildAdminWhere).toHaveBeenCalledWith({ imported: true, status: 'DRAFT' });
      expect(prisma.story.findMany.mock.calls[0][0]).toMatchObject({
        where: { built: { imported: true, status: 'DRAFT' } },
        skip: 0,
        take: 20,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      expect(res).toMatchObject({ total: 1, page: 1, limit: 20, totalPages: 1 });
      const card = res.data[0];
      expect(card).toMatchObject({
        id: 'tr1',
        content: 'Bir varmış bir yokmuş.',
        wordCount: 4,
        categoryLabel: expect.any(String),
        ageGroupLabel: expect.any(String),
        isMachineTranslation: true,
        translatedFrom: { id: 'en1', title: 'The Fox', language: 'en' },
        translations: [{ id: 'en1', title: 'The Fox', language: 'en', status: 'DRAFT', reviewed: true }],
        parts: [
          { id: 'tr1', number: 1 },
          { id: 'tr2', number: 2 },
        ],
        segments: { count: 2, source: 'import', version: 1 },
        coverImageUrl: null,
        sharedCoverImageUrl: 'signed:stories/cover/fox.png',
        coverCredit: null,
        reviewed: false,
        publishable: true,
        publishMissing: [],
      });
      expect(card.contentWarnings.map((w: any) => w.value)).toEqual(['SCARY', 'DEATH']);
      expect(card.segments.emotions).toHaveLength(2);
      expect(card).not.toHaveProperty('preprocessedSegments');
    });

    it('keeps explicit filters, caps the page size, reports what blocks publishing', async () => {
      prisma.story.findMany.mockResolvedValueOnce([
        row({
          translationGroupId: null,
          partGroupId: null,
          translatedFromId: null,
          translationMethod: null,
          attribution: null,
          content: '   ',
          coverImageUrl: 'stories/cover/own.png',
          coverCredit: { illustrator: 'Ada', licence: 'CC BY 4.0' },
          reviewedAt: new Date(),
        }),
      ]);
      prisma.story.count.mockResolvedValue(1);
      const res = await service.reviewList({ status: 'PUBLISHED', imported: false, limit: 500, page: 2, sort: 'title' } as any);
      expect(stories.buildAdminWhere).toHaveBeenCalledWith(expect.objectContaining({ status: 'PUBLISHED', imported: false }));
      expect(prisma.story.findMany.mock.calls[0][0]).toMatchObject({ skip: 200, take: 200, orderBy: [{ title: 'asc' }, { createdAt: 'desc' }] });
      // Neither group: no member query.
      expect(prisma.story.findMany).toHaveBeenCalledTimes(1);
      expect(res.data[0]).toMatchObject({
        wordCount: 0,
        translations: [],
        parts: [],
        translatedFrom: null,
        isMachineTranslation: false,
        coverImageUrl: 'signed:stories/cover/own.png',
        sharedCoverImageUrl: null,
        coverCredit: { illustrator: 'Ada', licenseName: 'CC BY 4.0' },
        coverCreditLine: 'Ada, CC BY 4.0',
        reviewed: true,
        publishable: false,
      });
      expect(res.data[0].publishMissing.map((m: any) => m.field)).toEqual(['ccAttribution']);
    });

    it('lists import batches with their counts, newest first', async () => {
      const d = (s: string) => new Date(s);
      prisma.story.findMany.mockResolvedValue([
        { importBatch: 'a.json', status: 'DRAFT', reviewedAt: null, importedAt: d('2026-10-01T10:00:00Z') },
        { importBatch: 'a.json', status: 'PUBLISHED', reviewedAt: d('2026-10-02'), importedAt: d('2026-10-01T09:00:00Z') },
        { importBatch: 'b.json', status: 'DRAFT', reviewedAt: null, importedAt: d('2026-10-05T10:00:00Z') },
        { importBatch: null, status: 'ARCHIVED', reviewedAt: null, importedAt: d('2026-09-01T10:00:00Z') },
      ]);
      const { batches } = await service.listImportBatches();
      expect(batches.map((b) => b.batch)).toEqual(['b.json', 'a.json', null]);
      expect(batches[1]).toEqual({
        batch: 'a.json',
        total: 2,
        drafts: 1,
        reviewed: 1,
        published: 1,
        firstImportedAt: d('2026-10-01T09:00:00Z'),
        lastImportedAt: d('2026-10-01T10:00:00Z'),
      });
      prisma.story.findMany.mockResolvedValue(undefined);
      await expect(service.listImportBatches()).resolves.toEqual({ batches: [] });
    });

    it('the review toggle records who and when, and can be taken back', async () => {
      prisma.story.findUnique.mockResolvedValue({ id: 's1' });
      prisma.story.update.mockImplementation(async ({ data }: any) => ({ id: 's1', ...data }));
      await expect(service.setReviewed('s1', true, 'admin@sesly.io')).resolves.toMatchObject({
        reviewed: true,
        reviewedBy: 'admin@sesly.io',
      });
      expect(prisma.story.update.mock.calls[0][0].data.reviewedAt).toBeInstanceOf(Date);
      await expect(service.setReviewed('s1', false)).resolves.toEqual({
        id: 's1',
        reviewedAt: null,
        reviewedBy: null,
        reviewed: false,
      });
      await service.setReviewed('s1', true);
      expect(prisma.story.update.mock.calls[2][0].data.reviewedBy).toBeNull();
      prisma.story.findUnique.mockResolvedValue(null);
      await expect(service.setReviewed('x', true)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('id list', () => {
    const brief = (id: string, over: Record<string, any> = {}) => ({
      id,
      title: id,
      language: 'tr',
      status: 'DRAFT',
      reviewedAt: null,
      ...ccBy,
      ...over,
    });

    it('view=review: the review defaults and import order; small rows with review and publish state', async () => {
      prisma.story.findMany.mockResolvedValueOnce([brief('a', { reviewedAt: new Date() }), brief('b', { attribution: null })]);
      prisma.story.count.mockResolvedValueOnce(2);
      const res = await service.listIds({ view: 'review', importBatch: 'x.json' } as any);
      expect(stories.buildAdminWhere).toHaveBeenCalledWith(
        expect.objectContaining({ importBatch: 'x.json', imported: true, status: 'DRAFT' }),
      );
      const args = prisma.story.findMany.mock.calls[0][0];
      expect(args).toMatchObject({ take: 1000, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      expect(args.select).toMatchObject({ id: true, reviewedAt: true, attribution: true, licenseName: true });
      expect(args.select.content).toBeUndefined();
      expect(res).toEqual({
        total: 2,
        limit: 1000,
        truncated: false,
        items: [
          { id: 'a', title: 'a', language: 'tr', status: 'DRAFT', reviewed: true, publishable: true },
          { id: 'b', title: 'b', language: 'tr', status: 'DRAFT', reviewed: false, publishable: false },
        ],
      });
    });

    it('view=review keeps explicit filters and a sort', async () => {
      prisma.story.findMany.mockResolvedValueOnce([]);
      prisma.story.count.mockResolvedValueOnce(0);
      await service.listIds({ view: 'review', status: 'PUBLISHED', imported: false, sort: 'title' } as any);
      expect(stories.buildAdminWhere).toHaveBeenCalledWith(expect.objectContaining({ status: 'PUBLISHED', imported: false }));
      expect(prisma.story.findMany.mock.calls[0][0].orderBy).toEqual([{ title: 'asc' }, { createdAt: 'desc' }]);
    });

    it('the list view uses the list filters as they are; more than 1000 is truncated', async () => {
      prisma.story.findMany.mockResolvedValueOnce([brief('a', { status: 'PUBLISHED' })]);
      prisma.story.count.mockResolvedValueOnce(1500);
      const res = await service.listIds({ language: 'en' } as any);
      expect(stories.buildAdminWhere).toHaveBeenCalledWith({ language: 'en' });
      expect(prisma.story.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }]);
      expect(res).toMatchObject({ total: 1500, truncated: true, items: [{ id: 'a', status: 'PUBLISHED' }] });
      prisma.story.findMany.mockResolvedValueOnce(undefined);
      prisma.story.count.mockResolvedValueOnce(0);
      await expect(service.listIds()).resolves.toEqual({ total: 0, limit: 1000, truncated: false, items: [] });
    });
  });

  describe('bulk review', () => {
    it('marks in chunks of 200, keeps who marked first, reports missing ids', async () => {
      const ids = Array.from({ length: 450 }, (_, i) => `s${i}`);
      prisma.story.findMany.mockImplementation(async ({ where }: any) =>
        where.id.in.filter((id: string) => id !== 's3' && id !== 's420').map((id: string) => ({ id })),
      );
      prisma.story.updateMany.mockImplementation(async ({ where }: any) => ({ count: where.id.in.length - 1 }));
      const res = await service.bulkSetReviewed([...ids, 's0'], true, 'admin@sesly.io');
      expect(prisma.story.findMany.mock.calls.map((c: any) => c[0].where.id.in.length)).toEqual([200, 200, 50]);
      const update = prisma.story.updateMany.mock.calls[0][0];
      expect(update.where.reviewedAt).toBeNull();
      expect(update.data).toEqual({ reviewedAt: expect.any(Date), reviewedBy: 'admin@sesly.io' });
      expect(res).toEqual({ reviewed: true, requested: 450, changed: 445, unchanged: 3, missing: ['s3', 's420'] });
    });

    it('unmarking clears reviewer and time of marked stories only; nothing found writes nothing', async () => {
      prisma.story.findMany.mockResolvedValueOnce([{ id: 'a' }]);
      prisma.story.updateMany.mockResolvedValueOnce({ count: 1 });
      await expect(service.bulkSetReviewed(['a'], false)).resolves.toEqual({
        reviewed: false,
        requested: 1,
        changed: 1,
        unchanged: 0,
        missing: [],
      });
      expect(prisma.story.updateMany.mock.calls[0][0]).toEqual({
        where: { id: { in: ['a'] }, reviewedAt: { not: null } },
        data: { reviewedAt: null, reviewedBy: null },
      });
      prisma.story.findMany.mockResolvedValueOnce(undefined);
      await expect(service.bulkSetReviewed(['gone'], true)).resolves.toMatchObject({ changed: 0, missing: ['gone'] });
      expect(prisma.story.updateMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('bulk publish', () => {
    const draft = (id: string, over: Record<string, any> = {}) => ({
      id,
      title: id,
      language: 'tr',
      status: 'DRAFT',
      publishedAt: null,
      reviewedAt: new Date(),
      ...ccBy,
      ...over,
    });

    it('publishes what passes, reports the rest; CC BY without its credit is refused', async () => {
      prisma.story.findMany.mockResolvedValue([
        draft('ok'),
        draft('again', { publishedAt: new Date('2026-01-01') }),
        draft('live', { status: 'PUBLISHED' }),
        draft('unreviewed', { reviewedAt: null }),
        draft('noCredit', { attribution: ' ', licenseName: null }),
        draft('raced'),
      ]);
      prisma.story.updateMany.mockImplementation(async ({ where }: any) => ({ count: where.id === 'raced' ? 0 : 1 }));

      const res = await service.bulkPublish(
        ['ok', 'again', 'live', 'unreviewed', 'noCredit', 'raced', 'gone', 'ok'],
        { requireReviewed: true },
        'admin@sesly.io',
      );

      expect(res.published).toEqual([
        { id: 'ok', title: 'ok', language: 'tr' },
        { id: 'again', title: 'again', language: 'tr' },
      ]);
      expect(res.skipped).toEqual([
        { storyId: 'live', title: 'live', reason: 'Zaten yayında.' },
        { storyId: 'unreviewed', title: 'unreviewed', reason: 'İncelendi olarak işaretlenmedi.' },
        {
          storyId: 'noCredit',
          title: 'noCredit',
          reason:
            'Masal yayınlanamaz. Eksik alanlar: Atıf metni (CC BY lisansı için zorunlu), Lisans adı (CC BY lisansı için zorunlu).',
          missing: ['ccAttribution', 'ccLicense'],
        },
        { storyId: 'raced', title: 'raced', reason: 'Masal bu arada değişti, yeniden deneyin.' },
        { storyId: 'gone', title: null, reason: 'Masal bulunamadı.' },
      ]);
      const ok = prisma.story.updateMany.mock.calls.find((c: any) => c[0].where.id === 'ok')[0];
      expect(ok).toEqual({
        where: { id: 'ok', status: 'DRAFT' },
        data: { status: 'PUBLISHED', publishedAt: expect.any(Date) },
      });
      const again = prisma.story.updateMany.mock.calls.find((c: any) => c[0].where.id === 'again')[0];
      expect(again.data).toEqual({ status: 'PUBLISHED' });
      expect(translationRequests.fulfilForStory).toHaveBeenCalledTimes(2);
    });

    it('without requireReviewed an unreviewed story is published', async () => {
      prisma.story.findMany.mockResolvedValue([draft('u', { reviewedAt: null })]);
      prisma.story.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.bulkPublish(['u'])).resolves.toMatchObject({ published: [{ id: 'u' }], skipped: [] });
    });
  });

  it('bulk archive archives what is not archived yet', async () => {
    prisma.story.findMany.mockResolvedValue([
      { id: 'a', title: 'A', language: 'tr', status: 'PUBLISHED' },
      { id: 'b', title: 'B', language: 'en', status: 'ARCHIVED' },
    ]);
    const res = await service.bulkArchive(['a', 'b', 'c']);
    expect(res).toEqual({
      archived: [{ id: 'a', title: 'A', language: 'tr' }],
      skipped: [
        { storyId: 'b', title: 'B', reason: 'Zaten arşivde.' },
        { storyId: 'c', title: null, reason: 'Masal bulunamadı.' },
      ],
    });
    expect(prisma.story.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['a'] } }, data: { status: 'ARCHIVED' } });

    prisma.story.updateMany.mockClear();
    prisma.story.findMany.mockResolvedValue(undefined);
    await service.bulkArchive(['x'], 'admin');
    expect(prisma.story.updateMany).not.toHaveBeenCalled();
  });

  describe('bulk delete', () => {
    beforeEach(() => {
      prisma.story.findMany.mockResolvedValue([
        { id: 'a', title: 'A', language: 'tr', status: 'PUBLISHED', coverImageUrl: 'c1' },
        { id: 'b', title: 'B', language: 'tr', status: 'DRAFT', coverImageUrl: 'c2' },
      ]);
      prisma.storyNarration.count.mockResolvedValue(13);
      prisma.audio.count.mockResolvedValue(2);
      prisma.favoriteStory.count.mockResolvedValue(1);
      prisma.playlistItem.count.mockResolvedValue(0);
      prisma.storyOnCollection.count.mockResolvedValue(3);
      // c1 is also shown by a story outside the selection.
      prisma.story.count.mockImplementation(async ({ where }: any) => (where.coverImageUrl === 'c1' ? 1 : 0));
    });

    it('the preview names every number and writes nothing', async () => {
      await expect(service.deletePreview(['a', 'b', 'zz'])).resolves.toEqual({
        stories: 2,
        missing: ['zz'],
        published: 1,
        narrations: 13,
        sharedAudios: 2,
        favorites: 1,
        playlistItems: 0,
        collectionLinks: 3,
        coverFiles: 1,
        titles: [
          { id: 'a', title: 'A', language: 'tr', status: 'PUBLISHED' },
          { id: 'b', title: 'B', language: 'tr', status: 'DRAFT' },
        ],
      });
      expect(prisma.storyNarration.count).toHaveBeenCalledWith({ where: { storyId: { in: ['a', 'b'] } } });
      expect(stories.deleteStory).not.toHaveBeenCalled();
    });

    it('nothing found: zero counts, no count queries', async () => {
      prisma.story.findMany.mockResolvedValue(undefined);
      await expect(service.deletePreview(['zz'])).resolves.toMatchObject({ stories: 0, narrations: 0, coverFiles: 0 });
      expect(prisma.storyNarration.count).not.toHaveBeenCalled();
    });

    it('deletes each story through the single delete path and reports failures', async () => {
      stories.deleteStory.mockImplementation(async (id: string) => {
        if (id === 'b') throw new Error('gcs down');
        return {};
      });
      await expect(service.bulkDelete(['a', 'b', 'zz'], 2, 'super@sesly.io')).resolves.toEqual({
        deleted: 1,
        deletedIds: ['a'],
        failed: [{ storyId: 'b', title: 'B', reason: 'gcs down' }],
        narrations: 13,
      });
      expect(stories.deleteStory.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
    });

    it('a count different from the confirmed one deletes nothing', async () => {
      await expect(service.bulkDelete(['a', 'b'], 3)).rejects.toBeInstanceOf(ConflictException);
      expect(stories.deleteStory).not.toHaveBeenCalled();
    });

    it('a failure without a message still reports a reason', async () => {
      prisma.story.findMany.mockResolvedValue([{ id: 'a', title: 'A', language: 'tr', status: 'DRAFT', coverImageUrl: null }]);
      stories.deleteStory.mockRejectedValue({});
      const res = await service.bulkDelete(['a'], 1);
      expect(res.failed).toEqual([{ storyId: 'a', title: 'A', reason: 'Masal silinemedi.' }]);
    });
  });

  describe('cover matching', () => {
    const taleRows = [
      { id: 'en1', title: "Little Ida's Flowers (Part 1)", language: 'en', status: 'DRAFT', partNumber: 1, slug: 'little-idas-flowers-part-1', coverImageUrl: null, coverCredit: null },
      { id: 'tr2', title: 'Ida 2', language: 'tr', status: 'DRAFT', partNumber: 2, slug: 'ida-2', coverImageUrl: 'stories/cover/ida.png', coverCredit: { illustrator: 'Vilhelm Pedersen' } },
      { id: 'tr1', title: 'Ida 1', language: 'tr', status: 'DRAFT', partNumber: 1, slug: 'ida-1', coverImageUrl: null, coverCredit: null },
    ];

    beforeEach(() => {
      prisma.story.findUnique.mockResolvedValue({ id: 'tr1', translationGroupId: null, partGroupId: 'p' });
      prisma.story.findMany.mockImplementation(async (args: any) => {
        // loadTaleStoryIds
        if (args.select?.partGroupId) return taleRows.map((r) => ({ id: r.id, translationGroupId: null, partGroupId: 'p' }));
        return taleRows;
      });
    });

    it('a pairKey, a partOf and a slug each find the tale; the lead is Turkish part 1', async () => {
      prisma.story.findFirst.mockImplementation(async ({ where }: any) => {
        if (where.translationGroupId === pairGroupId('colorful-birds')) return { id: 'tr1' };
        if (where.partGroupId?.in?.includes(partGroupIdOf('little-idas-flowers', 'en'))) return { id: 'tr1' };
        if (where.slug === 'renkli-kuslar') return { id: 'tr1' };
        return null;
      });
      const { results } = await service.matchCovers(['colorful-birds.jpg', 'little-idas-flowers', 'renkli-kuslar.png']);
      expect(results.map((r) => [r.status, r.via])).toEqual([
        ['matched', 'pairKey'],
        ['matched', 'partOf'],
        ['matched', 'slug'],
      ]);
      expect(results[0].tale).toMatchObject({
        storyId: 'tr1',
        language: 'tr',
        storyIds: ['tr1', 'tr2', 'en1'],
        languages: ['tr', 'en'],
        coverImageUrl: 'signed:stories/cover/ida.png',
        coverCreditLine: 'Vilhelm Pedersen',
      });
    });

    it('"woodcutter-of-gura" finds the pairKey "the-woodcutter-of-gura"', async () => {
      prisma.story.findFirst.mockImplementation(async ({ where }: any) =>
        where.translationGroupId === pairGroupId('the-woodcutter-of-gura') ? { id: 'tr1' } : null,
      );
      const { results } = await service.matchCovers(['woodcutter-of-gura.jpg']);
      expect(results[0]).toMatchObject({ key: 'woodcutter-of-gura', status: 'matched', via: 'pairKey' });
    });

    it('slug prefix: one tale matches, several are ambiguous, none is none', async () => {
      prisma.story.findFirst.mockResolvedValue(null);
      const findMany = prisma.story.findMany.getMockImplementation()!;
      prisma.story.findMany.mockImplementation(async (args: any) =>
        args.where?.OR?.[0]?.slug ? [{ id: 'tr1' }, { id: 'en1' }] : findMany(args),
      );
      let { results } = await service.matchCovers(['ida']);
      expect(results[0]).toMatchObject({ status: 'matched', via: 'slugPrefix', tale: { storyId: 'tr1' } });

      let call = 0;
      prisma.story.findUnique.mockImplementation(async () => ({ id: `x${call++}`, translationGroupId: null, partGroupId: null }));
      prisma.story.findMany.mockImplementation(async (args: any) => {
        if (args.where?.OR?.[0]?.slug) return [{ id: 'x' }, { id: 'y' }];
        if (args.where?.id?.in) return [{ id: args.where.id.in[0], title: 'T', language: 'en', status: 'DRAFT', partNumber: null, slug: 's', coverImageUrl: null }];
        return [];
      });
      ({ results } = await service.matchCovers(['ida']));
      expect(results[0]).toMatchObject({ status: 'ambiguous', tale: null });
      expect(results[0].candidates).toHaveLength(2);

      prisma.story.findMany.mockResolvedValue(undefined);
      ({ results } = await service.matchCovers(['nothing-like-it', '!!!']));
      expect(results).toEqual([
        { key: 'nothing-like-it', status: 'none', via: null, tale: null, candidates: [] },
        { key: '!!!', status: 'none', via: null, tale: null, candidates: [] },
      ]);
    });

    it('describeTale: unknown story is a 404; a tale without rows still names its lead', async () => {
      prisma.story.findUnique.mockResolvedValue(null);
      await expect(service.describeTale('nope')).rejects.toBeInstanceOf(NotFoundException);
      prisma.story.findUnique.mockResolvedValue({ id: 'solo', translationGroupId: null, partGroupId: null });
      prisma.story.findMany.mockResolvedValue(undefined);
      await expect(service.describeTale('solo')).resolves.toMatchObject({
        storyId: 'solo',
        storyIds: [],
        coverImageUrl: null,
        coverCreditLine: null,
      });
    });
  });
});
