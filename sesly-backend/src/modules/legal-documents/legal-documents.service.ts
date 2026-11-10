import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';
import { LegalDocumentStatus } from '@common/enums/prisma.enums';
import { CreateLegalDocumentDto } from './dto/create-legal-document.dto';
import { UpdateLegalDocumentDto } from './dto/update-legal-document.dto';
import {
  LegalDocumentResponseDto,
  PublicLegalDocumentDto,
} from './dto/legal-document-response.dto';
import { LegalDocumentVersionResponseDto } from './dto/legal-document-version-response.dto';
import {
  ALL_LEGAL_DOCUMENT_LANGUAGES,
  DEFAULT_LEGAL_DOCUMENT_LANGUAGE,
  LegalDocumentLanguage,
  legalLanguageRank,
} from './legal-languages';

type RawLegalDocument = {
  id: string;
  slug: string;
  language: string;
  title: string;
  contentMd: string;
  currentVersion: number;
  status: LegalDocumentStatus;
  publishedAt: Date | null;
  publishedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RawLegalDocumentVersion = {
  id: string;
  documentId: string;
  slug: string;
  language: string;
  version: number;
  title: string;
  contentMd: string;
  publishedAt: Date;
  publishedBy: string | null;
};

export type AdminLegalListLanguage =
  | LegalDocumentLanguage
  | typeof ALL_LEGAL_DOCUMENT_LANGUAGES;

/**
 * Languages a public read tries, in order: the requested one, then Turkish
 * (the canonical text). A request without a language reads Turkish only.
 */
function publicLanguageChain(
  language: LegalDocumentLanguage | undefined,
): LegalDocumentLanguage[] {
  const requested = language ?? DEFAULT_LEGAL_DOCUMENT_LANGUAGE;
  return requested === DEFAULT_LEGAL_DOCUMENT_LANGUAGE
    ? [DEFAULT_LEGAL_DOCUMENT_LANGUAGE]
    : [requested, DEFAULT_LEGAL_DOCUMENT_LANGUAGE];
}

function docKey(slug: string, language: string): string {
  return `${slug}\u0000${language}`;
}

@Injectable()
export class LegalDocumentsService {
  constructor(private prisma: PrismaService) {}

  // ─────────────────────────────────────────────
  // Public (read-only)
  // ─────────────────────────────────────────────

  /**
   * List every published legal document with its latest live snapshot, one
   * entry per slug: the requested language when that document is published,
   * else the published Turkish one (`language` on each entry says which).
   * Documents that have never been published are hidden from public view.
   */
  async listPublic(
    language?: LegalDocumentLanguage,
  ): Promise<PublicLegalDocumentDto[]> {
    const chain = publicLanguageChain(language);

    const docs = (await this.prisma.legalDocument.findMany({
      where: {
        status: LegalDocumentStatus.PUBLISHED,
        language: { in: chain },
      },
      select: { slug: true, language: true },
      orderBy: { slug: 'asc' },
    })) as unknown as Array<{ slug: string; language: string }>;

    if (docs.length === 0) return [];

    const slugs = [...new Set(docs.map((d) => d.slug))];
    const published = new Set(docs.map((d) => docKey(d.slug, d.language)));

    // Latest version per (slug, language) in a single query.
    const versions = (await this.prisma.legalDocumentVersion.findMany({
      where: {
        slug: { in: slugs },
        language: { in: chain },
      },
      orderBy: [{ slug: 'asc' }, { version: 'desc' }],
    })) as unknown as RawLegalDocumentVersion[];

    const latest = new Map<string, RawLegalDocumentVersion>();
    for (const v of versions) {
      const key = docKey(v.slug, v.language);
      if (!latest.has(key)) latest.set(key, v);
    }

    const out: PublicLegalDocumentDto[] = [];
    for (const slug of slugs) {
      for (const lang of chain) {
        const key = docKey(slug, lang);
        // status=PUBLISHED but no snapshot should never happen; try the next language.
        const v = published.has(key) ? latest.get(key) : undefined;
        if (v) {
          out.push(this.toPublicDto(v));
          break;
        }
      }
    }
    return out;
  }

  /**
   * Return the latest published snapshot for a slug in the requested
   * language, falling back to the published Turkish one.
   * IMPORTANT: reads from `legal_document_versions` — never from the draft
   * `LegalDocument.contentMd` row — so mid-edit drafts stay hidden. A
   * document that has never been published has no version row, so an
   * English DRAFT is never served: the Turkish snapshot is.
   */
  async getPublicBySlug(
    slug: string,
    language?: LegalDocumentLanguage,
  ): Promise<PublicLegalDocumentDto> {
    for (const lang of publicLanguageChain(language)) {
      const version = (await this.prisma.legalDocumentVersion.findFirst({
        where: { slug, language: lang },
        orderBy: { version: 'desc' },
      })) as unknown as RawLegalDocumentVersion | null;
      if (version) return this.toPublicDto(version);
    }

    throw new NotFoundException(`Legal document "${slug}" not found`);
  }

  // ─────────────────────────────────────────────
  // Admin (read)
  // ─────────────────────────────────────────────

  /**
   * Admin list. Default: the Turkish documents only (what the panel showed
   * before languages existed, one row per slug). `all`: every language,
   * slug asc, Turkish first within a slug.
   */
  async listAdmin(
    language: AdminLegalListLanguage = DEFAULT_LEGAL_DOCUMENT_LANGUAGE,
  ): Promise<LegalDocumentResponseDto[]> {
    const rows = (await this.prisma.legalDocument.findMany({
      ...(language === ALL_LEGAL_DOCUMENT_LANGUAGES
        ? {}
        : { where: { language } }),
      orderBy: { slug: 'asc' },
    })) as unknown as RawLegalDocument[];

    return [...rows]
      .sort((a, b) =>
        a.slug === b.slug
          ? legalLanguageRank(a.language) - legalLanguageRank(b.language)
          : a.slug < b.slug
            ? -1
            : 1,
      )
      .map((r) => this.toResponseDto(r));
  }

  async getAdminBySlug(
    slug: string,
    language: LegalDocumentLanguage = DEFAULT_LEGAL_DOCUMENT_LANGUAGE,
  ): Promise<LegalDocumentResponseDto> {
    const row = (await this.prisma.legalDocument.findUnique({
      where: { slug_language: { slug, language } },
    })) as unknown as RawLegalDocument | null;
    if (!row) throw this.notFound(slug, language);
    return this.toResponseDto(row);
  }

  // ─────────────────────────────────────────────
  // Admin (write)
  // ─────────────────────────────────────────────

  async create(dto: CreateLegalDocumentDto): Promise<LegalDocumentResponseDto> {
    const language = dto.language ?? DEFAULT_LEGAL_DOCUMENT_LANGUAGE;
    const existing = await this.prisma.legalDocument.findUnique({
      where: { slug_language: { slug: dto.slug, language } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        `Legal document slug "${dto.slug}" already exists for language "${language}"`,
      );
    }

    const row = (await this.prisma.legalDocument.create({
      data: {
        slug: dto.slug,
        language,
        title: dto.title,
        contentMd: dto.contentMd,
        status: LegalDocumentStatus.DRAFT,
        currentVersion: 0,
      },
    })) as unknown as RawLegalDocument;

    return this.toResponseDto(row);
  }

  /**
   * Patch the draft copy. Status intentionally remains whatever it was:
   * editing a previously-published document leaves the public surface on
   * the old snapshot until an explicit `publish` mints a new version.
   */
  async update(
    slug: string,
    dto: UpdateLegalDocumentDto,
    language: LegalDocumentLanguage = DEFAULT_LEGAL_DOCUMENT_LANGUAGE,
  ): Promise<LegalDocumentResponseDto> {
    await this.requireExists(slug, language);

    const row = (await this.prisma.legalDocument.update({
      where: { slug_language: { slug, language } },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.contentMd !== undefined ? { contentMd: dto.contentMd } : {}),
      },
    })) as unknown as RawLegalDocument;

    return this.toResponseDto(row);
  }

  /**
   * Atomic publish: snapshot the current draft into a new version row, bump
   * the document's currentVersion/publishedAt/publishedBy, flip to PUBLISHED.
   * Only the addressed (slug, language) document is touched; each language
   * has its own version numbers.
   */
  async publish(
    slug: string,
    publishedBy: string | null,
    language: LegalDocumentLanguage = DEFAULT_LEGAL_DOCUMENT_LANGUAGE,
  ): Promise<LegalDocumentResponseDto> {
    const doc = (await this.prisma.legalDocument.findUnique({
      where: { slug_language: { slug, language } },
    })) as unknown as RawLegalDocument | null;
    if (!doc) throw this.notFound(slug, language);

    const nextVersion = doc.currentVersion + 1;
    const now = new Date();

    const [, updated] = await this.prisma.$transaction([
      this.prisma.legalDocumentVersion.create({
        data: {
          documentId: doc.id,
          slug: doc.slug,
          language: doc.language,
          version: nextVersion,
          title: doc.title,
          contentMd: doc.contentMd,
          publishedAt: now,
          publishedBy: publishedBy ?? null,
        },
      }),
      this.prisma.legalDocument.update({
        where: { id: doc.id },
        data: {
          status: LegalDocumentStatus.PUBLISHED,
          currentVersion: nextVersion,
          publishedAt: now,
          publishedBy: publishedBy ?? null,
        },
      }),
    ]);

    return this.toResponseDto(updated as unknown as RawLegalDocument);
  }

  /**
   * Every published snapshot of one (slug, language) document, newest first.
   * Capped at 50 — legal documents are not expected to turn over often, and
   * the UI only needs a recent audit window.
   */
  async listVersions(
    slug: string,
    language: LegalDocumentLanguage = DEFAULT_LEGAL_DOCUMENT_LANGUAGE,
  ): Promise<LegalDocumentVersionResponseDto[]> {
    await this.requireExists(slug, language);

    const rows = (await this.prisma.legalDocumentVersion.findMany({
      where: { slug, language },
      orderBy: { version: 'desc' },
      take: 50,
    })) as unknown as RawLegalDocumentVersion[];

    return rows.map((r) => ({
      id: r.id,
      documentId: r.documentId,
      slug: r.slug,
      language: r.language,
      version: r.version,
      title: r.title,
      contentMd: r.contentMd,
      publishedAt: r.publishedAt,
      publishedBy: r.publishedBy,
    }));
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  private async requireExists(slug: string, language: string): Promise<void> {
    const row = await this.prisma.legalDocument.findUnique({
      where: { slug_language: { slug, language } },
      select: { id: true },
    });
    if (!row) throw this.notFound(slug, language);
  }

  private notFound(slug: string, language: string): NotFoundException {
    return new NotFoundException(
      `Legal document "${slug}" (${language}) not found`,
    );
  }

  private toPublicDto(v: RawLegalDocumentVersion): PublicLegalDocumentDto {
    return {
      slug: v.slug,
      language: v.language,
      title: v.title,
      contentMd: v.contentMd,
      version: v.version,
      publishedAt: v.publishedAt,
    };
  }

  private toResponseDto(row: RawLegalDocument): LegalDocumentResponseDto {
    return {
      id: row.id,
      slug: row.slug,
      language: row.language,
      title: row.title,
      contentMd: row.contentMd,
      currentVersion: row.currentVersion,
      status: row.status,
      publishedAt: row.publishedAt,
      publishedBy: row.publishedBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
