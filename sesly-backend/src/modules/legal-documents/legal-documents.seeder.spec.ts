import { Logger } from '@nestjs/common';
import { DRAFT_SEED_LANGUAGES, LegalDocumentsSeeder } from './legal-documents.seeder';
import { CANONICAL_LEGAL_SLUGS, LegalContentFile, loadLegalContentFile } from './legal-content.loader';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';

jest.mock('./legal-content.loader', () => ({
  ...jest.requireActual('./legal-content.loader'),
  loadLegalContentFile: jest.fn(),
}));

const loadFile = loadLegalContentFile as jest.MockedFunction<typeof loadLegalContentFile>;
const actualLoader = jest.requireActual('./legal-content.loader') as typeof import('./legal-content.loader');
const SLUGS = ['tos', 'privacy', 'data-deletion'];

const TR_FILES: Record<string, LegalContentFile> = {
  tos: { title: 'Kullanım Şartları', contentMd: 'Şartlar metni\n', path: '/c/tos.tr.md' },
  privacy: { title: 'Gizlilik Politikası', contentMd: 'Gizlilik metni\n', path: '/c/privacy.tr.md' },
  'data-deletion': { title: 'Veri Silme', contentMd: 'Silme metni\n', path: '/c/data-deletion.tr.md' },
};

const EN_FILES: Record<string, LegalContentFile> = {
  tos: { title: 'Terms of Use', contentMd: 'Terms body\n', path: '/c/tos.en.md' },
  privacy: { title: 'Privacy Policy', contentMd: 'Privacy body\n', path: '/c/privacy.en.md' },
  'data-deletion': { title: 'Data Deletion', contentMd: 'Deletion body\n', path: '/c/data-deletion.en.md' },
};

type FilesByLanguage = Partial<Record<string, Record<string, LegalContentFile>>>;

/** Content files per language; a language left out has none. */
function useFiles(files: FilesByLanguage): void {
  loadFile.mockImplementation((slug: string, language: string) => files[language]?.[slug] ?? null);
}

type Row = { slug: string; language: string; currentVersion: number; status: string };

describe('LegalDocumentsSeeder', () => {
  let prisma: MockPrismaService;
  let seeder: LegalDocumentsSeeder;
  let rows: Row[];

  /** Answer findUnique from `rows`, like the (slug, language) unique would. */
  function useRows(initial: Row[]): void {
    rows = initial;
    prisma.legalDocument.findUnique.mockImplementation(async ({ where }: any) => {
      const { slug, language } = where.slug_language;
      const row = rows.find((r) => r.slug === slug && r.language === language);
      return row ? { id: `${slug}-${language}`, currentVersion: row.currentVersion, status: row.status } : null;
    });
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    prisma = createMockPrismaService();
    // Interactive transaction: run the callback against the same mock client.
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.legalDocument.create.mockImplementation(async ({ data }: any) => ({ id: `${data.slug}-${data.language}`, ...data }));
    prisma.legalDocumentVersion.create.mockResolvedValue({});
    loadFile.mockReset();
    useFiles({ tr: TR_FILES });
    useRows([]);
    seeder = new LegalDocumentsSeeder(prisma as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function documentWrites(): any[] {
    return prisma.legalDocument.create.mock.calls.map((c: any[]) => c[0].data);
  }

  function expectNoOverwrites(): void {
    expect(prisma.legalDocument.update).not.toHaveBeenCalled();
    expect(prisma.legalDocument.updateMany).not.toHaveBeenCalled();
    expect(prisma.legalDocument.upsert).not.toHaveBeenCalled();
    expect(prisma.legalDocument.delete).not.toHaveBeenCalled();
    expect(prisma.legalDocumentVersion.update).not.toHaveBeenCalled();
    expect(prisma.legalDocumentVersion.deleteMany).not.toHaveBeenCalled();
  }

  it('seeds the three canonical slugs in Turkish, and English as a draft language', () => {
    expect([...CANONICAL_LEGAL_SLUGS]).toEqual(SLUGS);
    expect(DRAFT_SEED_LANGUAGES).toEqual(['en']);
  });

  it('empty database, no English files: creates and publishes v1 of every Turkish document from its content file', async () => {
    await seeder.onApplicationBootstrap();

    expect(documentWrites()).toEqual(
      SLUGS.map((slug) => ({
        slug,
        language: 'tr',
        title: TR_FILES[slug].title,
        contentMd: TR_FILES[slug].contentMd,
        status: 'PUBLISHED',
        currentVersion: 1,
        publishedAt: expect.any(Date),
        publishedBy: 'system:seeder',
      })),
    );
    expect(prisma.legalDocumentVersion.create.mock.calls.map((c: any[]) => c[0].data)).toEqual(
      SLUGS.map((slug) => ({
        documentId: `${slug}-tr`,
        slug,
        language: 'tr',
        version: 1,
        title: TR_FILES[slug].title,
        contentMd: TR_FILES[slug].contentMd,
        publishedAt: expect.any(Date),
        publishedBy: 'system:seeder',
      })),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    // The Turkish files, then the English ones, slug by slug.
    expect(loadFile.mock.calls).toEqual([
      ...SLUGS.map((slug) => [slug, 'tr']),
      ...SLUGS.map((slug) => [slug, 'en']),
    ]);
    // No English file: the English document is not even looked up.
    for (const call of prisma.legalDocument.findUnique.mock.calls) {
      expect(call[0].where.slug_language.language).toBe('tr');
    }
  });

  it('with the real content files: the seeded Turkish text is the corrected one (no Stripe, info@sesly.io)', async () => {
    loadFile.mockImplementation(actualLoader.loadLegalContentFile);

    await seeder.seed();

    const turkish = documentWrites().filter((d) => d.language === 'tr');
    expect(turkish.map((d) => [d.slug, d.title, d.status])).toEqual([
      ['tos', 'Kullanım Şartları', 'PUBLISHED'],
      ['privacy', 'Gizlilik Politikası', 'PUBLISHED'],
      ['data-deletion', 'Veri Silme', 'PUBLISHED'],
    ]);
    for (const doc of turkish) {
      expect(doc.contentMd).toBe(actualLoader.loadLegalContentFile(doc.slug, 'tr')?.contentMd);
      expect(doc.contentMd).toContain('info@sesly.io');
      expect(doc.contentMd).not.toContain('destek@sesly.app');
      expect(doc.contentMd).not.toMatch(/stripe/i);
    }
    // English is still only a draft.
    expect(documentWrites().filter((d) => d.language === 'en').map((d) => d.status)).toEqual(['DRAFT', 'DRAFT', 'DRAFT']);
  });

  it('never overwrites an existing Turkish document (whatever its state)', async () => {
    useRows([
      { slug: 'tos', language: 'tr', currentVersion: 4, status: 'PUBLISHED' },
      { slug: 'privacy', language: 'tr', currentVersion: 0, status: 'DRAFT' },
      { slug: 'data-deletion', language: 'tr', currentVersion: 2, status: 'PUBLISHED' },
    ]);

    await seeder.onApplicationBootstrap();

    expect(prisma.legalDocument.create).not.toHaveBeenCalled();
    expect(prisma.legalDocumentVersion.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expectNoOverwrites();
  });

  it('a missing Turkish file is logged as an error and that document is not seeded; the others are', async () => {
    useFiles({ tr: { tos: TR_FILES.tos, 'data-deletion': TR_FILES['data-deletion'] } });
    const error = jest.spyOn(Logger.prototype, 'error');

    await expect(seeder.seed()).resolves.toBeUndefined();

    expect(documentWrites().map((d) => `${d.slug}:${d.language}`)).toEqual(['tos:tr', 'data-deletion:tr']);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toBe('Legal seed failed for "privacy" (tr)');
    expect((error.mock.calls[0][1] as unknown as Error).message).toBe(
      'content/privacy.tr.md is missing or empty; the Turkish document cannot be seeded',
    );
    // The database is not asked about a document it cannot create.
    const looked = prisma.legalDocument.findUnique.mock.calls.map((c: any[]) => c[0].where.slug_language.slug);
    expect(looked).toEqual(['tos', 'data-deletion']);
  });

  it('English files present and English documents missing: creates DRAFTs (v0, no version row), never PUBLISHED', async () => {
    useRows(SLUGS.map((slug) => ({ slug, language: 'tr', currentVersion: 3, status: 'PUBLISHED' })));
    useFiles({ tr: TR_FILES, en: EN_FILES });

    await seeder.onApplicationBootstrap();

    expect(documentWrites()).toEqual(
      SLUGS.map((slug) => ({
        slug,
        language: 'en',
        title: EN_FILES[slug].title,
        contentMd: EN_FILES[slug].contentMd,
        status: 'DRAFT',
        currentVersion: 0,
      })),
    );
    for (const data of documentWrites()) {
      expect(data.status).not.toBe('PUBLISHED');
      expect(data).not.toHaveProperty('publishedAt');
      expect(data).not.toHaveProperty('publishedBy');
    }
    // Publishing means a version row: none for English, none for the existing Turkish rows.
    expect(prisma.legalDocumentVersion.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expectNoOverwrites();
  });

  it('empty database with English files: Turkish is published, English stays a draft', async () => {
    useFiles({ tr: TR_FILES, en: EN_FILES });

    await seeder.seed();

    const writes = documentWrites();
    expect(writes.filter((d) => d.language === 'tr').map((d) => d.status)).toEqual(['PUBLISHED', 'PUBLISHED', 'PUBLISHED']);
    expect(writes.filter((d) => d.language === 'en').map((d) => d.status)).toEqual(['DRAFT', 'DRAFT', 'DRAFT']);
    const versionLanguages = prisma.legalDocumentVersion.create.mock.calls.map((c: any[]) => c[0].data.language);
    expect(versionLanguages).toEqual(['tr', 'tr', 'tr']);
  });

  it('never overwrites an existing English document, published or draft; only the missing one is created', async () => {
    useRows([
      ...SLUGS.map((slug) => ({ slug, language: 'tr', currentVersion: 1, status: 'PUBLISHED' })),
      { slug: 'tos', language: 'en', currentVersion: 2, status: 'PUBLISHED' },
      { slug: 'privacy', language: 'en', currentVersion: 0, status: 'DRAFT' },
    ]);
    useFiles({ tr: TR_FILES, en: EN_FILES });

    await seeder.seed();

    expect(documentWrites()).toEqual([
      expect.objectContaining({ slug: 'data-deletion', language: 'en', status: 'DRAFT', currentVersion: 0 }),
    ]);
    expectNoOverwrites();
  });

  it('only the English files that exist are seeded', async () => {
    useRows(SLUGS.map((slug) => ({ slug, language: 'tr', currentVersion: 1, status: 'PUBLISHED' })));
    useFiles({ tr: TR_FILES, en: { privacy: EN_FILES.privacy } });

    await seeder.seed();

    expect(documentWrites().map((d) => `${d.slug}:${d.language}:${d.status}`)).toEqual(['privacy:en:DRAFT']);
  });

  it('fail-soft per document: an error is logged, the other documents are still seeded and the boot never fails', async () => {
    useFiles({ tr: TR_FILES, en: EN_FILES });
    prisma.legalDocument.findUnique.mockImplementation(async ({ where }: any) => {
      const { slug } = where.slug_language;
      if (slug === 'privacy') throw new Error('db down');
      return null;
    });
    const error = jest.spyOn(Logger.prototype, 'error');

    await expect(seeder.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(documentWrites().map((d) => `${d.slug}:${d.language}`)).toEqual([
      'tos:tr',
      'data-deletion:tr',
      'tos:en',
      'data-deletion:en',
    ]);
    expect(error.mock.calls.map((c) => c[0])).toEqual([
      'Legal seed failed for "privacy" (tr)',
      'Legal seed failed for "privacy" (en)',
    ]);
  });

  it('a unique-constraint race on create (another instance seeded first) is logged, not thrown', async () => {
    prisma.$transaction.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    await expect(seeder.seed()).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalledTimes(3);
  });
});
