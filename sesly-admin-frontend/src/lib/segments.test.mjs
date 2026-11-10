// Unit tests for the segment editor helpers. Run with `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    BEDTIME_EMOTIONS,
    cacheConfirmMessage,
    cacheIsEmpty,
    cleanSegments,
    joinTexts,
    mergeWithNext,
    moveSegment,
    oversizedSegments,
    segmentSourceLabel,
    segmentsMatchContent,
    sharingNote,
    splitSegmentAt,
} from "./segments.ts";

const segs = () => [
    { text: "Bir varmış. Bir yokmuş.", emotion: "calm", speed: 0.8, pauseAfterMs: 500 },
    { text: "Tavşan uyudu.", emotion: "peaceful" },
    { text: "Son." },
];

test("joinTexts adds a space only where neither side has whitespace", () => {
    assert.equal(joinTexts("a.", "b."), "a. b.");
    assert.equal(joinTexts("a. ", "b."), "a. b.");
    assert.equal(joinTexts("", "b"), "b");
    assert.equal(joinTexts("a", ""), "a");
});

test("splitSegmentAt keeps the tags on both halves and moves the pause to the second", () => {
    const next = splitSegmentAt(segs(), 0, 12);
    assert.deepEqual(next.slice(0, 2), [
        { text: "Bir varmış.", emotion: "calm", speed: 0.8 },
        { text: "Bir yokmuş.", emotion: "calm", speed: 0.8, pauseAfterMs: 500 },
    ]);
    assert.equal(next.length, 4);
});

test("splitSegmentAt does nothing at an edge or for a missing segment", () => {
    const list = segs();
    assert.equal(splitSegmentAt(list, 0, 0), list);
    assert.equal(splitSegmentAt(list, 0, list[0].text.length), list);
    assert.equal(splitSegmentAt(list, 9, 3), list);
    // A segment without a pause stays without one.
    assert.deepEqual(splitSegmentAt(list, 1, 7)[2], { text: "uyudu.", emotion: "peaceful" });
});

test("mergeWithNext keeps the first tags and takes the second pause", () => {
    const next = mergeWithNext(segs(), 0);
    assert.deepEqual(next[0], {
        text: "Bir varmış. Bir yokmuş. Tavşan uyudu.",
        emotion: "calm",
        speed: 0.8,
        pauseAfterMs: null,
    });
    assert.equal(next.length, 2);
    const list = segs();
    assert.equal(mergeWithNext(list, 2), list);
});

test("moveSegment moves within bounds", () => {
    const list = segs();
    assert.deepEqual(moveSegment(list, 2, -1).map((s) => s.text), ["Bir varmış. Bir yokmuş.", "Son.", "Tavşan uyudu."]);
    assert.equal(moveSegment(list, 0, -1), list);
    assert.equal(moveSegment(list, 2, 5), list);
    assert.equal(moveSegment(list, 7, 1), list);
});

test("cleanSegments drops empty segments and unset tags", () => {
    assert.deepEqual(
        cleanSegments([
            { text: "a", emotion: "", speed: null, volume: Number.NaN, pauseAfterMs: 0 },
            { text: "  " },
            { text: "b", emotion: "sad", speed: 0.9, volume: 1.1, pauseAfterMs: 400.6 },
        ]),
        [{ text: "a" }, { text: "b", emotion: "sad", speed: 0.9, volume: 1.1, pauseAfterMs: 401 }],
    );
});

test("oversizedSegments and segmentsMatchContent", () => {
    assert.deepEqual(oversizedSegments([{ text: "a" }, { text: "x".repeat(1501) }]), [2]);
    assert.equal(segmentsMatchContent(segs(), "Bir varmış. Bir yokmuş.\n\nTavşan uyudu. Son."), true);
    assert.equal(segmentsMatchContent(segs(), "Başka bir metin."), false);
});

test("segmentSourceLabel names every source in Turkish", () => {
    assert.match(segmentSourceLabel(null), /Henüz bölünmedi/);
    assert.equal(segmentSourceLabel("import"), "Toplu aktarımdan");
    assert.equal(segmentSourceLabel("manual"), "Elle düzenlendi");
    assert.match(segmentSourceLabel("fallback-split"), /Kural tabanlı/);
    assert.equal(segmentSourceLabel("gemini-3-flash-preview"), "Gemini (gemini-3-flash-preview)");
});

test("cache helpers: empty check and the confirm text with the numbers", () => {
    const summary = {
        storyId: "s",
        segmentationVersion: 2,
        narrations: 3,
        readyNarrations: 2,
        generatingNarrations: 1,
        audios: 3,
        staleAudios: 1,
        files: 4,
    };
    assert.equal(cacheIsEmpty(null), true);
    assert.equal(cacheIsEmpty({ ...summary, narrations: 0, audios: 0, files: 0 }), true);
    assert.equal(cacheIsEmpty(summary), false);
    const clear = cacheConfirmMessage(summary, "clear");
    assert.match(clear, /3 seslendirme \(2 hazır, 1 hazırlanıyor\), 3 ses kaydı ve 4 dosya silinecek/);
    assert.match(clear, /kotalarından düşmez/);
    assert.match(cacheConfirmMessage(summary, "save"), /^Segmentleri kaydetmek/);
    // No em dash, ellipsis character or arrows in UI copy.
    assert.doesNotMatch(clear + cacheConfirmMessage(summary, "save"), /[\u2014\u2026\u2192]/);
});

test("cache helpers: shared ready-made voice audio in the confirm text and the sharing note", () => {
    const summary = {
        storyId: "s",
        segmentationVersion: 2,
        narrations: 5,
        readyNarrations: 5,
        generatingNarrations: 0,
        audios: 2,
        sharedAudios: 1,
        sharedNarrations: 4,
        sharingEnabled: true,
        staleAudios: 0,
        files: 2,
    };
    const clear = cacheConfirmMessage(summary, "clear");
    assert.match(clear, /1 tanesi hazır seslerin paylaşılan kaydı; 4 seslendirme bunları kullanıyor/);
    assert.doesNotMatch(cacheConfirmMessage({ ...summary, sharedAudios: 0 }, "clear"), /paylaşılan/);
    assert.match(sharingNote(summary), /bir kez üretilir/);
    assert.match(sharingNote({ ...summary, sharingEnabled: false }), /Paylaşım kapalı/);
    assert.doesNotMatch(clear + sharingNote(summary) + sharingNote({ ...summary, sharingEnabled: false }), /[\u2014\u2026\u2192]/);
});

test("the bedtime emotions are the segmentation prompt list", () => {
    assert.equal(BEDTIME_EMOTIONS.length, 11);
    assert.ok(BEDTIME_EMOTIONS.includes("peaceful"));
});
