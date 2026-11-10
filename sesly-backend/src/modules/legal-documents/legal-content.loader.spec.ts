import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import {
  CANONICAL_LEGAL_SLUGS,
  DEFAULT_LEGAL_TITLES,
  legalContentDirs,
  legalContentFileName,
  loadCanonicalLegalTexts,
  loadLegalContentFile,
  parseLegalMarkdown,
} from './legal-content.loader';
import { LEGAL_DOCUMENT_LANGUAGES } from './legal-languages';

/** Every file the backend must ship: one per canonical slug and language. */
const EXPECTED_FILES = LEGAL_DOCUMENT_LANGUAGES.flatMap((language) =>
  CANONICAL_LEGAL_SLUGS.map((slug) => `${slug}.${language}.md`),
);

describe('legal content loader', () => {
  describe('legalContentDirs / legalContentFileName', () => {
    it('looks next to the module first (dist or src), then under the working directory', () => {
      expect(legalContentDirs()).toEqual([
        join(__dirname, 'content'),
        join(process.cwd(), 'src', 'modules', 'legal-documents', 'content'),
      ]);
    });

    it('names files <slug>.<language>.md', () => {
      expect(legalContentFileName('data-deletion', 'en')).toBe('data-deletion.en.md');
    });
  });

  describe('parseLegalMarkdown', () => {
    it('takes a leading "# Title" line as the title and removes it from the body', () => {
      expect(parseLegalMarkdown('# Terms of Use\n\nPlease read.\n\n## Accounts\n\nText.\n', 'x')).toEqual({
        title: 'Terms of Use',
        contentMd: 'Please read.\n\n## Accounts\n\nText.\n',
      });
    });

    it('accepts blank lines before the title and closing hashes', () => {
      expect(parseLegalMarkdown('\n\n#   Privacy Policy  ##\nBody', 'x')).toEqual({
        title: 'Privacy Policy',
        contentMd: 'Body\n',
      });
    });

    it('without an H1 keeps the whole text and uses the fallback title; a "##" first line is body', () => {
      expect(parseLegalMarkdown('## Section\n\nText', 'Data Deletion')).toEqual({
        title: 'Data Deletion',
        contentMd: '## Section\n\nText\n',
      });
      expect(parseLegalMarkdown('Intro #hashtag', 'T')).toEqual({ title: 'T', contentMd: 'Intro #hashtag\n' });
    });

    it('removes a byte order mark and Windows / old Mac line endings, ends with exactly one newline', () => {
      const bom = String.fromCharCode(0xfeff);
      expect(parseLegalMarkdown(`${bom}# Title\r\n\r\nLine 1\r\nLine 2\rLine 3\r\n\r\n\r\n`, 'x')).toEqual({
        title: 'Title',
        contentMd: 'Line 1\nLine 2\nLine 3\n',
      });
    });

    it('nothing but whitespace, or a title without a body -> null', () => {
      expect(parseLegalMarkdown('', 'T')).toBeNull();
      expect(parseLegalMarkdown(' \n\t\n', 'T')).toBeNull();
      expect(parseLegalMarkdown('# Only a title\n\n', 'T')).toBeNull();
    });

    it('an empty fallback title without an H1 -> null', () => {
      expect(parseLegalMarkdown('Body', '')).toBeNull();
    });
  });

  describe('loadLegalContentFile', () => {
    let root: string;
    let first: string;
    let second: string;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'legal-content-'));
      first = join(root, 'dist-content');
      second = join(root, 'src-content');
      mkdirSync(first);
      mkdirSync(second);
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it('missing everywhere (or the folders do not exist) -> null', () => {
      expect(loadLegalContentFile('tos', 'en', [first, second])).toBeNull();
      expect(loadLegalContentFile('tos', 'en', [join(root, 'nope')])).toBeNull();
    });

    it('reads <slug>.en.md, title from the H1', () => {
      writeFileSync(join(first, 'tos.en.md'), '# Terms of Use\n\nBody text\n');
      expect(loadLegalContentFile('tos', 'en', [first, second])).toEqual({
        title: 'Terms of Use',
        contentMd: 'Body text\n',
        path: join(first, 'tos.en.md'),
      });
    });

    it('without an H1 the English default title of the slug is used', () => {
      writeFileSync(join(first, 'privacy.en.md'), 'Body');
      writeFileSync(join(first, 'data-deletion.en.md'), 'Body');
      expect(loadLegalContentFile('privacy', 'en', [first])?.title).toBe('Privacy Policy');
      expect(loadLegalContentFile('data-deletion', 'en', [first])?.title).toBe('Data Deletion');
    });

    it('without an H1 the Turkish default title of the slug is used', () => {
      writeFileSync(join(first, 'tos.tr.md'), 'Gövde');
      writeFileSync(join(first, 'privacy.tr.md'), 'Gövde');
      writeFileSync(join(first, 'data-deletion.tr.md'), 'Gövde');
      expect(loadLegalContentFile('tos', 'tr', [first])?.title).toBe('Kullanım Şartları');
      expect(loadLegalContentFile('privacy', 'tr', [first])?.title).toBe('Gizlilik Politikası');
      expect(loadLegalContentFile('data-deletion', 'tr', [first])?.title).toBe('Veri Silme');
    });

    it('a slug without a default title falls back to the slug itself', () => {
      writeFileSync(join(first, 'cookies.en.md'), 'Body');
      expect(loadLegalContentFile('cookies', 'en', [first])?.title).toBe('cookies');
      writeFileSync(join(first, 'cookies.tr.md'), 'Gövde');
      expect(loadLegalContentFile('cookies', 'tr', [first])?.title).toBe('cookies');
    });

    it('a language without default titles falls back to the slug itself', () => {
      writeFileSync(join(first, 'tos.de.md'), 'Inhalt');
      expect(loadLegalContentFile('tos', 'de' as any, [first])?.title).toBe('tos');
    });

    it('the first folder that has the file wins; the second is used when the first lacks it', () => {
      writeFileSync(join(first, 'tos.en.md'), 'first');
      writeFileSync(join(second, 'tos.en.md'), 'second');
      writeFileSync(join(second, 'privacy.en.md'), 'second only');
      expect(loadLegalContentFile('tos', 'en', [first, second])?.contentMd).toBe('first\n');
      expect(loadLegalContentFile('privacy', 'en', [first, second])).toMatchObject({
        contentMd: 'second only\n',
        path: join(second, 'privacy.en.md'),
      });
    });

    it('an empty file -> null (does not fall through to the next folder)', () => {
      writeFileSync(join(first, 'tos.en.md'), '  \n');
      writeFileSync(join(second, 'tos.en.md'), 'second');
      expect(loadLegalContentFile('tos', 'en', [first, second])).toBeNull();
    });

    it.each(LEGAL_DOCUMENT_LANGUAGES)(
      'defaults to the real content folders, which hold a %s text for every canonical slug',
      (language) => {
        for (const slug of CANONICAL_LEGAL_SLUGS) {
          const file = loadLegalContentFile(slug, language);
          expect(file).toMatchObject({
            title: DEFAULT_LEGAL_TITLES[language][slug],
            path: join(__dirname, 'content', `${slug}.${language}.md`),
          });
          expect(file?.contentMd.length).toBeGreaterThan(1000);
          // Body only: the title is a separate field, so no H1 is left in the text.
          expect(file?.contentMd).not.toMatch(/^# /m);
        }
      },
    );
  });

  describe('loadCanonicalLegalTexts', () => {
    let root: string;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'legal-canonical-'));
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it('returns every canonical slug of the language in order, with slug, language, title, body and path', () => {
      writeFileSync(join(root, 'data-deletion.tr.md'), 'Silme\r\n');
      writeFileSync(join(root, 'tos.tr.md'), '# Özel Başlık\n\nŞartlar');
      writeFileSync(join(root, 'privacy.tr.md'), 'Gizlilik');
      writeFileSync(join(root, 'tos.en.md'), 'Terms');

      expect(loadCanonicalLegalTexts('tr', [root])).toEqual([
        { slug: 'tos', language: 'tr', title: 'Özel Başlık', contentMd: 'Şartlar\n', path: join(root, 'tos.tr.md') },
        { slug: 'privacy', language: 'tr', title: 'Gizlilik Politikası', contentMd: 'Gizlilik\n', path: join(root, 'privacy.tr.md') },
        { slug: 'data-deletion', language: 'tr', title: 'Veri Silme', contentMd: 'Silme\n', path: join(root, 'data-deletion.tr.md') },
      ]);
    });

    it('all or nothing: a missing or empty file throws and names every one of them', () => {
      writeFileSync(join(root, 'tos.tr.md'), 'Şartlar');
      writeFileSync(join(root, 'privacy.tr.md'), '   \n');

      expect(() => loadCanonicalLegalTexts('tr', [root])).toThrow(
        `Legal content missing or empty: privacy.tr.md, data-deletion.tr.md (looked in ${root})`,
      );
    });

    it('defaults to the shipped Turkish files', () => {
      const texts = loadCanonicalLegalTexts('tr');
      expect(texts.map((t) => [t.slug, t.title, t.path])).toEqual(
        CANONICAL_LEGAL_SLUGS.map((slug) => [slug, DEFAULT_LEGAL_TITLES.tr[slug], join(__dirname, 'content', `${slug}.tr.md`)]),
      );
    });
  });

  // The compiled seeder reads `join(__dirname, 'content')` in dist, and the
  // Docker image builds from the context. Both must contain the texts.
  describe('build and Docker packaging', () => {
    const projectRoot = join(__dirname, '..', '..', '..');
    const readJson = (file: string): any => JSON.parse(readFileSync(join(projectRoot, file), 'utf8'));
    const contentFromSourceRoot = 'modules/legal-documents/content';

    /** Minimal `.dockerignore` matcher: `**`, `*`, `?`, `!` exceptions, last match wins, parents count. */
    function dockerIgnores(path: string): boolean {
      const patterns = readFileSync(join(projectRoot, '.dockerignore'), 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
      const toRegExp = (glob: string): RegExp =>
        new RegExp(
          `^${glob
            .replace(/^\//, '')
            .split(/(\*\*\/?|\*|\?)/)
            .map((part) =>
              part === '**/' || part === '**'
                ? '(?:.*/)?'
                : part === '*'
                  ? '[^/]*'
                  : part === '?'
                    ? '[^/]'
                    : part.replace(/[.+^${}()|[\]\\]/g, '\\$&'),
            )
            .join('')}$`,
        );
      const segments = path.split('/');
      const candidates = segments.map((_, i) => segments.slice(0, i + 1).join('/'));
      let ignored = false;
      for (const raw of patterns) {
        const exception = raw.startsWith('!');
        const regExp = toRegExp(exception ? raw.slice(1) : raw);
        if (candidates.some((candidate) => regExp.test(candidate))) ignored = !exception;
      }
      return ignored;
    }

    it('the matcher follows the Docker rules it relies on', () => {
      expect(dockerIgnores('README.md')).toBe(true);
      expect(dockerIgnores('node_modules/x/index.js')).toBe(true);
      expect(dockerIgnores('src/main.ts')).toBe(false);
      expect(dockerIgnores('src/modules/legal-documents/content/tos.en.md')).toBe(false);
    });

    it('nest build copies content/*.md to the folder the compiled loader reads', () => {
      const nestCli = readJson('nest-cli.json');
      const tsconfig = readJson('tsconfig.json');
      const tsconfigBuild = readJson(nestCli.compilerOptions.tsConfigPath);
      const outDir = tsconfigBuild.compilerOptions?.outDir ?? tsconfig.compilerOptions.outDir;
      // Every compiled file keeps its path below `src` (tsc's root is `src`, main.ts is there).
      expect(tsconfig.include).toEqual([`${nestCli.sourceRoot}/**/*`]);
      const compiledLoaderDir = join(projectRoot, outDir, relative(join(projectRoot, nestCli.sourceRoot), __dirname));

      const rule = (nestCli.compilerOptions.assets as Array<string | { include: string; outDir?: string }>)
        .map((item) => (typeof item === 'string' ? { include: item } : item))
        .find((item) => item.include.startsWith(`${contentFromSourceRoot}/`) && item.include.endsWith('*.md'));
      expect(rule).toBeDefined();
      // The CLI copies an asset to <outDir>/<path below sourceRoot>.
      const copiedTo = join(projectRoot, rule?.outDir ?? outDir, contentFromSourceRoot);

      expect(copiedTo).toBe(join(compiledLoaderDir, 'content'));
      expect(legalContentDirs()[0]).toBe(join(__dirname, 'content'));
    });

    it('the Docker build context keeps every shipped content file, Turkish and English (and the src fallback folder)', () => {
      const dir = join(__dirname, 'content');
      const shipped = readdirSync(dir).filter((f) => f.endsWith('.md'));
      expect(shipped.sort()).toEqual([...EXPECTED_FILES].sort());
      for (const file of shipped) {
        expect(dockerIgnores(`src/${contentFromSourceRoot}/${file}`)).toBe(false);
      }
    });
  });

  it.each(LEGAL_DOCUMENT_LANGUAGES)('every canonical slug has a %s default title', (language) => {
    expect(Object.keys(DEFAULT_LEGAL_TITLES[language]).sort()).toEqual([...CANONICAL_LEGAL_SLUGS].sort());
    for (const slug of CANONICAL_LEGAL_SLUGS) {
      expect(DEFAULT_LEGAL_TITLES[language][slug].trim().length).toBeGreaterThan(0);
    }
  });

  // Guards the shipped texts (written separately) against the UI text rules
  // and facts the owner confirmed (contact info@sesly.io, store payments only).
  describe('shipped content files', () => {
    const dir = join(__dirname, 'content');
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
    // Code point ranges: em dash, unicode ellipsis, arrows, bullet, middle dot,
    // guillemets and single chevrons, misc symbols / dingbats (stars, check
    // marks, lightning) and the emoji blocks. Kept as numbers so this file
    // itself contains none of them.
    const FORBIDDEN: Array<[number, number]> = [
      [0x2014, 0x2014],
      [0x2026, 0x2026],
      [0x2190, 0x21ff],
      [0x2022, 0x2022],
      [0x00b7, 0x00b7],
      [0x00ab, 0x00ab],
      [0x00bb, 0x00bb],
      [0x2039, 0x203a],
      [0x2600, 0x27bf],
      [0x1f000, 0x1faff],
    ];
    const forbiddenIn = (text: string): string[] =>
      [...text].filter((ch) => {
        const cp = ch.codePointAt(0) as number;
        return FORBIDDEN.some(([from, to]) => cp >= from && cp <= to);
      });
    const slugs: readonly string[] = CANONICAL_LEGAL_SLUGS;

    it('the character guard catches what it should', () => {
      const emDash = String.fromCharCode(0x2014);
      const ellipsis = String.fromCharCode(0x2026);
      const arrow = String.fromCharCode(0x2192);
      const star = String.fromCharCode(0x2605);
      const emoji = String.fromCodePoint(0x1f319);
      expect(forbiddenIn(`a${emDash}b${ellipsis}c${arrow}d${star}e${emoji}`)).toEqual([emDash, ellipsis, arrow, star, emoji]);
      expect(forbiddenIn('Plain text - with hyphens, "quotes" and three dots...')).toEqual([]);
    });

    it('are named <canonical slug>.<language>.md', () => {
      for (const file of files) {
        expect(file).toMatch(new RegExp(`^(${slugs.join('|')})\\.[a-z]{2}\\.md$`));
      }
    });

    it('every canonical slug ships in every language, Turkish included, and nothing else', () => {
      expect([...files].sort()).toEqual([...EXPECTED_FILES].sort());
      expect(EXPECTED_FILES.filter((f) => f.endsWith('.tr.md'))).toEqual([
        'tos.tr.md',
        'privacy.tr.md',
        'data-deletion.tr.md',
      ]);
    });

    // Driven by the expected list, not the folder: a missing file fails here too.
    it.each(EXPECTED_FILES)('%s follows the text rules', (file) => {
      const text = readFileSync(join(dir, file), 'utf8');
      expect(forbiddenIn(text)).toEqual([]);
      expect(text).not.toContain('destek@sesly.app');
      expect(text).not.toMatch(/sesly\.app/i);
      expect(text).toContain('info@sesly.io');
      expect(text).not.toMatch(/stripe/i);
      // No date line: the app shows the published version's date.
      expect(text).not.toMatch(/son güncelleme|last updated/i);
    });

    it.each(CANONICAL_LEGAL_SLUGS)('%s.tr.md is the Turkish text: Turkish letters, payments through the stores only', (slug) => {
      const text = readFileSync(join(dir, `${slug}.tr.md`), 'utf8');
      expect(text).toMatch(/[çğıöşüİ]/);
      if (slug === 'tos' || slug === 'privacy') {
        expect(text).toContain('Apple In-App Purchase');
        expect(text).toContain('Google Play Billing');
      }
    });

    it('the default titles follow the text rules too', () => {
      for (const language of LEGAL_DOCUMENT_LANGUAGES) {
        for (const title of Object.values(DEFAULT_LEGAL_TITLES[language])) {
          expect(forbiddenIn(title)).toEqual([]);
        }
      }
    });
  });
});
