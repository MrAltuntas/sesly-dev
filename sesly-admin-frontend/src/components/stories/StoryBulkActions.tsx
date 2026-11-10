"use client";

import { useState } from "react";
import { AlertTriangle, Archive, CheckCircle2, GraduationCap, Languages, Loader2, Send, Sparkles, Trash2, X } from "lucide-react";
import { StoriesService } from "@/services/admin.service";
import type { BulkArchiveResponse, BulkDeletePreview, BulkDeleteResponse, BulkSkip, LlmBatchSkip, StoriesMeta } from "@/types/api.types";
import { getErrorMessage } from "@/components/ui/error-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { deleteConfirmMatches, languageName } from "@/lib/stories";
import {
    BULK_BATCH_SIZE,
    type StoryBrief,
    chunk,
    failureSkips,
    mergeArchiveResults,
    mergeDeletePreviews,
    mergeDeleteResults,
    runInBatches,
} from "@/lib/bulk";
import { inputClass } from "./form-fields";
import { StoryModal } from "./StoryModal";
import { BulkPublishDialog } from "./BulkPublishDialog";

/**
 * The AI batch endpoints (translate, level) take at most this many ids; the
 * panel does not split those, since every story there is a paid LLM call.
 * Publish, archive and delete go in batches of this size for any selection.
 */
const BATCH_MAX = BULK_BATCH_SIZE;

/** One delete-preview batch: the ids sent and the count confirmed for them. */
interface DeleteBatch {
    ids: string[];
    preview: BulkDeletePreview;
}

interface Props {
    meta: StoriesMeta | null;
    selectedIds: string[];
    /** Status, review mark and publish rule of the stories the page has seen. */
    known: ReadonlyMap<string, StoryBrief>;
    /** Title of a selected story, for the "skipped" report. */
    titleFor: (id: string) => string;
    onClearSelection: () => void;
    /** At least one task was queued: the page starts watching the task list. */
    onQueued: () => void;
    /** Bulk archive and publish (ADMIN+). */
    canArchive?: boolean;
    /** Bulk delete (SUPER_ADMIN). */
    canDelete?: boolean;
    /** Stories were archived or deleted: the page reloads the list. */
    onChanged?: (removedIds: string[]) => void;
}

interface BatchResult {
    heading: string;
    queued: number;
    /** Only the level batch reports how many stories matched. */
    matched?: number;
    skipped: LlmBatchSkip[];
}

function SkippedList({
    skipped,
    titleFor,
}: {
    skipped: Array<Pick<LlmBatchSkip, "storyId" | "reason">>;
    titleFor: (id: string) => string;
}) {
    if (skipped.length === 0) return null;
    return (
        <div className="space-y-2">
            <h4 className="text-xs font-semibold flex items-center gap-1.5 text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                Atlanan masallar ({skipped.length})
            </h4>
            <ul className="space-y-1.5 max-h-64 overflow-y-auto">
                {skipped.map((skip) => (
                    <li key={skip.storyId} className="border border-border rounded-md px-3 py-2 text-xs">
                        <div className="font-medium">{titleFor(skip.storyId)}</div>
                        <div className="text-muted-foreground">{skip.reason}</div>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function ResultView({
    result,
    titleFor,
    onClose,
}: {
    result: BatchResult;
    titleFor: (id: string) => string;
    onClose: () => void;
}) {
    return (
        <div className="space-y-4">
            <div className="border border-green-500/20 bg-green-500/5 rounded-xl p-4 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                <div className="text-sm">
                    <div className="font-semibold">{result.heading}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                        {result.queued} masal sıraya alındı
                        {result.skipped.length > 0 ? `, ${result.skipped.length} masal atlandı` : ""}
                        {typeof result.matched === "number" ? `. Seçime uyan masal sayısı: ${result.matched}` : ""}.
                        Görevler arka planda sırayla çalışır, ilerlemeyi Yapay zeka görevleri penceresinden
                        izleyebilirsin.
                    </p>
                </div>
            </div>
            <SkippedList skipped={result.skipped} titleFor={titleFor} />
            <button
                type="button"
                onClick={onClose}
                className="w-full bg-primary hover:bg-primary/90 text-white py-2.5 rounded-xl text-sm font-medium transition-colors"
            >
                Tamam
            </button>
        </div>
    );
}

export function StoryBulkActions({
    meta,
    selectedIds,
    known,
    titleFor,
    onClearSelection,
    onQueued,
    canArchive = false,
    canDelete = false,
    onChanged,
}: Props) {
    const [dialog, setDialog] = useState<"translate" | "level" | "archive" | "delete" | "publish" | null>(null);
    const [archiveResult, setArchiveResult] = useState<BulkArchiveResponse | null>(null);
    const [deletePreview, setDeletePreview] = useState<BulkDeletePreview | null>(null);
    const [deleteBatches, setDeleteBatches] = useState<DeleteBatch[]>([]);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [deleteResult, setDeleteResult] = useState<BulkDeleteResponse | null>(null);
    const [confirmText, setConfirmText] = useState("");
    const [targetLanguage, setTargetLanguage] = useState("");
    const [onlyMissing, setOnlyMissing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<BatchResult | null>(null);

    const count = selectedIds.length;
    const tooMany = count > BATCH_MAX;

    const openDialog = (kind: "translate" | "level" | "archive") => {
        setDialog(kind);
        setError(null);
        setResult(null);
        setArchiveResult(null);
    };

    const closeDialog = () => {
        setDialog(null);
        setError(null);
        setResult(null);
        setArchiveResult(null);
        setDeletePreview(null);
        setDeleteBatches([]);
        setDeleteResult(null);
        setConfirmText("");
        setProgress(null);
    };

    const describeError = (e: unknown) => getErrorMessage(e, "bilinmeyen hata");

    const runArchive = async () => {
        setBusy(true);
        setError(null);
        try {
            const { results, failures } = await runInBatches(
                selectedIds,
                BULK_BATCH_SIZE,
                (batch) => StoriesService.bulkArchive(batch).then((res) => res.data),
                (done, total) => setProgress({ done, total }),
            );
            if (results.length === 0) throw failures[0]?.error;
            const merged = mergeArchiveResults(results, failureSkips(failures, describeError, titleFor));
            setArchiveResult(merged);
            if (merged.archived.length > 0) onChanged?.([]);
        } catch (e) {
            setError(getErrorMessage(e, "Masallar arşivlenemedi."));
        } finally {
            setBusy(false);
            setProgress(null);
        }
    };

    const openDelete = async () => {
        setDialog("delete");
        setError(null);
        setDeletePreview(null);
        setDeleteBatches([]);
        setDeleteResult(null);
        setConfirmText("");
        setBusy(true);
        try {
            // One preview per batch of 200: each batch is later deleted with its own confirmed count.
            const batches: DeleteBatch[] = [];
            for (const ids of chunk(selectedIds, BULK_BATCH_SIZE)) {
                const res = await StoriesService.bulkDeletePreview(ids);
                batches.push({ ids, preview: res.data });
            }
            setDeleteBatches(batches);
            setDeletePreview(mergeDeletePreviews(batches.map((b) => b.preview)));
        } catch (e) {
            setError(getErrorMessage(e, "Silinecekler hesaplanamadı."));
        } finally {
            setBusy(false);
        }
    };

    const runDelete = async () => {
        if (!deletePreview || !deleteConfirmMatches(confirmText)) return;
        setBusy(true);
        setError(null);
        const work = deleteBatches.filter((b) => b.preview.stories > 0);
        const total = work.reduce((n, b) => n + b.ids.length, 0);
        const results: BulkDeleteResponse[] = [];
        const failed: BulkSkip[] = [];
        let done = 0;
        setProgress({ done, total });
        try {
            for (const batch of work) {
                try {
                    const res = await StoriesService.bulkDelete(batch.ids, batch.preview.stories, confirmText.trim());
                    results.push(res.data);
                } catch (e) {
                    failed.push(...failureSkips([{ items: batch.ids, error: e }], describeError, titleFor));
                }
                done += batch.ids.length;
                setProgress({ done, total });
            }
            const merged = mergeDeleteResults(results, failed);
            setDeleteResult(merged);
            onChanged?.(merged.deletedIds);
        } finally {
            setBusy(false);
            setProgress(null);
        }
    };

    const runTranslate = async () => {
        if (!targetLanguage) {
            setError("Hedef dili seç.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const res = await StoriesService.translateBatch(selectedIds, targetLanguage);
            setResult({
                heading: `${languageName(meta, res.data.targetLanguage)} diline toplu çeviri`,
                queued: res.data.queued.length,
                skipped: res.data.skipped,
            });
            if (res.data.queued.length > 0) onQueued();
        } catch (e) {
            console.error("Batch translation failed", e);
            setError(getErrorMessage(e, "Toplu çeviri başlatılamadı."));
        } finally {
            setBusy(false);
        }
    };

    const runLevels = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await StoriesService.assessLevelBatch(selectedIds, onlyMissing);
            setResult({
                heading: "Toplu seviye etiketleme",
                queued: res.data.queued.length,
                matched: res.data.matched,
                skipped: res.data.skipped,
            });
            if (res.data.queued.length > 0) onQueued();
        } catch (e) {
            console.error("Batch level assessment failed", e);
            setError(getErrorMessage(e, "Toplu seviye etiketleme başlatılamadı."));
        } finally {
            setBusy(false);
        }
    };

    if (count === 0 && dialog === null) return null;

    return (
        <>
            {count > 0 && (
                <div className="border border-primary/40 bg-primary/5 rounded-xl px-3 py-2 flex flex-wrap items-center gap-2 text-xs shrink-0">
                    <span className="font-semibold text-primary">{count} masal seçildi</span>
                    <button
                        type="button"
                        onClick={() => openDialog("translate")}
                        disabled={tooMany}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-white font-medium transition-colors disabled:opacity-50"
                    >
                        <Languages className="w-3.5 h-3.5" />
                        Seçilenleri çevir
                    </button>
                    <button
                        type="button"
                        onClick={() => openDialog("level")}
                        disabled={tooMany}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border font-medium hover:bg-muted transition-colors disabled:opacity-50"
                    >
                        <GraduationCap className="w-3.5 h-3.5" />
                        Seviyeleri AI ile etiketle
                    </button>
                    {canArchive && (
                        <button
                            type="button"
                            onClick={() => setDialog("publish")}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border font-medium hover:bg-muted transition-colors"
                        >
                            <Send className="w-3.5 h-3.5" />
                            Yayınla
                        </button>
                    )}
                    {canArchive && (
                        <button
                            type="button"
                            onClick={() => openDialog("archive")}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border font-medium hover:bg-muted transition-colors disabled:opacity-50"
                        >
                            <Archive className="w-3.5 h-3.5" />
                            Arşivle
                        </button>
                    )}
                    {canDelete && (
                        <button
                            type="button"
                            onClick={openDelete}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-red-500/50 text-red-400 font-medium hover:bg-red-500/10 transition-colors disabled:opacity-50"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            Sil
                        </button>
                    )}
                    {tooMany && (
                        <span className="text-amber-400">
                            Çeviri ve seviye etiketleme tek seferde en fazla {BATCH_MAX} masal işler. Yayınlama, arşivleme ve
                            silme {BATCH_MAX} masallık parçalar halinde yapılır.
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={onClearSelection}
                        className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <X className="w-3.5 h-3.5" />
                        Seçimi temizle
                    </button>
                </div>
            )}

            {dialog === "translate" && (
                <StoryModal
                    title="Seçilenleri çevir"
                    subtitle={`${count} masal yapay zekayla seçilen dile çevrilir.`}
                    icon={<Languages className="w-5 h-5 text-primary" />}
                    onClose={closeDialog}
                    busy={busy}
                >
                    {result ? (
                        <ResultView result={result} titleFor={titleFor} onClose={closeDialog} />
                    ) : (
                        <>
                            <div className="border border-amber-500/30 bg-amber-500/5 rounded-md p-3 text-xs flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-px" />
                                <p className="text-muted-foreground">
                                    <span className="font-semibold text-amber-400">
                                        Her çeviri taslak olarak kaydedilir ve uygulamada görünmez.
                                    </span>{" "}
                                    Yayınlamadan önce bir kişinin her birini baştan sona okuması gerekir. Hedef dilde
                                    çevirisi olan, zaten o dilde yazılmış ya da metni boş masallar atlanır. Toplu
                                    işlem var olan bir taslağın üzerine yazmaz.
                                </p>
                            </div>
                            <div>
                                <label
                                    htmlFor="bulk-translate-target"
                                    className="text-xs font-medium text-muted-foreground mb-1.5 block"
                                >
                                    Hedef dil
                                </label>
                                <select
                                    id="bulk-translate-target"
                                    value={targetLanguage}
                                    onChange={(e) => {
                                        setTargetLanguage(e.target.value);
                                        setError(null);
                                    }}
                                    disabled={busy}
                                    className={inputClass}
                                >
                                    <option value="">Dil seç</option>
                                    {(meta?.languages.all ?? []).map((language) => (
                                        <option key={language.code} value={language.code}>
                                            {language.nativeName} ({language.code})
                                            {language.enabled ? "" : ", uygulamada kapalı"}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {error && (
                                <p role="alert" className="text-xs text-red-400">
                                    {error}
                                </p>
                            )}
                            <button
                                type="button"
                                onClick={runTranslate}
                                disabled={busy || !targetLanguage}
                                className="w-full bg-primary hover:bg-primary/90 text-white py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                {busy ? "Sıraya alınıyor..." : `${count} masalı çevir`}
                            </button>
                        </>
                    )}
                </StoryModal>
            )}

            {dialog === "level" && (
                <StoryModal
                    title="Seviyeleri AI ile etiketle"
                    subtitle={`${count} masalın dil seviyesi (A1 ile C2 arası) yapay zekayla belirlenir.`}
                    icon={<GraduationCap className="w-5 h-5 text-primary" />}
                    onClose={closeDialog}
                    busy={busy}
                >
                    {result ? (
                        <ResultView result={result} titleFor={titleFor} onClose={closeDialog} />
                    ) : (
                        <>
                            <p className="text-xs text-muted-foreground">
                                Elle belirlenmiş seviyelere dokunulmaz, bu masallar atlanır. Yapay zekanın daha önce
                                etiketlediği masallar yeniden değerlendirilir.
                            </p>
                            <label className="flex items-start gap-2 text-sm cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={onlyMissing}
                                    onChange={(e) => setOnlyMissing(e.target.checked)}
                                    disabled={busy}
                                    className="w-4 h-4 mt-0.5 rounded border-border"
                                />
                                <span>
                                    Yalnızca seviyesi olmayan masallar
                                    <span className="block text-xs text-muted-foreground">
                                        İşaretlenirse seviyesi olan masallar yeniden değerlendirilmez.
                                    </span>
                                </span>
                            </label>
                            {error && (
                                <p role="alert" className="text-xs text-red-400">
                                    {error}
                                </p>
                            )}
                            <button
                                type="button"
                                onClick={runLevels}
                                disabled={busy}
                                className="w-full bg-primary hover:bg-primary/90 text-white py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                {busy ? "Sıraya alınıyor..." : `${count} masalı etiketle`}
                            </button>
                        </>
                    )}
                </StoryModal>
            )}
            {dialog === "archive" && (
                <StoryModal
                    title="Seçilenleri arşivle"
                    subtitle={`${count} masal uygulamanın listelerinden kalkar.`}
                    icon={<Archive className="w-5 h-5 text-primary" />}
                    onClose={closeDialog}
                    busy={busy}
                >
                    {archiveResult ? (
                        <div className="space-y-3">
                            <p className="text-sm">
                                {archiveResult.archived.length} masal arşivlendi
                                {archiveResult.skipped.length > 0 ? `, ${archiveResult.skipped.length} masal atlandı` : ""}.
                            </p>
                            <SkippedList skipped={archiveResult.skipped} titleFor={titleFor} />
                            <button
                                type="button"
                                onClick={() => {
                                    closeDialog();
                                    onClearSelection();
                                }}
                                className="w-full bg-primary hover:bg-primary/90 text-white py-2.5 rounded-xl text-sm font-medium"
                            >
                                Tamam
                            </button>
                        </div>
                    ) : progress ? (
                        <ProgressBar label="Arşivleniyor" done={progress.done} total={progress.total} />
                    ) : (
                        <>
                            <p className="text-xs text-muted-foreground">
                                Arşivlenen masal listelerde, aramada ve koleksiyonlarda görünmez. Daha önce kaydeden ya da
                                seslendiren kullanıcılar onu açmaya devam eder. Hiçbir şey silinmez; durumu sonra yeniden
                                Taslak ya da Yayında yapabilirsin.
                            </p>
                            {error && (
                                <p role="alert" className="text-xs text-red-400">
                                    {error}
                                </p>
                            )}
                            <button
                                type="button"
                                onClick={runArchive}
                                disabled={busy}
                                className="w-full bg-primary hover:bg-primary/90 text-white py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                                {busy ? "Arşivleniyor..." : `${count} masalı arşivle`}
                            </button>
                        </>
                    )}
                </StoryModal>
            )}

            {dialog === "delete" && (
                <StoryModal
                    title="Seçilenleri kalıcı olarak sil"
                    subtitle="Bu işlem geri alınamaz."
                    icon={<Trash2 className="w-5 h-5 text-red-400" />}
                    onClose={closeDialog}
                    busy={busy}
                >
                    {deleteResult ? (
                        <div className="space-y-3">
                            <div className="border border-green-500/20 bg-green-500/5 rounded-xl p-4 text-sm flex items-start gap-3">
                                <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
                                <span>
                                    {deleteResult.deleted} masal ve {deleteResult.narrations} seslendirme silindi.
                                    {deleteResult.failed.length > 0 ? ` ${deleteResult.failed.length} masal silinemedi.` : ""}
                                </span>
                            </div>
                            <SkippedList skipped={deleteResult.failed} titleFor={titleFor} />
                            <button
                                type="button"
                                onClick={() => {
                                    closeDialog();
                                    onClearSelection();
                                }}
                                className="w-full bg-primary hover:bg-primary/90 text-white py-2.5 rounded-xl text-sm font-medium"
                            >
                                Tamam
                            </button>
                        </div>
                    ) : progress ? (
                        <ProgressBar label="Siliniyor" done={progress.done} total={progress.total} />
                    ) : !deletePreview ? (
                        <div className="flex items-center justify-center py-8">
                            {busy ? (
                                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                            ) : (
                                <p role="alert" className="text-xs text-red-400">
                                    {error}
                                </p>
                            )}
                        </div>
                    ) : (
                        <>
                            <div className="border border-red-500/30 bg-red-500/5 rounded-md p-3 text-xs space-y-1">
                                <p className="font-semibold text-red-400 flex items-center gap-1.5">
                                    <AlertTriangle className="w-4 h-4" />
                                    {deletePreview.stories} masal ve {deletePreview.narrations} seslendirme kalıcı olarak silinecek.
                                </p>
                                <ul className="list-disc ml-5 text-muted-foreground">
                                    {deletePreview.published > 0 && <li>{deletePreview.published} masal şu an yayında.</li>}
                                    <li>{deletePreview.sharedAudios} paylaşılan hazır ses kaydı ve dosyası</li>
                                    <li>{deletePreview.favorites} kayıtlı (favori), {deletePreview.playlistItems} çalma listesi öğesi</li>
                                    <li>{deletePreview.collectionLinks} koleksiyon bağlantısı</li>
                                    <li>Başka masalın kullanmadığı {deletePreview.coverFiles} kapak dosyası</li>
                                </ul>
                                {deletePreview.missing.length > 0 && (
                                    <p className="text-amber-500">{deletePreview.missing.length} seçili masal zaten yok.</p>
                                )}
                            </div>
                            <ul className="text-xs max-h-40 overflow-y-auto space-y-0.5">
                                {deletePreview.titles.map((t) => (
                                    <li key={t.id}>
                                        {t.title} <span className="uppercase text-muted-foreground">{t.language}</span>
                                    </li>
                                ))}
                                {deletePreview.stories > deletePreview.titles.length && (
                                    <li className="text-muted-foreground">
                                        ve {deletePreview.stories - deletePreview.titles.length} masal daha
                                    </li>
                                )}
                            </ul>
                            <div>
                                <label htmlFor="bulk-delete-confirm" className="text-xs font-medium text-muted-foreground mb-1.5 block">
                                    Onaylamak için SİL yaz
                                </label>
                                <input
                                    id="bulk-delete-confirm"
                                    value={confirmText}
                                    onChange={(e) => setConfirmText(e.target.value)}
                                    autoComplete="off"
                                    disabled={busy}
                                    className={inputClass}
                                />
                            </div>
                            {error && (
                                <p role="alert" className="text-xs text-red-400">
                                    {error}
                                </p>
                            )}
                            <button
                                type="button"
                                onClick={runDelete}
                                disabled={busy || deletePreview.stories === 0 || !deleteConfirmMatches(confirmText)}
                                className="w-full bg-red-600 hover:bg-red-600/90 text-white py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                {busy ? "Siliniyor..." : `${deletePreview.stories} masalı kalıcı olarak sil`}
                            </button>
                        </>
                    )}
                </StoryModal>
            )}

            {dialog === "publish" && (
                <BulkPublishDialog
                    ids={selectedIds}
                    known={known}
                    onClose={closeDialog}
                    onChanged={() => onChanged?.([])}
                />
            )}
        </>
    );
}
