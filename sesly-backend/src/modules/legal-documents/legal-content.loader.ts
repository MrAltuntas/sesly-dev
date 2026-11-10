import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { LegalDocumentLanguage } from './legal-languages';

/**
 * The legal texts, every language: `content/<slug>.<language>.md` next to
 * this file (copied to `dist/modules/legal-documents/content/` by the
 * nest-cli assets rule). These files are the only copy of the texts in the
 * backend: the seeder and `scripts/republish-legal.ts` both read them.
 *
 * File format: plain Markdown (`##` headings, `-` bullets, `**bold**`). An
 * optional first line `# Title` is used as the document title and removed
 * from the body (clients render the title themselves); without it the title
 * comes from `DEFAULT_LEGAL_TITLES`.
 */

/** The documents every client links to; each has a file per language in `content/`. */
export const CANONICAL_LEGAL_SLUGS = ['tos', 'privacy', 'data-deletion'] as const;

export type CanonicalLegalSlug = (typeof CANONICAL_LEGAL_SLUGS)[number];

export const DEFAULT_LEGAL_TITLES: Record<
  LegalDocumentLanguage,
  Record<CanonicalLegalSlug, string>
> = {
  tr: {
    tos: 'Kullanım Şartları',
    privacy: 'Gizlilik Politikası',
    'data-deletion': 'Veri Silme',
  },
  en: {
    tos: 'Terms of Use',
    privacy: 'Privacy Policy',
    'data-deletion': 'Data Deletion',
  },
};

export interface LegalContentFile {
  title: string;
  contentMd: string;
  path: string;
}

/**
 * Folders searched in order. The first is the compiled location (dist) or
 * the source folder under ts-node / jest; the second covers a build whose
 * assets were not copied (the Docker image keeps `src/`).
 */
export function legalContentDirs(): string[] {
  return [
    join(__dirname, 'content'),
    join(process.cwd(), 'src', 'modules', 'legal-documents', 'content'),
  ];
}

export function legalContentFileName(slug: string, language: string): string {
  return `${slug}.${language}.md`;
}

const BYTE_ORDER_MARK = 0xfeff;

/**
 * Split an optional leading `# Title` line off the Markdown. Normalises a
 * byte order mark and Windows line endings; the body ends with one newline.
 * Returns null when nothing but whitespace (or only the title) is left.
 */
export function parseLegalMarkdown(
  raw: string,
  fallbackTitle: string,
): { title: string; contentMd: string } | null {
  const unmarked = raw.charCodeAt(0) === BYTE_ORDER_MARK ? raw.slice(1) : raw;
  let text = unmarked.replace(/\r\n?/g, '\n');
  let title = fallbackTitle;

  const heading = /^\s*#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\n|$)/.exec(text);
  if (heading) {
    title = heading[1].trim();
    text = text.slice(heading[0].length);
  }

  const body = text.trim();
  if (!body || !title) return null;
  return { title, contentMd: `${body}\n` };
}

/**
 * Read `content/<slug>.<language>.md` from the first folder that has it.
 * Missing or empty: null. A read error throws.
 */
export function loadLegalContentFile(
  slug: string,
  language: LegalDocumentLanguage,
  dirs: string[] = legalContentDirs(),
): LegalContentFile | null {
  const name = legalContentFileName(slug, language);
  const titles: Record<string, string> | undefined = DEFAULT_LEGAL_TITLES[language];
  const fallbackTitle = titles?.[slug] ?? slug;

  for (const dir of dirs) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    const parsed = parseLegalMarkdown(readFileSync(path, 'utf8'), fallbackTitle);
    return parsed ? { ...parsed, path } : null;
  }
  return null;
}

export interface CanonicalLegalText extends LegalContentFile {
  slug: CanonicalLegalSlug;
  language: LegalDocumentLanguage;
}

/**
 * Every canonical document of one language, in `CANONICAL_LEGAL_SLUGS`
 * order. All or nothing: a missing or empty file throws (naming each one),
 * so a caller that publishes never publishes half a set.
 */
export function loadCanonicalLegalTexts(
  language: LegalDocumentLanguage,
  dirs: string[] = legalContentDirs(),
): CanonicalLegalText[] {
  const texts: CanonicalLegalText[] = [];
  const missing: string[] = [];
  for (const slug of CANONICAL_LEGAL_SLUGS) {
    const file = loadLegalContentFile(slug, language, dirs);
    if (file) texts.push({ slug, language, ...file });
    else missing.push(legalContentFileName(slug, language));
  }
  if (missing.length) {
    throw new Error(
      `Legal content missing or empty: ${missing.join(', ')} (looked in ${dirs.join(', ')})`,
    );
  }
  return texts;
}
