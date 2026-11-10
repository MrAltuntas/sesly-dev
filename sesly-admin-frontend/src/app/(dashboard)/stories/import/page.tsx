"use client";

import { ChangeEvent, Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    AlertTriangle,
    ArrowLeft,
    Bot,
    CheckCircle2,
    ChevronDown,
    ClipboardCheck,
    FileJson,
    Images,
    ImageUp,
    Loader2,
    SearchCheck,
    SkipForward,
    Upload,
    XCircle,
} from "lucide-react";
import { BulkCoverUpload } from "@/components/stories/BulkCoverUpload";
import { coverCreditLine, findImportItemCover, pairCoverFiles, parseCoverCreditText } from "@/lib/covers";
import { textExcerpt } from "@/lib/review";
import { describeContentWarnings } from "@/lib/stories";
import type { CoverCredit } from "@/types/api.types";
import { StoriesService } from "@/services/admin.service";
import { ImportItemResult, ImportResult } from "@/types/api.types";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { getErrorMessage } from "@/components/ui/error-state";
import { cn } from "@/lib/utils";
import {
    IMPORT_STATUS_LABELS,
    RawImportStory,
    failedBatchResult,
    importBatches,
    importSummary,
    mergeImportResults,
    parseImportFile,
    previewRows,
} from "@/lib/story-import";

const STATUS_STYLES: Record<ImportItemResult["status"], string> = {
    created: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    valid: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    skipped: "bg-secondary/40 text-foreground",
    error: "bg-destructive/15 text-destructive",
};

const STATUS_ICONS: Record<ImportItemResult["status"], typeof CheckCircle2> = {
    created: CheckCircle2,
    valid: CheckCircle2,
    skipped: SkipForward,
    error: XCircle,
};

export default function StoryImportPage() {
    const { canCreateStory } = usePermissions();
    const toast = useToast();
    const confirm = useConfirm();

    const [fileName, setFileName] = useState<string | null>(null);
    const [stories, setStories] = useState<RawImportStory[]>([]);
    const [fileError, setFileError] = useState<string | null>(null);
    const [running, setRunning] = useState<"check" | "import" | null>(null);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [result, setResult] = useState<ImportResult | null>(null);
    // Pictures chosen next to the file (stories/batch1/images): shown in the
    // preview and offered as covers after the import.
    const [imageFiles, setImageFiles] = useState<File[]>([]);
    const [credits, setCredits] = useState<Map<string, CoverCredit | null>>(new Map());
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const [showCovers, setShowCovers] = useState(false);

    const rows = useMemo(() => previewRows(stories), [stories]);
    const pairs = useMemo(() => pairCoverFiles(imageFiles).pairs, [imageFiles]);
    const previews = useMemo(() => new Map(pairs.map((p) => [p.key, URL.createObjectURL(p.image)])), [pairs]);
    useEffect(
        () => () => {
            for (const url of previews.values()) URL.revokeObjectURL(url);
        },
        [previews],
    );
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const next = new Map<string, CoverCredit | null>();
            for (const pair of pairs) {
                if (pair.credit) next.set(pair.key, parseCoverCreditText(await pair.credit.text()).credit);
            }
            if (!cancelled) setCredits(next);
        })();
        return () => {
            cancelled = true;
        };
    }, [pairs]);
    const coverFor = (index: number) => {
        const item = stories[index];
        return item && typeof item === "object" ? findImportItemCover(item as Record<string, unknown>, pairs) : null;
    };
    const matchedImages = rows.filter((row) => coverFor(row.index)).length;
    const toggleRow = (index: number) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    const resultByIndex = useMemo(
        () => new Map((result?.items ?? []).map((item) => [item.index, item])),
        [result],
    );
    const warningCount = rows.filter((r) => r.warnings.length > 0).length;

    const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setResult(null);
        setShowCovers(false);
        setExpanded(new Set());
        setFileName(file.name);
        const parsed = parseImportFile(await file.text());
        setStories(parsed.stories);
        setFileError(parsed.error);
    };

    const handleImages = (e: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (files.length > 0) setImageFiles(files);
    };

    const run = async (dryRun: boolean) => {
        if (stories.length === 0) return;
        if (!dryRun) {
            const ok = await confirm({
                title: "Masallar aktarılsın mı?",
                message:
                    `${stories.length} masal TASLAK olarak eklenecek. Aynı dil, kaynak ve başlıkla zaten var olanlar atlanır.\n\n` +
                    "Aktarım yapay zeka ya da seslendirme çağrısı yapmaz: seviye ve yaş değerlendirmesi, çeviri ve segmentleme yapılmaz.",
                confirmLabel: "Aktar",
                cancelLabel: "Vazgeç",
            });
            if (!ok) return;
        }

        const batches = importBatches(stories);
        setRunning(dryRun ? "check" : "import");
        setProgress({ done: 0, total: batches.length });
        const answers: ImportResult[] = [];
        try {
            for (const batch of batches) {
                // The file name labels the stories for the review view. A
                // failed request (a timeout, a gateway error) is tried once
                // more; failing again, its stories are marked as errors and
                // the run goes on (an import is idempotent, so they can be
                // sent again later).
                let answer: ImportResult;
                try {
                    answer = (await StoriesService.importStories(batch, dryRun, fileName ?? undefined)).data;
                } catch {
                    try {
                        answer = (await StoriesService.importStories(batch, dryRun, fileName ?? undefined)).data;
                    } catch (e) {
                        answer = failedBatchResult(batch, dryRun, getErrorMessage(e, "Aktarım isteği başarısız oldu"));
                    }
                }
                answers.push(answer);
                setProgress({ done: answers.length, total: batches.length });
            }
            const merged = mergeImportResults(answers, dryRun);
            setResult(merged);
            if (merged.errors > 0) toast.error(importSummary(merged));
            else toast.success(importSummary(merged));
        } catch (e) {
            // Batches already answered are kept (an import is idempotent:
            // running it again skips what was created).
            if (answers.length > 0) setResult(mergeImportResults(answers, dryRun));
            toast.error(getErrorMessage(e, "Aktarım isteği başarısız oldu"));
        } finally {
            setRunning(null);
            setProgress(null);
        }
    };

    if (!canCreateStory) {
        return (
            <div className="p-6 text-sm text-muted-foreground">
                Toplu aktarım için masal oluşturma yetkisi gerekir.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <Link
                        href="/stories"
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1"
                    >
                        <ArrowLeft className="w-3.5 h-3.5" /> İçerik Stüdyosu
                    </Link>
                    <h2 className="text-3xl font-bold tracking-tight">Toplu aktarım</h2>
                    <p className="text-muted-foreground">
                        JSON dosyasındaki masalları taslak olarak ekle. Segmentler dosyada varsa sürüm 1 olarak saklanır.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <label className="bg-secondary/30 hover:bg-secondary/50 text-foreground border border-border px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 cursor-pointer">
                        <FileJson className="w-4 h-4" />
                        JSON dosyası seç
                        <input type="file" accept="application/json,.json" onChange={handleFile} className="hidden" />
                    </label>
                    <label
                        title="Dosya adları masalın pairKey ya da partOf anahtarı olan resimler ve .credit.json dosyaları (stories/batch1/images)"
                        className="bg-secondary/30 hover:bg-secondary/50 text-foreground border border-border px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 cursor-pointer"
                    >
                        <Images className="w-4 h-4" />
                        Resimleri seç
                        <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/json,.json" onChange={handleImages} className="hidden" />
                    </label>
                    <button
                        onClick={() => run(true)}
                        disabled={stories.length === 0 || !!running}
                        className="bg-secondary hover:bg-secondary/80 text-secondary-foreground px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                        {running === "check" ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <SearchCheck className="w-4 h-4" />
                        )}
                        Kontrol et
                    </button>
                    <button
                        onClick={() => run(false)}
                        disabled={stories.length === 0 || !!running}
                        className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                        {running === "import" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        Aktar
                    </button>
                </div>
            </div>

            {fileError && (
                <div className="border border-destructive/30 bg-destructive/10 text-destructive rounded-md p-3 text-sm flex gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    {fileError}
                </div>
            )}

            {fileName && !fileError && (
                <div className="text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                        Dosya: <span className="font-mono text-foreground">{fileName}</span>
                    </span>
                    <span>{stories.length} masal</span>
                    {warningCount > 0 && <span className="text-amber-600">{warningCount} masalda eksik alan var</span>}
                    {imageFiles.length > 0 && (
                        <span>
                            {pairs.length} resim, {matchedImages} masalda eşleşen resim var
                        </span>
                    )}
                    {progress && (
                        <span>
                            İstek {progress.done} / {progress.total}
                        </span>
                    )}
                    {result && <span className="text-foreground font-medium">{importSummary(result)}</span>}
                </div>
            )}

            {result && !result.dryRun && result.created + result.skipped > 0 && (
                <div className="border border-primary/30 bg-primary/5 rounded-lg p-3 text-sm flex flex-wrap items-center gap-3">
                    <span>Masallar taslak olarak eklendi. Yayınlamadan önce inceleme sayfasında tek tek okuyabilirsin.</span>
                    <Link
                        href={`/stories/review${result.batch ? `?batch=${encodeURIComponent(result.batch)}` : ""}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-white text-xs font-medium"
                    >
                        <ClipboardCheck className="w-3.5 h-3.5" /> İncelemeye git
                    </Link>
                    {imageFiles.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setShowCovers((v) => !v)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-muted"
                        >
                            <ImageUp className="w-3.5 h-3.5" /> Seçilen resimleri kapak olarak yükle
                        </button>
                    )}
                </div>
            )}

            {showCovers && imageFiles.length > 0 && <BulkCoverUpload initialFiles={imageFiles} />}

            {!fileName && (
                <div className="border border-dashed border-border rounded-lg p-10 text-center text-sm text-muted-foreground">
                    Bir JSON dosyası seç: masal dizisi ya da {"{ \"stories\": [...] }"}. Biçim docs/story-pipeline.md
                    dosyasında anlatılıyor.
                </div>
            )}

            {rows.length > 0 && (
                <div className="border border-border rounded-lg bg-card overflow-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/40 text-xs text-muted-foreground">
                            <tr>
                                <th className="text-left px-3 py-2 w-12">#</th>
                                <th className="text-left px-3 py-2 w-16">Resim</th>
                                <th className="text-left px-3 py-2">Başlık</th>
                                <th className="text-left px-3 py-2">Dil</th>
                                <th className="text-left px-3 py-2">Kategori</th>
                                <th className="text-left px-3 py-2">Yaş</th>
                                <th className="text-right px-3 py-2">Kelime</th>
                                <th className="text-right px-3 py-2">Segment</th>
                                <th className="text-left px-3 py-2">Çift / bölüm</th>
                                <th className="text-left px-3 py-2">Sonuç</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => {
                                const item = resultByIndex.get(row.index);
                                const Icon = item ? STATUS_ICONS[item.status] : null;
                                const cover = coverFor(row.index);
                                const raw = (stories[row.index] ?? {}) as Record<string, unknown>;
                                const open = expanded.has(row.index);
                                const str = (v: unknown) => (typeof v === "string" ? v : "");
                                const warnings = describeContentWarnings(raw.contentWarnings);
                                return (
                                    <Fragment key={row.index}>
                                    <tr className="border-t border-border align-top">
                                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.index + 1}</td>
                                        <td className="px-3 py-2">
                                            {cover ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                    src={previews.get(cover.key)}
                                                    alt=""
                                                    title={cover.image.name}
                                                    className="w-12 h-12 object-cover rounded border border-border"
                                                />
                                            ) : (
                                                <span className="text-xs text-muted-foreground">-</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            <button
                                                type="button"
                                                onClick={() => toggleRow(row.index)}
                                                aria-expanded={open}
                                                className="font-medium text-left hover:text-primary inline-flex items-start gap-1"
                                            >
                                                <ChevronDown className={cn("w-4 h-4 mt-0.5 shrink-0 transition-transform", !open && "-rotate-90")} />
                                                {row.title}
                                            </button>
                                            {raw.translationMethod === "MACHINE" && (
                                                <span className="ml-5 mt-0.5 inline-flex items-center gap-1 text-[10px] text-violet-400">
                                                    <Bot className="w-3 h-3" aria-hidden /> Yapay zekâ çevirisi
                                                </span>
                                            )}
                                            {row.warnings.length > 0 && (
                                                <div className="text-[11px] text-amber-600 mt-0.5">{row.warnings.join(", ")}</div>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 uppercase text-xs">{row.language}</td>
                                        <td className="px-3 py-2 text-xs">{row.category}</td>
                                        <td className="px-3 py-2 text-xs">{row.ageGroup}</td>
                                        <td className="px-3 py-2 text-right text-xs">{row.words}</td>
                                        <td className="px-3 py-2 text-right text-xs">{row.segments || "-"}</td>
                                        <td className="px-3 py-2 text-xs font-mono">
                                            {row.pairKey && <div>{row.pairKey}</div>}
                                            {row.part && <div className="text-muted-foreground">{row.part}</div>}
                                        </td>
                                        <td className="px-3 py-2 text-xs min-w-[14rem]">
                                            {item && Icon ? (
                                                <div className="space-y-1">
                                                    <span
                                                        className={cn(
                                                            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium",
                                                            STATUS_STYLES[item.status],
                                                        )}
                                                    >
                                                        <Icon className="w-3.5 h-3.5" />
                                                        {IMPORT_STATUS_LABELS[item.status]}
                                                    </span>
                                                    {item.message && <div className="text-muted-foreground">{item.message}</div>}
                                                    {item.problems && item.problems.length > 0 && (
                                                        <ul className="list-disc ml-4 text-destructive space-y-0.5">
                                                            {item.problems.map((p, i) => (
                                                                <li key={i} className="break-words">
                                                                    {p}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                    {item.storyId && (
                                                        <Link
                                                            href={`/stories?story=${item.storyId}`}
                                                            className="text-primary hover:underline"
                                                        >
                                                            Masalı aç
                                                        </Link>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-muted-foreground">-</span>
                                            )}
                                        </td>
                                    </tr>
                                    {open && (
                                        <tr className="bg-muted/20">
                                            <td />
                                            <td colSpan={9} className="px-3 py-3 text-xs space-y-2">
                                                {str(raw.description) && (
                                                    <p>
                                                        <span className="text-muted-foreground">Özet: </span>
                                                        {str(raw.description)}
                                                    </p>
                                                )}
                                                <p className="text-sm leading-relaxed whitespace-pre-line font-serif max-w-3xl">
                                                    {textExcerpt(str(raw.text), 1500)}
                                                </p>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 max-w-4xl">
                                                    <p>
                                                        <span className="text-muted-foreground">Yazar / derleyen: </span>
                                                        {[str(raw.author), str(raw.collector)].filter(Boolean).join(", ") || "-"}
                                                    </p>
                                                    <p>
                                                        <span className="text-muted-foreground">Lisans: </span>
                                                        {str(raw.licence) || "-"} {str(raw.rightsBasis) ? `(${str(raw.rightsBasis)})` : ""}
                                                    </p>
                                                    <p className="md:col-span-2 break-words">
                                                        <span className="text-muted-foreground">Atıf: </span>
                                                        {str(raw.attribution) || "-"}
                                                    </p>
                                                    <p>
                                                        <span className="text-muted-foreground">İçerik uyarıları: </span>
                                                        {warnings.labels.length > 0 ? warnings.labels.join(", ") : warnings.unknown.length === 0 ? "Yok" : ""}
                                                        {warnings.unknown.length > 0 && (
                                                            <span className="text-destructive" data-testid="import-unknown-warnings">
                                                                {warnings.labels.length > 0 ? " " : ""}
                                                                Tanınmayan: {warnings.unknown.join(", ")} (bu masal aktarılmaz)
                                                            </span>
                                                        )}
                                                    </p>
                                                    <p className="break-all">
                                                        <span className="text-muted-foreground">Kaynak: </span>
                                                        {str(raw.sourceUrl) || str(raw.collection) || "-"}
                                                    </p>
                                                </div>
                                                {cover && (
                                                    <div className="flex items-start gap-3 pt-1">
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img
                                                            src={previews.get(cover.key)}
                                                            alt=""
                                                            className="w-32 h-32 object-cover rounded border border-border"
                                                        />
                                                        <div className="space-y-1 max-w-xl">
                                                            <p className="font-mono">{cover.image.name}</p>
                                                            <p>
                                                                <span className="text-muted-foreground">Kapak künyesi: </span>
                                                                {coverCreditLine(credits.get(cover.key)) || (cover.credit ? "Okunamadı" : "Künye dosyası yok")}
                                                            </p>
                                                        </div>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    )}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
