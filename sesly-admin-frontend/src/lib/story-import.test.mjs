// Unit tests for the bulk import helpers. Run with `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    IMPORT_BATCH_MAX_BYTES,
    IMPORT_BATCH_MAX_STORIES,
    IMPORT_STATUS_LABELS,
    failedBatchResult,
    importBatches,
    importSummary,
    mergeImportResults,
    parseImportFile,
    previewRows,
} from "./story-import.ts";

const story = (overrides = {}) => ({
    title: "Tavşan",
    language: "tr",
    text: "Bir varmış bir yokmuş.",
    category: "BEDTIME",
    ageGroup: "THREE_TO_SIX",
    ...overrides,
});

test("parseImportFile accepts an array or { stories }", () => {
    assert.deepEqual(parseImportFile(JSON.stringify([story()])), { stories: [story()], error: null });
    assert.deepEqual(parseImportFile(JSON.stringify({ stories: [story()] })).stories, [story()]);
});

test("parseImportFile explains what is wrong", () => {
    assert.match(parseImportFile("{nope").error, /geçerli bir JSON değil/);
    assert.match(parseImportFile('{"a":1}').error, /masal dizisi/);
    assert.match(parseImportFile("null").error, /masal dizisi/);
    assert.equal(parseImportFile("[]").error, "Dosyada masal yok.");
});

test("previewRows counts words and segments and flags obvious problems", () => {
    const rows = previewRows([
        story({ segments: [{ text: "a" }, { text: "b" }], pairKey: "tavsan", partOf: "tavsan", partNumber: 2 }),
        { language: "de", partOf: "x" },
        null,
    ]);
    assert.deepEqual(rows[0], {
        index: 0,
        title: "Tavşan",
        language: "tr",
        category: "BEDTIME",
        ageGroup: "THREE_TO_SIX",
        words: 4,
        segments: 2,
        pairKey: "tavsan",
        part: "tavsan / 2",
        warnings: [],
    });
    assert.deepEqual(rows[1].warnings, [
        "Başlık yok",
        "Metin yok",
        'Dil "tr" ya da "en" olmalı',
        "Kategori yok",
        "Yaş grubu yok",
        "partOf ile partNumber birlikte olmalı",
    ]);
    assert.equal(rows[1].title, "(başlıksız)");
    assert.equal(rows[1].words, 0);
    assert.equal(rows[2].warnings.length, 5);
});

test("importBatches respects the count and the byte limit", () => {
    const many = Array.from({ length: 7 }, (_, i) => story({ title: `T${i}` }));
    assert.deepEqual(importBatches(many, 3).map((b) => b.length), [3, 3, 1]);
    const big = [story({ text: "x".repeat(600) }), story({ text: "y".repeat(600) }), story()];
    assert.deepEqual(importBatches(big, 50, 900).map((b) => b.length), [1, 2]);
    assert.deepEqual(importBatches([]), []);
});

test("mergeImportResults renumbers items over the whole file and recounts", () => {
    const a = {
        dryRun: false,
        total: 2,
        created: 1,
        skipped: 1,
        errors: 0,
        items: [
            { index: 0, title: "a", language: "tr", status: "created" },
            { index: 1, title: "b", language: "tr", status: "skipped" },
        ],
    };
    const b = { ...a, total: 1, items: [{ index: 0, title: "c", language: "en", status: "error" }] };
    const merged = mergeImportResults([a, b], false);
    assert.deepEqual(merged.items.map((i) => i.index), [0, 1, 2]);
    assert.deepEqual([merged.total, merged.created, merged.skipped, merged.errors], [3, 1, 1, 1]);
    assert.equal(importSummary(merged), "3 masal: 1 eklendi, 1 atlandı, 1 hatalı.");
});

test("dry run summary and status labels are Turkish", () => {
    const dry = mergeImportResults(
        [{ dryRun: true, total: 2, created: 0, skipped: 0, errors: 1, items: [
            { index: 0, title: "a", language: "tr", status: "valid" },
            { index: 1, title: "b", language: "tr", status: "error" },
        ] }],
        true,
    );
    assert.equal(importSummary(dry), "Kontrol: 2 masal, 1 eklenebilir, 0 zaten var, 1 hatalı.");
    assert.deepEqual(IMPORT_STATUS_LABELS, { created: "Eklendi", skipped: "Atlandı", error: "Hata", valid: "Uygun" });
});

test("failedBatchResult marks every story of a failed batch as an error", () => {
    const r = failedBatchResult([{ title: "Bir", language: "tr" }, { title: 3 }], true, "Zaman aşımı");
    assert.equal(r.total, 2);
    assert.equal(r.errors, 2);
    assert.deepEqual(r.items.map((i) => [i.index, i.title, i.language, i.status, i.message]), [
        [0, "Bir", "tr", "error", "Zaman aşımı"],
        [1, null, null, "error", "Zaman aşımı"],
    ]);
    // Merged after good batches, its items keep their place in the file.
    const merged = mergeImportResults(
        [{ dryRun: true, total: 1, created: 0, skipped: 0, errors: 0, items: [{ index: 0, title: "A", language: "tr", status: "valid" }] }, r],
        true,
    );
    assert.deepEqual(merged.items.map((i) => i.index), [0, 1, 2]);
    assert.equal(merged.errors, 2);
});

test("batches stay small enough for the 100 s gateway limit", () => {
    assert.equal(IMPORT_BATCH_MAX_STORIES, 10);
    assert.ok(IMPORT_BATCH_MAX_BYTES <= 500_000);
});
