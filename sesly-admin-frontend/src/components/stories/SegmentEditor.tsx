"use client";

import { useRef, useState } from "react";
import {
    Wand2,
    Trash2,
    Plus,
    RotateCcw,
    ChevronDown,
    ChevronUp,
    Loader2,
    AlertCircle,
    AlertTriangle,
    Sparkles,
    Info,
    Scissors,
    Merge,
    ArrowUp,
    ArrowDown,
} from "lucide-react";
import { StorySegment } from "@/types/api.types";
import {
    SONIC3_EXTENDED_EMOTIONS,
    SONIC3_SPEED_MAX,
    SONIC3_SPEED_MIN,
    SONIC3_SPEED_STEP,
    SONIC3_VOLUME_MAX,
    SONIC3_VOLUME_MIN,
    SONIC3_VOLUME_STEP,
    emotionLabel,
} from "@/lib/cartesia-emotions";
import {
    BEDTIME_EMOTIONS,
    PAUSE_AFTER_MAX_MS,
    SEGMENT_MAX_CHARS,
    mergeWithNext,
    moveSegment,
    segmentSourceLabel,
    splitSegmentAt,
} from "@/lib/segments";
import { cn } from "@/lib/utils";

interface SegmentEditorProps {
    segments: StorySegment[];
    onChange: (segments: StorySegment[]) => void;
    onAutoSplit: () => void | Promise<void>;
    onClear: () => void | Promise<void>;
    onLlmFill?: () => void | Promise<void>;
    isAutoSplitting?: boolean;
    isClearing?: boolean;
    isLlmFilling?: boolean;
    disabled?: boolean;
    preprocessedAt?: string | null;
    /** Who wrote the stored segments: import, manual, fallback-split or a Gemini model. */
    preprocessedModel?: string | null;
    /** Story.segmentationVersion of the stored segments. */
    version?: number | null;
    /** False when the stored segments do not read the story text exactly. */
    matchesContent?: boolean;
    contentDiff?: string | null;
    llmWarnings?: string[];
}

const OTHER_EMOTIONS = SONIC3_EXTENDED_EMOTIONS.filter(
    (e) => !(BEDTIME_EMOTIONS as readonly string[]).includes(e),
);

const iconButton =
    "text-muted-foreground hover:text-primary p-1 rounded transition-colors disabled:opacity-40 disabled:hover:text-muted-foreground";

export function SegmentEditor({
    segments,
    onChange,
    onAutoSplit,
    onClear,
    onLlmFill,
    isAutoSplitting = false,
    isClearing = false,
    isLlmFilling = false,
    disabled = false,
    preprocessedAt,
    preprocessedModel,
    version,
    matchesContent = true,
    contentDiff,
    llmWarnings,
}: SegmentEditorProps) {
    const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
    const textareas = useRef<Record<number, HTMLTextAreaElement | null>>({});

    const toggleCollapsed = (index: number) => {
        setCollapsed((prev) => ({ ...prev, [index]: !prev[index] }));
    };

    const updateSegment = (index: number, patch: Partial<StorySegment>) => {
        onChange(segments.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    };

    const insertAfter = (index: number) => {
        const next = [...segments];
        next.splice(index + 1, 0, { text: "" });
        onChange(next);
    };

    const removeSegment = (index: number) => {
        onChange(segments.filter((_, i) => i !== index));
    };

    const splitAtCursor = (index: number) => {
        const el = textareas.current[index];
        const offset = el ? el.selectionStart : 0;
        onChange(splitSegmentAt(segments, index, offset));
    };

    const resetSegmentOverrides = (index: number) => {
        updateSegment(index, { emotion: null, speed: null, volume: null, pauseAfterMs: null });
    };

    const isEmpty = segments.length === 0;
    const busy = disabled || isAutoSplitting || isLlmFilling;

    return (
        <div className="border border-border rounded-lg bg-muted/10 p-4 space-y-4">
            {/* Header + actions */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h3 className="text-sm font-semibold">Segment Yönetimi</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {isEmpty
                            ? "Henüz segment yok. İlk seslendirme isteğinde masal Gemini ile otomatik bölünür ve etiketlenir."
                            : `${segments.length} segment. Her birine duygu, hız, ses düzeyi ve sonrasında ara atayabilirsin.`}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                        Kaynak: {segmentSourceLabel(preprocessedModel)}
                        {typeof version === "number" && version > 0 ? `, sürüm ${version}` : ""}
                        {preprocessedAt ? `, ${new Date(preprocessedAt).toLocaleString("tr-TR")}` : ""}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={onAutoSplit}
                        disabled={busy}
                        title="Paragraf ve cümle sınırlarından böler. Ücretsizdir, duygu etiketi koymaz."
                        className="bg-secondary hover:bg-secondary/80 text-secondary-foreground px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    >
                        {isAutoSplitting ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                            <Wand2 className="w-3.5 h-3.5" />
                        )}
                        Kural tabanlı böl (ücretsiz)
                    </button>
                    {onLlmFill && (
                        <button
                            type="button"
                            onClick={onLlmFill}
                            disabled={busy}
                            title="Masalı Gemini'ye böldür ve her segmente duygu ve hız önerisi ata"
                            className="bg-primary hover:bg-primary/90 text-white px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
                        >
                            {isLlmFilling ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <Sparkles className="w-3.5 h-3.5" />
                            )}
                            Gemini ile böl ve etiketle
                        </button>
                    )}
                    {!isEmpty && (
                        <button
                            type="button"
                            onClick={onClear}
                            disabled={disabled || isClearing}
                            className="bg-muted hover:bg-muted/80 text-muted-foreground px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
                        >
                            {isClearing ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <RotateCcw className="w-3.5 h-3.5" />
                            )}
                            Mevcut Segmentleri Sıfırla
                        </button>
                    )}
                </div>
            </div>

            {!isEmpty && !matchesContent && (
                <div className="border border-amber-500/30 bg-amber-500/10 rounded-md p-3 flex gap-2 text-xs text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                        Kayıtlı segmentler masal metniyle birebir aynı değil (boşluklar hariç). Seslendirme segmentleri okur,
                        uygulamada metin gösterilir.
                        {contentDiff && <div className="font-mono text-[11px] mt-1 break-all">{contentDiff}</div>}
                    </div>
                </div>
            )}

            {/* LLM warnings (only after a fresh fill) */}
            {llmWarnings && llmWarnings.length > 0 && (
                <div className="border border-primary/20 bg-primary/5 rounded-md p-3 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                        <Info className="w-3.5 h-3.5" />
                        LLM çıktısı üzerinde otomatik düzeltmeler yapıldı
                    </div>
                    <ul className="text-[11px] text-muted-foreground space-y-0.5 ml-5 list-disc">
                        {llmWarnings.map((w, i) => (
                            <li key={i}>{w}</li>
                        ))}
                    </ul>
                    <p className="text-[10px] text-muted-foreground italic ml-5">
                        Onaylamak için Kaydet düğmesine bas; istemediklerini elle düzelt.
                    </p>
                </div>
            )}

            {/* Empty hint */}
            {isEmpty && (
                <div className="border border-dashed border-border rounded-md p-6 text-center">
                    <AlertCircle className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Bu masal için kayıtlı segment yok.</p>
                    <p className="text-xs text-muted-foreground mt-1">
                        İlk seslendirme isteği masalı bölüp kaydeder; sonraki istekler aynı segmentleri kullanır.
                    </p>
                </div>
            )}

            {/* Segment list */}
            {!isEmpty && (
                <div className="space-y-2">
                    {segments.map((seg, idx) => {
                        const isCollapsed = collapsed[idx] ?? false;
                        const hasOverride =
                            !!seg.emotion || seg.speed != null || seg.volume != null || !!seg.pauseAfterMs;
                        const tooLong = seg.text.length > SEGMENT_MAX_CHARS;
                        return (
                            <div
                                key={idx}
                                className={cn(
                                    "border rounded-md bg-background overflow-hidden",
                                    tooLong ? "border-destructive" : "border-border",
                                )}
                            >
                                {/* Segment header */}
                                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/30 border-b border-border">
                                    <button
                                        type="button"
                                        onClick={() => toggleCollapsed(idx)}
                                        className="flex items-center gap-2 text-xs font-medium hover:text-primary transition-colors min-w-0"
                                    >
                                        {isCollapsed ? (
                                            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                                        ) : (
                                            <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                                        )}
                                        <span className="font-mono">#{idx + 1}</span>
                                        {seg.emotion && (
                                            <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded">
                                                {emotionLabel(seg.emotion)}
                                            </span>
                                        )}
                                        {!!seg.pauseAfterMs && (
                                            <span className="text-[10px] bg-secondary/40 px-1.5 py-0.5 rounded">
                                                ara {seg.pauseAfterMs} ms
                                            </span>
                                        )}
                                        <span className="text-muted-foreground font-normal truncate max-w-[40ch]">
                                            {seg.text.slice(0, 60) || "(boş)"}
                                            {seg.text.length > 60 ? "..." : ""}
                                        </span>
                                    </button>
                                    <div className="flex items-center gap-0.5 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => onChange(moveSegment(segments, idx, -1))}
                                            disabled={disabled || idx === 0}
                                            title="Yukarı taşı"
                                            className={iconButton}
                                        >
                                            <ArrowUp className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onChange(moveSegment(segments, idx, 1))}
                                            disabled={disabled || idx === segments.length - 1}
                                            title="Aşağı taşı"
                                            className={iconButton}
                                        >
                                            <ArrowDown className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => splitAtCursor(idx)}
                                            disabled={disabled || isCollapsed}
                                            title="İmlecin olduğu yerden ikiye böl"
                                            className={iconButton}
                                        >
                                            <Scissors className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onChange(mergeWithNext(segments, idx))}
                                            disabled={disabled || idx === segments.length - 1}
                                            title="Sonraki segmentle birleştir"
                                            className={iconButton}
                                        >
                                            <Merge className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => insertAfter(idx)}
                                            disabled={disabled}
                                            title="Bu segmentten sonra yeni segment ekle"
                                            className={iconButton}
                                        >
                                            <Plus className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => removeSegment(idx)}
                                            disabled={disabled}
                                            title="Bu segmenti sil"
                                            className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors disabled:opacity-50"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>

                                {/* Segment body */}
                                {!isCollapsed && (
                                    <div className="p-3 space-y-3">
                                        <textarea
                                            ref={(el) => {
                                                textareas.current[idx] = el;
                                            }}
                                            value={seg.text}
                                            onChange={(e) => updateSegment(idx, { text: e.target.value })}
                                            rows={3}
                                            disabled={disabled}
                                            className="w-full bg-background border border-border rounded-md p-2 text-sm leading-relaxed resize-y focus:ring-2 focus:ring-primary focus:outline-none disabled:opacity-50"
                                            placeholder="Segment metni..."
                                        />
                                        <div
                                            className={cn(
                                                "text-[10px] text-right -mt-2",
                                                tooLong ? "text-destructive" : "text-muted-foreground",
                                            )}
                                        >
                                            {seg.text.length} / {SEGMENT_MAX_CHARS} karakter
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                                            {/* Emotion */}
                                            <div>
                                                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                                                    Duygu
                                                </label>
                                                <select
                                                    value={seg.emotion ?? ""}
                                                    onChange={(e) =>
                                                        updateSegment(idx, { emotion: e.target.value || null })
                                                    }
                                                    disabled={disabled}
                                                    className={cn(
                                                        "w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs focus:ring-2 focus:ring-primary focus:outline-none disabled:opacity-50",
                                                        seg.emotion ? "text-foreground" : "text-muted-foreground italic",
                                                    )}
                                                >
                                                    <option value="">Varsayılanı kullan</option>
                                                    <optgroup label="Uyku masalı için önerilen">
                                                        {BEDTIME_EMOTIONS.map((emotion) => (
                                                            <option key={emotion} value={emotion}>
                                                                {emotionLabel(emotion)}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                    <optgroup label="Diğer">
                                                        {OTHER_EMOTIONS.map((emotion) => (
                                                            <option key={emotion} value={emotion}>
                                                                {emotionLabel(emotion)}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                </select>
                                            </div>

                                            {/* Speed */}
                                            <div>
                                                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                                                    Hız ({SONIC3_SPEED_MIN}-{SONIC3_SPEED_MAX})
                                                </label>
                                                <input
                                                    type="number"
                                                    step={SONIC3_SPEED_STEP}
                                                    min={SONIC3_SPEED_MIN}
                                                    max={SONIC3_SPEED_MAX}
                                                    value={seg.speed ?? ""}
                                                    onChange={(e) => {
                                                        const raw = e.target.value;
                                                        updateSegment(idx, { speed: raw === "" ? null : parseFloat(raw) });
                                                    }}
                                                    disabled={disabled}
                                                    placeholder="varsayılan"
                                                    className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs focus:ring-2 focus:ring-primary focus:outline-none disabled:opacity-50"
                                                />
                                            </div>

                                            {/* Volume */}
                                            <div>
                                                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                                                    Ses Seviyesi ({SONIC3_VOLUME_MIN}-{SONIC3_VOLUME_MAX})
                                                </label>
                                                <input
                                                    type="number"
                                                    step={SONIC3_VOLUME_STEP}
                                                    min={SONIC3_VOLUME_MIN}
                                                    max={SONIC3_VOLUME_MAX}
                                                    value={seg.volume ?? ""}
                                                    onChange={(e) => {
                                                        const raw = e.target.value;
                                                        updateSegment(idx, { volume: raw === "" ? null : parseFloat(raw) });
                                                    }}
                                                    disabled={disabled}
                                                    placeholder="varsayılan"
                                                    className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs focus:ring-2 focus:ring-primary focus:outline-none disabled:opacity-50"
                                                />
                                            </div>

                                            {/* Pause after */}
                                            <div>
                                                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                                                    Sonrasında ara (ms, en fazla {PAUSE_AFTER_MAX_MS})
                                                </label>
                                                <input
                                                    type="number"
                                                    step={100}
                                                    min={0}
                                                    max={PAUSE_AFTER_MAX_MS}
                                                    value={seg.pauseAfterMs ?? ""}
                                                    onChange={(e) => {
                                                        const raw = e.target.value;
                                                        updateSegment(idx, {
                                                            pauseAfterMs: raw === "" ? null : parseInt(raw, 10),
                                                        });
                                                    }}
                                                    disabled={disabled}
                                                    placeholder="yok"
                                                    className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs focus:ring-2 focus:ring-primary focus:outline-none disabled:opacity-50"
                                                />
                                            </div>
                                        </div>

                                        {hasOverride && (
                                            <button
                                                type="button"
                                                onClick={() => resetSegmentOverrides(idx)}
                                                disabled={disabled}
                                                className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline disabled:opacity-50"
                                            >
                                                Bu segmentin özel ayarlarını sıfırla
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
