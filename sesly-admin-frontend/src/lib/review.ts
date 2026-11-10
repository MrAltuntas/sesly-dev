import type {
    AdminStoriesQueryDto,
    AdminStoryIdsQueryDto,
    BulkPublishResponse,
    ImportBatchSummary,
    StoryReviewCard,
} from "@/types/api.types";
import type { StoryBrief } from "@/lib/bulk";

// Pure helpers of the review view (/stories/review). No React and no runtime
// imports, so the file can be unit tested with `node --test` (review.test.mjs).

/** Default rows per page (one of PAGE_SIZE_OPTIONS); the chosen size is kept in localStorage. */
export const REVIEW_PAGE_SIZE = 25;

export interface ReviewFilters {
    /** Story.importBatch; "" means every import. */
    batch: string;
    language: string;
    /** "" any, "no" not reviewed yet, "yes" reviewed. */
    reviewed: string;
    /** Story status (DRAFT, PUBLISHED, ARCHIVED); the review view starts on drafts. */
    status: string;
    page: number;
}

export const DEFAULT_REVIEW_FILTERS: ReviewFilters = {
    batch: "",
    language: "",
    reviewed: "",
    status: "DRAFT",
    page: 1,
};

interface ParamReader {
    get(name: string): string | null;
}

export function parseReviewFilters(params: ParamReader): ReviewFilters {
    const text = (name: string) => (params.get(name) ?? "").trim();
    const page = Number.parseInt(text("page"), 10);
    const status = text("status").toUpperCase();
    return {
        batch: text("batch").slice(0, 120),
        language: text("language").toLowerCase(),
        reviewed: ["yes", "no"].includes(text("reviewed")) ? text("reviewed") : "",
        status: ["DRAFT", "PUBLISHED", "ARCHIVED"].includes(status) ? status : "DRAFT",
        page: Number.isFinite(page) && page > 1 ? page : 1,
    };
}

export function reviewFiltersToQuery(filters: ReviewFilters): Record<string, string> {
    const query: Record<string, string> = {};
    if (filters.batch) query.batch = filters.batch;
    if (filters.language) query.language = filters.language;
    if (filters.reviewed) query.reviewed = filters.reviewed;
    if (filters.status && filters.status !== "DRAFT") query.status = filters.status;
    if (filters.page > 1) query.page = String(filters.page);
    return query;
}

export function reviewFiltersToApiParams(filters: ReviewFilters, pageSize = REVIEW_PAGE_SIZE): AdminStoriesQueryDto {
    const params: AdminStoriesQueryDto = { page: filters.page, limit: pageSize, imported: "true" };
    if (filters.batch) params.importBatch = filters.batch;
    if (filters.language) params.language = filters.language;
    if (filters.reviewed) params.reviewed = filters.reviewed === "yes" ? "true" : "false";
    if (filters.status) params.status = filters.status;
    return params;
}

/** GET /admin/stories/ids for every story of the review filters (all pages). */
export function reviewFiltersToIdParams(filters: ReviewFilters): AdminStoryIdsQueryDto {
    const params: AdminStoryIdsQueryDto = { ...reviewFiltersToApiParams(filters), view: "review" };
    delete params.page;
    delete params.limit;
    return params;
}

/** "import-batch1.json (339 masal, 12 incelendi)". */
export function batchLabel(batch: ImportBatchSummary): string {
    const name = batch.batch ?? "Etiketsiz aktarım";
    return `${name} (${batch.total} masal, ${batch.reviewed} incelendi, ${batch.published} yayında)`;
}

/** "curious 12, Masal varsayılanı 3": the emotion tags of a story, most used first. */
export function emotionLine(card: Pick<StoryReviewCard, "segments">, max = 6): string {
    const emotions = card.segments.emotions;
    const shown = emotions.slice(0, max).map((e) => `${e.label} ${e.count}`);
    const rest = emotions.length - shown.length;
    return rest > 0 ? `${shown.join(", ")} ve ${rest} duygu daha` : shown.join(", ");
}

/**
 * The selected stories split by what bulk publish (only reviewed ones) will
 * do with them. `known` holds what the panel loaded (cards of the visited
 * pages and the id list); a selected story it does not know counts in the
 * total only.
 */
export function selectionSummary(known: Iterable<StoryBrief>, selected: Set<string>) {
    const chosen = [...known].filter((c) => selected.has(c.id));
    return {
        total: selected.size,
        reviewed: chosen.filter((c) => c.reviewed).length,
        notReviewed: chosen.filter((c) => !c.reviewed).length,
        blocked: chosen.filter((c) => c.reviewed && c.publishable === false).length,
        ready: chosen.filter((c) => c.reviewed && c.publishable !== false && c.status !== "PUBLISHED").length,
    };
}

/** What the panel keeps of a review card for the bulk actions. */
export function cardBrief(card: Pick<StoryReviewCard, "id" | "title" | "status" | "reviewed" | "publishable">): StoryBrief {
    return { id: card.id, title: card.title, status: card.status, reviewed: card.reviewed, publishable: card.publishable };
}

/** One Turkish line for a bulk publish answer. */
export function publishSummary(result: BulkPublishResponse): string {
    const skipped = result.skipped.length;
    return skipped > 0
        ? `${result.published.length} masal yayınlandı, ${skipped} masal atlandı.`
        : `${result.published.length} masal yayınlandı.`;
}

/** First paragraphs of a text up to about `max` characters (word boundary, three dots). */
export function textExcerpt(content: string, max = 600): string {
    const text = content.trim();
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const space = cut.lastIndexOf(" ");
    return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}...`;
}
