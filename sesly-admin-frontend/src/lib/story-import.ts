import type { ImportItemResult, ImportResult } from "@/types/api.types";

// Pure helpers of the bulk import page. No React and no runtime imports, so
// the file can be unit tested with `node --test` (see story-import.test.mjs).

/**
 * The backend accepts at most 300 stories and a 2 MB body per request, but
 * Cloudflare cuts any request that runs over 100 s, and checking 50 long
 * stories with their segments took longer than that in production. Small
 * batches keep every request well under the limit.
 */
export const IMPORT_BATCH_MAX_STORIES = 10;
export const IMPORT_BATCH_MAX_BYTES = 500_000;

/**
 * The answer for a batch whose request failed twice: every story of it is
 * an error with the request's message, so the run can go on with the next
 * batch and the table shows which stories to try again.
 */
export function failedBatchResult(batch: RawImportStory[], dryRun: boolean, message: string): ImportResult {
    return {
        dryRun,
        total: batch.length,
        created: 0,
        skipped: 0,
        errors: batch.length,
        items: batch.map((story, index) => ({
            index,
            title: typeof story.title === "string" ? story.title : null,
            language: typeof story.language === "string" ? story.language : null,
            status: "error" as const,
            message,
        })),
    };
}

export type RawImportStory = Record<string, unknown>;

export interface ParsedImportFile {
    stories: RawImportStory[];
    /** Turkish, why the file cannot be used (stories is then empty). */
    error: string | null;
}

/** A JSON array of stories, or `{ "stories": [...] }`. */
export function parseImportFile(text: string): ParsedImportFile {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        return { stories: [], error: `Dosya geçerli bir JSON değil: ${(e as Error).message}` };
    }
    const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { stories?: unknown }).stories)
          ? (parsed as { stories: unknown[] }).stories
          : null;
    if (!list) {
        return { stories: [], error: 'Dosya bir masal dizisi ya da { "stories": [...] } olmalı.' };
    }
    if (list.length === 0) return { stories: [], error: "Dosyada masal yok." };
    return { stories: list as RawImportStory[], error: null };
}

export interface ImportPreviewRow {
    index: number;
    title: string;
    language: string;
    category: string;
    ageGroup: string;
    words: number;
    segments: number;
    pairKey: string;
    part: string;
    /** Quick checks before the server validates everything. */
    warnings: string[];
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** One table row per story of the file, with the obvious problems flagged. */
export function previewRows(stories: RawImportStory[]): ImportPreviewRow[] {
    return stories.map((s, index) => {
        const item = s && typeof s === "object" && !Array.isArray(s) ? s : {};
        const warnings: string[] = [];
        if (!text(item.title).trim()) warnings.push("Başlık yok");
        if (!text(item.text).trim()) warnings.push("Metin yok");
        if (item.language !== "tr" && item.language !== "en") warnings.push('Dil "tr" ya da "en" olmalı');
        if (!text(item.category)) warnings.push("Kategori yok");
        if (!text(item.ageGroup)) warnings.push("Yaş grubu yok");
        if (!!item.partOf !== (item.partNumber !== undefined && item.partNumber !== null)) {
            warnings.push("partOf ile partNumber birlikte olmalı");
        }
        const segments = Array.isArray(item.segments) ? item.segments.length : 0;
        const words = text(item.text).trim() ? text(item.text).trim().split(/\s+/).length : 0;
        return {
            index,
            title: text(item.title) || "(başlıksız)",
            language: text(item.language),
            category: text(item.category),
            ageGroup: text(item.ageGroup),
            words,
            segments,
            pairKey: text(item.pairKey),
            part: item.partOf ? `${text(item.partOf)} / ${String(item.partNumber ?? "")}` : "",
            warnings,
        };
    });
}

/**
 * Splits the stories into request batches below the backend limits.
 * A single story larger than the byte limit gets a batch of its own.
 */
export function importBatches(
    stories: RawImportStory[],
    maxStories: number = IMPORT_BATCH_MAX_STORIES,
    maxBytes: number = IMPORT_BATCH_MAX_BYTES,
): RawImportStory[][] {
    const batches: RawImportStory[][] = [];
    let current: RawImportStory[] = [];
    let bytes = 0;
    for (const story of stories) {
        const size = new TextEncoder().encode(JSON.stringify(story)).length;
        if (current.length > 0 && (current.length >= maxStories || bytes + size > maxBytes)) {
            batches.push(current);
            current = [];
            bytes = 0;
        }
        current.push(story);
        bytes += size;
    }
    if (current.length > 0) batches.push(current);
    return batches;
}

/** Puts the per-batch answers together, item indices counted over the whole file. */
export function mergeImportResults(results: ImportResult[], dryRun: boolean): ImportResult {
    const items: ImportItemResult[] = [];
    let offset = 0;
    for (const r of results) {
        for (const item of r.items) items.push({ ...item, index: item.index + offset });
        offset += r.total;
    }
    const count = (status: ImportItemResult["status"]) => items.filter((i) => i.status === status).length;
    return {
        dryRun,
        total: items.length,
        created: count("created"),
        skipped: count("skipped"),
        errors: count("error"),
        items,
    };
}

export const IMPORT_STATUS_LABELS: Record<ImportItemResult["status"], string> = {
    created: "Eklendi",
    skipped: "Atlandı",
    error: "Hata",
    valid: "Uygun",
};

/** One-line Turkish summary of an import answer. */
export function importSummary(result: ImportResult): string {
    if (result.dryRun) {
        const valid = result.items.filter((i) => i.status === "valid").length;
        return `Kontrol: ${result.total} masal, ${valid} eklenebilir, ${result.skipped} zaten var, ${result.errors} hatalı.`;
    }
    return `${result.total} masal: ${result.created} eklendi, ${result.skipped} atlandı, ${result.errors} hatalı.`;
}
