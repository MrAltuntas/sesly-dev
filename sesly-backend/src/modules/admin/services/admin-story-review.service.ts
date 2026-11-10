import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';
import { StoryStatus, TranslationMethod } from '../../../common/enums/prisma.enums';
import { AGE_GROUP_LABELS, STORY_CATEGORY_LABELS } from '../../../common/constants/story-labels';
import { CONTENT_WARNING_LABELS, normalizeContentWarnings } from '../../../common/constants/content-warnings';
import { SONIC3_EMOTION_LABELS_TR } from '../../tts-providers/cartesia/cartesia-emotions.constants';
import { normalizeStoredSegments } from '../../story-segmentation/story-segments';
import { COVER_CANDIDATE_SELECT, CoverCandidate, loadTaleStoryIds, sharedCoverSource } from '../../stories/story-covers';
import { coverCreditLine, readCoverCredit } from '../../stories/cover-credit';
import { missingPublishFields, publishRefusalMessage } from '../../stories/story-publish.rules';
import { storyOrderBy } from '../../stories/story-query.util';
import { TranslationRequestsService } from '../../translation-requests/translation-requests.service';
import { ADMIN_STORY_PAGE_MAX, AdminStoriesQueryDto, AdminStoryIdsQueryDto } from '../dto/admin-stories-query.dto';
import { AdminStoriesService } from './admin-stories.service';
import { pairGroupId, partGroupIdOf } from './admin-story-import.service';

export interface BulkSkip {
  storyId: string;
  title: string | null;
  /** Turkish, why nothing was done to this story. */
  reason: string;
  /** Publish rule keys (story-publish.rules.ts) when the rule refused it. */
  missing?: string[];
}

export interface StoryRef {
  id: string;
  title: string;
  language: string;
}

/** Defaults of the review list: the imported drafts. */
const REVIEW_PAGE_SIZE = 20;
const REVIEW_MAX_PAGE_SIZE = ADMIN_STORY_PAGE_MAX;

/** Most stories GET /admin/stories/ids returns ("select every matching story"). */
export const STORY_ID_LIST_MAX = 1000;
/** Rows one updateMany of the bulk review touches. */
export const BULK_REVIEW_CHUNK = 200;

/** Columns the publish rule reads (story-publish.rules.ts). */
const PUBLISH_CHECK_SELECT = {
  origin: true,
  textFidelity: true,
  rightsBasis: true,
  sourceUrl: true,
  sourceName: true,
  authorName: true,
  collectorName: true,
  attribution: true,
  licenseName: true,
} as const;

/** Columns a review card shows (the text included). */
const REVIEW_SELECT = {
  id: true,
  title: true,
  language: true,
  status: true,
  slug: true,
  content: true,
  summary: true,
  category: true,
  ageGroup: true,
  ageGroupSource: true,
  languageLevel: true,
  contentWarnings: true,
  estimatedDuration: true,
  isPremium: true,
  origin: true,
  textFidelity: true,
  rightsBasis: true,
  rightsNote: true,
  authorName: true,
  collectorName: true,
  translatorName: true,
  sourceName: true,
  sourceUrl: true,
  sourceEdition: true,
  licenseName: true,
  licenseUrl: true,
  attribution: true,
  translationMethod: true,
  translatedFromId: true,
  translationGroupId: true,
  partGroupId: true,
  partNumber: true,
  coverImageUrl: true,
  coverCredit: true,
  preprocessedSegments: true,
  preprocessedModel: true,
  segmentationVersion: true,
  importBatch: true,
  importedAt: true,
  reviewedAt: true,
  reviewedBy: true,
  publishedAt: true,
  createdAt: true,
} as const;

/** Language versions and parts: id, cover fields, group ids, part number and status. */
const MEMBER_SELECT = {
  ...COVER_CANDIDATE_SELECT,
  title: true,
  language: true,
  reviewedAt: true,
} as const;

/** Emotion tag counts of a segment list, most used first ("" = story default). */
export function emotionSummary(segments: Array<{ emotion?: string }>) {
  const counts = new Map<string, number>();
  for (const segment of segments) {
    const key = segment.emotion ?? '';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([emotion, count]) => ({
      emotion: emotion || null,
      label: emotion ? ((SONIC3_EMOTION_LABELS_TR as Record<string, string>)[emotion] ?? emotion) : 'Masal varsayılanı',
      count,
    }));
}

/**
 * Lower-case file name without extension, the way the batch images are
 * named (`<slug>.<ext>`); spaces and underscores become hyphens.
 */
export function coverMatchKey(name: string): string {
  return name
    .trim()
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .toLocaleLowerCase('tr')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** The key as it is, without a leading article, and with "the-" in front. */
export function coverKeyVariants(key: string): string[] {
  const bare = key.replace(/^(the|a|an)-/, '');
  return [...new Set([key, bare, `the-${bare}`].filter(Boolean))];
}

/**
 * The review before publishing (imported drafts), bulk publish / archive /
 * delete of the story list, and the cover matching of the bulk cover upload.
 * Single-story work (cover upload, delete) goes through AdminStoriesService,
 * so files and audio are cleaned exactly as for one story.
 */
@Injectable()
export class AdminStoryReviewService {
  private readonly logger = new Logger(AdminStoryReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stories: AdminStoriesService,
    private readonly translationRequests: TranslationRequestsService,
  ) {}

  // ---------------------------------------------------------------------
  // Review list
  // ---------------------------------------------------------------------

  /**
   * GET /admin/stories/import-batches: every import label with its counts,
   * newest import first. Stories imported before labels existed have none.
   */
  async listImportBatches() {
    const rows: Array<{ importBatch: string | null; status: string; reviewedAt: Date | null; importedAt: Date | null }> =
      (await this.prisma.story.findMany({
        where: { importedAt: { not: null } },
        select: { importBatch: true, status: true, reviewedAt: true, importedAt: true },
      })) ?? [];
    const batches = new Map<
      string,
      { batch: string | null; total: number; drafts: number; reviewed: number; published: number; firstImportedAt: Date; lastImportedAt: Date }
    >();
    for (const row of rows) {
      const key = row.importBatch ?? '';
      const at = row.importedAt as Date;
      const entry = batches.get(key) ?? {
        batch: row.importBatch,
        total: 0,
        drafts: 0,
        reviewed: 0,
        published: 0,
        firstImportedAt: at,
        lastImportedAt: at,
      };
      entry.total += 1;
      if (row.status === StoryStatus.DRAFT) entry.drafts += 1;
      if (row.status === StoryStatus.PUBLISHED) entry.published += 1;
      if (row.reviewedAt) entry.reviewed += 1;
      if (at < entry.firstImportedAt) entry.firstImportedAt = at;
      if (at > entry.lastImportedAt) entry.lastImportedAt = at;
      batches.set(key, entry);
    }
    return {
      batches: [...batches.values()].sort((a, b) => b.lastImportedAt.getTime() - a.lastImportedAt.getTime()),
    };
  }

  /**
   * GET /admin/stories/review: one card per story with what a reviewer
   * needs before publishing. Defaults: imported stories that are drafts,
   * in import order (the file keeps the languages of a tale together).
   */
  async reviewList(query: AdminStoriesQueryDto = {}) {
    const page = query.page || 1;
    const limit = Math.min(query.limit || REVIEW_PAGE_SIZE, REVIEW_MAX_PAGE_SIZE);
    const where = await this.reviewWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.story.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: this.reviewOrderBy(query),
        select: REVIEW_SELECT,
      }),
      this.prisma.story.count({ where }),
    ]);

    const members = await this.loadMembers(rows);
    const data = await Promise.all(rows.map((row) => this.toReviewCard(row, members)));
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** The review list filter: imported drafts unless the query says otherwise. */
  private reviewWhere(query: AdminStoriesQueryDto) {
    return this.stories.buildAdminWhere({
      ...query,
      imported: query.imported ?? true,
      status: query.status ?? (StoryStatus.DRAFT as any),
    });
  }

  /** Import order (the file keeps the languages of a tale together) unless a sort is asked for. */
  private reviewOrderBy(query: AdminStoriesQueryDto): any {
    return query.sort ? storyOrderBy(query.sort) : [{ createdAt: 'asc' }, { id: 'asc' }];
  }

  /**
   * GET /admin/stories/ids: every story matching the filters of the list
   * (view=review: of the review list), at most STORY_ID_LIST_MAX, in the
   * order of that view. Small rows only (no text), so the panel can select
   * "every matching story" across pages and say what a bulk publish would do.
   */
  async listIds(query: AdminStoryIdsQueryDto = {}) {
    const review = query.view === 'review';
    const where = review ? await this.reviewWhere(query) : await this.stories.buildAdminWhere(query);
    const [rows, total] = await Promise.all([
      this.prisma.story.findMany({
        where,
        take: STORY_ID_LIST_MAX,
        orderBy: review ? this.reviewOrderBy(query) : storyOrderBy(query.sort),
        select: { id: true, title: true, language: true, status: true, reviewedAt: true, ...PUBLISH_CHECK_SELECT },
      }),
      this.prisma.story.count({ where }),
    ]);
    const items = ((rows ?? []) as any[]).map((row) => ({
      id: row.id as string,
      title: row.title as string,
      language: row.language as string,
      status: row.status as string,
      reviewed: !!row.reviewedAt,
      publishable: missingPublishFields(row).length === 0,
    }));
    return { total, limit: STORY_ID_LIST_MAX, truncated: total > items.length, items };
  }

  /** Language versions and parts of a page of stories (any status), in one query. */
  private async loadMembers(rows: Array<{ translationGroupId: string | null; partGroupId: string | null }>) {
    const groups = [...new Set(rows.map((r) => r.translationGroupId).filter(Boolean) as string[])];
    const parts = [...new Set(rows.map((r) => r.partGroupId).filter(Boolean) as string[])];
    if (groups.length === 0 && parts.length === 0) return [];
    return (
      (await this.prisma.story.findMany({
        where: {
          OR: [
            ...(groups.length ? [{ translationGroupId: { in: groups } }] : []),
            ...(parts.length ? [{ partGroupId: { in: parts } }] : []),
          ],
        },
        select: MEMBER_SELECT,
      })) ?? []
    );
  }

  private async toReviewCard(row: any, members: any[]) {
    const segments = normalizeStoredSegments(row.preprocessedSegments);
    const translations = row.translationGroupId
      ? members
          .filter((m) => m.translationGroupId === row.translationGroupId && m.id !== row.id)
          .map((m) => ({ id: m.id, title: m.title, language: m.language, status: m.status, reviewed: !!m.reviewedAt }))
      : [];
    const parts = row.partGroupId
      ? members
          .filter((m) => m.partGroupId === row.partGroupId)
          .sort((a, b) => (a.partNumber ?? 0) - (b.partNumber ?? 0))
          .map((m) => ({ id: m.id, title: m.title, number: m.partNumber, status: m.status }))
      : [];
    const translatedFrom = row.translatedFromId
      ? (members.find((m) => m.id === row.translatedFromId) ?? null)
      : null;
    const borrowed = sharedCoverSource(row, members as CoverCandidate[]);
    const missing = missingPublishFields(row);
    const words = row.content.trim() ? row.content.trim().split(/\s+/).length : 0;
    // The raw segments stay out of the card (they repeat the whole text).
    const rest = { ...row };
    delete rest.preprocessedSegments;
    delete rest.coverCredit;
    const { content, coverCredit } = row;
    return {
      ...rest,
      content,
      wordCount: words,
      categoryLabel: (STORY_CATEGORY_LABELS as Record<string, string>)[row.category] ?? row.category,
      ageGroupLabel: (AGE_GROUP_LABELS as Record<string, string>)[row.ageGroup] ?? row.ageGroup,
      contentWarnings: normalizeContentWarnings(row.contentWarnings).map((key) => ({
        value: key,
        label: CONTENT_WARNING_LABELS[key],
      })),
      isMachineTranslation: row.translationMethod === TranslationMethod.MACHINE,
      translatedFrom: translatedFrom
        ? { id: translatedFrom.id, title: translatedFrom.title, language: translatedFrom.language }
        : null,
      translations,
      parts,
      segments: {
        count: segments.length,
        source: row.preprocessedModel ?? null,
        version: row.segmentationVersion ?? 0,
        emotions: emotionSummary(segments),
      },
      coverImageUrl: await this.stories.getPresignedCoverImageUrl(row),
      coverCredit: readCoverCredit(coverCredit),
      coverCreditLine: coverCreditLine(coverCredit),
      // A cover of another language or part the app shows until this one has its own.
      sharedCoverImageUrl: borrowed ? await this.stories.getPresignedCoverImageUrl(borrowed) : null,
      reviewed: !!row.reviewedAt,
      publishable: missing.length === 0,
      publishMissing: missing,
    };
  }

  /** PATCH /admin/stories/:id/review: the "İncelendi" toggle. */
  async setReviewed(storyId: string, reviewed: boolean, adminLabel?: string | null) {
    const story = await this.prisma.story.findUnique({ where: { id: storyId }, select: { id: true } });
    if (!story) throw new NotFoundException('Masal bulunamadı.');
    const updated = await this.prisma.story.update({
      where: { id: storyId },
      data: reviewed
        ? { reviewedAt: new Date(), reviewedBy: adminLabel ?? null }
        : { reviewedAt: null, reviewedBy: null },
      select: { id: true, reviewedAt: true, reviewedBy: true },
    });
    return { ...updated, reviewed: !!updated.reviewedAt };
  }

  /**
   * PATCH /admin/stories/bulk/review: the "İncelendi" mark for many stories,
   * BULK_REVIEW_CHUNK rows per update. Marking keeps the reviewer and time of
   * a story already marked; unmarking clears both.
   */
  async bulkSetReviewed(storyIds: string[], reviewed: boolean, adminLabel?: string | null) {
    const ids = [...new Set(storyIds)];
    const missing: string[] = [];
    let changed = 0;
    let found = 0;
    const now = new Date();
    for (let start = 0; start < ids.length; start += BULK_REVIEW_CHUNK) {
      const chunk = ids.slice(start, start + BULK_REVIEW_CHUNK);
      const rows: Array<{ id: string }> =
        (await this.prisma.story.findMany({ where: { id: { in: chunk } }, select: { id: true } })) ?? [];
      const present = new Set(rows.map((r) => r.id));
      missing.push(...chunk.filter((id) => !present.has(id)));
      found += present.size;
      if (present.size === 0) continue;
      const result = await this.prisma.story.updateMany({
        where: reviewed
          ? { id: { in: [...present] }, reviewedAt: null }
          : { id: { in: [...present] }, reviewedAt: { not: null } },
        data: reviewed ? { reviewedAt: now, reviewedBy: adminLabel ?? null } : { reviewedAt: null, reviewedBy: null },
      });
      changed += result.count;
    }
    this.logger.log(
      `AUDIT bulk review=${reviewed} by ${adminLabel ?? 'unknown'}: changed=${changed} unchanged=${found - changed} missing=${missing.length}`,
    );
    return { reviewed, requested: ids.length, changed, unchanged: found - changed, missing };
  }

  // ---------------------------------------------------------------------
  // Bulk actions
  // ---------------------------------------------------------------------

  private async loadForBulk(storyIds: string[]) {
    const ids = [...new Set(storyIds)];
    const rows: any[] =
      (await this.prisma.story.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          title: true,
          language: true,
          status: true,
          publishedAt: true,
          reviewedAt: true,
          ...PUBLISH_CHECK_SELECT,
        },
      })) ?? [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return { ids, byId };
  }

  /**
   * POST /admin/stories/bulk/publish. Each story is checked on its own
   * against the publish rule (CC BY included); a refused or unreviewed
   * story is reported and the others are published.
   */
  async bulkPublish(storyIds: string[], options: { requireReviewed?: boolean } = {}, adminLabel?: string | null) {
    const { ids, byId } = await this.loadForBulk(storyIds);
    const published: StoryRef[] = [];
    const skipped: BulkSkip[] = [];
    for (const id of ids) {
      const story = byId.get(id);
      if (!story) {
        skipped.push({ storyId: id, title: null, reason: 'Masal bulunamadı.' });
        continue;
      }
      if (story.status === StoryStatus.PUBLISHED) {
        skipped.push({ storyId: id, title: story.title, reason: 'Zaten yayında.' });
        continue;
      }
      if (options.requireReviewed && !story.reviewedAt) {
        skipped.push({ storyId: id, title: story.title, reason: 'İncelendi olarak işaretlenmedi.' });
        continue;
      }
      const missing = missingPublishFields(story);
      if (missing.length > 0) {
        skipped.push({
          storyId: id,
          title: story.title,
          reason: publishRefusalMessage(missing),
          missing: missing.map((m) => m.field),
        });
        continue;
      }
      // Conditional: a story changed in between keeps its new status.
      const result = await this.prisma.story.updateMany({
        where: { id, status: story.status },
        data: { status: StoryStatus.PUBLISHED as any, ...(story.publishedAt ? {} : { publishedAt: new Date() }) },
      });
      if (result.count === 0) {
        skipped.push({ storyId: id, title: story.title, reason: 'Masal bu arada değişti, yeniden deneyin.' });
        continue;
      }
      published.push({ id, title: story.title, language: story.language });
      void this.translationRequests.fulfilForStory(id);
    }
    this.logger.log(
      `AUDIT bulk publish by ${adminLabel ?? 'unknown'}: published=${published.length} skipped=${skipped.length}`,
    );
    return { published, skipped };
  }

  /** POST /admin/stories/bulk/archive. Archived stories leave every list; old favourites still open them. */
  async bulkArchive(storyIds: string[], adminLabel?: string | null) {
    const { ids, byId } = await this.loadForBulk(storyIds);
    const archived: StoryRef[] = [];
    const skipped: BulkSkip[] = [];
    for (const id of ids) {
      const story = byId.get(id);
      if (!story) skipped.push({ storyId: id, title: null, reason: 'Masal bulunamadı.' });
      else if (story.status === StoryStatus.ARCHIVED) skipped.push({ storyId: id, title: story.title, reason: 'Zaten arşivde.' });
      else archived.push({ id, title: story.title, language: story.language });
    }
    if (archived.length > 0) {
      await this.prisma.story.updateMany({
        where: { id: { in: archived.map((s) => s.id) } },
        data: { status: StoryStatus.ARCHIVED as any },
      });
    }
    this.logger.log(`AUDIT bulk archive by ${adminLabel ?? 'unknown'}: archived=${archived.length}`);
    return { archived, skipped };
  }

  /**
   * POST /admin/stories/bulk/delete-preview: what a bulk delete removes, so
   * the confirmation can name the numbers before anything is written.
   */
  async deletePreview(storyIds: string[]) {
    const ids = [...new Set(storyIds)];
    const stories: Array<{ id: string; title: string; language: string; status: string; coverImageUrl: string | null }> =
      (await this.prisma.story.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true, language: true, status: true, coverImageUrl: true },
      })) ?? [];
    const found = stories.map((s) => s.id);
    const [narrations, sharedAudios, favorites, playlistItems, collectionLinks] = found.length
      ? await Promise.all([
          this.prisma.storyNarration.count({ where: { storyId: { in: found } } }),
          this.prisma.audio.count({ where: { storyId: { in: found }, shared: true } }),
          this.prisma.favoriteStory.count({ where: { storyId: { in: found } } }),
          this.prisma.playlistItem.count({ where: { storyId: { in: found } } }),
          this.prisma.storyOnCollection.count({ where: { storyId: { in: found } } }),
        ])
      : [0, 0, 0, 0, 0];
    // A cover file goes only when no story outside the selection shows it.
    const covers = [...new Set(stories.map((s) => s.coverImageUrl).filter(Boolean) as string[])];
    let coverFiles = 0;
    for (const url of covers) {
      const others = await this.prisma.story.count({ where: { coverImageUrl: url, id: { notIn: found } } });
      if (others === 0) coverFiles += 1;
    }
    return {
      stories: found.length,
      missing: ids.filter((id) => !found.includes(id)),
      published: stories.filter((s) => s.status === StoryStatus.PUBLISHED).length,
      narrations,
      sharedAudios,
      favorites,
      playlistItems,
      collectionLinks,
      coverFiles,
      titles: stories.slice(0, 50).map((s) => ({ id: s.id, title: s.title, language: s.language, status: s.status })),
    };
  }

  /**
   * POST /admin/stories/bulk/delete (SUPER_ADMIN). Every story goes through
   * AdminStoriesService.deleteStory, so covers, shared audio and narrations
   * are cleaned exactly as for one story. The count the admin confirmed
   * must still be the count found, else nothing is deleted.
   */
  async bulkDelete(storyIds: string[], expectedCount: number, adminLabel?: string | null) {
    const preview = await this.deletePreview(storyIds);
    if (preview.stories !== expectedCount) {
      throw new ConflictException({
        code: 'BULK_DELETE_COUNT_MISMATCH',
        message: `Onaylanan sayı (${expectedCount}) ile bulunan masal sayısı (${preview.stories}) farklı. Listeyi yenileyip yeniden deneyin.`,
        found: preview.stories,
      });
    }
    const ids = [...new Set(storyIds)].filter((id) => !preview.missing.includes(id));
    const deleted: string[] = [];
    const failed: BulkSkip[] = [];
    for (const id of ids) {
      try {
        await this.stories.deleteStory(id);
        deleted.push(id);
      } catch (err) {
        const title = preview.titles.find((t) => t.id === id)?.title ?? null;
        failed.push({ storyId: id, title, reason: (err as Error)?.message || 'Masal silinemedi.' });
      }
    }
    this.logger.log(
      `AUDIT bulk delete by ${adminLabel ?? 'unknown'}: deleted=${deleted.length} failed=${failed.length} narrations=${preview.narrations}`,
    );
    return { deleted: deleted.length, deletedIds: deleted, failed, narrations: preview.narrations };
  }

  // ---------------------------------------------------------------------
  // Bulk cover upload: file name to tale
  // ---------------------------------------------------------------------

  /**
   * POST /admin/stories/covers/match. Each file name (without extension) is
   * looked up as a pairKey (translation group of the import), a partOf
   * (part group in tr or en) or a slug; then the same without a leading
   * article and with "the-" in front. Last resort: slugs that start with
   * the key (several tales: ambiguous, the admin picks). The upload goes
   * to the representative story (Turkish first, part 1) with the cover
   * applied to its whole tale.
   */
  async matchCovers(keys: string[]) {
    const results = [];
    for (const raw of keys) {
      results.push(await this.matchOne(raw));
    }
    return { results };
  }

  private async matchOne(raw: string) {
    const key = coverMatchKey(raw);
    if (!key) return { key: raw, status: 'none' as const, via: null, tale: null, candidates: [] };
    for (const variant of coverKeyVariants(key)) {
      const exact: Array<{ via: string; where: any }> = [
        { via: 'pairKey', where: { translationGroupId: pairGroupId(variant) } },
        {
          via: 'partOf',
          where: { partGroupId: { in: [partGroupIdOf(variant, 'tr'), partGroupIdOf(variant, 'en')] } },
        },
        { via: 'slug', where: { slug: variant } },
      ];
      for (const { via, where } of exact) {
        const hit = await this.prisma.story.findFirst({ where, select: { id: true } });
        if (hit) return { key, status: 'matched' as const, via, tale: await this.describeTale(hit.id), candidates: [] };
      }
    }
    // Slugs that start with the key: "woodcutter-of-gura" finds "the-woodcutter-of-gura-a-folktale-...".
    const loose: Array<{ id: string }> =
      (await this.prisma.story.findMany({
        where: { OR: coverKeyVariants(key).map((v) => ({ slug: { startsWith: `${v}-` } })) },
        select: { id: true },
        take: 20,
      })) ?? [];
    const tales: any[] = [];
    const seen = new Set<string>();
    for (const row of loose) {
      if (seen.has(row.id)) continue;
      const tale = await this.describeTale(row.id);
      for (const id of tale.storyIds) seen.add(id);
      tales.push(tale);
      if (tales.length >= 5) break;
    }
    if (tales.length === 1) return { key, status: 'matched' as const, via: 'slugPrefix', tale: tales[0], candidates: [] };
    if (tales.length > 1) return { key, status: 'ambiguous' as const, via: 'slugPrefix', tale: null, candidates: tales };
    return { key, status: 'none' as const, via: null, tale: null, candidates: [] };
  }

  /**
   * GET-like description of the tale of a story: the representative story
   * (Turkish first, then part 1), every language and part, the current cover.
   */
  async describeTale(storyId: string) {
    const start = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, translationGroupId: true, partGroupId: true },
    });
    if (!start) throw new NotFoundException('Masal bulunamadı.');
    const ids = await loadTaleStoryIds(this.prisma, start);
    const rows: any[] =
      (await this.prisma.story.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true, language: true, status: true, partNumber: true, slug: true, coverImageUrl: true, coverCredit: true },
      })) ?? [];
    const rank = (r: any) => [r.language === 'tr' ? 0 : 1, r.partNumber ?? 0, r.id];
    rows.sort((a, b) => {
      const [x, y] = [rank(a), rank(b)];
      return (x[0] as number) - (y[0] as number) || (x[1] as number) - (y[1] as number) || String(x[2]).localeCompare(String(y[2]));
    });
    const lead = rows[0] ?? { id: storyId, title: '', language: '', status: '', partNumber: null, slug: null, coverImageUrl: null };
    const withCover = rows.find((r) => r.coverImageUrl) ?? null;
    return {
      storyId: lead.id,
      title: lead.title,
      language: lead.language,
      storyIds: rows.map((r) => r.id),
      stories: rows.map((r) => ({
        id: r.id,
        title: r.title,
        language: r.language,
        status: r.status,
        partNumber: r.partNumber,
        slug: r.slug,
        hasCover: !!r.coverImageUrl,
      })),
      languages: [...new Set(rows.map((r) => r.language))],
      coverImageUrl: withCover ? await this.stories.getPresignedCoverImageUrl(withCover) : null,
      coverCreditLine: withCover ? coverCreditLine(withCover.coverCredit) : null,
    };
  }
}
