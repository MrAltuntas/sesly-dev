"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCheck, ClipboardCheck, ImageUp, ListChecks, Loader2, Rocket, Send, Undo2, X } from "lucide-react";
import { StoriesService } from "@/services/admin.service";
import type { ImportBatchSummary, StoriesMeta, StoryReviewCard } from "@/types/api.types";
import { usePermissions } from "@/hooks/usePermissions";
import { usePageSize } from "@/hooks/usePageSize";
import { useToast } from "@/hooks/useToast";
import { ErrorState, getErrorMessage } from "@/components/ui/error-state";
import { Pagination } from "@/components/ui/pagination";
import { PageSizeSelect } from "@/components/ui/page-size-select";
import { ReviewCard } from "@/components/stories/ReviewCard";
import { BulkPublishDialog } from "@/components/stories/BulkPublishDialog";
import {
    ReviewFilters,
    REVIEW_PAGE_SIZE,
    batchLabel,
    cardBrief,
    parseReviewFilters,
    reviewFiltersToApiParams,
    reviewFiltersToIdParams,
    reviewFiltersToQuery,
    selectionSummary,
} from "@/lib/review";
import {
    BULK_REVIEW_BATCH_SIZE,
    ID_LIST_MAX,
    PAGE_SIZE_KEYS,
    type StoryBrief,
    reviewSummary,
    runInBatches,
    selectAllMatchingLabel,
} from "@/lib/bulk";

const selectClass =
    "bg-background border border-border rounded-md px-2 py-1.5 text-xs focus:ring-2 focus:ring-primary focus:outline-none max-w-[18rem]";

const barButton =
    "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border font-medium hover:bg-muted transition-colors disabled:opacity-50";

export default function StoryReviewPage() {
    return (
        <Suspense
            fallback={
                <div className="flex items-center justify-center p-16">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
            }
        >
            <StoryReview />
        </Suspense>
    );
}

interface PublishRequest {
    ids: string[];
    markReviewedFirst: boolean;
}

function StoryReview() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { canViewStories, canReviewStories } = usePermissions();
    const toast = useToast();
    const [pageSize, setPageSize] = usePageSize(PAGE_SIZE_KEYS.review, REVIEW_PAGE_SIZE);

    const filtersKey = useMemo(
        () => new URLSearchParams(reviewFiltersToQuery(parseReviewFilters(searchParams))).toString(),
        [searchParams],
    );
    const filters = useMemo<ReviewFilters>(() => parseReviewFilters(new URLSearchParams(filtersKey)), [filtersKey]);
    const setFilters = useCallback(
        (changes: Partial<ReviewFilters>) => {
            const next = { ...filters, ...changes, page: changes.page ?? 1 };
            const qs = new URLSearchParams(reviewFiltersToQuery(next)).toString();
            router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        },
        [filters, pathname, router],
    );

    const [meta, setMeta] = useState<StoriesMeta | null>(null);
    const [batches, setBatches] = useState<ImportBatchSummary[]>([]);
    const [cards, setCards] = useState<StoryReviewCard[]>([]);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    // What the panel knows of every story it has seen (cards and id lists),
    // so a selection across pages can be summed up and named in reports.
    const [known, setKnown] = useState<Map<string, StoryBrief>>(new Map());
    const [selectingAll, setSelectingAll] = useState(false);
    const [marking, setMarking] = useState(false);
    const [publish, setPublish] = useState<PublishRequest | null>(null);
    const requestRef = useRef(0);

    const remember = useCallback((briefs: StoryBrief[]) => {
        if (briefs.length === 0) return;
        setKnown((prev) => {
            const next = new Map(prev);
            for (const brief of briefs) next.set(brief.id, brief);
            return next;
        });
    }, []);

    const loadCards = useCallback(async () => {
        const request = ++requestRef.current;
        setLoading(true);
        setError(null);
        try {
            const params = reviewFiltersToApiParams(parseReviewFilters(new URLSearchParams(filtersKey)), pageSize);
            const res = await StoriesService.getReviewList(params);
            if (request !== requestRef.current) return;
            const rows = res.data.data ?? [];
            setCards(rows);
            setTotal(res.data.total ?? 0);
            setTotalPages(res.data.totalPages ?? 1);
            remember(rows.map(cardBrief));
        } catch (e) {
            if (request !== requestRef.current) return;
            setCards([]);
            setError(getErrorMessage(e, "İnceleme listesi yüklenemedi."));
        } finally {
            if (request === requestRef.current) setLoading(false);
        }
    }, [filtersKey, pageSize, remember]);

    const loadBatches = useCallback(async () => {
        try {
            const res = await StoriesService.getImportBatches();
            setBatches(res.data.batches ?? []);
        } catch {
            setBatches([]);
        }
    }, []);

    useEffect(() => {
        if (!canViewStories) return;
        StoriesService.getMeta()
            .then((res) => setMeta(res.data))
            .catch(() => setMeta(null));
        loadBatches();
    }, [canViewStories, loadBatches]);

    useEffect(() => {
        if (!canViewStories) return;
        loadCards();
    }, [canViewStories, loadCards]);

    const toggleSelect = useCallback(
        (id: string) =>
            setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
            }),
        [],
    );

    const pageIds = useMemo(() => cards.map((c) => c.id), [cards]);
    const pageIdSet = useMemo(() => new Set(pageIds), [pageIds]);
    const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
    const summary = useMemo(() => selectionSummary(known.values(), selected), [known, selected]);

    /** Review marks changed for these ids: cards, pair links and the known map follow. */
    const applyReviewed = useCallback((ids: string[], reviewed: boolean, by: string | null = null) => {
        const set = new Set(ids);
        setCards((prev) =>
            prev.map((c) => {
                const own = set.has(c.id)
                    ? { ...c, reviewed, reviewedAt: reviewed ? (c.reviewedAt ?? new Date().toISOString()) : null, reviewedBy: reviewed ? (c.reviewedBy ?? by) : null }
                    : c;
                return own.translations.some((t) => set.has(t.id))
                    ? { ...own, translations: own.translations.map((t) => (set.has(t.id) ? { ...t, reviewed } : t)) }
                    : own;
            }),
        );
        setKnown((prev) => {
            const next = new Map(prev);
            for (const id of ids) {
                const brief = next.get(id);
                if (brief) next.set(id, { ...brief, reviewed });
            }
            return next;
        });
    }, []);

    const toggleReviewed = useCallback(
        async (card: StoryReviewCard) => {
            try {
                const res = await StoriesService.setReviewed(card.id, !card.reviewed);
                applyReviewed([card.id], res.data.reviewed, res.data.reviewedBy);
                loadBatches();
            } catch (e) {
                toast.error(getErrorMessage(e, "İnceleme durumu kaydedilemedi."));
            }
        },
        [applyReviewed, loadBatches, toast],
    );

    /** Every story of the current filters (all pages), at most ID_LIST_MAX. */
    const fetchMatchingIds = async (): Promise<string[] | null> => {
        try {
            const res = await StoriesService.getIds(reviewFiltersToIdParams(filters));
            remember(res.data.items);
            if (res.data.truncated) {
                toast.info(`Filtreye uyan ${res.data.total} masaldan ilk ${ID_LIST_MAX} tanesi alındı.`);
            }
            return res.data.items.map((item) => item.id);
        } catch (e) {
            toast.error(getErrorMessage(e, "Filtreye uyan masallar alınamadı."));
            return null;
        }
    };

    const selectAllMatching = async () => {
        setSelectingAll(true);
        try {
            const ids = await fetchMatchingIds();
            if (ids) setSelected(new Set(ids));
        } finally {
            setSelectingAll(false);
        }
    };

    const reviewAndPublishAll = async () => {
        setSelectingAll(true);
        try {
            const ids = await fetchMatchingIds();
            if (ids && ids.length > 0) setPublish({ ids, markReviewedFirst: true });
            else if (ids) toast.info("Bu filtrelere uyan masal yok.");
        } finally {
            setSelectingAll(false);
        }
    };

    const markSelected = async (reviewed: boolean) => {
        const ids = Array.from(selected);
        if (ids.length === 0) return;
        setMarking(true);
        try {
            const { results, failures } = await runInBatches(ids, BULK_REVIEW_BATCH_SIZE, (batch) =>
                StoriesService.bulkReview(batch, reviewed).then((res) => ({ batch, data: res.data })),
            );
            let changed = 0;
            let unchanged = 0;
            let missing = 0;
            const done: string[] = [];
            for (const { batch, data } of results) {
                changed += data.changed;
                unchanged += data.unchanged;
                missing += data.missing.length;
                const gone = new Set(data.missing);
                done.push(...batch.filter((id) => !gone.has(id)));
            }
            applyReviewed(done, reviewed);
            if (failures.length > 0) {
                const failedCount = failures.reduce((n, f) => n + f.items.length, 0);
                toast.error(`${failedCount} masalın işareti kaydedilemedi: ${getErrorMessage(failures[0].error, "bilinmeyen hata")}`);
            }
            if (results.length > 0) toast.success(reviewSummary(reviewed, changed, unchanged, missing));
            loadBatches();
            loadCards();
        } finally {
            setMarking(false);
        }
    };

    const onPublished = useCallback(
        ({ publishedIds, reviewedIds }: { publishedIds: string[]; reviewedIds: string[] }) => {
            // Stories of other pages stay in `known`: keep their mark and status current.
            if (reviewedIds.length > 0) applyReviewed(reviewedIds, true);
            if (publishedIds.length > 0) {
                const gone = new Set(publishedIds);
                setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))));
                setKnown((prev) => {
                    const next = new Map(prev);
                    for (const id of publishedIds) {
                        const brief = next.get(id);
                        if (brief) next.set(id, { ...brief, status: "PUBLISHED" });
                    }
                    return next;
                });
            }
            loadCards();
            loadBatches();
        },
        [applyReviewed, loadBatches, loadCards],
    );

    if (!canViewStories) {
        return <div className="p-6 text-sm text-muted-foreground">Bu sayfa için masal görme yetkisi gerekir.</div>;
    }

    const busy = selectingAll || marking;

    return (
        <div className="space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <Link href="/stories" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1">
                        <ArrowLeft className="w-3.5 h-3.5" /> İçerik Stüdyosu
                    </Link>
                    <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <ClipboardCheck className="w-7 h-7" /> Yayından önce inceleme
                    </h2>
                    <p className="text-muted-foreground">
                        Toplu aktarımla gelen taslak masallar. Her birini oku, &quot;İncelendi&quot; olarak işaretle, sonra seçtiklerini
                        birlikte yayınla.
                    </p>
                </div>
                {canReviewStories && (
                    <Link
                        href="/stories/covers"
                        className="bg-secondary/30 hover:bg-secondary/50 border border-border px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2"
                    >
                        <ImageUp className="w-4 h-4" /> Toplu kapak yükle
                    </Link>
                )}
            </div>

            <div className="border border-border rounded-xl bg-card p-3 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
                    Aktarım
                    <select value={filters.batch} onChange={(e) => setFilters({ batch: e.target.value })} className={selectClass}>
                        <option value="">Bütün aktarımlar</option>
                        {batches
                            .filter((b) => b.batch)
                            .map((b) => (
                                <option key={b.batch!} value={b.batch!}>
                                    {batchLabel(b)}
                                </option>
                            ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
                    Dil
                    <select value={filters.language} onChange={(e) => setFilters({ language: e.target.value })} className={selectClass}>
                        <option value="">Tüm diller</option>
                        {(meta?.languages.all ?? []).map((l) => (
                            <option key={l.code} value={l.code}>
                                {l.nativeName} ({l.code})
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
                    İnceleme
                    <select value={filters.reviewed} onChange={(e) => setFilters({ reviewed: e.target.value })} className={selectClass}>
                        <option value="">Hepsi</option>
                        <option value="no">İncelenmedi</option>
                        <option value="yes">İncelendi</option>
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
                    Durum
                    <select value={filters.status} onChange={(e) => setFilters({ status: e.target.value })} className={selectClass}>
                        {(meta?.enums.status ?? []).map((s) => (
                            <option key={s.value} value={s.value}>
                                {s.label}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="ml-auto flex items-center gap-3">
                    <PageSizeSelect
                        value={pageSize}
                        onChange={(size) => {
                            setPageSize(size);
                            if (filters.page !== 1) setFilters({ page: 1 });
                        }}
                        disabled={loading}
                    />
                    <span className="text-xs text-muted-foreground">{total} masal</span>
                </div>
            </div>

            {canReviewStories && total > 0 && (
                <div className="border border-primary/40 bg-card shadow-lg rounded-xl px-3 py-2 space-y-2 text-xs sticky top-0 z-20">
                    <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-1.5 cursor-pointer mr-1">
                            <input
                                type="checkbox"
                                checked={allOnPage}
                                disabled={cards.length === 0}
                                onChange={(e) =>
                                    setSelected((prev) => {
                                        const next = new Set(prev);
                                        for (const id of pageIds) {
                                            if (e.target.checked) next.add(id);
                                            else next.delete(id);
                                        }
                                        return next;
                                    })
                                }
                            />
                            Sayfadakileri seç
                        </label>
                        <button type="button" onClick={selectAllMatching} disabled={busy} className={barButton}>
                            {selectingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListChecks className="w-3.5 h-3.5" />}
                            {selectAllMatchingLabel(total)}
                        </button>
                        <button
                            type="button"
                            onClick={reviewAndPublishAll}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-primary/50 text-primary font-medium hover:bg-primary/10 transition-colors disabled:opacity-50 ml-auto"
                        >
                            <Rocket className="w-3.5 h-3.5" />
                            Filtredeki tümünü incelendi işaretle ve yayınla
                        </button>
                    </div>
                    {selected.size > 0 && (
                        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
                            <span className="font-semibold text-primary">{summary.total} masal seçildi</span>
                            <span className="text-muted-foreground">
                                {summary.ready} yayına hazır
                                {summary.notReviewed > 0 ? `, ${summary.notReviewed} incelenmedi` : ""}
                                {summary.blocked > 0 ? `, ${summary.blocked} eksik alan yüzünden yayınlanamaz` : ""}
                            </span>
                            <button type="button" onClick={() => markSelected(true)} disabled={busy} className={barButton}>
                                {marking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
                                Seçilenleri incelendi işaretle
                            </button>
                            <button type="button" onClick={() => markSelected(false)} disabled={busy} className={barButton}>
                                <Undo2 className="w-3.5 h-3.5" />
                                İncelendi işaretini kaldır
                            </button>
                            <button
                                type="button"
                                onClick={() => setPublish({ ids: Array.from(selected), markReviewedFirst: false })}
                                disabled={busy}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-white font-medium disabled:opacity-50"
                            >
                                <Send className="w-3.5 h-3.5" />
                                Seçilenleri yayınla
                            </button>
                            <button
                                type="button"
                                onClick={() => setSelected(new Set())}
                                className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                            >
                                <X className="w-3.5 h-3.5" /> Seçimi temizle
                            </button>
                        </div>
                    )}
                </div>
            )}

            {error ? (
                <div className="border border-border rounded-xl bg-card">
                    <ErrorState message={error} onRetry={loadCards} retryLabel="Tekrar dene" />
                </div>
            ) : loading && cards.length === 0 ? (
                <div className="flex items-center justify-center p-16">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
            ) : cards.length === 0 ? (
                <div className="border border-dashed border-border rounded-xl p-10 text-center text-sm text-muted-foreground space-y-2">
                    <p>Bu filtrelere uyan aktarılmış masal yok.</p>
                    <Link href="/stories/import" className="text-primary hover:underline">
                        Toplu aktarım sayfasına git
                    </Link>
                </div>
            ) : (
                <div className="space-y-3">
                    {cards.map((card) => (
                        <ReviewCard
                            key={card.id}
                            card={card}
                            meta={meta}
                            selected={selected.has(card.id)}
                            onToggleSelect={toggleSelect}
                            onToggleReviewed={toggleReviewed}
                            onCoverUploaded={loadCards}
                            canEdit={canReviewStories}
                            pageIds={pageIdSet}
                        />
                    ))}
                </div>
            )}

            {total > 0 && (
                <Pagination
                    page={filters.page}
                    totalPages={totalPages}
                    total={total}
                    onPageChange={(page) => setFilters({ page })}
                    disabled={loading}
                    itemLabel="masal"
                    prevLabel="Önceki"
                    nextLabel="Sonraki"
                />
            )}

            {publish && (
                <BulkPublishDialog
                    ids={publish.ids}
                    known={known}
                    markReviewedFirst={publish.markReviewedFirst}
                    title={publish.markReviewedFirst ? "Filtredeki tümünü incelendi işaretle ve yayınla" : undefined}
                    onClose={() => setPublish(null)}
                    onChanged={onPublished}
                />
            )}
        </div>
    );
}
