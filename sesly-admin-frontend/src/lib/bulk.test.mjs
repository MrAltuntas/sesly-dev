// Unit tests for the bulk action helpers. Run with `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    BULK_BATCH_SIZE,
    BULK_REVIEW_BATCH_SIZE,
    ID_LIST_MAX,
    PAGE_SIZE_OPTIONS,
    chunk,
    failureSkips,
    mergeArchiveResults,
    mergeDeletePreviews,
    mergeDeleteResults,
    mergePublishResults,
    parsePageSize,
    progressLabel,
    progressPercent,
    publishPlan,
    readPageSize,
    reviewSummary,
    runInBatches,
    selectAllMatchingLabel,
    writePageSize,
} from "./bulk.ts";

// Characters the UI must not show (CLAUDE.md): em-dash, unicode ellipsis, arrows, bullets, stars, checkmarks, middle dot.
const FORBIDDEN = /[—…←-⇿•★☆✓✔·]/u;

test("page sizes: 25, 50, 100, 200; anything else falls back", () => {
    assert.deepEqual([...PAGE_SIZE_OPTIONS], [25, 50, 100, 200]);
    assert.equal(parsePageSize("100", 25), 100);
    assert.equal(parsePageSize(200, 25), 200);
    assert.equal(parsePageSize("201", 25), 25);
    assert.equal(parsePageSize("abc", 50), 50);
    assert.equal(parsePageSize(null, 25), 25);
    assert.equal(parsePageSize(undefined, 25), 25);
    assert.equal(BULK_BATCH_SIZE, 200);
    assert.equal(BULK_REVIEW_BATCH_SIZE, 1000);
    assert.equal(ID_LIST_MAX, 1000);
});

test("the page size is remembered; a missing or blocked storage does not break the page", () => {
    const data = new Map();
    const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
    assert.equal(readPageSize(storage, "k", 25), 25);
    writePageSize(storage, "k", 100);
    assert.equal(data.get("k"), "100");
    assert.equal(readPageSize(storage, "k", 25), 100);
    data.set("k", "7");
    assert.equal(readPageSize(storage, "k", 25), 25);

    const blocked = {
        getItem: () => {
            throw new Error("SecurityError");
        },
        setItem: () => {
            throw new Error("QuotaExceededError");
        },
    };
    assert.equal(readPageSize(blocked, "k", 50), 50);
    assert.doesNotThrow(() => writePageSize(blocked, "k", 100));
    assert.equal(readPageSize(null, "k", 25), 25);
    assert.doesNotThrow(() => writePageSize(undefined, "k", 100));
});

test("chunk splits in order, the last piece is shorter", () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([], 200), []);
    assert.deepEqual(chunk([1, 2], 0), [[1], [2]]);
    const ids = Array.from({ length: 450 }, (_, i) => `s${i}`);
    assert.deepEqual(chunk(ids, 200).map((c) => c.length), [200, 200, 50]);
});

test("runInBatches runs the pieces one after the other, records failures and reports progress", async () => {
    const ids = Array.from({ length: 5 }, (_, i) => `s${i}`);
    const seen = [];
    const progress = [];
    let running = 0;
    const { results, failures } = await runInBatches(
        ids,
        2,
        async (batch) => {
            running += 1;
            assert.equal(running, 1, "never two requests at once");
            seen.push(batch);
            await new Promise((r) => setTimeout(r, 1));
            running -= 1;
            if (batch.includes("s2")) throw new Error("ağ hatası");
            return batch.length;
        },
        (done, total) => progress.push([done, total]),
    );
    assert.deepEqual(seen, [["s0", "s1"], ["s2", "s3"], ["s4"]]);
    assert.deepEqual(results, [2, 1]);
    assert.equal(failures.length, 1);
    assert.deepEqual(failures[0].items, ["s2", "s3"]);
    assert.deepEqual(progress, [[0, 5], [2, 5], [4, 5], [5, 5]]);
    // Without a progress callback and with nothing to do.
    assert.deepEqual(await runInBatches([], 200, async () => 1), { results: [], failures: [] });
});

test("failed requests become one skip per story; publish answers merge", () => {
    const skips = failureSkips(
        [{ items: ["a", "b"], error: new Error("Zaman aşımı") }],
        (e) => e.message,
        (id) => (id === "a" ? "Tilki" : null),
    );
    assert.deepEqual(skips, [
        { storyId: "a", title: "Tilki", reason: "İstek başarısız oldu: Zaman aşımı" },
        { storyId: "b", title: null, reason: "İstek başarısız oldu: Zaman aşımı" },
    ]);
    assert.equal(failureSkips([{ items: ["c"], error: 1 }], () => "x", undefined, "İnceleme işareti kaydedilemedi")[0].reason,
        "İnceleme işareti kaydedilemedi: x");

    const merged = mergePublishResults(
        [
            { published: [{ id: "1", title: "A", language: "tr" }], skipped: [{ storyId: "2", title: "B", reason: "Zaten yayında." }] },
            { published: [{ id: "3", title: "C", language: "en" }], skipped: [] },
        ],
        skips,
    );
    assert.deepEqual(merged.published.map((p) => p.id), ["1", "3"]);
    assert.deepEqual(merged.skipped.map((s) => s.storyId), ["2", "a", "b"]);
    assert.deepEqual(mergePublishResults([]), { published: [], skipped: [] });
});

test("archive and delete answers of several batches merge", () => {
    assert.deepEqual(
        mergeArchiveResults(
            [
                { archived: [{ id: "1", title: "A", language: "tr" }], skipped: [] },
                { archived: [], skipped: [{ storyId: "2", title: "B", reason: "Zaten arşivde." }] },
            ],
            [{ storyId: "3", title: null, reason: "x" }],
        ),
        {
            archived: [{ id: "1", title: "A", language: "tr" }],
            skipped: [
                { storyId: "2", title: "B", reason: "Zaten arşivde." },
                { storyId: "3", title: null, reason: "x" },
            ],
        },
    );
    const preview = (n, extra = {}) => ({
        stories: n,
        missing: [],
        published: 1,
        narrations: 2,
        sharedAudios: 3,
        favorites: 4,
        playlistItems: 5,
        collectionLinks: 6,
        coverFiles: 7,
        titles: Array.from({ length: n }, (_, i) => ({ id: `${n}-${i}`, title: "T", language: "tr", status: "DRAFT" })),
        ...extra,
    });
    const sum = mergeDeletePreviews([preview(40), preview(30, { missing: ["gone"] })], 50);
    assert.deepEqual(
        { ...sum, titles: sum.titles.length },
        {
            stories: 70,
            missing: ["gone"],
            published: 2,
            narrations: 4,
            sharedAudios: 6,
            favorites: 8,
            playlistItems: 10,
            collectionLinks: 12,
            coverFiles: 14,
            titles: 50,
        },
    );
    assert.deepEqual(
        mergeDeleteResults(
            [
                { deleted: 2, deletedIds: ["a", "b"], failed: [], narrations: 1 },
                { deleted: 1, deletedIds: ["c"], failed: [{ storyId: "d", title: "D", reason: "x" }], narrations: 2 },
            ],
            [{ storyId: "e", title: null, reason: "y" }],
        ),
        {
            deleted: 3,
            deletedIds: ["a", "b", "c"],
            failed: [
                { storyId: "d", title: "D", reason: "x" },
                { storyId: "e", title: null, reason: "y" },
            ],
            narrations: 3,
        },
    );
});

test("publish plan: what a bulk publish will do with the selection", () => {
    const known = new Map(
        [
            { id: "ready", title: "a", status: "DRAFT", reviewed: true, publishable: true },
            { id: "unreviewed", title: "b", status: "DRAFT", reviewed: false, publishable: true },
            { id: "blocked", title: "c", status: "DRAFT", reviewed: true, publishable: false },
            { id: "live", title: "d", status: "PUBLISHED", reviewed: true, publishable: true },
            { id: "norule", title: "e", status: "ARCHIVED", reviewed: true },
        ].map((s) => [s.id, s]),
    );
    const ids = ["ready", "unreviewed", "blocked", "live", "norule", "elsewhere"];
    assert.deepEqual(publishPlan(ids, known, { requireReviewed: true }), {
        total: 6,
        willPublish: 2,
        alreadyPublished: 1,
        notReviewed: 1,
        blocked: 1,
        unknown: 1,
    });
    // Publishing without review takes the unreviewed one too.
    assert.equal(publishPlan(ids, known, { requireReviewed: false }).willPublish, 3);
    // The shortcut marks everything first: the review mark skips none.
    assert.deepEqual(publishPlan(ids, known, { requireReviewed: true, markReviewedFirst: true }), {
        total: 6,
        willPublish: 3,
        alreadyPublished: 1,
        notReviewed: 0,
        blocked: 1,
        unknown: 1,
    });
});

test("labels are Turkish, free of special characters", () => {
    assert.equal(selectAllMatchingLabel(339), "Filtredeki tümünü seç (339 masal)");
    assert.equal(selectAllMatchingLabel(1000), "Filtredeki tümünü seç (1000 masal)");
    assert.equal(selectAllMatchingLabel(1500), "Filtredeki ilk 1000 masalı seç (toplam 1500)");
    assert.equal(progressLabel(200, 339), "200 / 339 masal işlendi");
    assert.equal(progressPercent(200, 339), 59);
    assert.equal(progressPercent(5, 0), 0);
    assert.equal(progressPercent(400, 339), 100);
    assert.equal(reviewSummary(true, 10, 0, 0), "10 masal incelendi olarak işaretlendi.");
    assert.equal(
        reviewSummary(true, 8, 2, 1),
        "8 masal incelendi olarak işaretlendi, 2 masal zaten işaretliydi, 1 masal bulunamadı.",
    );
    assert.equal(reviewSummary(false, 3, 1, 0), "3 masalın inceleme işareti kaldırıldı, 1 masal zaten işaretsizdi.");
    for (const text of [
        selectAllMatchingLabel(1500),
        progressLabel(1, 2),
        reviewSummary(true, 8, 2, 1),
        reviewSummary(false, 3, 1, 1),
    ]) {
        assert.doesNotMatch(text, FORBIDDEN);
    }
});
