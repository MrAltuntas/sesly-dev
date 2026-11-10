"use client";

import { MouseEvent } from "react";
import { BookOpen, ChevronLeft, ChevronRight, ListChecks, Loader2, MessageSquarePlus, PenLine, Sparkles, Trash2 } from "lucide-react";
import type { AdminStoryListItem, StoriesMeta } from "@/types/api.types";
import { ErrorState } from "@/components/ui/error-state";
import { PageSizeSelect } from "@/components/ui/page-size-select";
import { selectAllMatchingLabel } from "@/lib/bulk";
import { languageName, optionLabel } from "@/lib/stories";
import { cn } from "@/lib/utils";
import { LanguageBadge, StatusBadge } from "./form-fields";
import { CoverThumb } from "./CoverThumb";

interface Props {
    meta: StoriesMeta | null;
    rows: AdminStoryListItem[];
    total: number;
    page: number;
    totalPages: number;
    loading: boolean;
    error: string | null;
    onRetry: () => void;
    hasFilters: boolean;
    onClearFilters: () => void;
    onPageChange: (page: number) => void;

    selectedId: string | null;
    /** Real link target of a row, so it can be opened in a new tab. */
    hrefFor: (id: string) => string;
    onOpen: (id: string) => void;

    /** Bulk selection. Hidden for roles that cannot run the bulk actions. */
    canSelect: boolean;
    checkedIds: Set<string>;
    onToggle: (id: string) => void;
    onToggleAll: (ids: string[], checked: boolean) => void;
    /** Selects every story of the filters across pages. */
    onSelectAllMatching: () => void;
    selectingAll: boolean;

    pageSize: number;
    onPageSizeChange: (size: number) => void;

    canDelete: boolean;
    onDelete: (story: AdminStoryListItem) => void;

    /** Click or drop a picture on a row's thumbnail to upload its cover. */
    canEditCover: boolean;
    onCoverUploaded: (storyIds: string[]) => void;
}

function LevelMarker({ story, meta }: { story: AdminStoryListItem; meta: StoriesMeta | null }) {
    if (!story.languageLevel) {
        return (
            <span
                title="Dil seviyesi belirlenmedi"
                className="inline-flex items-center px-1.5 py-0.5 rounded border border-dashed border-border text-[10px] text-muted-foreground"
            >
                Seviye yok
            </span>
        );
    }
    const isAi = story.languageLevelSource === "AI";
    const sourceLabel = optionLabel(meta?.enums.languageLevelSource, story.languageLevelSource) || "Kaynak bilinmiyor";
    const Icon = isAi ? Sparkles : PenLine;
    return (
        <span
            title={`${optionLabel(meta?.enums.languageLevel, story.languageLevel)} - ${sourceLabel}`}
            className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold",
                isAi
                    ? "border-violet-500/40 bg-violet-500/10 text-violet-300"
                    : "border-sky-500/40 bg-sky-500/10 text-sky-300",
            )}
        >
            <Icon className="w-3 h-3" aria-hidden />
            {story.languageLevel}
            <span className="sr-only">{sourceLabel}</span>
        </span>
    );
}

/** Open translation requests of users for the tale of the row. */
function RequestsBadge({ story, meta }: { story: AdminStoryListItem; meta: StoriesMeta | null }) {
    const requests = story.translationRequests;
    if (!requests || requests.total === 0) return null;
    const detail = requests.languages
        .map((entry) => `${languageName(meta, entry.language)}: ${entry.count}`)
        .join(", ");
    return (
        <span
            title={`Çeviri isteği: ${detail}`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 text-[10px] font-semibold"
        >
            <MessageSquarePlus className="w-3 h-3" aria-hidden />
            {requests.total} istek
            <span className="sr-only">{detail}</span>
        </span>
    );
}

export function StoryListPanel({
    meta,
    rows,
    total,
    page,
    totalPages,
    loading,
    error,
    onRetry,
    hasFilters,
    onClearFilters,
    onPageChange,
    selectedId,
    hrefFor,
    onOpen,
    canSelect,
    checkedIds,
    onToggle,
    onToggleAll,
    onSelectAllMatching,
    selectingAll,
    pageSize,
    onPageSizeChange,
    canDelete,
    onDelete,
    canEditCover,
    onCoverUploaded,
}: Props) {
    const pageIds = rows.map((row) => row.id);
    const allChecked = pageIds.length > 0 && pageIds.every((id) => checkedIds.has(id));
    const someChecked = pageIds.some((id) => checkedIds.has(id));
    const safeTotalPages = Math.max(totalPages, 1);

    const handleRowClick = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
        // Let the browser handle "open in new tab" gestures.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(id);
    };

    return (
        <div className="border border-border rounded-xl bg-card overflow-hidden flex flex-col h-full min-h-0">
            <div className="p-3 border-b border-border bg-muted/20 font-medium text-sm flex items-center gap-2">
                {canSelect && (
                    <input
                        type="checkbox"
                        aria-label="Bu sayfadaki masalların tümünü seç"
                        checked={allChecked}
                        ref={(el) => {
                            if (el) el.indeterminate = !allChecked && someChecked;
                        }}
                        onChange={(e) => onToggleAll(pageIds, e.target.checked)}
                        disabled={rows.length === 0}
                        className="w-4 h-4 rounded border-border"
                    />
                )}
                <BookOpen className="w-4 h-4" />
                <span className="flex-1">Masallar ({total})</span>
                {loading && rows.length > 0 && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </div>
            {canSelect && total > rows.length && (
                <div className="px-3 py-1.5 border-b border-border text-xs">
                    <button
                        type="button"
                        onClick={onSelectAllMatching}
                        disabled={selectingAll || loading}
                        className="inline-flex items-center gap-1.5 text-primary hover:underline disabled:opacity-50"
                    >
                        {selectingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListChecks className="w-3.5 h-3.5" />}
                        {selectAllMatchingLabel(total)}
                    </button>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {error ? (
                    <ErrorState message={error} onRetry={onRetry} retryLabel="Tekrar dene" />
                ) : loading && rows.length === 0 ? (
                    <div className="flex items-center justify-center p-8">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                ) : rows.length === 0 ? (
                    <div className="text-center p-8 text-sm text-muted-foreground space-y-3">
                        <p>{hasFilters ? "Bu filtrelere uyan masal yok." : "Henüz masal yok."}</p>
                        {hasFilters && (
                            <button
                                type="button"
                                onClick={onClearFilters}
                                className="px-3 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-muted transition-colors"
                            >
                                Filtreleri temizle
                            </button>
                        )}
                    </div>
                ) : (
                    rows.map((story) => {
                        const isSelected = selectedId === story.id;
                        const others = (story.groupLanguages ?? []).filter((code) => code !== story.language);
                        return (
                            <div
                                key={story.id}
                                className={cn(
                                    "rounded-md text-sm flex items-start gap-2 group transition-colors px-2 py-2",
                                    isSelected ? "bg-primary/10" : "hover:bg-muted",
                                )}
                            >
                                {canSelect && (
                                    <input
                                        type="checkbox"
                                        aria-label={`${story.title} masalını seç`}
                                        checked={checkedIds.has(story.id)}
                                        onChange={() => onToggle(story.id)}
                                        className="w-4 h-4 mt-0.5 rounded border-border shrink-0"
                                    />
                                )}
                                <CoverThumb
                                    storyId={story.id}
                                    title={story.title}
                                    coverUrl={story.coverImageUrl}
                                    canEdit={canEditCover}
                                    onUploaded={(res) => onCoverUploaded(res.storyIds)}
                                />
                                <a
                                    href={hrefFor(story.id)}
                                    onClick={(e) => handleRowClick(e, story.id)}
                                    aria-current={isSelected ? "true" : undefined}
                                    className="flex-1 min-w-0 block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                                >
                                    <span className={cn("block truncate font-medium", isSelected && "text-primary")}>
                                        {story.title}
                                    </span>
                                    <span className="mt-1 flex flex-wrap items-center gap-1">
                                        <LanguageBadge code={story.language} title={languageName(meta, story.language)} />
                                        <LevelMarker story={story} meta={meta} />
                                        <StatusBadge
                                            status={story.status}
                                            label={optionLabel(meta?.enums.status, story.status)}
                                        />
                                        <RequestsBadge story={story} meta={meta} />
                                    </span>
                                    <span className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                                        {others.length > 0 ? (
                                            <>
                                                <span>Çeviriler:</span>
                                                {others.map((code) => (
                                                    <LanguageBadge
                                                        key={code}
                                                        code={code}
                                                        title={languageName(meta, code)}
                                                        muted
                                                    />
                                                ))}
                                            </>
                                        ) : (
                                            <span>Çevirisi yok</span>
                                        )}
                                    </span>
                                </a>
                                {canDelete && (
                                    <button
                                        type="button"
                                        onClick={() => onDelete(story)}
                                        title="Masalı sil"
                                        aria-label={`${story.title} masalını sil`}
                                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity p-1 shrink-0"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {!error && total > 0 && (
                <div className="border-t border-border px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                        Sayfa {Math.min(page, safeTotalPages)} / {safeTotalPages}
                    </span>
                    <PageSizeSelect value={pageSize} onChange={onPageSizeChange} disabled={loading} />
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => onPageChange(page - 1)}
                            disabled={page <= 1 || loading}
                            aria-label="Önceki sayfa"
                            title="Önceki sayfa"
                            className="p-1.5 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => onPageChange(page + 1)}
                            disabled={page >= safeTotalPages || loading}
                            aria-label="Sonraki sayfa"
                            title="Sonraki sayfa"
                            className="p-1.5 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
