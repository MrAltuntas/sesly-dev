"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Info, Send } from "lucide-react";
import { StoriesService } from "@/services/admin.service";
import type { BulkPublishResponse, BulkSkip } from "@/types/api.types";
import { getErrorMessage } from "@/components/ui/error-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
    BULK_BATCH_SIZE,
    BULK_REVIEW_BATCH_SIZE,
    type StoryBrief,
    failureSkips,
    mergePublishResults,
    publishPlan,
    runInBatches,
} from "@/lib/bulk";
import { publishSummary } from "@/lib/review";
import { cn } from "@/lib/utils";
import { StoryModal } from "./StoryModal";

interface Props {
    /** Stories to publish (any number; sent in batches of 200). */
    ids: string[];
    /** What the panel knows of them (status, review mark, publish rule). */
    known: ReadonlyMap<string, StoryBrief>;
    /** Mark every story "İncelendi" first (the one-step shortcut of the review view). */
    markReviewedFirst?: boolean;
    /** Start value of "Sadece incelenmişleri yayınla". */
    defaultRequireReviewed?: boolean;
    title?: string;
    onClose: () => void;
    /** Marks or statuses changed: the page reloads its list. */
    onChanged: (change: { publishedIds: string[]; reviewedIds: string[] }) => void;
}

interface Progress {
    step: "review" | "publish";
    done: number;
    total: number;
}

function Line({ count, children, tone }: { count: number; children: string; tone?: "warn" | "ok" }) {
    if (count === 0) return null;
    return (
        <li className={cn(tone === "warn" && "text-amber-400", tone === "ok" && "text-emerald-400 font-medium")}>
            {count} {children}
        </li>
    );
}

/**
 * Bulk publish with progress for any number of stories: the panel sends
 * batches of 200 to POST /admin/stories/bulk/publish and lists every skipped
 * story with its reason at the end. A missing cover never blocks publishing.
 */
export function BulkPublishDialog({
    ids,
    known,
    markReviewedFirst = false,
    defaultRequireReviewed = true,
    title,
    onClose,
    onChanged,
}: Props) {
    const [requireReviewed, setRequireReviewed] = useState(defaultRequireReviewed);
    const [progress, setProgress] = useState<Progress | null>(null);
    const [result, setResult] = useState<BulkPublishResponse | null>(null);
    const running = progress !== null && result === null;
    const plan = publishPlan(ids, known, { requireReviewed, markReviewedFirst });
    const titleFor = (id: string) => known.get(id)?.title ?? null;
    const toPublish = plan.willPublish + plan.unknown;

    const run = async () => {
        let publishIds = ids;
        const extraSkips: BulkSkip[] = [];
        const reviewedIds: string[] = [];
        if (markReviewedFirst) {
            setProgress({ step: "review", done: 0, total: ids.length });
            const marked = await runInBatches(
                ids,
                BULK_REVIEW_BATCH_SIZE,
                (batch) => StoriesService.bulkReview(batch, true).then((res) => ({ batch, data: res.data })),
                (done, total) => setProgress({ step: "review", done, total }),
            );
            const failed = new Set(marked.failures.flatMap((f) => f.items));
            for (const { batch, data } of marked.results) {
                const missing = new Set(data.missing);
                reviewedIds.push(...batch.filter((id) => !missing.has(id)));
            }
            extraSkips.push(
                ...failureSkips(
                    marked.failures,
                    (e) => getErrorMessage(e, "bilinmeyen hata"),
                    titleFor,
                    "İnceleme işareti kaydedilemedi",
                ),
            );
            publishIds = ids.filter((id) => !failed.has(id));
        }
        setProgress({ step: "publish", done: 0, total: publishIds.length });
        const published = await runInBatches(
            publishIds,
            BULK_BATCH_SIZE,
            (batch) => StoriesService.bulkPublish(batch, markReviewedFirst ? true : requireReviewed).then((res) => res.data),
            (done, total) => setProgress({ step: "publish", done, total }),
        );
        const merged = mergePublishResults(published.results, [
            ...extraSkips,
            ...failureSkips(published.failures, (e) => getErrorMessage(e, "bilinmeyen hata"), titleFor),
        ]);
        setResult(merged);
        onChanged({ publishedIds: merged.published.map((s) => s.id), reviewedIds });
    };

    const heading = title ?? (markReviewedFirst ? "İncelendi işaretle ve yayınla" : "Seçilenleri yayınla");

    return (
        <StoryModal
            title={heading}
            subtitle={result ? publishSummary(result) : `${ids.length} masal`}
            icon={<Send className="w-5 h-5 text-primary" />}
            onClose={onClose}
            busy={running}
        >
            {result ? (
                <div className="space-y-4">
                    {result.published.length > 0 && (
                        <div className="space-y-1">
                            <h4 className="text-xs font-semibold flex items-center gap-1.5 text-emerald-400">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Yayınlanan ({result.published.length})
                            </h4>
                            <ul className="text-xs space-y-0.5 max-h-40 overflow-y-auto">
                                {result.published.map((s) => (
                                    <li key={s.id}>
                                        {s.title} <span className="uppercase text-muted-foreground">{s.language}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {result.skipped.length > 0 && (
                        <div className="space-y-1">
                            <h4 className="text-xs font-semibold flex items-center gap-1.5 text-amber-400">
                                <AlertTriangle className="w-3.5 h-3.5" /> Atlanan ({result.skipped.length})
                            </h4>
                            <ul className="space-y-1.5 max-h-72 overflow-y-auto">
                                {result.skipped.map((s) => (
                                    <li key={s.storyId} className="border border-border rounded-md px-3 py-2 text-xs">
                                        <div className="font-medium">{s.title ?? titleFor(s.storyId) ?? s.storyId}</div>
                                        <div className="text-muted-foreground">{s.reason}</div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-full bg-primary hover:bg-primary/90 text-white py-2.5 rounded-xl text-sm font-medium"
                    >
                        Tamam
                    </button>
                </div>
            ) : progress ? (
                <ProgressBar
                    label={progress.step === "review" ? "İnceleme işareti kaydediliyor" : "Yayınlanıyor"}
                    done={progress.done}
                    total={progress.total}
                    note={`Pencereyi kapatma, istekler ${BULK_BATCH_SIZE} masallık parçalar halinde gönderiliyor.`}
                />
            ) : (
                <div className="space-y-4">
                    {markReviewedFirst ? (
                        <div className="border border-primary/30 bg-primary/5 rounded-md p-3 text-xs flex items-start gap-2">
                            <ClipboardCheck className="w-4 h-4 text-primary shrink-0 mt-px" />
                            <p>
                                Önce {ids.length} masalın tamamı senin adınla &quot;İncelendi&quot; olarak işaretlenir, sonra
                                yayınlanır. Yayın kuralına uymayanlar atlanır ve sonunda nedenleriyle listelenir.
                            </p>
                        </div>
                    ) : (
                        <label className="flex items-start gap-3 cursor-pointer border border-border rounded-md p-3">
                            <input
                                type="checkbox"
                                role="switch"
                                checked={requireReviewed}
                                onChange={(e) => setRequireReviewed(e.target.checked)}
                                className="w-4 h-4 mt-0.5 rounded border-border shrink-0"
                            />
                            <span className="text-sm">
                                Sadece incelenmişleri yayınla
                                <span className="block text-xs text-muted-foreground">
                                    {requireReviewed
                                        ? "\"İncelendi\" işareti olmayan masallar atlanır."
                                        : "İncelenmemiş masallar da yayınlanır. Metni okunmamış bir masal uygulamada görünür."}
                                </span>
                            </span>
                        </label>
                    )}
                    {!markReviewedFirst && !requireReviewed && (
                        <p className="text-xs text-amber-400 flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> İncelemeden yayınlama açık.
                        </p>
                    )}
                    <ul className="text-sm space-y-0.5">
                        <Line count={plan.willPublish} tone="ok">
                            masal yayınlanacak
                        </Line>
                        <Line count={plan.unknown}>masalın durumu yayınlanırken tek tek denetlenecek</Line>
                        <Line count={plan.alreadyPublished}>masal zaten yayında, atlanacak</Line>
                        <Line count={plan.notReviewed} tone="warn">
                            masal incelenmediği için atlanacak
                        </Line>
                        <Line count={plan.blocked} tone="warn">
                            masal yayın kuralına uymadığı için atlanacak (eksik atıf, lisans ya da kaynak)
                        </Line>
                    </ul>
                    <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                        <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
                        Kapak zorunlu değil: kapağı olmayan masal da yayınlanır. Her masal sunucuda yeniden denetlenir.
                    </p>
                    <button
                        type="button"
                        onClick={run}
                        disabled={toPublish === 0}
                        className="w-full bg-primary hover:bg-primary/90 text-white py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        <Send className="w-4 h-4" />
                        {toPublish === 0
                            ? "Yayınlanacak masal yok"
                            : markReviewedFirst
                              ? `Onayla: ${ids.length} masalı işaretle ve yayınla`
                              : `${toPublish} masalı yayınla`}
                    </button>
                </div>
            )}
        </StoryModal>
    );
}
