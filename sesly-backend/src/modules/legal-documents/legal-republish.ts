import { PrismaClient } from '@prisma/client';
// Relative imports only: `scripts/republish-legal.ts` loads this file under
// ts-node, with or without tsconfig-paths.
import { LegalDocumentStatus } from '../../common/enums/prisma.enums';
import {
  CanonicalLegalSlug,
  CanonicalLegalText,
  loadCanonicalLegalTexts,
} from './legal-content.loader';
import { DEFAULT_LEGAL_DOCUMENT_LANGUAGE, LegalDocumentLanguage } from './legal-languages';

/**
 * Publish the Turkish legal texts from `content/<slug>.tr.md` (the files the
 * seeder reads) as new versions where the database differs. Used by
 * `scripts/republish-legal.ts`; kept here so it is compiled and tested with
 * the module.
 *
 * Turkish only: English (and any later language) is reviewed and published
 * from the admin panel, never by code.
 *
 * Per canonical slug:
 *   - no (slug, tr) document: create it and publish v1;
 *   - the published version (the text users are served) has the file's
 *     title and text: unchanged, nothing is written (not even the working
 *     copy, so an unpublished panel draft survives);
 *   - otherwise: the working copy becomes the file text, the document is
 *     PUBLISHED with currentVersion + 1, and an immutable version row is
 *     written, exactly like a publish from the admin panel.
 * Line endings and leading or trailing whitespace do not count as a change.
 * Every file is read before the database is touched: a missing or empty file
 * throws and nothing is written. `dryRun` reads and reports, never writes.
 */

export const REPUBLISH_LANGUAGE: LegalDocumentLanguage = DEFAULT_LEGAL_DOCUMENT_LANGUAGE;
export const REPUBLISH_ACTOR = 'script:republish-legal';

export type LegalRepublishClient = Pick<
  PrismaClient,
  'legalDocument' | 'legalDocumentVersion' | '$transaction'
>;

export type LegalRepublishAction = 'created' | 'bumped' | 'unchanged';

export interface LegalRepublishResult {
  slug: CanonicalLegalSlug;
  language: LegalDocumentLanguage;
  action: LegalRepublishAction;
  /** Published version before the run; null when the document did not exist. */
  fromVersion: number | null;
  /** Published version after the run (on a dry run: what it would be). */
  toVersion: number;
  /**
   * The working copy held unpublished edits that are not the file text; a
   * bump replaces them. Always false for `created` and `unchanged`.
   */
  replacesDraft: boolean;
  /** Content file the text was read from. */
  path: string;
}

export interface LegalRepublishOptions {
  /** Read and compare only; nothing is written. */
  dryRun?: boolean;
  now?: Date;
  publishedBy?: string;
  /** Content folders (tests); default `legalContentDirs()`. */
  dirs?: string[];
}

/** Same text for publishing purposes: line endings and surrounding whitespace do not count. */
export function sameLegalText(a: string, b: string): boolean {
  const canonical = (text: string) => text.replace(/\r\n?/g, '\n').trim();
  return canonical(a) === canonical(b);
}

export async function republishTurkishLegalDocuments(
  prisma: LegalRepublishClient,
  options: LegalRepublishOptions = {},
): Promise<LegalRepublishResult[]> {
  const texts = loadCanonicalLegalTexts(REPUBLISH_LANGUAGE, options.dirs);
  const context: RepublishContext = {
    dryRun: options.dryRun === true,
    now: options.now ?? new Date(),
    publishedBy: options.publishedBy ?? REPUBLISH_ACTOR,
  };

  const results: LegalRepublishResult[] = [];
  for (const text of texts) {
    results.push(await republishOne(prisma, text, context));
  }
  return results;
}

interface RepublishContext {
  dryRun: boolean;
  now: Date;
  publishedBy: string;
}

async function republishOne(
  prisma: LegalRepublishClient,
  text: CanonicalLegalText,
  { dryRun, now, publishedBy }: RepublishContext,
): Promise<LegalRepublishResult> {
  const { slug, language, title, contentMd, path } = text;
  const base = { slug, language, path, replacesDraft: false };

  const existing = await prisma.legalDocument.findUnique({
    where: { slug_language: { slug, language } },
    select: { id: true, currentVersion: true, title: true, contentMd: true },
  });

  if (!existing) {
    if (!dryRun) {
      await prisma.$transaction(async (tx) => {
        const doc = await tx.legalDocument.create({
          data: {
            slug,
            language,
            title,
            contentMd,
            status: LegalDocumentStatus.PUBLISHED,
            currentVersion: 1,
            publishedAt: now,
            publishedBy,
          },
        });
        await tx.legalDocumentVersion.create({
          data: {
            documentId: doc.id,
            slug,
            language,
            version: 1,
            title,
            contentMd,
            publishedAt: now,
            publishedBy,
          },
        });
      });
    }
    return { ...base, action: 'created', fromVersion: null, toVersion: 1 };
  }

  const published =
    existing.currentVersion > 0
      ? await prisma.legalDocumentVersion.findUnique({
          where: {
            documentId_version: { documentId: existing.id, version: existing.currentVersion },
          },
          select: { title: true, contentMd: true },
        })
      : null;

  const matches = (doc: { title: string; contentMd: string } | null): boolean =>
    doc !== null && doc.title === title && sameLegalText(doc.contentMd, contentMd);

  if (matches(published)) {
    return {
      ...base,
      action: 'unchanged',
      fromVersion: existing.currentVersion,
      toVersion: existing.currentVersion,
    };
  }

  const workingCopyIsPublished =
    published !== null &&
    published.title === existing.title &&
    sameLegalText(published.contentMd, existing.contentMd);
  const replacesDraft = !matches(existing) && !workingCopyIsPublished;
  const nextVersion = existing.currentVersion + 1;

  if (!dryRun) {
    await prisma.$transaction(async (tx) => {
      await tx.legalDocument.update({
        where: { id: existing.id },
        data: {
          title,
          contentMd,
          status: LegalDocumentStatus.PUBLISHED,
          currentVersion: nextVersion,
          publishedAt: now,
          publishedBy,
        },
      });
      await tx.legalDocumentVersion.create({
        data: {
          documentId: existing.id,
          slug,
          language,
          version: nextVersion,
          title,
          contentMd,
          publishedAt: now,
          publishedBy,
        },
      });
    });
  }

  return {
    ...base,
    action: 'bumped',
    fromVersion: existing.currentVersion,
    toVersion: nextVersion,
    replacesDraft,
  };
}
