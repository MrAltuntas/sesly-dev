// Unit tests for the review view helpers. Run with `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    DEFAULT_REVIEW_FILTERS,
    REVIEW_PAGE_SIZE,
    batchLabel,
    cardBrief,
    emotionLine,
    parseReviewFilters,
    publishSummary,
    reviewFiltersToApiParams,
    reviewFiltersToIdParams,
    reviewFiltersToQuery,
    selectionSummary,
    textExcerpt,
} from "./review.ts";

const params = (q) => new URLSearchParams(q);

test("filters: drafts by default, a round trip through the URL", () => {
    assert.deepEqual(parseReviewFilters(params("")), DEFAULT_REVIEW_FILTERS);
    const filters = parseReviewFilters(params("batch=import-batch1.json&language=EN&reviewed=no&status=published&page=2"));
    assert.deepEqual(filters, { batch: "import-batch1.json", language: "en", reviewed: "no", status: "PUBLISHED", page: 2 });
    assert.deepEqual(parseReviewFilters(params(new URLSearchParams(reviewFiltersToQuery(filters)).toString())), filters);
    const bad = parseReviewFilters(params("status=all&reviewed=maybe&page=x"));
    assert.equal(bad.status, "DRAFT");
    assert.equal(bad.reviewed, "");
    assert.equal(bad.page, 1);
    assert.deepEqual(reviewFiltersToQuery(bad), {});
    assert.deepEqual(reviewFiltersToQuery({ ...bad, status: "ARCHIVED" }), { status: "ARCHIVED" });
    assert.deepEqual(reviewFiltersToQuery(DEFAULT_REVIEW_FILTERS), {});
});

test("api params: always imported stories, reviewed as true/false", () => {
    assert.equal(REVIEW_PAGE_SIZE, 25);
    assert.deepEqual(reviewFiltersToApiParams(DEFAULT_REVIEW_FILTERS), { page: 1, limit: 25, imported: "true", status: "DRAFT" });
    assert.deepEqual(
        reviewFiltersToApiParams({ batch: "b", language: "tr", reviewed: "yes", status: "PUBLISHED", page: 3 }, 200),
        { page: 3, limit: 200, imported: "true", importBatch: "b", language: "tr", reviewed: "true", status: "PUBLISHED" },
    );
    assert.equal(reviewFiltersToApiParams({ ...DEFAULT_REVIEW_FILTERS, reviewed: "no" }).reviewed, "false");
});

test("id params: the review view with the same filters, every page", () => {
    assert.deepEqual(reviewFiltersToIdParams({ ...DEFAULT_REVIEW_FILTERS, batch: "a.json", reviewed: "no", page: 4 }), {
        imported: "true",
        importBatch: "a.json",
        reviewed: "false",
        status: "DRAFT",
        view: "review",
    });
});

test("labels and summaries are Turkish and free of special characters", () => {
    assert.equal(
        batchLabel({ batch: "a.json", total: 3, reviewed: 1, published: 0 }),
        "a.json (3 masal, 1 incelendi, 0 yayında)",
    );
    assert.match(batchLabel({ batch: null, total: 1, reviewed: 0, published: 0 }), /^Etiketsiz aktarım/);
    const card = {
        segments: {
            emotions: [
                { label: "Meraklı", count: 5 },
                { label: "Sakin", count: 2 },
                { label: "Masal varsayılanı", count: 1 },
            ],
        },
    };
    assert.equal(emotionLine(card), "Meraklı 5, Sakin 2, Masal varsayılanı 1");
    assert.equal(emotionLine(card, 1), "Meraklı 5 ve 2 duygu daha");
    assert.equal(publishSummary({ published: [{}, {}], skipped: [] }), "2 masal yayınlandı.");
    assert.equal(publishSummary({ published: [], skipped: [{}] }), "0 masal yayınlandı, 1 masal atlandı.");
});

test("selection summary tells what bulk publish will do, across pages", () => {
    const card = (id, reviewed, publishable, status = "DRAFT") => ({ id, reviewed, publishable, status });
    const cards = [card("a", true, true), card("b", true, false), card("c", false, true), card("d", true, true, "PUBLISHED")];
    assert.deepEqual(selectionSummary(cards, new Set(["a", "b", "c", "d", "elsewhere"])), {
        total: 5,
        reviewed: 3,
        notReviewed: 1,
        blocked: 1,
        ready: 1,
    });
    // A Map of briefs works the same; an unknown publish rule is not "blocked".
    const known = new Map([["x", { id: "x", title: "x", status: "DRAFT", reviewed: true }]]);
    assert.deepEqual(selectionSummary(known.values(), new Set(["x"])), {
        total: 1,
        reviewed: 1,
        notReviewed: 0,
        blocked: 0,
        ready: 1,
    });
    const full = { id: "a", title: "T", status: "DRAFT", reviewed: false, publishable: true, content: "uzun metin", segments: {} };
    assert.deepEqual(cardBrief(full), { id: "a", title: "T", status: "DRAFT", reviewed: false, publishable: true });
});

test("text excerpt keeps short texts and cuts long ones at a word with three dots", () => {
    assert.equal(textExcerpt("  Kısa metin. "), "Kısa metin.");
    const long = "kelime ".repeat(200);
    const cut = textExcerpt(long, 50);
    assert.ok(cut.endsWith("..."));
    assert.ok(cut.length <= 53);
    assert.equal(textExcerpt("x".repeat(100), 50), `${"x".repeat(50)}...`);
});
