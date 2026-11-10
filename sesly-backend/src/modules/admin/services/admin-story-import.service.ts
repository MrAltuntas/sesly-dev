import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { ValidationError, validate } from 'class-validator';
import { v5 as uuidv5 } from 'uuid';
import { PrismaService } from '@prisma/prisma.service';
import { estimateDurationMinutes } from '../../../common/constants/content-languages';
import {
  AgeGroupSource,
  LanguageLevelSource,
  StoryOrigin,
  StoryStatus,
  StoryTextFidelity,
  TranslationMethod,
} from '../../../common/enums/prisma.enums';
import { findFreeSlug, slugify } from '../../../common/utils/slug';
import { normalizeContentWarnings } from '../../../common/constants/content-warnings';
import { splitStoryIntoChunks } from '../../../common/utils/story-chunks';
import {
  SEGMENTATION_SOURCE,
  compareSegmentsWithContent,
  segmentProblems,
  toStoredSegments,
} from '../../story-segmentation/story-segments';
import { ImportStoryItemDto, ImportStoriesDto } from '../dto/import-stories.dto';

/** Namespace of the deterministic group ids made from pairKey / partOf. */
export const IMPORT_ID_NAMESPACE = '6f1c9c52-3b5e-4f4f-9d39-2c1a9d0f7e11';

export type ImportItemStatus = 'created' | 'skipped' | 'error' | 'valid';

export interface ImportItemResult {
  index: number;
  title: string | null;
  language: string | null;
  status: ImportItemStatus;
  storyId?: string;
  slug?: string;
  /** Turkish, why it was skipped or failed. */
  message?: string;
  problems?: string[];
  segments?: number;
  pairKey?: string;
  partOf?: string;
  partNumber?: number;
}

export interface ImportResult {
  dryRun: boolean;
  /** Story.importBatch of the created stories (review view filter). */
  batch: string;
  total: number;
  created: number;
  skipped: number;
  errors: number;
  items: ImportItemResult[];
}

/** `<language>|<source url>|<folded title>`: the identity of an imported text. */
export function buildImportKey(language: string, sourceUrl: string | null | undefined, title: string): string {
  const url = (sourceUrl ?? '').trim().replace(/\/+$/, '');
  const folded = title.normalize('NFKC').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
  return `${language}|${url}|${folded}`;
}

export const pairGroupId = (pairKey: string) => uuidv5(`pair:${pairKey}`, IMPORT_ID_NAMESPACE);
export const partGroupIdOf = (partOf: string, language: string) =>
  uuidv5(`part:${language}:${partOf}`, IMPORT_ID_NAMESPACE);

/** Label stored on every story of an import: the one sent, else the import date. */
export function importBatchLabel(batch: string | null | undefined, now: Date = new Date()): string {
  const label = (batch ?? '').replace(/\s+/g, ' ').trim();
  return label || now.toISOString().slice(0, 10);
}

function flattenErrors(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = [];
  for (const e of errors) {
    const path = parent ? `${parent}.${e.property}` : e.property;
    for (const message of Object.values(e.constraints ?? {})) {
      out.push(e.property === 'whitelistValidation' || /should not exist/.test(message)
        ? `${path}: bilinmeyen alan.`
        : `${path}: ${message}`);
    }
    if (e.children?.length) out.push(...flattenErrors(e.children, path));
  }
  return out;
}

/**
 * Bulk import of stories (POST /admin/stories/import).
 *
 * Every story is created as a DRAFT with no LLM call and no TTS call: no
 * level or age-group assessment, no translation, no segmentation. Segments
 * prepared offline are stored as segmentation version 1 (source 'import');
 * a story without them is segmented on its first narration request.
 *
 * Idempotent: the identity of a text is language + source URL + title
 * (`importKey`, unique). A re-import of the same text, or a text that
 * already exists with the same source URL, language and title, is
 * reported as skipped and left untouched.
 *
 * Items are handled one by one: a bad item is reported with its problems
 * and the rest are imported.
 */
@Injectable()
export class AdminStoryImportService {
  private readonly logger = new Logger(AdminStoryImportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async importStories(dto: ImportStoriesDto, adminLabel?: string | null): Promise<ImportResult> {
    const dryRun = dto.dryRun === true;
    const batch = importBatchLabel(dto.batch);
    const items: ImportItemResult[] = [];
    // Identities seen earlier in this file (a dry run writes nothing).
    const seenKeys = new Set<string>();
    const seenPairs = new Set<string>();
    const seenParts = new Set<string>();

    for (const [index, raw] of dto.stories.entries()) {
      items.push(await this.importOne(index, raw, { dryRun, batch, seenKeys, seenPairs, seenParts }));
    }

    const count = (status: ImportItemStatus) => items.filter((i) => i.status === status).length;
    const result: ImportResult = {
      dryRun,
      batch,
      total: items.length,
      created: count('created'),
      skipped: count('skipped'),
      errors: count('error'),
      items,
    };
    this.logger.log(
      `AUDIT story import by ${adminLabel ?? 'unknown'}: batch="${batch}" dryRun=${dryRun} total=${result.total} ` +
        `created=${result.created} skipped=${result.skipped} errors=${result.errors}`,
    );
    return result;
  }

  private async importOne(
    index: number,
    raw: Record<string, unknown>,
    ctx: { dryRun: boolean; batch: string; seenKeys: Set<string>; seenPairs: Set<string>; seenParts: Set<string> },
  ): Promise<ImportItemResult> {
    const title = typeof raw?.title === 'string' ? raw.title : null;
    const language = typeof raw?.language === 'string' ? raw.language : null;
    const base = { index, title, language };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ...base, status: 'error', message: 'Her masal bir nesne olmalıdır.' };
    }

    const item = plainToInstance(ImportStoryItemDto, raw);
    const validationErrors = await validate(item, { whitelist: true, forbidNonWhitelisted: true });
    const problems = flattenErrors(validationErrors);
    if (problems.length > 0) {
      return { ...base, status: 'error', message: 'Geçersiz alanlar.', problems };
    }

    // Business rules that need more than one field.
    if ((item.partOf && !item.partNumber) || (!item.partOf && item.partNumber)) {
      problems.push('partOf ve partNumber birlikte gönderilmelidir.');
    }
    if (item.translatedFrom) {
      if (!item.pairKey) problems.push('translatedFrom için pairKey gereklidir (kaynak masal aynı pairKey ile aktarılır).');
      if (item.translatedFrom === item.language) problems.push('translatedFrom masalın kendi dilinden farklı olmalıdır.');
    }
    if (
      item.translationMethod === TranslationMethod.MACHINE &&
      item.textFidelity &&
      item.textFidelity !== StoryTextFidelity.TRANSLATED
    ) {
      problems.push('Makine çevirisinin metin sadakati TRANSLATED olmalıdır (alanı boş bırakabilirsiniz).');
    }
    if (item.segments) {
      problems.push(...segmentProblems(item.segments));
      const match = compareSegmentsWithContent(item.segments, item.text);
      if (!match.matches) {
        problems.push(`Segmentler masal metniyle birebir aynı değil (boşluklar hariç). İlk fark: ${match.diff}`);
      }
    }
    if (problems.length > 0) {
      return { ...base, status: 'error', message: 'Masal alınamadı.', problems };
    }

    const links = {
      ...(item.pairKey ? { pairKey: item.pairKey } : {}),
      ...(item.partOf ? { partOf: item.partOf, partNumber: item.partNumber } : {}),
      ...(item.segments ? { segments: item.segments.length } : {}),
    };

    // Idempotency: the same text (in this file or already in the catalogue).
    const importKey = buildImportKey(item.language, item.sourceUrl, item.title);
    if (ctx.seenKeys.has(importKey)) {
      return { ...base, ...links, status: 'skipped', message: 'Bu dosyada aynı masal daha önce var.' };
    }
    const existing = await this.prisma.story.findFirst({
      where: {
        OR: [
          { importKey },
          ...(item.sourceUrl
            ? [{ language: item.language, sourceUrl: item.sourceUrl, title: { equals: item.title, mode: 'insensitive' as const } }]
            : []),
        ],
      },
      select: { id: true, slug: true },
    });
    if (existing) {
      ctx.seenKeys.add(importKey);
      return {
        ...base,
        ...links,
        status: 'skipped',
        storyId: existing.id,
        slug: existing.slug ?? undefined,
        message: 'Bu masal zaten var (aynı dil, kaynak ve başlık).',
      };
    }

    const translationGroupId = item.pairKey ? pairGroupId(item.pairKey) : null;
    const partGroupId = item.partOf ? partGroupIdOf(item.partOf, item.language) : null;
    const clash = await this.findLinkClash(item, translationGroupId, partGroupId, ctx);
    if (clash) return { ...base, ...links, status: 'error', message: clash };

    const slug = await findFreeSlug(slugify(item.title), async (candidate) => {
      const hit = await this.prisma.story.findFirst({
        where: { slug: candidate, language: item.language },
        select: { id: true },
      });
      return !!hit;
    });

    ctx.seenKeys.add(importKey);
    if (translationGroupId) ctx.seenPairs.add(`${translationGroupId}|${item.language}`);
    if (partGroupId) ctx.seenParts.add(`${partGroupId}|${item.partNumber}`);

    if (ctx.dryRun) {
      return { ...base, ...links, status: 'valid', slug };
    }

    try {
      const story = await this.create(item, { importKey, slug, translationGroupId, partGroupId, batch: ctx.batch });
      return { ...base, ...links, status: 'created', storyId: story.id, slug };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = String((err.meta as any)?.target ?? '');
        if (target.includes('importKey')) {
          return { ...base, ...links, status: 'skipped', message: 'Bu masal aynı anda başka bir aktarımla eklendi.' };
        }
        return { ...base, ...links, status: 'error', message: `Benzersizlik çakışması (${target || 'bilinmiyor'}).` };
      }
      this.logger.error(`Import of item ${index} failed: ${(err as Error)?.message ?? err}`);
      return { ...base, ...links, status: 'error', message: 'Masal kaydedilemedi.' };
    }
  }

  /** A pairKey whose group already has this language, or a part number already taken. */
  private async findLinkClash(
    item: ImportStoryItemDto,
    translationGroupId: string | null,
    partGroupId: string | null,
    ctx: { seenPairs: Set<string>; seenParts: Set<string> },
  ): Promise<string | null> {
    if (translationGroupId) {
      const taken =
        ctx.seenPairs.has(`${translationGroupId}|${item.language}`) ||
        !!(await this.prisma.story.findFirst({
          where: { translationGroupId, language: item.language },
          select: { id: true },
        }));
      if (taken) return `pairKey "${item.pairKey}" için "${item.language}" dilinde zaten bir masal var.`;
    }
    if (partGroupId) {
      const taken =
        ctx.seenParts.has(`${partGroupId}|${item.partNumber}`) ||
        !!(await this.prisma.story.findFirst({
          where: { partGroupId, partNumber: item.partNumber },
          select: { id: true },
        }));
      if (taken) return `"${item.partOf}" masalının ${item.partNumber}. bölümü bu dilde zaten var.`;
    }
    return null;
  }

  private async create(
    item: ImportStoryItemDto,
    ids: { importKey: string; slug: string; translationGroupId: string | null; partGroupId: string | null; batch: string },
  ) {
    const now = new Date();
    const content = item.text.replace(/\r\n?/g, '\n').trim();
    const segments = item.segments ? toStoredSegments(item.segments) : null;
    const data: Prisma.StoryUncheckedCreateInput = {
      title: item.title.trim(),
      content,
      language: item.language,
      category: item.category as any,
      ageGroup: item.ageGroup as any,
      ageGroupSource: AgeGroupSource.MANUAL as any,
      ageGroupAssessedAt: now,
      ...(item.level
        ? {
            languageLevel: item.level as any,
            languageLevelSource: LanguageLevelSource.MANUAL as any,
            languageLevelAssessedAt: now,
          }
        : {}),
      estimatedDuration: estimateDurationMinutes(content, item.language),
      isPremium: item.isPremium ?? false,
      status: StoryStatus.DRAFT as any,
      slug: ids.slug,
      summary: item.description ?? null,
      tags: [...new Set((item.tags ?? []).map((t) => t.trim()).filter(Boolean))],
      contentWarnings: normalizeContentWarnings(item.contentWarnings),
      // Credit and rights
      authorName: item.author ?? null,
      authorDeathYear: item.authorDeathYear ?? null,
      collectorName: item.collector ?? null,
      collectorDeathYear: item.collectorDeathYear ?? null,
      translatorName: item.translator ?? null,
      translatorDeathYear: item.translatorDeathYear ?? null,
      sourceName: item.collection ?? null,
      sourceUrl: item.sourceUrl ?? null,
      sourceEdition: item.sourceEdition ?? null,
      sourceRetrievedAt: now,
      firstPublishedYear: item.firstPublishedYear ?? null,
      originalTitle: item.originalTitle ?? null,
      originalLanguage: item.originalLanguage ?? null,
      licenseName: item.licence ?? null,
      licenseUrl: item.licenceUrl ?? null,
      attribution: item.attribution ?? null,
      rightsNote: item.licenceBasis ?? null,
      rightsBasis: (item.rightsBasis ?? null) as any,
      origin: (item.origin ?? StoryOrigin.PUBLIC_DOMAIN) as any,
      textFidelity: (item.textFidelity ??
        (item.translationMethod === TranslationMethod.MACHINE || item.translatedFrom
          ? StoryTextFidelity.TRANSLATED
          : StoryTextFidelity.VERBATIM)) as any,
      translationMethod: (item.translationMethod ?? null) as any,
      // Linking
      translationGroupId: ids.translationGroupId,
      partGroupId: ids.partGroupId,
      partNumber: item.partNumber ?? null,
      // Import
      importKey: ids.importKey,
      importedAt: now,
      importBatch: ids.batch,
      ...(segments
        ? {
            preprocessedSegments: segments as any,
            preprocessedAt: now,
            preprocessedModel: SEGMENTATION_SOURCE.IMPORT,
            segmentationVersion: 1,
          }
        : {}),
    };

    return this.prisma.$transaction(async (tx) => {
      const story = await tx.story.create({ data, select: { id: true } });
      const chunks = splitStoryIntoChunks(content);
      if (chunks.length > 0) {
        await tx.storyChunk.createMany({
          data: chunks.map((chunk, chunkIndex) => ({ storyId: story.id, chunkIndex, content: chunk })),
        });
      }
      if (ids.translationGroupId) await this.linkTranslationSource(tx, story.id, item, ids.translationGroupId);
      return story;
    });
  }

  /**
   * Translation links inside a pair, in whichever order the two stories
   * arrive (same file, later batch or a later import):
   *   - this story names its source (`translatedFrom`): point at the pair
   *     member of that language when it is already there;
   *   - an imported machine translation of the pair that is still waiting
   *     for its source points at this story. The import takes only tr and
   *     en, so the other member of a pair is the source it named.
   */
  private async linkTranslationSource(
    tx: Prisma.TransactionClient,
    storyId: string,
    item: ImportStoryItemDto,
    translationGroupId: string,
  ): Promise<void> {
    if (item.translatedFrom) {
      const source = await tx.story.findFirst({
        where: { translationGroupId, language: item.translatedFrom },
        select: { id: true },
      });
      if (source) {
        await tx.story.update({ where: { id: storyId }, data: { translatedFromId: source.id } });
      }
    }
    if (item.translationMethod !== TranslationMethod.MACHINE && !item.translatedFrom) {
      await tx.story.updateMany({
        where: {
          translationGroupId,
          id: { not: storyId },
          language: { not: item.language },
          translatedFromId: null,
          translationMethod: TranslationMethod.MACHINE as any,
          importKey: { not: null },
        },
        data: { translatedFromId: storyId },
      });
    }
  }
}
