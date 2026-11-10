import { ConflictException, NotFoundException } from '@nestjs/common';
import { LegalDocumentsService } from './legal-documents.service';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import {
  createMockLegalDocument,
  createMockLegalDocumentVersion,
} from '../../test-utils/mock-factories';

const PUBLIC_KEYS = ['contentMd', 'language', 'publishedAt', 'slug', 'title', 'version'];
const ADMIN_KEYS = [
  'contentMd',
  'createdAt',
  'currentVersion',
  'id',
  'language',
  'publishedAt',
  'publishedBy',
  'slug',
  'status',
  'title',
  'updatedAt',
];
const VERSION_KEYS = [
  'contentMd',
  'documentId',
  'id',
  'language',
  'publishedAt',
  'publishedBy',
  'slug',
  'title',
  'version',
];

describe('LegalDocumentsService', () => {
  let prisma: MockPrismaService;
  let service: LegalDocumentsService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new LegalDocumentsService(prisma as any);
  });

  // -------------------------------------------------------------------------
  describe('getPublicBySlug', () => {
    it('returns the latest published Turkish snapshot, not the draft row, when no language is sent', async () => {
      prisma.legalDocumentVersion.findFirst.mockResolvedValue(
        createMockLegalDocumentVersion({
          slug: 'tos',
          language: 'tr',
          version: 3,
          title: 'Kullanım Şartları',
          contentMd: '# v3 published',
          publishedAt: new Date('2026-09-01T00:00:00Z'),
          publishedBy: 'admin@test.sesly',
        }),
      );

      const res = await service.getPublicBySlug('tos');

      expect(prisma.legalDocumentVersion.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.legalDocumentVersion.findFirst).toHaveBeenCalledWith({
        where: { slug: 'tos', language: 'tr' },
        orderBy: { version: 'desc' },
      });
      // Drafts live on legal_documents; the public read must never touch it.
      expect(prisma.legalDocument.findUnique).not.toHaveBeenCalled();
      expect(prisma.legalDocument.findFirst).not.toHaveBeenCalled();
      expect(res).toEqual({
        slug: 'tos',
        language: 'tr',
        title: 'Kullanım Şartları',
        contentMd: '# v3 published',
        version: 3,
        publishedAt: new Date('2026-09-01T00:00:00Z'),
      });
    });

    it('exposes only the public keys (no admin metadata such as publishedBy / documentId)', async () => {
      prisma.legalDocumentVersion.findFirst.mockResolvedValue(createMockLegalDocumentVersion());
      const res = await service.getPublicBySlug('tos');
      expect(Object.keys(res).sort()).toEqual(PUBLIC_KEYS);
    });

    it('language=en with a published English version returns it (language en) and never reads Turkish', async () => {
      prisma.legalDocumentVersion.findFirst.mockResolvedValue(
        createMockLegalDocumentVersion({ slug: 'tos', language: 'en', version: 1, title: 'Terms of Use' }),
      );

      const res = await service.getPublicBySlug('tos', 'en');

      expect(prisma.legalDocumentVersion.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.legalDocumentVersion.findFirst).toHaveBeenCalledWith({
        where: { slug: 'tos', language: 'en' },
        orderBy: { version: 'desc' },
      });
      expect(res).toMatchObject({ slug: 'tos', language: 'en', title: 'Terms of Use', version: 1 });
    });

    it('language=en without a published English version falls back to the published Turkish one and says so', async () => {
      prisma.legalDocumentVersion.findFirst
        .mockResolvedValueOnce(null) // en: draft only (no version row) or missing
        .mockResolvedValueOnce(
          createMockLegalDocumentVersion({ slug: 'privacy', language: 'tr', version: 4, title: 'Gizlilik Politikası' }),
        );

      const res = await service.getPublicBySlug('privacy', 'en');

      expect(prisma.legalDocumentVersion.findFirst.mock.calls.map((c: any[]) => c[0].where)).toEqual([
        { slug: 'privacy', language: 'en' },
        { slug: 'privacy', language: 'tr' },
      ]);
      expect(res).toMatchObject({ slug: 'privacy', language: 'tr', title: 'Gizlilik Politikası', version: 4 });
      expect(Object.keys(res).sort()).toEqual(PUBLIC_KEYS);
      expect(prisma.legalDocument.findUnique).not.toHaveBeenCalled();
    });

    it('language=tr reads Turkish once (no fallback chain)', async () => {
      prisma.legalDocumentVersion.findFirst.mockResolvedValue(null);
      await expect(service.getPublicBySlug('tos', 'tr')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.legalDocumentVersion.findFirst).toHaveBeenCalledTimes(1);
    });

    it('never-published (draft only) or unknown slug -> 404', async () => {
      prisma.legalDocumentVersion.findFirst.mockResolvedValue(null);
      const err = await service.getPublicBySlug('privacy').catch((e) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('Legal document "privacy" not found');
    });

    it('nothing published in English nor Turkish -> 404 after trying both', async () => {
      prisma.legalDocumentVersion.findFirst.mockResolvedValue(null);
      const err = await service.getPublicBySlug('cookies', 'en').catch((e) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('Legal document "cookies" not found');
      expect(prisma.legalDocumentVersion.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  describe('listPublic', () => {
    it('lists only PUBLISHED Turkish documents with their latest snapshot when no language is sent', async () => {
      prisma.legalDocument.findMany.mockResolvedValue([
        { slug: 'privacy', language: 'tr' },
        { slug: 'tos', language: 'tr' },
      ]);
      // Ordered slug asc, version desc (as the query requests).
      prisma.legalDocumentVersion.findMany.mockResolvedValue([
        createMockLegalDocumentVersion({ slug: 'privacy', version: 2, contentMd: 'privacy v2' }),
        createMockLegalDocumentVersion({ slug: 'privacy', version: 1, contentMd: 'privacy v1' }),
        createMockLegalDocumentVersion({ slug: 'tos', version: 5, contentMd: 'tos v5' }),
        createMockLegalDocumentVersion({ slug: 'tos', version: 4, contentMd: 'tos v4' }),
      ]);

      const res = await service.listPublic();

      expect(prisma.legalDocument.findMany).toHaveBeenCalledWith({
        where: { status: 'PUBLISHED', language: { in: ['tr'] } },
        select: { slug: true, language: true },
        orderBy: { slug: 'asc' },
      });
      expect(prisma.legalDocumentVersion.findMany).toHaveBeenCalledWith({
        where: { slug: { in: ['privacy', 'tos'] }, language: { in: ['tr'] } },
        orderBy: [{ slug: 'asc' }, { version: 'desc' }],
      });
      expect(res.map((d) => [d.slug, d.language, d.version, d.contentMd])).toEqual([
        ['privacy', 'tr', 2, 'privacy v2'],
        ['tos', 'tr', 5, 'tos v5'],
      ]);
      for (const doc of res) expect(Object.keys(doc).sort()).toEqual(PUBLIC_KEYS);
    });

    it('language=en: one entry per slug, English where published, else the Turkish fallback', async () => {
      // tos: published in both; privacy: only Turkish published (English is a
      // draft, so the PUBLISHED filter leaves it out); data-deletion: Turkish only.
      prisma.legalDocument.findMany.mockResolvedValue([
        { slug: 'data-deletion', language: 'tr' },
        { slug: 'privacy', language: 'tr' },
        { slug: 'tos', language: 'en' },
        { slug: 'tos', language: 'tr' },
      ]);
      prisma.legalDocumentVersion.findMany.mockResolvedValue([
        createMockLegalDocumentVersion({ slug: 'data-deletion', language: 'tr', version: 1, contentMd: 'veri v1' }),
        createMockLegalDocumentVersion({ slug: 'privacy', language: 'tr', version: 3, contentMd: 'gizlilik v3' }),
        createMockLegalDocumentVersion({ slug: 'tos', language: 'tr', version: 7, contentMd: 'şartlar v7' }),
        createMockLegalDocumentVersion({ slug: 'tos', language: 'en', version: 2, contentMd: 'terms v2' }),
        createMockLegalDocumentVersion({ slug: 'tos', language: 'en', version: 1, contentMd: 'terms v1' }),
      ]);

      const res = await service.listPublic('en');

      expect(prisma.legalDocument.findMany.mock.calls[0][0].where).toEqual({
        status: 'PUBLISHED',
        language: { in: ['en', 'tr'] },
      });
      expect(prisma.legalDocumentVersion.findMany.mock.calls[0][0].where).toEqual({
        slug: { in: ['data-deletion', 'privacy', 'tos'] },
        language: { in: ['en', 'tr'] },
      });
      expect(res.map((d) => [d.slug, d.language, d.version, d.contentMd])).toEqual([
        ['data-deletion', 'tr', 1, 'veri v1'],
        ['privacy', 'tr', 3, 'gizlilik v3'],
        ['tos', 'en', 2, 'terms v2'],
      ]);
    });

    it('an English version row whose document is not PUBLISHED is never served (Turkish instead)', async () => {
      prisma.legalDocument.findMany.mockResolvedValue([{ slug: 'tos', language: 'tr' }]);
      prisma.legalDocumentVersion.findMany.mockResolvedValue([
        createMockLegalDocumentVersion({ slug: 'tos', language: 'en', version: 1, contentMd: 'stray en' }),
        createMockLegalDocumentVersion({ slug: 'tos', language: 'tr', version: 2, contentMd: 'tr v2' }),
      ]);

      const res = await service.listPublic('en');
      expect(res.map((d) => [d.language, d.contentMd])).toEqual([['tr', 'tr v2']]);
    });

    it('skips a PUBLISHED document that has no snapshot (in any language of the chain)', async () => {
      prisma.legalDocument.findMany.mockResolvedValue([
        { slug: 'tos', language: 'tr' },
        { slug: 'data-deletion', language: 'tr' },
      ]);
      prisma.legalDocumentVersion.findMany.mockResolvedValue([
        createMockLegalDocumentVersion({ slug: 'tos', version: 1 }),
      ]);

      const res = await service.listPublic();
      expect(res.map((d) => d.slug)).toEqual(['tos']);
    });

    it('a published English document without a snapshot falls back to the Turkish one', async () => {
      prisma.legalDocument.findMany.mockResolvedValue([
        { slug: 'tos', language: 'en' },
        { slug: 'tos', language: 'tr' },
      ]);
      prisma.legalDocumentVersion.findMany.mockResolvedValue([
        createMockLegalDocumentVersion({ slug: 'tos', language: 'tr', version: 1 }),
      ]);

      const res = await service.listPublic('en');
      expect(res.map((d) => [d.slug, d.language])).toEqual([['tos', 'tr']]);
    });

    it('no published documents -> [] without a version query', async () => {
      prisma.legalDocument.findMany.mockResolvedValue([]);
      await expect(service.listPublic()).resolves.toEqual([]);
      await expect(service.listPublic('en')).resolves.toEqual([]);
      expect(prisma.legalDocumentVersion.findMany).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('admin reads', () => {
    it('listAdmin without a language returns the Turkish documents (drafts included) in the admin shape', async () => {
      prisma.legalDocument.findMany.mockResolvedValue([
        createMockLegalDocument({ slug: 'privacy', status: 'DRAFT', currentVersion: 0, publishedAt: null }),
        createMockLegalDocument({ slug: 'tos' }),
      ]);

      const res = await service.listAdmin();

      expect(prisma.legalDocument.findMany).toHaveBeenCalledWith({
        where: { language: 'tr' },
        orderBy: { slug: 'asc' },
      });
      expect(res.map((d) => d.status)).toEqual(['DRAFT', 'PUBLISHED']);
      for (const doc of res) expect(Object.keys(doc).sort()).toEqual(ADMIN_KEYS);
    });

    it('listAdmin(en) filters on English', async () => {
      prisma.legalDocument.findMany.mockResolvedValue([
        createMockLegalDocument({ slug: 'tos', language: 'en', status: 'DRAFT' }),
      ]);
      const res = await service.listAdmin('en');
      expect(prisma.legalDocument.findMany).toHaveBeenCalledWith({
        where: { language: 'en' },
        orderBy: { slug: 'asc' },
      });
      expect(res.map((d) => [d.slug, d.language])).toEqual([['tos', 'en']]);
    });

    it('listAdmin(all) returns every language, slug asc, Turkish first within a slug', async () => {
      prisma.legalDocument.findMany.mockResolvedValue([
        createMockLegalDocument({ slug: 'privacy', language: 'en' }),
        createMockLegalDocument({ slug: 'privacy', language: 'tr' }),
        createMockLegalDocument({ slug: 'data-deletion', language: 'tr' }),
        createMockLegalDocument({ slug: 'tos', language: 'xx' }), // unknown language sorts last
        createMockLegalDocument({ slug: 'tos', language: 'en' }),
        createMockLegalDocument({ slug: 'tos', language: 'tr' }),
      ]);

      const res = await service.listAdmin('all');

      expect(prisma.legalDocument.findMany).toHaveBeenCalledWith({ orderBy: { slug: 'asc' } });
      expect(res.map((d) => `${d.slug}:${d.language}`)).toEqual([
        'data-deletion:tr',
        'privacy:tr',
        'privacy:en',
        'tos:tr',
        'tos:en',
        'tos:xx',
      ]);
    });

    it('getAdminBySlug reads the (slug, language) row; default tr; unknown -> 404 naming the language', async () => {
      prisma.legalDocument.findUnique.mockResolvedValue(createMockLegalDocument({ contentMd: 'draft body' }));
      await expect(service.getAdminBySlug('tos')).resolves.toMatchObject({ contentMd: 'draft body', language: 'tr' });
      expect(prisma.legalDocument.findUnique).toHaveBeenLastCalledWith({
        where: { slug_language: { slug: 'tos', language: 'tr' } },
      });

      prisma.legalDocument.findUnique.mockResolvedValue(createMockLegalDocument({ language: 'en', title: 'Terms of Use' }));
      await expect(service.getAdminBySlug('tos', 'en')).resolves.toMatchObject({ language: 'en', title: 'Terms of Use' });
      expect(prisma.legalDocument.findUnique).toHaveBeenLastCalledWith({
        where: { slug_language: { slug: 'tos', language: 'en' } },
      });

      prisma.legalDocument.findUnique.mockResolvedValue(null);
      const err = await service.getAdminBySlug('tos', 'en').catch((e) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('Legal document "tos" (en) not found');
    });
  });

  // -------------------------------------------------------------------------
  describe('create / update', () => {
    it('create stores a Turkish DRAFT at version 0 when no language is sent', async () => {
      prisma.legalDocument.findUnique.mockResolvedValue(null);
      prisma.legalDocument.create.mockImplementation(async ({ data }: any) =>
        createMockLegalDocument({ ...data, publishedAt: null, publishedBy: null }),
      );

      const res = await service.create({ slug: 'cookies', title: 'Çerezler', contentMd: '# Çerezler' });

      expect(prisma.legalDocument.findUnique).toHaveBeenCalledWith({
        where: { slug_language: { slug: 'cookies', language: 'tr' } },
        select: { id: true },
      });
      expect(prisma.legalDocument.create).toHaveBeenCalledWith({
        data: {
          slug: 'cookies',
          language: 'tr',
          title: 'Çerezler',
          contentMd: '# Çerezler',
          status: 'DRAFT',
          currentVersion: 0,
        },
      });
      expect(res).toMatchObject({ slug: 'cookies', language: 'tr', status: 'DRAFT', currentVersion: 0 });
      // Creating never publishes.
      expect(prisma.legalDocumentVersion.create).not.toHaveBeenCalled();
    });

    it('create of an English document next to an existing Turkish one checks (slug, en) only', async () => {
      prisma.legalDocument.findUnique.mockResolvedValue(null);
      prisma.legalDocument.create.mockImplementation(async ({ data }: any) => createMockLegalDocument(data));

      const res = await service.create({ slug: 'tos', language: 'en', title: 'Terms of Use', contentMd: 'Terms' });

      expect(prisma.legalDocument.findUnique.mock.calls[0][0].where).toEqual({
        slug_language: { slug: 'tos', language: 'en' },
      });
      expect(prisma.legalDocument.create.mock.calls[0][0].data).toMatchObject({
        slug: 'tos',
        language: 'en',
        status: 'DRAFT',
        currentVersion: 0,
      });
      expect(res.language).toBe('en');
      expect(prisma.legalDocumentVersion.create).not.toHaveBeenCalled();
    });

    it('create with an existing (slug, language) -> 409 naming the language and nothing written', async () => {
      prisma.legalDocument.findUnique.mockResolvedValue({ id: 'doc-1' });
      const err = await service
        .create({ slug: 'tos', language: 'en', title: 'x', contentMd: 'y' })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe('Legal document slug "tos" already exists for language "en"');
      expect(prisma.legalDocument.create).not.toHaveBeenCalled();
    });

    it('update edits only the provided draft fields of the Turkish document by default and never touches status or versions', async () => {
      prisma.legalDocument.findUnique.mockResolvedValue({ id: 'doc-1' });
      prisma.legalDocument.update.mockResolvedValue(createMockLegalDocument({ contentMd: 'new draft' }));

      await service.update('tos', { contentMd: 'new draft' });

      expect(prisma.legalDocument.findUnique).toHaveBeenCalledWith({
        where: { slug_language: { slug: 'tos', language: 'tr' } },
        select: { id: true },
      });
      expect(prisma.legalDocument.update).toHaveBeenCalledWith({
        where: { slug_language: { slug: 'tos', language: 'tr' } },
        data: { contentMd: 'new draft' },
      });
      expect(prisma.legalDocumentVersion.create).not.toHaveBeenCalled();
    });

    it('update with language=en edits the English draft only', async () => {
      prisma.legalDocument.findUnique.mockResolvedValue({ id: 'doc-en' });
      prisma.legalDocument.update.mockResolvedValue(createMockLegalDocument({ language: 'en' }));

      const res = await service.update('tos', { title: 'Terms of Use' }, 'en');

      expect(prisma.legalDocument.update).toHaveBeenCalledWith({
        where: { slug_language: { slug: 'tos', language: 'en' } },
        data: { title: 'Terms of Use' },
      });
      expect(res.language).toBe('en');
    });

    it('update can change the title alone or both fields; an empty patch writes no fields', async () => {
      prisma.legalDocument.findUnique.mockResolvedValue({ id: 'doc-1' });
      prisma.legalDocument.update.mockResolvedValue(createMockLegalDocument());

      await service.update('tos', { title: 'Yeni Başlık' });
      await service.update('tos', { title: 'T', contentMd: 'C' });
      await service.update('tos', {});

      expect(prisma.legalDocument.update.mock.calls.map((c: any[]) => c[0].data)).toEqual([
        { title: 'Yeni Başlık' },
        { title: 'T', contentMd: 'C' },
        {},
      ]);
    });

    it('update of an unknown (slug, language) -> 404 and nothing written', async () => {
      prisma.legalDocument.findUnique.mockResolvedValue(null);
      await expect(service.update('nope', { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
      const err = await service.update('tos', { title: 'x' }, 'en').catch((e) => e);
      expect(err.message).toBe('Legal document "tos" (en) not found');
      expect(prisma.legalDocument.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('publish', () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
      jest.setSystemTime(new Date('2026-09-20T10:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('snapshots the draft as currentVersion + 1 and flips the document to PUBLISHED atomically', async () => {
      const doc = createMockLegalDocument({
        id: 'doc-1',
        slug: 'tos',
        title: 'Kullanım Şartları',
        contentMd: '# draft v3',
        currentVersion: 2,
      });
      prisma.legalDocument.findUnique.mockResolvedValue(doc);
      prisma.legalDocumentVersion.create.mockReturnValue('CREATE_VERSION_OP');
      prisma.legalDocument.update.mockReturnValue('UPDATE_DOC_OP');
      const updatedRow = { ...doc, currentVersion: 3, status: 'PUBLISHED' };
      prisma.$transaction.mockResolvedValue([{ id: 'ver-3' }, updatedRow]);

      const res = await service.publish('tos', 'admin@test.sesly');
      const now = new Date('2026-09-20T10:00:00Z');

      expect(prisma.legalDocument.findUnique).toHaveBeenCalledWith({
        where: { slug_language: { slug: 'tos', language: 'tr' } },
      });
      expect(prisma.legalDocumentVersion.create).toHaveBeenCalledWith({
        data: {
          documentId: 'doc-1',
          slug: 'tos',
          language: 'tr',
          version: 3,
          title: 'Kullanım Şartları',
          contentMd: '# draft v3',
          publishedAt: now,
          publishedBy: 'admin@test.sesly',
        },
      });
      expect(prisma.legalDocument.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: {
          status: 'PUBLISHED',
          currentVersion: 3,
          publishedAt: now,
          publishedBy: 'admin@test.sesly',
        },
      });
      // Both writes go through one transaction.
      expect(prisma.$transaction).toHaveBeenCalledWith(['CREATE_VERSION_OP', 'UPDATE_DOC_OP']);
      expect(res).toMatchObject({ currentVersion: 3, status: 'PUBLISHED' });
      expect(Object.keys(res).sort()).toEqual(ADMIN_KEYS);
    });

    it('publishing the English document mints its own v1 (language en) and touches only that row', async () => {
      const doc = createMockLegalDocument({
        id: 'doc-en',
        slug: 'tos',
        language: 'en',
        title: 'Terms of Use',
        contentMd: 'Terms draft',
        currentVersion: 0,
        status: 'DRAFT',
      });
      prisma.legalDocument.findUnique.mockResolvedValue(doc);
      prisma.$transaction.mockResolvedValue([{}, { ...doc, currentVersion: 1, status: 'PUBLISHED' }]);

      const res = await service.publish('tos', 'admin@sesly.io', 'en');

      expect(prisma.legalDocument.findUnique).toHaveBeenCalledWith({
        where: { slug_language: { slug: 'tos', language: 'en' } },
      });
      expect(prisma.legalDocumentVersion.create.mock.calls[0][0].data).toMatchObject({
        documentId: 'doc-en',
        slug: 'tos',
        language: 'en',
        version: 1,
        title: 'Terms of Use',
        contentMd: 'Terms draft',
      });
      expect(prisma.legalDocument.update).toHaveBeenCalledTimes(1);
      expect(prisma.legalDocument.update.mock.calls[0][0].where).toEqual({ id: 'doc-en' });
      expect(res).toMatchObject({ language: 'en', currentVersion: 1, status: 'PUBLISHED' });
    });

    it('first publish of a draft mints version 1; missing publisher is stored as null', async () => {
      const doc = createMockLegalDocument({ id: 'doc-2', slug: 'cookies', currentVersion: 0, status: 'DRAFT' });
      prisma.legalDocument.findUnique.mockResolvedValue(doc);
      prisma.$transaction.mockResolvedValue([{}, { ...doc, currentVersion: 1, status: 'PUBLISHED' }]);

      await service.publish('cookies', null);

      expect(prisma.legalDocumentVersion.create.mock.calls[0][0].data).toMatchObject({
        version: 1,
        publishedBy: null,
      });
      expect(prisma.legalDocument.update.mock.calls[0][0].data).toMatchObject({
        currentVersion: 1,
        publishedBy: null,
      });
    });

    it('unknown (slug, language) -> 404 and no transaction', async () => {
      prisma.legalDocument.findUnique.mockResolvedValue(null);
      await expect(service.publish('nope', 'admin')).rejects.toBeInstanceOf(NotFoundException);
      const err = await service.publish('tos', 'admin', 'en').catch((e) => e);
      expect(err.message).toBe('Legal document "tos" (en) not found');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.legalDocumentVersion.create).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('listVersions (history)', () => {
    it('returns Turkish snapshots newest first by default, capped at 50, with audit fields', async () => {
      prisma.legalDocument.findUnique.mockResolvedValue({ id: 'doc-1' });
      prisma.legalDocumentVersion.findMany.mockResolvedValue([
        createMockLegalDocumentVersion({ id: 'v2', documentId: 'doc-1', version: 2, publishedBy: 'a@x' }),
        createMockLegalDocumentVersion({ id: 'v1', documentId: 'doc-1', version: 1, publishedBy: null }),
      ]);

      const res = await service.listVersions('tos');

      expect(prisma.legalDocument.findUnique).toHaveBeenCalledWith({
        where: { slug_language: { slug: 'tos', language: 'tr' } },
        select: { id: true },
      });
      expect(prisma.legalDocumentVersion.findMany).toHaveBeenCalledWith({
        where: { slug: 'tos', language: 'tr' },
        orderBy: { version: 'desc' },
        take: 50,
      });
      expect(res.map((v) => v.version)).toEqual([2, 1]);
      expect(Object.keys(res[0]).sort()).toEqual(VERSION_KEYS);
      expect(res[1].publishedBy).toBeNull();
    });

    it('language=en lists the English history only', async () => {
      prisma.legalDocument.findUnique.mockResolvedValue({ id: 'doc-en' });
      prisma.legalDocumentVersion.findMany.mockResolvedValue([
        createMockLegalDocumentVersion({ documentId: 'doc-en', language: 'en', version: 1 }),
      ]);

      const res = await service.listVersions('tos', 'en');

      expect(prisma.legalDocumentVersion.findMany.mock.calls[0][0].where).toEqual({ slug: 'tos', language: 'en' });
      expect(res.map((v) => [v.language, v.version])).toEqual([['en', 1]]);
    });

    it('unknown (slug, language) -> 404', async () => {
      prisma.legalDocument.findUnique.mockResolvedValue(null);
      await expect(service.listVersions('nope')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.listVersions('tos', 'en')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.legalDocumentVersion.findMany).not.toHaveBeenCalled();
    });
  });
});
