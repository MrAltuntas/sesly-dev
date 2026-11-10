import type { NarrationCacheSummary, StorySegment } from "@/types/api.types";

// Pure helpers of the segment editor and the narration cache dialog. No
// React and no runtime imports, so the file can be unit tested with
// `node --test` (see segments.test.mjs).

/** Limits of the backend (story-segments.ts). */
export const SEGMENT_MAX_CHARS = 1500;
export const PAUSE_AFTER_MAX_MS = 3000;

/** Emotions the segmentation prompt uses for bedtime stories (shown first). */
export const BEDTIME_EMOTIONS = [
    "neutral",
    "peaceful",
    "calm",
    "content",
    "curious",
    "mysterious",
    "nostalgic",
    "happy",
    "excited",
    "sad",
    "scared",
] as const;

/**
 * Joins two segment texts: a space only where neither side already has
 * whitespace (the same rule as the backend).
 */
export function joinTexts(a: string, b: string): string {
    if (!a) return b;
    if (!b) return a;
    return /\s$/.test(a) || /^\s/.test(b) ? a + b : `${a} ${b}`;
}

/**
 * Splits segment `index` at character `offset`. Both halves keep the tags;
 * the pause after the segment moves to the second half. Nothing happens
 * when the cut would leave an empty half.
 */
export function splitSegmentAt(segments: StorySegment[], index: number, offset: number): StorySegment[] {
    const seg = segments[index];
    if (!seg) return segments;
    const first = seg.text.slice(0, offset).trimEnd();
    const second = seg.text.slice(offset).trimStart();
    if (!first || !second) return segments;
    const { pauseAfterMs, ...tags } = seg;
    const next = [...segments];
    next.splice(
        index,
        1,
        { ...tags, text: first },
        { ...tags, text: second, ...(pauseAfterMs != null ? { pauseAfterMs } : {}) },
    );
    return next;
}

/**
 * Merges segment `index` with the one after it. The first keeps its tags;
 * the merged segment takes the pause of the second.
 */
export function mergeWithNext(segments: StorySegment[], index: number): StorySegment[] {
    const a = segments[index];
    const b = segments[index + 1];
    if (!a || !b) return segments;
    const merged: StorySegment = { ...a, text: joinTexts(a.text, b.text), pauseAfterMs: b.pauseAfterMs ?? null };
    const next = [...segments];
    next.splice(index, 2, merged);
    return next;
}

/** Moves segment `index` by `delta` places (clamped to the list). */
export function moveSegment(segments: StorySegment[], index: number, delta: number): StorySegment[] {
    const target = Math.min(segments.length - 1, Math.max(0, index + delta));
    if (target === index || !segments[index]) return segments;
    const next = [...segments];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    return next;
}

/** The payload of PATCH /admin/stories/:id/segments: only set fields, no empty segments. */
export function cleanSegments(segments: StorySegment[]): StorySegment[] {
    return segments
        .filter((s) => s.text.trim().length > 0)
        .map((s) => ({
            text: s.text,
            ...(s.emotion ? { emotion: s.emotion } : {}),
            ...(typeof s.speed === "number" && Number.isFinite(s.speed) ? { speed: s.speed } : {}),
            ...(typeof s.volume === "number" && Number.isFinite(s.volume) ? { volume: s.volume } : {}),
            ...(typeof s.pauseAfterMs === "number" && s.pauseAfterMs > 0
                ? { pauseAfterMs: Math.round(s.pauseAfterMs) }
                : {}),
        }));
}

/** Whether the segments read exactly the story text (whitespace ignored, as the backend checks). */
export function segmentsMatchContent(segments: StorySegment[], content: string): boolean {
    const strip = (s: string) => s.replace(/\s+/g, "");
    return strip(segments.map((s) => s.text).join("")) === strip(content);
}

/** Segments longer than the backend accepts (1-based numbers). */
export function oversizedSegments(segments: StorySegment[]): number[] {
    return segments.flatMap((s, i) => (s.text.length > SEGMENT_MAX_CHARS ? [i + 1] : []));
}

/** Turkish name of who wrote the stored segments. */
export function segmentSourceLabel(source: string | null | undefined): string {
    if (!source) return "Henüz bölünmedi (ilk seslendirme isteğinde Gemini ile bölünür)";
    if (source === "import") return "Toplu aktarımdan";
    if (source === "manual") return "Elle düzenlendi";
    if (source === "fallback-split") return "Kural tabanlı bölme (Gemini sonucu kullanılamadı)";
    return `Gemini (${source})`;
}

/** Whether clearing the cache would delete anything. */
export function cacheIsEmpty(summary: NarrationCacheSummary | null | undefined): boolean {
    return !summary || (summary.narrations === 0 && summary.audios === 0 && summary.files === 0);
}

/** One line under the cache numbers: how ready-made voice narrations are stored now. */
export function sharingNote(summary: NarrationCacheSummary): string {
    if (summary.sharingEnabled === false) {
        return "Paylaşım kapalı (Ayarlar, tts.sharePresetAudio): yeni hazır ses seslendirmeleri her kullanıcı için ayrı üretilir. Var olan paylaşılan sesler dinlenmeye devam eder.";
    }
    return "Hazır seslerle yapılan seslendirmeler paylaşılır: aynı ses ve aynı segmentlerle bir kez üretilir, bütün kullanıcılar aynı dosyayı dinler. Klon sesler kişiye özeldir.";
}

/** Text of the confirm dialog before the cache is cleared (or segments saved). */
export function cacheConfirmMessage(summary: NarrationCacheSummary, reason: "clear" | "save"): string {
    const lead =
        reason === "save"
            ? "Segmentleri kaydetmek bu masalın seslendirme önbelleğini de temizler."
            : "Bu masalın sunucudaki bütün seslendirmeleri silinecek.";
    const counts =
        `${summary.narrations} seslendirme (${summary.readyNarrations} hazır, ` +
        `${summary.generatingNarrations} hazırlanıyor), ${summary.audios} ses kaydı ve ` +
        `${summary.files} dosya silinecek.`;
    const shared =
        (summary.sharedAudios ?? 0) > 0
            ? `Bunların ${summary.sharedAudios} tanesi hazır seslerin paylaşılan kaydı; ` +
              `${summary.sharedNarrations ?? 0} seslendirme bunları kullanıyor, hepsi yeniden oluşturulacak.`
            : null;
    return [
        lead,
        counts,
        ...(shared ? [shared] : []),
        "Kullanıcılar bu masalı yeniden oluşturabilir; yeniden oluşturma kotalarından düşmez.",
        "Uygulama sesi indirmez, akışla çalar: silinen seslendirmeler kullanıcıların kütüphanesinden kalkar.",
    ].join("\n\n");
}
