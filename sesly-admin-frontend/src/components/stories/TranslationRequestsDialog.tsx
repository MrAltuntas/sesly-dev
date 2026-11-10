"use client";

import { MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Languages, Loader2, RefreshCw } from "lucide-react";
import { StoriesService } from "@/services/admin.service";
import type { StoriesMeta, TranslationRequestRow } from "@/types/api.types";
import { useToast } from "@/hooks/useToast";
import { ErrorState, getErrorMessage } from "@/components/ui/error-state";
import { formatDateTime, getApiErrorData, languageName, optionLabel } from "@/lib/stories";
import { LanguageBadge, StatusBadge } from "./form-fields";
import { StoryModal } from "./StoryModal";

const PAGE_SIZE = 20;

interface Props {
    meta: StoriesMeta | null;
    /** Only roles that may start a translation see the button. */
    canTranslate: boolean;
    onClose: () => void;
    /** A translation task was queued: the task lists should refresh. */
    onQueued: () => void;
    hrefFor: (id: string) => string;
    onOpenStory: (id: string) => void;
}

const rowKey = (row: TranslationRequestRow) => `${row.groupKey}|${row.language}`;

/**
 * What users asked for: one row per tale and language with the number of
 * requests, most requested first. "Çevir" starts the usual machine
 * translation task from the story named in the row.
 */
export function TranslationRequestsDialog({ meta, canTranslate, onClose, onQueued, hrefFor, onOpenStory }: Props) {
    const toast = useToast();
    const [rows, setRows] = useState<TranslationRequestRow[]>([]);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [startingKey, setStartingKey] = useState<string | null>(null);
    // Rows whose translation was queued in this dialog (or was already running).
    const [queuedKeys, setQueuedKeys] = useState<Set<string>>(new Set());
    const requestRef = useRef(0);

    const load = useCallback(async (nextPage: number) => {
        const request = ++requestRef.current;
        setLoading(true);
        setError(null);
        try {
            const res = await StoriesService.getTranslationRequests({ page: nextPage, limit: PAGE_SIZE });
            if (request !== requestRef.current) return;
            setRows(res.data.data ?? []);
            setTotal(res.data.total ?? 0);
            setTotalPages(Math.max(res.data.totalPages ?? 1, 1));
        } catch (e) {
            if (request !== requestRef.current) return;
            console.error("Failed to load translation requests", e);
            setError(getErrorMessage(e, "Çeviri istekleri yüklenemedi."));
        } finally {
            if (request === requestRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        load(page);
    }, [load, page]);

    const markQueued = (key: string) => {
        setQueuedKeys((prev) => new Set(prev).add(key));
    };

    const handleTranslate = async (row: TranslationRequestRow) => {
        if (!row.story) return;
        const key = rowKey(row);
        setStartingKey(key);
        try {
            await StoriesService.translate(row.story.id, row.language);
            toast.success(`${row.languageName} çevirisi sıraya alındı. Taslak olarak kaydedilecek.`);
            markQueued(key);
            onQueued();
        } catch (e) {
            const data = getApiErrorData(e);
            if (data.code === "STORY_LLM_TASK_ACTIVE") {
                toast.info(data.message ?? "Bu çeviri zaten sırada ya da çalışıyor.");
                markQueued(key);
                onQueued();
            } else {
                console.error("Failed to start translation", e);
                toast.error(getErrorMessage(e, "Çeviri başlatılamadı."));
                // The tale may have got a version in that language meanwhile.
                if (data.code === "TRANSLATION_EXISTS") load(page);
            }
        } finally {
            setStartingKey(null);
        }
    };

    const open = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onClose();
        onOpenStory(id);
    };

    return (
        <StoryModal
            title="Çeviri istekleri"
            subtitle="Kullanıcıların başka dilde istediği masallar. En çok istenen üstte. Çeviri yayınlanınca isteyenlere bildirim gider."
            icon={<Languages className="w-5 h-5 text-primary" />}
            onClose={onClose}
        >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{loading && rows.length === 0 ? "Yükleniyor..." : `Bekleyen istek: ${total} masal ve dil`}</span>
                <button
                    type="button"
                    onClick={() => load(page)}
                    disabled={loading}
                    className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-foreground font-medium hover:bg-muted transition-colors disabled:opacity-50"
                >
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Yenile
                </button>
            </div>

            {error ? (
                <ErrorState message={error} onRetry={() => load(page)} retryLabel="Tekrar dene" />
            ) : loading && rows.length === 0 ? (
                <div className="flex items-center justify-center p-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
            ) : rows.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground p-8">Bekleyen çeviri isteği yok.</p>
            ) : (
                <ul className="space-y-2">
                    {rows.map((row) => {
                        const key = rowKey(row);
                        const queued = queuedKeys.has(key);
                        const starting = startingKey === key;
                        return (
                            <li
                                key={key}
                                className="border border-border rounded-md bg-background/40 p-3 flex flex-wrap items-start gap-3 text-xs"
                            >
                                <div className="flex-1 min-w-[200px] space-y-1">
                                    {row.story ? (
                                        <a
                                            href={hrefFor(row.story.id)}
                                            onClick={(e) => open(e, row.story!.id)}
                                            className="text-sm font-medium text-primary hover:underline"
                                        >
                                            {row.story.title}
                                        </a>
                                    ) : (
                                        <span className="text-sm font-medium text-muted-foreground">
                                            Kaynak masal bulunamadı
                                        </span>
                                    )}
                                    <div className="flex flex-wrap items-center gap-1 text-muted-foreground">
                                        <span>Var olan diller:</span>
                                        {row.groupLanguages.map((code) => (
                                            <LanguageBadge key={code} code={code} title={languageName(meta, code)} muted />
                                        ))}
                                    </div>
                                    {row.existingVersion && (
                                        <p className="flex flex-wrap items-center gap-1.5 text-amber-400">
                                            Bu dilde bir kayıt zaten var:
                                            <a
                                                href={hrefFor(row.existingVersion.id)}
                                                onClick={(e) => open(e, row.existingVersion!.id)}
                                                className="text-primary hover:underline"
                                            >
                                                {row.existingVersion.title}
                                            </a>
                                            <StatusBadge
                                                status={row.existingVersion.status}
                                                label={optionLabel(meta?.enums.status, row.existingVersion.status)}
                                            />
                                        </p>
                                    )}
                                    {row.latestRequestedAt && (
                                        <p className="text-muted-foreground">
                                            Son istek: {formatDateTime(row.latestRequestedAt)}
                                        </p>
                                    )}
                                </div>

                                <div className="flex flex-col items-end gap-2 shrink-0">
                                    <div className="flex items-center gap-2">
                                        <LanguageBadge code={row.language} title={row.languageName} />
                                        <span className="font-medium text-foreground">{row.languageName}</span>
                                        <span
                                            title="İstek sayısı"
                                            className="inline-flex items-center justify-center min-w-[1.75rem] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-semibold"
                                        >
                                            {row.requestCount}
                                        </span>
                                    </div>
                                    {canTranslate && row.story && !row.existingVersion && (
                                        <button
                                            type="button"
                                            onClick={() => handleTranslate(row)}
                                            disabled={starting || queued}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-white font-medium transition-colors disabled:opacity-50"
                                        >
                                            {starting ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                                <Languages className="w-3.5 h-3.5" />
                                            )}
                                            {queued ? "Sıraya alındı" : "Çevir"}
                                        </button>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {!error && totalPages > 1 && (
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                        Sayfa {page} / {totalPages}
                    </span>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setPage((current) => Math.max(1, current - 1))}
                            disabled={page <= 1 || loading}
                            aria-label="Önceki sayfa"
                            title="Önceki sayfa"
                            className="p-1.5 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                            disabled={page >= totalPages || loading}
                            aria-label="Sonraki sayfa"
                            title="Sonraki sayfa"
                            className="p-1.5 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </StoryModal>
    );
}
