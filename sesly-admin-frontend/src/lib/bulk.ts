import type {
    BulkArchiveResponse,
    BulkDeletePreview,
    BulkDeleteResponse,
    BulkPublishResponse,
    BulkSkip,
    StoryIdItem,
} from "@/types/api.types";

// Pure helpers of the bulk actions (story list and review view): page size,
// batching, what a bulk publish will do. No React and no runtime imports, so
// the file can be unit tested with `node --test` (bulk.test.mjs).

/** Rows per page the lists offer. The backend allows up to 200. */
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

/** Ids one bulk publish / archive / delete request may name (backend BULK_MAX_STORIES). */
export const BULK_BATCH_SIZE = 200;

/** Ids one bulk review request may name (backend BULK_REVIEW_MAX_STORIES). */
export const BULK_REVIEW_BATCH_SIZE = 1000;

/** Most ids "select every matching story" fetches (backend STORY_ID_LIST_MAX). */
export const ID_LIST_MAX = 1000;

/** localStorage keys of the remembered page sizes. */
export const PAGE_SIZE_KEYS = {
    stories: "sesly-admin.stories.pageSize",
    review: "sesly-admin.review.pageSize",
} as const;

/** One of PAGE_SIZE_OPTIONS, else the fallback. */
export function parsePageSize(value: unknown, fallback: number): number {
    const size = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
    return (PAGE_SIZE_OPTIONS as readonly number[]).includes(size) ? size : fallback;
}

interface KeyValueStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

/** The remembered page size; a missing, blocked or broken storage gives the fallback. */
export function readPageSize(storage: KeyValueStore | null | undefined, key: string, fallback: number): number {
    try {
        return parsePageSize(storage?.getItem(key), fallback);
    } catch {
        return fallback;
    }
}

/** Remembers the page size; a blocked storage is ignored. */
export function writePageSize(storage: KeyValueStore | null | undefined, key: string, size: number): void {
    try {
        storage?.setItem(key, String(size));
    } catch {
        // Private window or blocked site data: the size is simply not remembered.
    }
}

/** The items in pieces of at most `size`, in order. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
    const step = Math.max(1, Math.floor(size));
    const out: T[][] = [];
    for (let start = 0; start < items.length; start += step) out.push(items.slice(start, start + step));
    return out;
}

export interface BatchFailure<T> {
    items: T[];
    error: unknown;
}

/**
 * Runs `run` for each piece of `items`, one after the other. A failed piece
 * is recorded and the next one still runs, so one network error does not
 * stop a long bulk publish. `onProgress` gets the number of items done.
 */
export async function runInBatches<T, R>(
    items: readonly T[],
    size: number,
    run: (batch: T[]) => Promise<R>,
    onProgress?: (done: number, total: number) => void,
): Promise<{ results: R[]; failures: BatchFailure<T>[] }> {
    const results: R[] = [];
    const failures: BatchFailure<T>[] = [];
    let done = 0;
    onProgress?.(0, items.length);
    for (const batch of chunk(items, size)) {
        try {
            results.push(await run(batch));
        } catch (error) {
            failures.push({ items: batch, error });
        }
        done += batch.length;
        onProgress?.(done, items.length);
    }
    return { results, failures };
}

/** One skip entry per story of a failed request, with the error text. */
export function failureSkips(
    failures: BatchFailure<string>[],
    describe: (error: unknown) => string,
    titleFor?: (id: string) => string | null,
    prefix = "İstek başarısız oldu",
): BulkSkip[] {
    return failures.flatMap((failure) => {
        const reason = `${prefix}: ${describe(failure.error)}`;
        return failure.items.map((id) => ({ storyId: id, title: titleFor?.(id) ?? null, reason }));
    });
}

/** The answers of several bulk publish requests as one. */
export function mergePublishResults(results: BulkPublishResponse[], extraSkips: BulkSkip[] = []): BulkPublishResponse {
    return {
        published: results.flatMap((r) => r.published),
        skipped: [...results.flatMap((r) => r.skipped), ...extraSkips],
    };
}

/** What the panel knows about a story for a bulk action. */
export type StoryBrief = Pick<StoryIdItem, "id" | "title" | "status" | "reviewed"> & {
    /** Passes the publish rule; undefined when the panel does not know. */
    publishable?: boolean;
};

export interface PublishPlan {
    total: number;
    /** Will be published (as far as the panel knows; the backend checks each again). */
    willPublish: number;
    alreadyPublished: number;
    /** Skipped because they are not marked "İncelendi" (only with requireReviewed). */
    notReviewed: number;
    /** Fail the publish rule (missing attribution and similar). */
    blocked: number;
    /** Not loaded in the panel: the backend decides. */
    unknown: number;
}

/**
 * What a bulk publish of `ids` will do. `markReviewedFirst`: the stories are
 * marked "İncelendi" before publishing, so the review mark skips none.
 */
export function publishPlan(
    ids: readonly string[],
    known: ReadonlyMap<string, StoryBrief>,
    options: { requireReviewed: boolean; markReviewedFirst?: boolean },
): PublishPlan {
    const plan: PublishPlan = { total: ids.length, willPublish: 0, alreadyPublished: 0, notReviewed: 0, blocked: 0, unknown: 0 };
    for (const id of ids) {
        const story = known.get(id);
        if (!story) plan.unknown += 1;
        else if (story.status === "PUBLISHED") plan.alreadyPublished += 1;
        else if (options.requireReviewed && !options.markReviewedFirst && !story.reviewed) plan.notReviewed += 1;
        else if (story.publishable === false) plan.blocked += 1;
        else plan.willPublish += 1;
    }
    return plan;
}

/** "Filtredeki tümünü seç (339 masal)"; above the id list cap only the first ones are taken. */
export function selectAllMatchingLabel(total: number): string {
    return total > ID_LIST_MAX
        ? `Filtredeki ilk ${ID_LIST_MAX} masalı seç (toplam ${total})`
        : `Filtredeki tümünü seç (${total} masal)`;
}

/** "120 / 339 masal işlendi". */
export function progressLabel(done: number, total: number): string {
    return `${done} / ${total} masal işlendi`;
}

/** Percentage for a progress bar, 0 to 100. */
export function progressPercent(done: number, total: number): number {
    if (total <= 0) return 0;
    return Math.min(100, Math.round((done / total) * 100));
}

/** One Turkish line for the bulk review answer(s). */
export function reviewSummary(reviewed: boolean, changed: number, unchanged: number, missing: number): string {
    const verb = reviewed ? "incelendi olarak işaretlendi" : "masalın inceleme işareti kaldırıldı";
    const head = reviewed ? `${changed} masal ${verb}` : `${changed} ${verb}`;
    const parts = [head];
    if (unchanged > 0) parts.push(`${unchanged} masal zaten ${reviewed ? "işaretliydi" : "işaretsizdi"}`);
    if (missing > 0) parts.push(`${missing} masal bulunamadı`);
    return `${parts.join(", ")}.`;
}

/** The answers of several bulk archive requests as one. */
export function mergeArchiveResults(results: BulkArchiveResponse[], extraSkips: BulkSkip[] = []): BulkArchiveResponse {
    return {
        archived: results.flatMap((r) => r.archived),
        skipped: [...results.flatMap((r) => r.skipped), ...extraSkips],
    };
}

/** Delete previews of several batches as one confirmation (titles: the first `maxTitles`). */
export function mergeDeletePreviews(previews: BulkDeletePreview[], maxTitles = 50): BulkDeletePreview {
    const sum = (key: "stories" | "published" | "narrations" | "sharedAudios" | "favorites" | "playlistItems" | "collectionLinks" | "coverFiles") =>
        previews.reduce((n, p) => n + p[key], 0);
    return {
        stories: sum("stories"),
        missing: previews.flatMap((p) => p.missing),
        published: sum("published"),
        narrations: sum("narrations"),
        sharedAudios: sum("sharedAudios"),
        favorites: sum("favorites"),
        playlistItems: sum("playlistItems"),
        collectionLinks: sum("collectionLinks"),
        coverFiles: sum("coverFiles"),
        titles: previews.flatMap((p) => p.titles).slice(0, maxTitles),
    };
}

/** The answers of several bulk delete requests as one. */
export function mergeDeleteResults(results: BulkDeleteResponse[], extraFailures: BulkSkip[] = []): BulkDeleteResponse {
    return {
        deleted: results.reduce((n, r) => n + r.deleted, 0),
        deletedIds: results.flatMap((r) => r.deletedIds),
        failed: [...results.flatMap((r) => r.failed), ...extraFailures],
        narrations: results.reduce((n, r) => n + r.narrations, 0),
    };
}
