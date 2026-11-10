import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  REPUBLISH_ACTOR,
  REPUBLISH_LANGUAGE,
  republishTurkishLegalDocuments,
  sameLegalText,
} from './legal-republish';
import { CANONICAL_LEGAL_SLUGS, loadLegalContentFile } from './legal-content.loader';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';

const NOW = new Date('2026-10-19T10:00:00.000Z');
const SLUGS = ['tos', 'privacy', 'data-deletion'];
const TITLES: Record<string, string> = {
  tos: 'Kullanım Şartları',
  privacy: 'Gizlilik Politikası',
  'data-deletion': 'Veri Silme',
};
const FILE_TEXT: Record<string, string> = {
  tos: 'Yeni şartlar. İletişim: info@sesly.io\n',
  privacy: 'Yeni gizlilik metni. İletişim: info@sesly.io\n',
  'data-deletion': 'Yeni silme metni. İletişim: info@sesly.io\n',
};
const OLD_TEXT = 'Ödemeler Stripe ile. İletişim: destek@sesly.app\n';

interface DocRow {
  id: string;
  currentVersion: number;
  title: string;
  contentMd: string;
}
interface VersionRow {
  title: string;
  contentMd: string;
}

describe('republishTurkishLegalDocuments', () => {
  let prisma: MockPrismaService;
  let dir: string;
  let docs: Record<string, DocRow | undefined>;
  /** Published snapshots by `<documentId>@<version>`. */
  let versions: Record<string, VersionRow | undefined>;

  function writeFiles(texts: Record<string, string> = FILE_TEXT): void {
    for (const [slug, text] of Object.entries(texts)) {
      writeFileSync(join(dir, `${slug}.tr.md`), text);
    }
  }

  /** A published document: working copy and the snapshot of `version` hold `text`. */
  function published(slug: string, version: number, text: string, title = TITLES[slug]): void {
    docs[slug] = { id: `doc-${slug}`, currentVersion: version, title, contentMd: text };
    versions[`doc-${slug}@${version}`] = { title, contentMd: text };
  }

  const run = (options: Record<string, unknown> = {}) =>
    republishTurkishLegalDocuments(prisma as any, { dirs: [dir], now: NOW, ...options });

  function expectNoWrites(): void {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.legalDocument.create).not.toHaveBeenCalled();
    expect(prisma.legalDocument.update).not.toHaveBeenCalled();
    expect(prisma.legalDocumentVersion.create).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'legal-republish-'));
    writeFiles();
    docs = {};
    versions = {};
    prisma = createMockPrismaService();
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.legalDocument.findUnique.mockImplementation(async ({ where }: any) => {
      const { slug } = where.slug_language;
      return docs[slug] ?? null;
    });
    prisma.legalDocumentVersion.findUnique.mockImplementation(async ({ where }: any) => {
      const { documentId, version } = where.documentId_version;
      return versions[`${documentId}@${version}`] ?? null;
    });
    prisma.legalDocument.create.mockImplementation(async ({ data }: any) => ({ id: `new-${data.slug}`, ...data }));
    prisma.legalDocument.update.mockResolvedValue({});
    prisma.legalDocumentVersion.create.mockResolvedValue({});
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is Turkish only and publishes as the script', () => {
    expect(REPUBLISH_LANGUAGE).toBe('tr');
    expect(REPUBLISH_ACTOR).toBe('script:republish-legal');
  });

  it('reads every file before touching the database: a missing file throws and nothing is read or written', async () => {
    rmSync(join(dir, 'privacy.tr.md'));

    await expect(run()).rejects.toThrow('Legal content missing or empty: privacy.tr.md');

    expect(prisma.legalDocument.findUnique).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it('empty database: creates and publishes v1 of every document from the files', async () => {
    const results = await run();

    expect(results.map((r) => [r.slug, r.action, r.fromVersion, r.toVersion, r.replacesDraft])).toEqual(
      SLUGS.map((slug) => [slug, 'created', null, 1, false]),
    );
    expect(results.map((r) => r.path)).toEqual(SLUGS.map((slug) => join(dir, `${slug}.tr.md`)));
    expect(prisma.legalDocument.create.mock.calls.map((c: any[]) => c[0].data)).toEqual(
      SLUGS.map((slug) => ({
        slug,
        language: 'tr',
        title: TITLES[slug],
        contentMd: FILE_TEXT[slug],
        status: 'PUBLISHED',
        currentVersion: 1,
        publishedAt: NOW,
        publishedBy: 'script:republish-legal',
      })),
    );
    expect(prisma.legalDocumentVersion.create.mock.calls.map((c: any[]) => c[0].data)).toEqual(
      SLUGS.map((slug) => ({
        documentId: `new-${slug}`,
        slug,
        language: 'tr',
        version: 1,
        title: TITLES[slug],
        contentMd: FILE_TEXT[slug],
        publishedAt: NOW,
        publishedBy: 'script:republish-legal',
      })),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('the published texts already equal the files: nothing is written, so a second run is a no-op', async () => {
    for (const slug of SLUGS) published(slug, 3, FILE_TEXT[slug]);

    const results = await run();

    expect(results.map((r) => [r.slug, r.action, r.fromVersion, r.toVersion])).toEqual(
      SLUGS.map((slug) => [slug, 'unchanged', 3, 3]),
    );
    expectNoWrites();
  });

  it('line endings and surrounding whitespace are not a change', async () => {
    for (const slug of SLUGS) published(slug, 2, `\n${FILE_TEXT[slug].replace(/\n/g, '\r\n')}\n\n`);

    expect((await run()).map((r) => r.action)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expectNoWrites();
  });

  it('the published text is the old one (Stripe, destek@sesly.app): publishes the file as the next version', async () => {
    for (const slug of SLUGS) published(slug, 1, OLD_TEXT);

    const results = await run();

    expect(results.map((r) => [r.slug, r.action, r.fromVersion, r.toVersion, r.replacesDraft])).toEqual(
      SLUGS.map((slug) => [slug, 'bumped', 1, 2, false]),
    );
    expect(prisma.legalDocument.update.mock.calls.map((c: any[]) => c[0])).toEqual(
      SLUGS.map((slug) => ({
        where: { id: `doc-${slug}` },
        data: {
          title: TITLES[slug],
          contentMd: FILE_TEXT[slug],
          status: 'PUBLISHED',
          currentVersion: 2,
          publishedAt: NOW,
          publishedBy: 'script:republish-legal',
        },
      })),
    );
    expect(prisma.legalDocumentVersion.create.mock.calls.map((c: any[]) => c[0].data)).toEqual(
      SLUGS.map((slug) => ({
        documentId: `doc-${slug}`,
        slug,
        language: 'tr',
        version: 2,
        title: TITLES[slug],
        contentMd: FILE_TEXT[slug],
        publishedAt: NOW,
        publishedBy: 'script:republish-legal',
      })),
    );
    expect(prisma.legalDocument.create).not.toHaveBeenCalled();
    // It compared against the snapshot of the current version.
    expect(prisma.legalDocumentVersion.findUnique.mock.calls[0][0]).toEqual({
      where: { documentId_version: { documentId: 'doc-tos', version: 1 } },
      select: { title: true, contentMd: true },
    });
  });

  it('compares against the published version, not the working copy', async () => {
    // Working copy already holds the file text, but it was never published: users still get the old text.
    published('tos', 4, OLD_TEXT);
    docs.tos = { ...(docs.tos as DocRow), contentMd: FILE_TEXT.tos };
    // Published text equals the file, the working copy holds an unpublished panel draft: left alone.
    published('privacy', 2, FILE_TEXT.privacy);
    docs.privacy = { ...(docs.privacy as DocRow), contentMd: 'Panel taslağı\n' };
    published('data-deletion', 1, FILE_TEXT['data-deletion']);

    const results = await run();

    expect(results.map((r) => [r.slug, r.action, r.toVersion, r.replacesDraft])).toEqual([
      ['tos', 'bumped', 5, false],
      ['privacy', 'unchanged', 2, false],
      ['data-deletion', 'unchanged', 1, false],
    ]);
    expect(prisma.legalDocument.update).toHaveBeenCalledTimes(1);
    expect(prisma.legalDocument.update.mock.calls[0][0].where).toEqual({ id: 'doc-tos' });
  });

  it('flags a bump that replaces unpublished edits in the working copy', async () => {
    published('tos', 2, OLD_TEXT);
    docs.tos = { ...(docs.tos as DocRow), contentMd: 'Yayınlanmamış düzenleme\n' };
    published('privacy', 1, OLD_TEXT);
    docs.privacy = { ...(docs.privacy as DocRow), title: 'Başka başlık' };
    published('data-deletion', 1, OLD_TEXT);

    const results = await run();

    expect(results.map((r) => [r.slug, r.action, r.replacesDraft])).toEqual([
      ['tos', 'bumped', true],
      ['privacy', 'bumped', true],
      ['data-deletion', 'bumped', false],
    ]);
  });

  it('a title change alone is published', async () => {
    for (const slug of SLUGS) published(slug, 1, FILE_TEXT[slug]);
    published('tos', 1, FILE_TEXT.tos, 'Eski Başlık');

    const results = await run();

    expect(results.map((r) => r.action)).toEqual(['bumped', 'unchanged', 'unchanged']);
    expect(prisma.legalDocument.update.mock.calls[0][0].data.title).toBe('Kullanım Şartları');
  });

  it('a draft that was never published (v0) is published as v1 without looking for a snapshot', async () => {
    for (const slug of SLUGS) published(slug, 1, FILE_TEXT[slug]);
    docs.tos = { id: 'doc-tos', currentVersion: 0, title: TITLES.tos, contentMd: FILE_TEXT.tos };
    docs.privacy = { id: 'doc-privacy', currentVersion: 0, title: TITLES.privacy, contentMd: 'Taslak\n' };

    const results = await run();

    expect(results.map((r) => [r.slug, r.action, r.fromVersion, r.toVersion, r.replacesDraft])).toEqual([
      ['tos', 'bumped', 0, 1, false],
      ['privacy', 'bumped', 0, 1, true],
      ['data-deletion', 'unchanged', 1, 1, false],
    ]);
    const looked = prisma.legalDocumentVersion.findUnique.mock.calls.map((c: any[]) => c[0].where.documentId_version.documentId);
    expect(looked).toEqual(['doc-data-deletion']);
    expect(prisma.legalDocument.update.mock.calls[0][0].data).toMatchObject({ status: 'PUBLISHED', currentVersion: 1 });
  });

  it('a current version without its snapshot row is published again', async () => {
    for (const slug of SLUGS) published(slug, 1, FILE_TEXT[slug]);
    versions['doc-tos@1'] = undefined;

    expect((await run()).map((r) => [r.action, r.toVersion])).toEqual([
      ['bumped', 2],
      ['unchanged', 1],
      ['unchanged', 1],
    ]);
  });

  it('dry run: reports the same actions and writes nothing', async () => {
    published('tos', 1, OLD_TEXT);
    published('privacy', 3, FILE_TEXT.privacy);

    const results = await run({ dryRun: true });

    expect(results.map((r) => [r.slug, r.action, r.fromVersion, r.toVersion])).toEqual([
      ['tos', 'bumped', 1, 2],
      ['privacy', 'unchanged', 3, 3],
      ['data-deletion', 'created', null, 1],
    ]);
    expectNoWrites();
  });

  it('only ever reads and writes Turkish documents', async () => {
    published('tos', 1, OLD_TEXT);

    await run();

    for (const call of prisma.legalDocument.findUnique.mock.calls) {
      expect(call[0].where.slug_language.language).toBe('tr');
    }
    for (const call of prisma.legalDocument.create.mock.calls) {
      expect(call[0].data.language).toBe('tr');
    }
    for (const call of prisma.legalDocumentVersion.create.mock.calls) {
      expect(call[0].data.language).toBe('tr');
    }
  });

  it('defaults: the shipped content files, the current time and the script as publisher', async () => {
    const before = Date.now();

    const results = await republishTurkishLegalDocuments(prisma as any);

    expect(results.map((r) => r.slug)).toEqual([...CANONICAL_LEGAL_SLUGS]);
    const created = prisma.legalDocument.create.mock.calls.map((c: any[]) => c[0].data);
    for (const data of created) {
      expect(data.contentMd).toBe(loadLegalContentFile(data.slug, 'tr')?.contentMd);
      expect(data.publishedBy).toBe('script:republish-legal');
      expect(data.publishedAt.getTime()).toBeGreaterThanOrEqual(before);
    }
  });

  it('with the shipped files: a database still holding the old texts gets the corrected ones, and once they are published a re-run changes nothing', async () => {
    for (const slug of SLUGS) published(slug, 1, OLD_TEXT);

    const first = await republishTurkishLegalDocuments(prisma as any, { now: NOW, publishedBy: 'owner' });
    expect(first.map((r) => r.action)).toEqual(['bumped', 'bumped', 'bumped']);
    for (const call of prisma.legalDocumentVersion.create.mock.calls) {
      const { contentMd, publishedBy } = call[0].data;
      expect(publishedBy).toBe('owner');
      expect(contentMd).toContain('info@sesly.io');
      expect(contentMd).not.toContain('destek@sesly.app');
      expect(contentMd).not.toMatch(/stripe/i);
    }

    // The database now holds what was just published.
    for (const call of prisma.legalDocumentVersion.create.mock.calls) {
      const { slug, version, contentMd, title } = call[0].data;
      published(slug, version, contentMd, title);
    }
    prisma.legalDocument.update.mockClear();
    prisma.legalDocumentVersion.create.mockClear();
    prisma.$transaction.mockClear();

    const second = await republishTurkishLegalDocuments(prisma as any, { now: NOW });
    expect(second.map((r) => [r.action, r.toVersion])).toEqual([
      ['unchanged', 2],
      ['unchanged', 2],
      ['unchanged', 2],
    ]);
    expectNoWrites();
  });
});

describe('sameLegalText', () => {
  it('ignores line ending style and surrounding whitespace, nothing else', () => {
    expect(sameLegalText('a\nb\n', 'a\r\nb')).toBe(true);
    expect(sameLegalText('\n  a\rb  \n\n', 'a\nb')).toBe(true);
    expect(sameLegalText('a\nb', 'a\n\nb')).toBe(false);
    expect(sameLegalText('a b', 'a  b')).toBe(false);
    expect(sameLegalText('Şartlar', 'Sartlar')).toBe(false);
  });
});
