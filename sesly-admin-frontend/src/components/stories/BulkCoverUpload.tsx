"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
    AlertTriangle,
    CheckCircle2,
    FolderOpen,
    ImageUp,
    Loader2,
    Search,
    Upload,
    XCircle,
} from "lucide-react";
import { StoriesService } from "@/services/admin.service";
import type { AdminStoryListItem, CoverCredit, CoverMatchResult, CoverTale } from "@/types/api.types";
import { getErrorMessage } from "@/components/ui/error-state";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import {
    COVER_MAX_BYTES,
    CoverFilePair,
    coverCreditLine,
    pairCoverFiles,
    parseCoverCreditText,
} from "@/lib/covers";
import { inputClass } from "./form-fields";

/** The match endpoint takes at most this many names per request. */
const MATCH_CHUNK = 300;

interface Target {
    storyId: string;
    title: string;
    languages: string[];
    storyCount: number;
    coverImageUrl: string | null;
}

interface Row {
    key: string;
    pair: CoverFilePair<File>;
    preview: string;
    credit: CoverCredit | null;
    creditError: string | null;
    match: CoverMatchResult | null;
    target: Target | null;
    include: boolean;
    /** Another row already goes to the same tale. */
    duplicate: boolean;
    state: "idle" | "uploading" | "done" | "failed";
    message?: string;
}

const taleTarget = (tale: CoverTale): Target => ({
    storyId: tale.storyId,
    title: tale.title,
    languages: tale.languages,
    storyCount: tale.storyIds.length,
    coverImageUrl: tale.coverImageUrl,
});

const VIA_LABELS: Record<string, string> = {
    pairKey: "eşleşme anahtarı (pairKey)",
    partOf: "bölüm anahtarı (partOf)",
    slug: "kısa ad (slug)",
    slugPrefix: "kısa adın başı",
};

function StorySearch({ onPick }: { onPick: (target: Target) => void }) {
    const [q, setQ] = useState("");
    const [hits, setHits] = useState<AdminStoryListItem[]>([]);
    const [busy, setBusy] = useState(false);

    const search = async () => {
        if (!q.trim()) return;
        setBusy(true);
        try {
            const res = await StoriesService.getAll({ q: q.trim(), limit: 6, page: 1 });
            setHits(res.data.data ?? []);
        } catch {
            setHits([]);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-1">
            <div className="flex gap-1">
                <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") search();
                    }}
                    placeholder="Masal ara"
                    className={`${inputClass} text-xs py-1`}
                />
                <button
                    type="button"
                    onClick={search}
                    aria-label="Masal ara"
                    className="px-2 rounded-md border border-border hover:bg-muted"
                >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                </button>
            </div>
            {hits.map((story) => (
                <button
                    key={story.id}
                    type="button"
                    onClick={() =>
                        onPick({
                            storyId: story.id,
                            title: story.title,
                            languages: story.groupLanguages ?? [story.language],
                            storyCount: (story.translations?.length ?? 0) + 1,
                            coverImageUrl: story.coverImageUrl ?? null,
                        })
                    }
                    className="block w-full text-left text-xs px-2 py-1 rounded hover:bg-muted"
                >
                    {story.title} <span className="uppercase text-muted-foreground">{story.language}</span>
                </button>
            ))}
        </div>
    );
}

interface Props {
    /** Files already chosen elsewhere (the import page's image folder). */
    initialFiles?: File[];
    /** Called after an upload round with the number of covers written. */
    onUploaded?: (count: number) => void;
}

/**
 * Bulk cover upload: drop many pictures at once (and their
 * `<slug>.credit.json`). Each file is matched to a tale by its name (the
 * pairKey, the partOf or the slug); the preview shows the match, the credit
 * and the current cover before anything is uploaded. Every upload goes to
 * the whole tale unless "Bu kapağı tüm dillere ve bölümlere uygula" is off.
 */
export function BulkCoverUpload({ initialFiles, onUploaded }: Props) {
    const toast = useToast();
    const [rows, setRows] = useState<Row[]>([]);
    const [notes, setNotes] = useState<string[]>([]);
    const [matching, setMatching] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [applyToTale, setApplyToTale] = useState(true);
    const [dragOver, setDragOver] = useState(false);
    const previews = useRef<string[]>([]);
    const seededRef = useRef(false);

    useEffect(
        () => () => {
            for (const url of previews.current) URL.revokeObjectURL(url);
        },
        [],
    );

    const load = useCallback(
        async (files: File[]) => {
            for (const url of previews.current) URL.revokeObjectURL(url);
            previews.current = [];
            const { pairs, unusedCredits, ignored } = pairCoverFiles(files);
            const tooBig = pairs.filter((p) => p.image.size > COVER_MAX_BYTES);
            const usable = pairs.filter((p) => p.image.size <= COVER_MAX_BYTES);
            setNotes([
                ...tooBig.map((p) => `${p.image.name}: 10 MB sınırını aşıyor, atlandı.`),
                ...unusedCredits.map((f) => `${f.name}: aynı adla bir resim yok.`),
                ...ignored.map((i) => `${i.file.name}: ${i.reason}`),
            ]);
            const base: Row[] = await Promise.all(
                usable.map(async (pair) => {
                    const preview = URL.createObjectURL(pair.image);
                    previews.current.push(preview);
                    const parsed = pair.credit ? parseCoverCreditText(await pair.credit.text()) : { credit: null, error: null };
                    return {
                        key: pair.key,
                        pair,
                        preview,
                        credit: parsed.credit,
                        creditError: parsed.error,
                        match: null,
                        target: null,
                        include: false,
                        duplicate: false,
                        state: "idle" as const,
                    };
                }),
            );
            setRows(base);
            if (base.length === 0) return;

            setMatching(true);
            try {
                const results: CoverMatchResult[] = [];
                for (let i = 0; i < base.length; i += MATCH_CHUNK) {
                    const res = await StoriesService.matchCovers(base.slice(i, i + MATCH_CHUNK).map((r) => r.key));
                    results.push(...res.data.results);
                }
                const seen = new Set<string>();
                setRows(
                    base.map((row, index) => {
                        const match = results[index] ?? null;
                        const target = match?.tale ? taleTarget(match.tale) : null;
                        const duplicate = !!target && seen.has(target.storyId);
                        if (target) seen.add(target.storyId);
                        return { ...row, match, target, duplicate, include: !!target && !duplicate };
                    }),
                );
            } catch (e) {
                toast.error(getErrorMessage(e, "Dosya adları masallarla eşleştirilemedi."));
            } finally {
                setMatching(false);
            }
        },
        [toast],
    );

    useEffect(() => {
        if (seededRef.current || !initialFiles || initialFiles.length === 0) return;
        seededRef.current = true;
        void load(initialFiles);
    }, [initialFiles, load]);

    const onFiles = (e: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (files.length > 0) void load(files);
    };

    const onDrop = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOver(false);
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length > 0) void load(files);
    };

    const update = (key: string, change: Partial<Row>) =>
        setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...change } : row)));

    const chosen = useMemo(() => rows.filter((r) => r.include && r.target && r.state !== "done"), [rows]);
    const counts = useMemo(
        () => ({
            matched: rows.filter((r) => r.match?.status === "matched").length,
            ambiguous: rows.filter((r) => r.match?.status === "ambiguous").length,
            none: rows.filter((r) => r.match?.status === "none").length,
            withCredit: rows.filter((r) => r.credit).length,
            replacing: chosen.filter((r) => r.target?.coverImageUrl).length,
        }),
        [rows, chosen],
    );

    const uploadAll = async () => {
        if (chosen.length === 0) return;
        setUploading(true);
        let done = 0;
        for (const row of chosen) {
            update(row.key, { state: "uploading", message: undefined });
            try {
                const res = await StoriesService.setCover(row.target!.storyId, row.pair.image, {
                    coverCredit: row.credit,
                    applyCoverToTale: applyToTale,
                });
                done += 1;
                update(row.key, {
                    state: "done",
                    message: res.data.appliedTo > 1 ? `${res.data.appliedTo} masala uygulandı.` : "Yüklendi.",
                });
            } catch (e) {
                update(row.key, { state: "failed", message: getErrorMessage(e, "Yüklenemedi.") });
            }
        }
        setUploading(false);
        if (done > 0) toast.success(`${done} kapak yüklendi.`);
        if (done < chosen.length) toast.error(`${chosen.length - done} kapak yüklenemedi.`);
        onUploaded?.(done);
    };

    const folderProps = { webkitdirectory: "", directory: "" } as Record<string, string>;

    return (
        <div className="space-y-4">
            <div
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={cn(
                    "border-2 border-dashed rounded-xl p-6 text-center text-sm text-muted-foreground transition-colors",
                    dragOver ? "border-primary bg-primary/5" : "border-border",
                )}
            >
                <ImageUp className="w-8 h-8 mx-auto mb-2" />
                <p>
                    Resimleri ve yanlarındaki <span className="font-mono">.credit.json</span> dosyalarını buraya bırak. Dosya
                    adı masalın eşleşme anahtarı (pairKey), bölüm anahtarı (partOf) ya da kısa adı olmalı, örneğin{" "}
                    <span className="font-mono">little-idas-flowers.jpg</span>.
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-md text-xs font-medium cursor-pointer hover:bg-muted text-foreground">
                        <Upload className="w-3.5 h-3.5" /> Dosya seç
                        <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/json,.json" className="hidden" onChange={onFiles} />
                    </label>
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-md text-xs font-medium cursor-pointer hover:bg-muted text-foreground">
                        <FolderOpen className="w-3.5 h-3.5" /> Klasör seç
                        <input type="file" multiple className="hidden" onChange={onFiles} {...folderProps} />
                    </label>
                </div>
            </div>

            {notes.length > 0 && (
                <div className="border border-amber-500/30 bg-amber-500/5 rounded-md p-3 text-xs space-y-1">
                    <div className="font-semibold text-amber-500 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> Kullanılmayan dosyalar ({notes.length})
                    </div>
                    <ul className="list-disc ml-5 text-muted-foreground max-h-32 overflow-y-auto">
                        {notes.map((n) => (
                            <li key={n}>{n}</li>
                        ))}
                    </ul>
                </div>
            )}

            {rows.length > 0 && (
                <>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                        <span>{rows.length} resim</span>
                        {matching ? (
                            <span className="flex items-center gap-1">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Eşleştiriliyor...
                            </span>
                        ) : (
                            <>
                                <span className="text-emerald-500">{counts.matched} eşleşti</span>
                                {counts.ambiguous > 0 && <span className="text-amber-500">{counts.ambiguous} birden çok masala uyuyor</span>}
                                {counts.none > 0 && <span className="text-red-400">{counts.none} eşleşmedi</span>}
                                <span>{counts.withCredit} künyeli</span>
                            </>
                        )}
                        <label className="flex items-center gap-1.5 cursor-pointer ml-auto">
                            <input
                                type="checkbox"
                                className="accent-primary"
                                checked={applyToTale}
                                onChange={(e) => setApplyToTale(e.target.checked)}
                                disabled={uploading}
                            />
                            Bu kapağı tüm dillere ve bölümlere uygula
                        </label>
                        <button
                            type="button"
                            onClick={uploadAll}
                            disabled={uploading || matching || chosen.length === 0}
                            className="bg-primary hover:bg-primary/90 text-white px-3 py-1.5 rounded-md font-medium flex items-center gap-1.5 disabled:opacity-50"
                        >
                            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                            {chosen.length} kapağı yükle
                        </button>
                    </div>
                    {counts.replacing > 0 && (
                        <p className="text-xs text-amber-500">
                            {counts.replacing} masalın kapağı var; yüklenince yenisiyle değişir (eskisi başka masal kullanmıyorsa silinir).
                        </p>
                    )}

                    <div className="border border-border rounded-lg bg-card overflow-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-muted/40 text-muted-foreground">
                                <tr>
                                    <th className="px-2 py-2 w-8" />
                                    <th className="text-left px-2 py-2">Resim</th>
                                    <th className="text-left px-2 py-2">Künye</th>
                                    <th className="text-left px-2 py-2">Masal</th>
                                    <th className="text-left px-2 py-2">Şu anki kapak</th>
                                    <th className="text-left px-2 py-2">Sonuç</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr key={row.key} className="border-t border-border align-top">
                                        <td className="px-2 py-2">
                                            <input
                                                type="checkbox"
                                                aria-label={`${row.pair.image.name} yüklensin`}
                                                checked={row.include}
                                                disabled={!row.target || uploading || row.state === "done"}
                                                onChange={(e) => update(row.key, { include: e.target.checked })}
                                            />
                                        </td>
                                        <td className="px-2 py-2">
                                            <div className="flex gap-2 items-start">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={row.preview} alt="" className="w-14 h-14 object-cover rounded border border-border" />
                                                <span className="font-mono break-all">{row.pair.image.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-2 py-2 max-w-[16rem]">
                                            {row.credit ? (
                                                <span className="line-clamp-4" title={coverCreditLine(row.credit)}>
                                                    {coverCreditLine(row.credit)}
                                                </span>
                                            ) : row.creditError ? (
                                                <span className="text-amber-500">{row.creditError}</span>
                                            ) : (
                                                <span className="text-muted-foreground">Künye yok</span>
                                            )}
                                        </td>
                                        <td className="px-2 py-2 min-w-[14rem]">
                                            {row.target ? (
                                                <div className="space-y-0.5">
                                                    <Link href={`/stories?story=${row.target.storyId}`} className="font-medium text-primary hover:underline">
                                                        {row.target.title}
                                                    </Link>
                                                    <div className="text-muted-foreground">
                                                        {row.target.languages.map((l) => l.toUpperCase()).join(", ")}, {row.target.storyCount} masal
                                                        {row.match?.via ? `, ${VIA_LABELS[row.match.via] ?? row.match.via}` : ""}
                                                    </div>
                                                    {row.duplicate && (
                                                        <div className="text-amber-500">Başka bir resim de bu masala eşleşti.</div>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className="text-muted-foreground hover:text-foreground underline"
                                                        onClick={() => update(row.key, { target: null, include: false })}
                                                        disabled={uploading}
                                                    >
                                                        Başka masal seç
                                                    </button>
                                                </div>
                                            ) : row.match?.status === "ambiguous" ? (
                                                <div className="space-y-1">
                                                    <div className="text-amber-500">Birden çok masala uyuyor, birini seç:</div>
                                                    {row.match.candidates.map((tale) => (
                                                        <button
                                                            key={tale.storyId}
                                                            type="button"
                                                            onClick={() => update(row.key, { target: taleTarget(tale), include: true })}
                                                            className="block w-full text-left px-2 py-1 rounded border border-border hover:bg-muted"
                                                        >
                                                            {tale.title} <span className="text-muted-foreground">({tale.languages.join(", ")})</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            ) : matching ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                                <div className="space-y-1">
                                                    <div className="text-red-400">Eşleşen masal bulunamadı. Elle seç:</div>
                                                    <StorySearch onPick={(target) => update(row.key, { target, include: true })} />
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-2 py-2">
                                            {row.target?.coverImageUrl ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={row.target.coverImageUrl} alt="" className="w-14 h-14 object-cover rounded border border-border" />
                                            ) : (
                                                <span className="text-muted-foreground">Yok</span>
                                            )}
                                        </td>
                                        <td className="px-2 py-2 min-w-[8rem]">
                                            {row.state === "uploading" && <Loader2 className="w-4 h-4 animate-spin" />}
                                            {row.state === "done" && (
                                                <span className="text-emerald-500 flex items-center gap-1">
                                                    <CheckCircle2 className="w-3.5 h-3.5" /> {row.message}
                                                </span>
                                            )}
                                            {row.state === "failed" && (
                                                <span className="text-red-400 flex items-center gap-1">
                                                    <XCircle className="w-3.5 h-3.5 shrink-0" /> {row.message}
                                                </span>
                                            )}
                                            {row.state === "idle" && <span className="text-muted-foreground">-</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
