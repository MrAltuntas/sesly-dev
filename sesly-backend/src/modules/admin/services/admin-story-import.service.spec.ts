import { Prisma } from '@prisma/client';
import {
  AdminStoryImportService,
  buildImportKey,
  importBatchLabel,
  pairGroupId,
  partGroupIdOf,
} from './admin-story-import.service';
import { createMockPrismaService, MockPrismaService } from '../../../test-utils/prisma-mock';

const TEXT = 'Bir varmış bir yokmuş.\n\nKüçük bir tavşan varmış.';

function item(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Tavşan',
    language: 'tr',
    text: TEXT,
    category: 'BEDTIME',
    ageGroup: 'THREE_TO_SIX',
    sourceUrl: 'https://www.gutenberg.org/ebooks/1',
    ...overrides,
  };
}

describe('AdminStoryImportService', () => {
  let prisma: MockPrismaService;
  let tx: {
    story: { create: jest.Mock; findFirst: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    storyChunk: { createMany: jest.Mock };
  };
  let service: AdminStoryImportService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    tx = {
      story: {
        create: jest.fn().mockResolvedValue({ id: 'new-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      storyChunk: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
    prisma.story.findFirst.mockResolvedValue(null);
    service = new AdminStoryImportService(prisma as any);
  });

  it('buildImportKey folds the title (Turkish lower case, spaces) and the trailing slash of the URL', () => {
    expect(buildImportKey('tr', 'https://x.org/a/', '  IŞIK  Masalı ')).toBe('tr|https://x.org/a|ışık masalı');
    expect(buildImportKey('en', null, 'A')).toBe('en||a');
  });

  it('group ids from pairKey / partOf are deterministic (re-imports land in the same group)', () => {
    expect(pairGroupId('kedi')).toBe(pairGroupId('kedi'));
    expect(pairGroupId('kedi')).not.toBe(pairGroupId('kopek'));
    expect(partGroupIdOf('kar', 'tr')).not.toBe(partGroupIdOf('kar', 'en'));
  });

  it('creates a DRAFT with the field mapping, chunks, no segments, and no LLM work', async () => {
    const result = await service.importStories(
      {
        stories: [
          item({
            level: 'A2',
            tags: ['hayvanlar', ' fabl ', 'hayvanlar', ''],
            description: 'Kısa özet',
            isPremium: true,
            author: 'Ezop',
            authorDeathYear: -564,
            collector: 'Derleyen',
            collectorDeathYear: 1900,
            translator: 'Çevirmen',
            translatorDeathYear: 1950,
            collection: "The Aesop for Children",
            sourceEdition: 'Rand McNally, 1919',
            firstPublishedYear: 1919,
            originalTitle: 'The Hare',
            originalLanguage: 'en',
            licence: 'Public domain',
            licenceUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
            attribution: 'Project Gutenberg',
            licenceBasis: 'Yazar 1950 öncesi öldü.',
            rightsBasis: 'AUTHOR_LIFE_PLUS_70',
          }),
        ],
      },
      'admin@sesly.app',
    );

    expect(result).toEqual({
      dryRun: false,
      batch: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      total: 1,
      created: 1,
      skipped: 0,
      errors: 0,
      items: [{ index: 0, title: 'Tavşan', language: 'tr', status: 'created', storyId: 'new-1', slug: 'tavsan' }],
    });
    const data = tx.story.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      title: 'Tavşan',
      content: TEXT,
      language: 'tr',
      category: 'BEDTIME',
      ageGroup: 'THREE_TO_SIX',
      ageGroupSource: 'MANUAL',
      languageLevel: 'A2',
      languageLevelSource: 'MANUAL',
      isPremium: true,
      status: 'DRAFT',
      slug: 'tavsan',
      summary: 'Kısa özet',
      tags: ['hayvanlar', 'fabl'],
      authorName: 'Ezop',
      authorDeathYear: -564,
      collectorName: 'Derleyen',
      translatorName: 'Çevirmen',
      sourceName: 'The Aesop for Children',
      sourceUrl: 'https://www.gutenberg.org/ebooks/1',
      sourceEdition: 'Rand McNally, 1919',
      firstPublishedYear: 1919,
      originalTitle: 'The Hare',
      originalLanguage: 'en',
      licenseName: 'Public domain',
      licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
      attribution: 'Project Gutenberg',
      rightsNote: 'Yazar 1950 öncesi öldü.',
      rightsBasis: 'AUTHOR_LIFE_PLUS_70',
      origin: 'PUBLIC_DOMAIN',
      textFidelity: 'VERBATIM',
      translationGroupId: null,
      partGroupId: null,
      partNumber: null,
      importKey: 'tr|https://www.gutenberg.org/ebooks/1|tavşan',
      importBatch: result.batch,
    });
    expect(data.estimatedDuration).toBeGreaterThanOrEqual(1);
    expect(data.preprocessedSegments).toBeUndefined();
    expect(data.segmentationVersion).toBeUndefined();
    expect(tx.storyChunk.createMany).toHaveBeenCalledWith({
      data: [{ storyId: 'new-1', chunkIndex: 0, content: TEXT }],
    });
  });

  it('stores the batch label sent by the panel on every created story', async () => {
    const result = await service.importStories({ stories: [item()], batch: '  import-batch1.json ' });
    expect(result.batch).toBe('import-batch1.json');
    expect(tx.story.create.mock.calls[0][0].data.importBatch).toBe('import-batch1.json');
  });

  it('importBatchLabel: the label sent, spaces collapsed, else the import date', () => {
    expect(importBatchLabel('a   b')).toBe('a b');
    expect(importBatchLabel('  ', new Date('2026-10-21T22:00:00Z'))).toBe('2026-10-21');
    expect(importBatchLabel(undefined, new Date('2026-01-02T00:00:00Z'))).toBe('2026-01-02');
  });

  it('minimal item: optional columns null, origin / fidelity defaults, no level', async () => {
    await service.importStories({ stories: [item({ sourceUrl: undefined, text: 'Kısa.\r\n' })] });
    const data = tx.story.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      content: 'Kısa.',
      isPremium: false,
      summary: null,
      tags: [],
      authorName: null,
      sourceUrl: null,
      rightsBasis: null,
      origin: 'PUBLIC_DOMAIN',
      textFidelity: 'VERBATIM',
    });
    expect(data.languageLevel).toBeUndefined();
  });

  it('pre-made segments become segmentation version 1 from "import"', async () => {
    await service.importStories({
      stories: [
        item({
          segments: [
            { text: 'Bir varmış bir yokmuş.', emotion: 'peaceful', speed: 0.82, pauseAfterMs: 600 },
            { text: 'Küçük bir tavşan varmış.', emotion: 'calm' },
          ],
        }),
      ],
    });
    expect(tx.story.create.mock.calls[0][0].data).toMatchObject({
      preprocessedSegments: [
        { text: 'Bir varmış bir yokmuş.', emotion: 'peaceful', speed: 0.82, pauseAfterMs: 600 },
        { text: 'Küçük bir tavşan varmış.', emotion: 'calm' },
      ],
      preprocessedModel: 'import',
      segmentationVersion: 1,
    });
  });

  it('pairKey and partOf map to deterministic groups', async () => {
    await service.importStories({
      stories: [item({ pairKey: 'tavsan', partOf: 'tavsan-masali', partNumber: 2 })],
    });
    expect(tx.story.create.mock.calls[0][0].data).toMatchObject({
      translationGroupId: pairGroupId('tavsan'),
      partGroupId: partGroupIdOf('tavsan-masali', 'tr'),
      partNumber: 2,
    });
  });

  it('dry run: validates, reports "valid", writes nothing', async () => {
    const result = await service.importStories({ stories: [item(), item({ title: 'Bozuk', category: 'X' })], dryRun: true });
    expect(result).toMatchObject({ dryRun: true, created: 0, errors: 1 });
    expect(result.items[0]).toMatchObject({ status: 'valid', slug: 'tavsan' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('validation problems are reported per item with field paths; the rest is imported', async () => {
    const result = await service.importStories({
      stories: [
        { title: 'Eksik', language: 'de', unknownField: 1 } as any,
        item({ segments: [{ text: 'Bir', speed: 9 }] }),
        null as any,
        item({ title: 'İyi' }),
      ],
    });

    expect(result.items[0].status).toBe('error');
    expect(result.items[0].problems).toEqual(
      expect.arrayContaining([
        'language: Dil "tr" ya da "en" olmalıdır.',
        'unknownField: bilinmeyen alan.',
        expect.stringMatching(/^text: /),
        expect.stringMatching(/^category: /),
      ]),
    );
    expect(result.items[1].problems).toEqual(['segments.0.speed: Hız en fazla 1.5 olabilir.']);
    expect(result.items[2]).toMatchObject({ status: 'error', title: null, language: null });
    expect(result.items[3].status).toBe('created');
    expect(result).toMatchObject({ created: 1, errors: 3 });
  });

  it('cross-field rules: partOf needs partNumber, segments must read the text', async () => {
    const result = await service.importStories({
      stories: [
        item({ partOf: 'x' }),
        item({ partNumber: 2 }),
        item({ segments: [{ text: 'Bambaşka bir metin.' }] }),
        item({ segments: [{ text: 'Bir varmış bir yokmuş.', emotion: 'calm' }, { text: 'Küçük bir tavşan varmış.' }] }),
      ],
    });
    expect(result.items[0].problems).toEqual(['partOf ve partNumber birlikte gönderilmelidir.']);
    expect(result.items[1].problems).toEqual(['partOf ve partNumber birlikte gönderilmelidir.']);
    expect(result.items[2].problems?.[0]).toContain('Segmentler masal metniyle birebir aynı değil');
    expect(result.items[3].status).toBe('created');
  });

  it('idempotent: an existing text (import key or source + language + title) is skipped untouched', async () => {
    prisma.story.findFirst.mockResolvedValueOnce({ id: 'old-1', slug: 'tavsan' });

    const result = await service.importStories({ stories: [item()] });

    expect(result.items[0]).toMatchObject({ status: 'skipped', storyId: 'old-1', slug: 'tavsan' });
    expect(prisma.story.findFirst.mock.calls[0][0].where.OR).toEqual([
      { importKey: 'tr|https://www.gutenberg.org/ebooks/1|tavşan' },
      {
        language: 'tr',
        sourceUrl: 'https://www.gutenberg.org/ebooks/1',
        title: { equals: 'Tavşan', mode: 'insensitive' },
      },
    ]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('an existing row without slug is skipped too; without a source URL only the import key is checked', async () => {
    prisma.story.findFirst.mockResolvedValueOnce({ id: 'old-2', slug: null });
    const result = await service.importStories({ stories: [item({ sourceUrl: undefined })] });
    expect(result.items[0]).toMatchObject({ status: 'skipped', storyId: 'old-2' });
    expect(result.items[0].slug).toBeUndefined();
    expect(prisma.story.findFirst.mock.calls[0][0].where.OR).toEqual([{ importKey: 'tr||tavşan' }]);
  });

  it('the same text twice in one file: the second is skipped', async () => {
    const result = await service.importStories({ stories: [item(), item({ title: 'TAVŞAN' })] });
    expect(result.items.map((i) => i.status)).toEqual(['created', 'skipped']);
  });

  it('a pair language or a part number already taken (in the file or the catalogue) is an error', async () => {
    const result = await service.importStories({
      stories: [
        item({ pairKey: 'p', partOf: 'q', partNumber: 1 }),
        item({ title: 'Başka', pairKey: 'p' }),
        item({ title: 'Üçüncü', partOf: 'q', partNumber: 1 }),
      ],
    });
    expect(result.items[1]).toMatchObject({ status: 'error', message: 'pairKey "p" için "tr" dilinde zaten bir masal var.' });
    expect(result.items[2]).toMatchObject({ status: 'error', message: '"q" masalının 1. bölümü bu dilde zaten var.' });

    prisma.story.findFirst.mockReset();
    prisma.story.findFirst
      .mockResolvedValueOnce(null) // identity
      .mockResolvedValueOnce({ id: 'other-tr' }); // pair language taken
    const again = await service.importStories({ stories: [item({ title: 'Yeni', pairKey: 'p' })] });
    expect(again.items[0].status).toBe('error');

    prisma.story.findFirst.mockReset();
    prisma.story.findFirst
      .mockResolvedValueOnce(null) // identity
      .mockResolvedValueOnce({ id: 'part-1' }); // part taken
    const parts = await service.importStories({ stories: [item({ title: 'Yeni', partOf: 'q', partNumber: 1 })] });
    expect(parts.items[0].status).toBe('error');
  });

  it('slug clash in the language: the next free slug', async () => {
    prisma.story.findFirst
      .mockResolvedValueOnce(null) // identity
      .mockResolvedValueOnce({ id: 'x' }) // "tavsan" taken
      .mockResolvedValueOnce(null); // "tavsan-2" free
    const result = await service.importStories({ stories: [item()] });
    expect(result.items[0].slug).toBe('tavsan-2');
  });

  it('a concurrent import of the same text (unique import key) is reported as skipped', async () => {
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: ['importKey'] } }),
    );
    const result = await service.importStories({ stories: [item()] });
    expect(result.items[0]).toMatchObject({ status: 'skipped' });
  });

  it('another unique clash or a database error is an item error, the batch goes on', async () => {
    prisma.$transaction
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: ['slug', 'language'] } }),
      )
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
      .mockRejectedValueOnce(new Error('db down'));
    const result = await service.importStories({
      stories: [item({ title: 'A' }), item({ title: 'B' }), item({ title: 'C' }), item({ title: 'D', text: '   x  ' })],
    });
    expect(result.items.map((i) => i.message ?? i.status)).toEqual([
      'Benzersizlik çakışması (slug,language).',
      'Benzersizlik çakışması (bilinmiyor).',
      'Masal kaydedilemedi.',
      'created',
    ]);
  });
  it('content warnings: stored in enum order, an unknown or old Turkish key fails the item', async () => {
    const result = await service.importStories({
      stories: [
        item({ contentWarnings: ['SAD_ENDING', 'SCARY', 'SCARY'] }),
        item({ title: 'B', contentWarnings: ['zombi'] }),
        item({ title: 'C' }),
        item({ title: 'D', contentWarnings: ['korkutucu'] }),
      ],
    });
    expect(result.items.map((i) => i.status)).toEqual(['created', 'error', 'created', 'error']);
    expect(result.items[1].problems?.join(' ')).toContain('İçerik uyarısı');
    expect(result.items[3].problems?.join(' ')).toContain('SCARY, VIOLENCE, DEATH');
    expect(tx.story.create.mock.calls[0][0].data.contentWarnings).toEqual(['SCARY', 'SAD_ENDING']);
    expect(tx.story.create.mock.calls[1][0].data.contentWarnings).toEqual([]);
  });

  describe('AI translations (translationMethod, translatedFrom)', () => {
    it('a machine translation of the pair member in English: MACHINE, TRANSLATED, linked to its source', async () => {
      tx.story.findFirst.mockResolvedValue({ id: 'en-source' });

      const result = await service.importStories({
        stories: [item({ pairKey: 'tavsan', translationMethod: 'MACHINE', translatedFrom: 'en' })],
      });

      expect(result.created).toBe(1);
      expect(tx.story.create.mock.calls[0][0].data).toMatchObject({
        translationMethod: 'MACHINE',
        textFidelity: 'TRANSLATED',
        translationGroupId: pairGroupId('tavsan'),
      });
      expect(tx.story.findFirst).toHaveBeenCalledWith({
        where: { translationGroupId: pairGroupId('tavsan'), language: 'en' },
        select: { id: true },
      });
      expect(tx.story.update).toHaveBeenCalledWith({ where: { id: 'new-1' }, data: { translatedFromId: 'en-source' } });
      // A machine translation never becomes the source of another one.
      expect(tx.story.updateMany).not.toHaveBeenCalled();
    });

    it('the source arrives later: it adopts the waiting machine translation of its pair', async () => {
      await service.importStories({ stories: [item({ title: 'The Rabbit', language: 'en', pairKey: 'tavsan' })] });

      expect(tx.story.create.mock.calls[0][0].data).toMatchObject({ translationMethod: null, textFidelity: 'VERBATIM' });
      expect(tx.story.updateMany).toHaveBeenCalledWith({
        where: {
          translationGroupId: pairGroupId('tavsan'),
          id: { not: 'new-1' },
          language: { not: 'en' },
          translatedFromId: null,
          translationMethod: 'MACHINE',
          importKey: { not: null },
        },
        data: { translatedFromId: 'new-1' },
      });
    });

    it('source not there yet: the translation is stored unlinked (no update)', async () => {
      await service.importStories({
        stories: [item({ pairKey: 'tavsan', translationMethod: 'MACHINE', translatedFrom: 'en' })],
      });
      expect(tx.story.update).not.toHaveBeenCalled();
    });

    it('rules: translatedFrom needs a pairKey and another language; MACHINE with a non-TRANSLATED fidelity is refused', async () => {
      const result = await service.importStories({
        stories: [
          item({ translatedFrom: 'en' }),
          item({ title: 'B', pairKey: 'b', translatedFrom: 'tr' }),
          item({ title: 'C', pairKey: 'c', translationMethod: 'MACHINE', textFidelity: 'VERBATIM' }),
          item({ title: 'D', pairKey: 'd', translatedFrom: 'de' }),
          item({ title: 'E', translationMethod: 'ROBOT' }),
        ],
      });

      expect(result.items.map((i) => i.status)).toEqual(['error', 'error', 'error', 'error', 'error']);
      expect(result.items[0].problems?.join(' ')).toContain('pairKey');
      expect(result.items[1].problems?.join(' ')).toContain('kendi dilinden');
      expect(result.items[2].problems?.join(' ')).toContain('TRANSLATED');
      expect(tx.story.create).not.toHaveBeenCalled();
    });

    it('a human translation keeps its fidelity default and links nothing without a pairKey', async () => {
      await service.importStories({ stories: [item({ translationMethod: 'HUMAN', textFidelity: 'TRANSLATED' })] });
      expect(tx.story.create.mock.calls[0][0].data).toMatchObject({ translationMethod: 'HUMAN', textFidelity: 'TRANSLATED' });
      expect(tx.story.findFirst).not.toHaveBeenCalled();
      expect(tx.story.updateMany).not.toHaveBeenCalled();
    });
  });
});
