import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';
import { LegalDocumentStatus } from '@common/enums/prisma.enums';
import {
  CANONICAL_LEGAL_SLUGS,
  CanonicalLegalSlug,
  legalContentFileName,
  loadLegalContentFile,
} from './legal-content.loader';
import {
  DEFAULT_LEGAL_DOCUMENT_LANGUAGE,
  LegalDocumentLanguage,
} from './legal-languages';

/**
 * Languages seeded as DRAFT from `content/<slug>.<language>.md`. Never
 * published by the seeder: an editor reviews and publishes them in the admin
 * panel. Until then the public read serves the Turkish text.
 */
export const DRAFT_SEED_LANGUAGES: LegalDocumentLanguage[] = ['en'];

const SEEDER_ACTOR = 'system:seeder';

/**
 * Idempotent seeder for the three canonical legal slugs, per (slug, language):
 *   - tos            Kullanım Şartları
 *   - privacy        Gizlilik Politikası
 *   - data-deletion  Veri Silme
 *
 * Runs on application bootstrap. Every text comes from
 * `content/<slug>.<language>.md` (see `legal-content.loader.ts`), the same
 * files `scripts/republish-legal.ts` publishes, so the backend holds one copy.
 *   - Turkish (the canonical text, `content/<slug>.tr.md`): if the (slug, tr)
 *     row does not exist, create it AND publish v1 in a single transaction so
 *     the public endpoint works immediately after first boot. A missing
 *     Turkish file is a packaging error: logged, the document is not seeded.
 *   - English (`DRAFT_SEED_LANGUAGES`): if `content/<slug>.en.md` exists and
 *     the (slug, en) row does not, create it as a DRAFT (currentVersion 0, no
 *     version row). Never PUBLISHED here.
 * An existing document is never touched, in any language: edits to the
 * content files are NOT applied to an existing database. Publish them
 * through the admin legal editor or `scripts/republish-legal.ts` (Turkish
 * only).
 */
@Injectable()
export class LegalDocumentsSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(LegalDocumentsSeeder.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seed();
  }

  /** Every document on its own: one failure (DB down, a race) never stops the others or the boot. */
  async seed(): Promise<void> {
    for (const slug of CANONICAL_LEGAL_SLUGS) {
      await this.failSoft(slug, DEFAULT_LEGAL_DOCUMENT_LANGUAGE, () =>
        this.seedPublished(slug),
      );
    }
    for (const language of DRAFT_SEED_LANGUAGES) {
      for (const slug of CANONICAL_LEGAL_SLUGS) {
        await this.failSoft(slug, language, () => this.seedDraft(slug, language));
      }
    }
  }

  private async failSoft(
    slug: string,
    language: string,
    step: () => Promise<void>,
  ): Promise<void> {
    try {
      await step();
    } catch (err) {
      // Fail-soft: don't crash the whole app if the DB is unreachable during boot.
      this.logger.error(`Legal seed failed for "${slug}" (${language})`, err as Error);
    }
  }

  /** Turkish: create + publish v1 from the content file when the (slug, tr) document is missing. */
  private async seedPublished(slug: CanonicalLegalSlug): Promise<void> {
    const language = DEFAULT_LEGAL_DOCUMENT_LANGUAGE;
    const file = loadLegalContentFile(slug, language);
    if (!file) {
      throw new Error(
        `content/${legalContentFileName(slug, language)} is missing or empty; the Turkish document cannot be seeded`,
      );
    }

    const existing = await this.prisma.legalDocument.findUnique({
      where: { slug_language: { slug, language } },
      select: { id: true, currentVersion: true, status: true },
    });

    if (existing) {
      this.logger.log(
        `Legal seed: skipped "${slug}" (${language}) (already present, v${existing.currentVersion}, ${existing.status})`,
      );
      return;
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const doc = await tx.legalDocument.create({
        data: {
          slug,
          language,
          title: file.title,
          contentMd: file.contentMd,
          status: LegalDocumentStatus.PUBLISHED,
          currentVersion: 1,
          publishedAt: now,
          publishedBy: SEEDER_ACTOR,
        },
      });

      await tx.legalDocumentVersion.create({
        data: {
          documentId: doc.id,
          slug,
          language,
          version: 1,
          title: file.title,
          contentMd: file.contentMd,
          publishedAt: now,
          publishedBy: SEEDER_ACTOR,
        },
      });
    });

    this.logger.log(
      `Legal seed: created + published v1 for "${slug}" (${language}) from content/${legalContentFileName(slug, language)}`,
    );
  }

  /** Other languages: create a DRAFT from the content file when the document is missing. */
  private async seedDraft(slug: CanonicalLegalSlug, language: LegalDocumentLanguage): Promise<void> {
    const file = loadLegalContentFile(slug, language);
    if (!file) {
      this.logger.log(
        `Legal seed: no content/${legalContentFileName(slug, language)}, "${slug}" (${language}) not seeded`,
      );
      return;
    }

    const existing = await this.prisma.legalDocument.findUnique({
      where: { slug_language: { slug, language } },
      select: { id: true, currentVersion: true, status: true },
    });
    if (existing) {
      this.logger.log(
        `Legal seed: skipped "${slug}" (${language}) (already present, v${existing.currentVersion}, ${existing.status})`,
      );
      return;
    }

    await this.prisma.legalDocument.create({
      data: {
        slug,
        language,
        title: file.title,
        contentMd: file.contentMd,
        status: LegalDocumentStatus.DRAFT,
        currentVersion: 0,
      },
    });

    this.logger.log(
      `Legal seed: created DRAFT "${slug}" (${language}) from content/${legalContentFileName(slug, language)}; publish it in the admin panel`,
    );
  }
}
