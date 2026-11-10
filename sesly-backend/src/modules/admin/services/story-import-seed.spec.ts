import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  SeedArgsError,
  isLocalDatabaseUrl,
  parseSeedArgs,
  readImportFile,
  runImportFileSeed,
} from './story-import-seed';

describe('seed:stories (import file seed)', () => {
  describe('parseSeedArgs', () => {
    it('reads the file, the flags and the batch label', () => {
      expect(parseSeedArgs(['--file', 'a.json'])).toEqual({
        file: 'a.json',
        dryRun: false,
        publish: false,
        batch: null,
        allowRemote: false,
      });
      expect(parseSeedArgs(['--file=a.json', '--dry-run', '--publish', '--batch', 'dev', '--allow-remote'])).toEqual({
        file: 'a.json',
        dryRun: true,
        publish: true,
        batch: 'dev',
        allowRemote: true,
      });
      expect(parseSeedArgs(['--batch=x', '--file', 'b.json']).batch).toBe('x');
    });

    it.each([[[]], [['--file']], [['--file', '--dry-run']], [['--file', 'a.json', '--force']], [['a.json']]])(
      'refuses %j with the usage',
      (argv) => {
        expect(() => parseSeedArgs(argv as string[])).toThrow(SeedArgsError);
        expect(() => parseSeedArgs(argv as string[])).toThrow(/npm run seed:stories/);
      },
    );
  });

  it('isLocalDatabaseUrl: localhost, loopback and *.localhost only', () => {
    expect(isLocalDatabaseUrl('postgresql://u:p@localhost:5439/sesly')).toBe(true);
    expect(isLocalDatabaseUrl('postgresql://u:p@127.0.0.1:5432/sesly')).toBe(true);
    expect(isLocalDatabaseUrl('postgresql://u:p@[::1]:5432/sesly')).toBe(true);
    expect(isLocalDatabaseUrl('postgresql://u:p@db.localhost:5432/sesly')).toBe(true);
    expect(isLocalDatabaseUrl('postgresql://u:p@10.0.0.5:5432/sesly')).toBe(false);
    expect(isLocalDatabaseUrl('postgresql://u:p@db.example.com/sesly')).toBe(false);
    expect(isLocalDatabaseUrl('not a url')).toBe(false);
    expect(isLocalDatabaseUrl(undefined)).toBe(false);
  });

  describe('readImportFile', () => {
    let dir: string;
    const write = (name: string, body: string) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, body);
      return file;
    };
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-stories-'));
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('takes an array or { stories }', () => {
      expect(readImportFile(write('a.json', '[{"title":"A"}]'))).toEqual([{ title: 'A' }]);
      expect(readImportFile(write('b.json', '{"stories":[{"title":"B"}]}'))).toEqual([{ title: 'B' }]);
    });

    it.each([
      ['missing.json', null, /bulunamadı/],
      ['bad.json', '{oops', /geçerli bir JSON değil/],
      ['obj.json', '{"a":1}', /masal dizisi/],
      ['empty.json', '[]', /dosyada masal yok/],
    ])('%s is refused', (name, body, message) => {
      const file = body === null ? path.join(dir, name) : write(name, body);
      expect(() => readImportFile(file)).toThrow(message);
    });
  });

  describe('runImportFileSeed', () => {
    const item = (index: number, status: string, storyId?: string) => ({
      index,
      title: `T${index}`,
      language: 'tr',
      status,
      ...(storyId ? { storyId } : {}),
      ...(status === 'error' ? { message: 'Geçersiz alanlar.', problems: ['text: boş'] } : {}),
    });

    it('imports in requests of at most 300 with the batch label, renumbering errors over the file', async () => {
      const stories = Array.from({ length: 301 }, (_, i) => ({ title: `T${i}` }));
      const importer = {
        importStories: jest
          .fn()
          .mockResolvedValueOnce({ total: 300, created: 299, skipped: 1, errors: 0, items: [item(0, 'created', 'a'), item(1, 'skipped')] })
          .mockResolvedValueOnce({ total: 1, created: 0, skipped: 0, errors: 1, items: [item(0, 'error')] }),
      };
      const prisma = { story: { findMany: jest.fn(), updateMany: jest.fn() } };
      const summary = await runImportFileSeed(prisma, importer as any, stories, {
        dryRun: false,
        publish: false,
        batch: 'dev.json',
      });
      expect(importer.importStories.mock.calls.map((c) => [c[0].stories.length, c[0].batch, c[0].dryRun, c[1]])).toEqual([
        [300, 'dev.json', false, 'seed:stories'],
        [1, 'dev.json', false, 'seed:stories'],
      ]);
      expect(summary).toMatchObject({ total: 301, created: 299, skipped: 1, errors: 1, published: 0 });
      expect(summary.errorItems).toEqual([{ index: 300, title: 'T0', message: 'Geçersiz alanlar.', problems: ['text: boş'] }]);
      expect(prisma.story.findMany).not.toHaveBeenCalled();
    });

    it('--publish publishes the created stories that pass the rule; CC BY without credit stays a draft', async () => {
      const importer = {
        importStories: jest.fn().mockResolvedValue({
          total: 2,
          created: 2,
          skipped: 0,
          errors: 0,
          items: [item(0, 'created', 'ok'), item(1, 'created', 'cc')],
        }),
      };
      const prisma = {
        story: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'ok', title: 'Tamam', origin: 'AI_GENERATED', textFidelity: 'RETOLD' },
            { id: 'cc', title: 'CC', origin: 'AI_GENERATED', textFidelity: 'RETOLD', rightsBasis: 'CC_BY' },
          ]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const summary = await runImportFileSeed(prisma, importer as any, [{}, {}], { dryRun: false, publish: true, batch: 'b' });
      expect(prisma.story.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['ok'] }, status: 'DRAFT' },
        data: { status: 'PUBLISHED', publishedAt: expect.any(Date) },
      });
      expect(summary.published).toBe(1);
      expect(summary.notPublished).toEqual([
        {
          storyId: 'cc',
          title: 'CC',
          missing: ['Atıf metni (CC BY lisansı için zorunlu)', 'Lisans adı (CC BY lisansı için zorunlu)'],
        },
      ]);
    });

    it('a dry run counts the valid items and never publishes; nothing publishable writes nothing', async () => {
      const importer = {
        importStories: jest.fn().mockResolvedValue({ total: 1, created: 0, skipped: 0, errors: 0, items: [item(0, 'valid')] }),
      };
      const prisma = { story: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() } };
      const dry = await runImportFileSeed(prisma, importer as any, [{}], { dryRun: true, publish: true, batch: 'b' });
      expect(dry.valid).toBe(1);
      expect(prisma.story.findMany).not.toHaveBeenCalled();

      importer.importStories.mockResolvedValue({ total: 1, created: 1, skipped: 0, errors: 0, items: [item(0, 'created', 'x')] });
      prisma.story.findMany.mockResolvedValue([{ id: 'x', title: 'X' }]);
      const res = await runImportFileSeed(prisma, importer as any, [{}], { dryRun: false, publish: true, batch: 'b' });
      expect(prisma.story.updateMany).not.toHaveBeenCalled();
      expect(res.notPublished[0].missing).toEqual(['Köken', 'Metin sadakati']);
    });
  });
});
