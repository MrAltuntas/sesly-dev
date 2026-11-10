"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Library,
    Plus,
    Pencil,
    Trash2,
    Loader2,
    X,
    ArrowUp,
    ArrowDown,
    Save,
    BookOpen,
    Search,
    EyeOff,
} from "lucide-react";
import {
    CollectionsService,
    StoriesService,
} from "@/services/admin.service";
import {
    Collection,
    CollectionStoryItem,
    CollectionTone,
    CreateCollectionDto,
    AdminStoryListItem,
    UpdateCollectionDto,
} from "@/types/api.types";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { usePermissions } from "@/hooks/usePermissions";
import { ErrorState, getErrorMessage } from "@/components/ui/error-state";
import { Pagination } from "@/components/ui/pagination";

// Backend caps every list at 100 per page.
const COLLECTIONS_PAGE_SIZE = 100;
const COLLECTION_STORIES_PAGE_SIZE = 100;
const STORY_POOL_PAGE_SIZE = 50;
const STORY_POOL_SEARCH_DELAY_MS = 300;

function InactiveBadge({ className }: { className?: string }) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
                className,
            )}
            title="Hidden from the mobile app"
        >
            <EyeOff className="w-3 h-3" />
            Inactive
        </span>
    );
}

const toneLabels: Record<CollectionTone, string> = {
    [CollectionTone.ACCENT]: "Accent (mor)",
    [CollectionTone.TRUST]: "Trust (mavi)",
    [CollectionTone.NATURE]: "Nature (yeşil)",
    [CollectionTone.SUN]: "Sun (sarı)",
};

const toneChipClass: Record<CollectionTone, string> = {
    [CollectionTone.ACCENT]: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    [CollectionTone.TRUST]: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    [CollectionTone.NATURE]: "bg-green-500/15 text-green-300 border-green-500/30",
    [CollectionTone.SUN]: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
};

const emptyForm = (): CreateCollectionDto => ({
    slug: "",
    title: "",
    subtitle: "",
    description: "",
    tone: CollectionTone.ACCENT,
    coverImageUrl: "",
    isActive: true,
    sortOrder: 0,
});

export default function CollectionsPage() {
    const toast = useToast();
    const confirm = useConfirm();
    const { canEditCollections, canManageCollectionStories } = usePermissions();

    const [collections, setCollections] = useState<Collection[]>([]);
    const [collectionsPage, setCollectionsPage] = useState(1);
    const [collectionsTotal, setCollectionsTotal] = useState(0);
    const [collectionsTotalPages, setCollectionsTotalPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [collectionsError, setCollectionsError] = useState<string | null>(null);
    const [selected, setSelected] = useState<Collection | null>(null);
    const [stories, setStories] = useState<CollectionStoryItem[]>([]);
    const [storiesLoading, setStoriesLoading] = useState(false);
    const [storiesError, setStoriesError] = useState<string | null>(null);

    // Create/edit modal
    const [modalOpen, setModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<CreateCollectionDto>(emptyForm());
    const [saving, setSaving] = useState(false);

    // Attach-story modal
    const [attachOpen, setAttachOpen] = useState(false);
    const [storyPool, setStoryPool] = useState<AdminStoryListItem[]>([]);
    const [storyPoolPage, setStoryPoolPage] = useState(1);
    const [storyPoolTotal, setStoryPoolTotal] = useState(0);
    const [storyPoolTotalPages, setStoryPoolTotalPages] = useState(1);
    const [storyPoolLoading, setStoryPoolLoading] = useState(false);
    const [storyPoolError, setStoryPoolError] = useState<string | null>(null);
    const [storyPoolSearch, setStoryPoolSearch] = useState("");
    const [attachPending, setAttachPending] = useState<string | null>(null);

    const selectedId = selected?.id ?? null;

    const loadCollections = useCallback(async () => {
        setLoading(true);
        setCollectionsError(null);
        try {
            const res = await CollectionsService.getAll({
                page: collectionsPage,
                limit: COLLECTIONS_PAGE_SIZE,
            });
            const list = res.data.data;
            setCollections(list);
            setCollectionsTotal(res.data.total);
            setCollectionsTotalPages(res.data.totalPages);
            // Refresh the selected row (storyCount, isActive) if it is on this page.
            setSelected((prev) => {
                if (!prev) return prev;
                return list.find((c) => c.id === prev.id) ?? prev;
            });
        } catch (e) {
            console.error("Failed to load collections", e);
            setCollections([]);
            setCollectionsError(getErrorMessage(e, "Could not load collections."));
        } finally {
            setLoading(false);
        }
    }, [collectionsPage]);

    // Reorder sends the full id list, so load every page of the collection.
    const loadStories = useCallback(async (collectionId: string) => {
        setStoriesLoading(true);
        setStoriesError(null);
        try {
            const all: CollectionStoryItem[] = [];
            let page = 1;
            let totalPages = 1;
            do {
                const res = await CollectionsService.getStories(collectionId, {
                    page,
                    limit: COLLECTION_STORIES_PAGE_SIZE,
                });
                all.push(...res.data.data);
                totalPages = res.data.totalPages;
                page += 1;
            } while (page <= totalPages);
            all.sort((a, b) => a.position - b.position);
            setStories(all);
        } catch (e) {
            console.error("Failed to load collection stories", e);
            setStories([]);
            setStoriesError(getErrorMessage(e, "Could not load the stories in this collection."));
        } finally {
            setStoriesLoading(false);
        }
    }, []);

    useEffect(() => {
        loadCollections();
    }, [loadCollections]);

    useEffect(() => {
        if (selectedId) {
            loadStories(selectedId);
        } else {
            setStories([]);
            setStoriesError(null);
        }
    }, [selectedId, loadStories]);

    const openCreateModal = () => {
        setEditingId(null);
        setForm(emptyForm());
        setModalOpen(true);
    };

    const openEditModal = (c: Collection) => {
        setEditingId(c.id);
        setForm({
            slug: c.slug,
            title: c.title,
            subtitle: c.subtitle ?? "",
            description: c.description ?? "",
            tone: c.tone,
            coverImageUrl: c.coverImageUrl ?? "",
            isActive: c.isActive,
            sortOrder: c.sortOrder,
        });
        setModalOpen(true);
    };

    const closeModal = () => {
        setModalOpen(false);
        setEditingId(null);
        setForm(emptyForm());
    };

    const saveCollection = async () => {
        if (!form.title.trim()) {
            toast.error("Title is required");
            return;
        }
        if (!editingId) {
            if (!form.slug.trim()) {
                toast.error("Slug is required");
                return;
            }
            if (!/^[a-z0-9-]+$/.test(form.slug)) {
                toast.error("Slug must be lowercase letters, numbers and dashes");
                return;
            }
        }

        setSaving(true);
        try {
            if (editingId) {
                const payload: UpdateCollectionDto = {
                    title: form.title,
                    subtitle: form.subtitle || undefined,
                    description: form.description || undefined,
                    tone: form.tone,
                    coverImageUrl: form.coverImageUrl || undefined,
                    isActive: form.isActive,
                    sortOrder: form.sortOrder ?? 0,
                };
                await CollectionsService.update(editingId, payload);
                toast.success("Collection updated");
            } else {
                const payload: CreateCollectionDto = {
                    ...form,
                    subtitle: form.subtitle || undefined,
                    description: form.description || undefined,
                    coverImageUrl: form.coverImageUrl || undefined,
                };
                await CollectionsService.create(payload);
                toast.success("Collection created");
            }
            closeModal();
            await loadCollections();
        } catch (e: unknown) {
            toast.error(getErrorMessage(e, "Save failed"));
        } finally {
            setSaving(false);
        }
    };

    const deleteCollection = async (c: Collection) => {
        if (!canEditCollections) {
            toast.error("You can't delete collections");
            return;
        }
        const ok = await confirm({
            title: "Delete collection?",
            message: `Delete collection "${c.title}"?\n\nStory attachments will be removed but the stories themselves stay.`,
            confirmLabel: "Delete",
            variant: "destructive",
        });
        if (!ok) return;
        try {
            await CollectionsService.delete(c.id);
            toast.success("Collection deleted");
            if (selected?.id === c.id) setSelected(null);
            await loadCollections();
        } catch (e) {
            console.error("Delete failed", e);
            toast.error(getErrorMessage(e, "Delete failed"));
        }
    };

    // ───────── Stories in collection: reorder / detach ─────────

    const moveStory = async (index: number, direction: -1 | 1) => {
        if (!selected) return;
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= stories.length) return;

        const next = [...stories];
        const tmp = next[index];
        next[index] = next[newIndex];
        next[newIndex] = tmp;

        // Optimistic
        setStories(next);
        try {
            await CollectionsService.reorderStories(selected.id, {
                storyIds: next.map((s) => s.id),
            });
        } catch (e) {
            console.error("Reorder failed", e);
            toast.error("Reorder failed, reverted");
            // Revert
            setStories(stories);
        }
    };

    const detachStory = async (storyId: string) => {
        if (!selected) return;
        const ok = await confirm({
            title: "Detach story?",
            message: "Detach this story from the collection?",
            confirmLabel: "Detach",
        });
        if (!ok) return;
        try {
            await CollectionsService.removeStory(selected.id, storyId);
            toast.success("Story detached");
            await loadStories(selected.id);
            await loadCollections(); // updates storyCount
        } catch (e) {
            console.error("Detach failed", e);
            toast.error(getErrorMessage(e, "Detach failed"));
        }
    };

    // ───────── Attach-story modal ─────────
    // The picker asks the server for one page at a time (the API caps a page
    // at 100 rows) and searches on the server too, so a story on another
    // page is found. Only stories the collection can hold are listed: the
    // collection's own language, since it never shows any other.

    const selectedLanguage = selected?.language;
    const storyPoolRequestRef = useRef(0);

    const loadStoryPool = useCallback(
        async (page: number, search: string) => {
            const request = ++storyPoolRequestRef.current;
            setStoryPoolLoading(true);
            setStoryPoolError(null);
            try {
                const res = await StoriesService.getAll({
                    page,
                    limit: STORY_POOL_PAGE_SIZE,
                    sort: "title",
                    ...(search ? { q: search } : {}),
                    ...(selectedLanguage ? { language: selectedLanguage } : {}),
                });
                if (request !== storyPoolRequestRef.current) return;
                setStoryPool(res.data.data);
                setStoryPoolTotal(res.data.total);
                setStoryPoolTotalPages(res.data.totalPages);
            } catch (e) {
                if (request !== storyPoolRequestRef.current) return;
                console.error("Failed to load stories", e);
                setStoryPool([]);
                setStoryPoolError(getErrorMessage(e, "Masallar yüklenemedi."));
            } finally {
                if (request === storyPoolRequestRef.current) setStoryPoolLoading(false);
            }
        },
        [selectedLanguage],
    );

    // What the server is asked for: the typed text, a moment after typing stops.
    const [storyPoolQuery, setStoryPoolQuery] = useState("");
    useEffect(() => {
        const timer = setTimeout(() => {
            setStoryPoolQuery(storyPoolSearch.trim());
            setStoryPoolPage(1);
        }, STORY_POOL_SEARCH_DELAY_MS);
        return () => clearTimeout(timer);
    }, [storyPoolSearch]);

    useEffect(() => {
        if (attachOpen && selectedId) loadStoryPool(storyPoolPage, storyPoolQuery);
    }, [attachOpen, selectedId, storyPoolPage, storyPoolQuery, loadStoryPool]);

    const openAttachModal = () => {
        if (!selected) return;
        setStoryPoolSearch("");
        setStoryPoolQuery("");
        setStoryPoolPage(1);
        setAttachOpen(true);
    };

    const attachedIds = useMemo(
        () => new Set(stories.map((s) => s.id)),
        [stories],
    );


    const attachStory = async (storyId: string) => {
        if (!selected) return;
        setAttachPending(storyId);
        try {
            await CollectionsService.addStories(selected.id, {
                storyIds: [storyId],
            });
            toast.success("Masal koleksiyona eklendi");
            await loadStories(selected.id);
            await loadCollections();
        } catch (e) {
            console.error("Attach failed", e);
            toast.error(getErrorMessage(e, "Masal eklenemedi"));
        } finally {
            setAttachPending(null);
        }
    };

    return (
        <div className="space-y-6 h-[calc(100vh-6rem)] flex flex-col">
            <div className="flex items-center justify-between shrink-0">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">
                        Koleksiyonlar
                    </h2>
                    <p className="text-muted-foreground">
                        Curated story collections shown on mobile
                    </p>
                </div>
                {canEditCollections && (
                    <button
                        onClick={openCreateModal}
                        className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                    >
                        <Plus className="w-4 h-4" /> New Collection
                    </button>
                )}
            </div>

            <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
                {/* Collections list */}
                <div className="col-span-4 border border-border rounded-xl bg-card overflow-hidden flex flex-col">
                    <div className="p-3 border-b border-border bg-muted/20 font-medium text-sm flex items-center gap-2">
                        <Library className="w-4 h-4" />
                        Collections ({collectionsTotal})
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {loading ? (
                            <div className="flex items-center justify-center p-8">
                                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : collectionsError ? (
                            <ErrorState message={collectionsError} onRetry={loadCollections} />
                        ) : collections.length === 0 ? (
                            <div className="text-center p-8 text-sm text-muted-foreground">
                                No collections yet
                            </div>
                        ) : (
                            collections.map((c) => (
                                <div
                                    key={c.id}
                                    onClick={() => setSelected(c)}
                                    className={cn(
                                        "p-3 rounded-md cursor-pointer text-sm group transition-colors",
                                        selected?.id === c.id
                                            ? "bg-primary/10 text-primary"
                                            : "hover:bg-muted",
                                    )}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="truncate font-medium">
                                                    {c.title}
                                                </span>
                                                {!c.isActive && <InactiveBadge />}
                                            </div>
                                            <div className="text-xs text-muted-foreground truncate">
                                                /{c.slug} - {c.storyCount}{" "}
                                                {c.storyCount === 1 ? "story" : "stories"}
                                            </div>
                                        </div>
                                        <span
                                            className={cn(
                                                "shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border",
                                                toneChipClass[c.tone],
                                            )}
                                        >
                                            {c.tone.toLowerCase()}
                                        </span>
                                    </div>

                                    {canEditCollections && (
                                        <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    openEditModal(c);
                                                }}
                                                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1 rounded hover:bg-muted"
                                            >
                                                <Pencil className="w-3 h-3" /> Edit
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteCollection(c);
                                                }}
                                                className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 px-2 py-1 rounded hover:bg-muted"
                                            >
                                                <Trash2 className="w-3 h-3" /> Delete
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                    {collectionsTotalPages > 1 && (
                        <Pagination
                            className="border-t border-border px-2 text-xs"
                            page={collectionsPage}
                            totalPages={collectionsTotalPages}
                            total={collectionsTotal}
                            itemLabel="collections"
                            onPageChange={setCollectionsPage}
                            disabled={loading}
                        />
                    )}
                </div>

                {/* Detail panel */}
                <div className="col-span-8 border border-border rounded-xl bg-card overflow-hidden flex flex-col">
                    {!selected ? (
                        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                            Select a collection to view stories
                        </div>
                    ) : (
                        <>
                            <div className="p-4 border-b border-border bg-muted/20">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h3 className="font-semibold text-lg truncate">
                                                {selected.title}
                                            </h3>
                                            <span
                                                className={cn(
                                                    "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border",
                                                    toneChipClass[selected.tone],
                                                )}
                                            >
                                                {selected.tone.toLowerCase()}
                                            </span>
                                            {!selected.isActive && <InactiveBadge />}
                                        </div>
                                        {selected.subtitle && (
                                            <p className="text-sm text-muted-foreground mt-1">
                                                {selected.subtitle}
                                            </p>
                                        )}
                                        <p className="text-xs text-muted-foreground mt-1">
                                            slug: /{selected.slug} - sortOrder:{" "}
                                            {selected.sortOrder}
                                        </p>
                                    </div>
                                    {canManageCollectionStories && (
                                        <button
                                            onClick={openAttachModal}
                                            className="shrink-0 bg-secondary hover:bg-secondary/80 text-secondary-foreground px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1"
                                        >
                                            <Plus className="w-3 h-3" /> Attach story
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto">
                                {storiesLoading ? (
                                    <div className="flex items-center justify-center p-8">
                                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                                    </div>
                                ) : storiesError ? (
                                    <ErrorState
                                        message={storiesError}
                                        onRetry={() => loadStories(selected.id)}
                                    />
                                ) : stories.length === 0 ? (
                                    <div className="text-center p-8 text-sm text-muted-foreground">
                                        No stories attached yet
                                    </div>
                                ) : (
                                    <table className="w-full text-sm">
                                        <thead className="bg-muted/30 text-muted-foreground text-xs uppercase sticky top-0">
                                            <tr>
                                                <th className="px-4 py-2 text-left font-medium w-14">
                                                    #
                                                </th>
                                                <th className="px-4 py-2 text-left font-medium">
                                                    Story
                                                </th>
                                                <th className="px-4 py-2 text-left font-medium">
                                                    Category
                                                </th>
                                                <th className="px-4 py-2 text-right font-medium w-40">
                                                    Actions
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {stories.map((s, idx) => (
                                                <tr
                                                    key={s.id}
                                                    className="hover:bg-muted/20 transition-colors"
                                                >
                                                    <td className="px-4 py-3 text-muted-foreground">
                                                        {idx + 1}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <BookOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                                            <span className="truncate font-medium">
                                                                {s.title}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-muted-foreground">
                                                        {s.category}
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        {canManageCollectionStories && (
                                                            <div className="inline-flex gap-1">
                                                                <button
                                                                    onClick={() =>
                                                                        moveStory(idx, -1)
                                                                    }
                                                                    disabled={idx === 0}
                                                                    className="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                                                                    title="Move up"
                                                                >
                                                                    <ArrowUp className="w-4 h-4" />
                                                                </button>
                                                                <button
                                                                    onClick={() =>
                                                                        moveStory(idx, 1)
                                                                    }
                                                                    disabled={
                                                                        idx === stories.length - 1
                                                                    }
                                                                    className="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                                                                    title="Move down"
                                                                >
                                                                    <ArrowDown className="w-4 h-4" />
                                                                </button>
                                                                <button
                                                                    onClick={() =>
                                                                        detachStory(s.id)
                                                                    }
                                                                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                                                                    title="Detach"
                                                                >
                                                                    <Trash2 className="w-4 h-4" />
                                                                </button>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Create / Edit modal */}
            {modalOpen && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                        <div className="p-4 border-b border-border flex items-center justify-between">
                            <h3 className="font-semibold">
                                {editingId ? "Edit Collection" : "New Collection"}
                            </h3>
                            <button
                                onClick={closeModal}
                                className="text-muted-foreground hover:text-foreground p-1"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                                        Slug *{" "}
                                        {editingId && (
                                            <span className="text-muted-foreground/60">
                                                (immutable)
                                            </span>
                                        )}
                                    </label>
                                    <input
                                        value={form.slug}
                                        disabled={!!editingId}
                                        onChange={(e) =>
                                            setForm({ ...form, slug: e.target.value })
                                        }
                                        placeholder="sleep"
                                        className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none disabled:opacity-60"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                                        Tone *
                                    </label>
                                    <select
                                        value={form.tone}
                                        onChange={(e) =>
                                            setForm({
                                                ...form,
                                                tone: e.target.value as CollectionTone,
                                            })
                                        }
                                        className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                                    >
                                        {Object.entries(toneLabels).map(([value, label]) => (
                                            <option key={value} value={value}>
                                                {label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                                    Title *
                                </label>
                                <input
                                    value={form.title}
                                    onChange={(e) =>
                                        setForm({ ...form, title: e.target.value })
                                    }
                                    placeholder="Uyku Vakti"
                                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                                />
                            </div>

                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                                    Subtitle
                                </label>
                                <input
                                    value={form.subtitle ?? ""}
                                    onChange={(e) =>
                                        setForm({ ...form, subtitle: e.target.value })
                                    }
                                    placeholder="Sakin, yumuşak masallar"
                                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                                />
                            </div>

                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                                    Description
                                </label>
                                <textarea
                                    value={form.description ?? ""}
                                    onChange={(e) =>
                                        setForm({ ...form, description: e.target.value })
                                    }
                                    rows={3}
                                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                                />
                            </div>

                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                                    Cover Image URL
                                </label>
                                <input
                                    value={form.coverImageUrl ?? ""}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            coverImageUrl: e.target.value,
                                        })
                                    }
                                    placeholder="https://..."
                                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                                        Sort Order
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={form.sortOrder ?? 0}
                                        onChange={(e) =>
                                            setForm({
                                                ...form,
                                                sortOrder:
                                                    parseInt(e.target.value, 10) || 0,
                                            })
                                        }
                                        className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                                    />
                                </div>
                                <div className="flex items-end">
                                    <label className="flex items-center gap-2 text-sm">
                                        <input
                                            type="checkbox"
                                            checked={form.isActive ?? true}
                                            onChange={(e) =>
                                                setForm({
                                                    ...form,
                                                    isActive: e.target.checked,
                                                })
                                            }
                                            className="w-4 h-4 rounded border-border"
                                        />
                                        Active (visible on mobile)
                                    </label>
                                </div>
                            </div>
                        </div>
                        <div className="p-4 border-t border-border flex justify-end gap-2">
                            <button
                                onClick={closeModal}
                                className="px-4 py-2 rounded-md text-sm font-medium hover:bg-muted"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveCollection}
                                disabled={saving}
                                className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                            >
                                {saving ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Save className="w-4 h-4" />
                                )}
                                {editingId ? "Save" : "Create"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Attach-story modal */}
            {attachOpen && selected && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
                        <div className="p-4 border-b border-border flex items-center justify-between">
                            <h3 className="font-semibold">
                                Masal ekle: {selected.title}
                            </h3>
                            <button
                                onClick={() => setAttachOpen(false)}
                                aria-label="Kapat"
                                className="text-muted-foreground hover:text-foreground p-1"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-4 border-b border-border">
                            <div className="relative">
                                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input
                                    value={storyPoolSearch}
                                    onChange={(e) =>
                                        setStoryPoolSearch(e.target.value)
                                    }
                                    aria-label="Masal ara"
                                    placeholder="Başlıkta ya da metinde ara..."
                                    className="w-full bg-background border border-border rounded-md pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                                />
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto divide-y divide-border">
                            {storyPoolLoading ? (
                                <div className="flex items-center justify-center p-8">
                                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                                </div>
                            ) : storyPoolError ? (
                                <ErrorState
                                    message={storyPoolError}
                                    onRetry={() => loadStoryPool(storyPoolPage, storyPoolQuery)}
                                    retryLabel="Tekrar dene"
                                />
                            ) : storyPool.length === 0 ? (
                                <div className="text-center p-8 text-sm text-muted-foreground">
                                    {storyPoolQuery
                                        ? "Aramaya uyan masal yok."
                                        : "Bu koleksiyonun dilinde henüz masal yok."}
                                </div>
                            ) : (
                                storyPool.map((s) => {
                                    const already = attachedIds.has(s.id);
                                    return (
                                        <div
                                            key={s.id}
                                            className="flex items-center gap-3 p-3 hover:bg-muted/30"
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium text-sm truncate">
                                                    {s.title}
                                                </div>
                                                <div className="text-xs text-muted-foreground truncate">
                                                    {s.category} - {s.ageGroup}
                                                    {s.status && s.status !== "PUBLISHED"
                                                        ? " - yayında değil, uygulamada görünmez"
                                                        : ""}
                                                </div>
                                            </div>
                                            <button
                                                disabled={already || attachPending === s.id}
                                                onClick={() => attachStory(s.id)}
                                                className={cn(
                                                    "text-xs px-3 py-1.5 rounded-md font-medium flex items-center gap-1",
                                                    already
                                                        ? "bg-muted text-muted-foreground cursor-not-allowed"
                                                        : "bg-primary hover:bg-primary/90 text-white disabled:opacity-50",
                                                )}
                                            >
                                                {attachPending === s.id ? (
                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                ) : (
                                                    <Plus className="w-3 h-3" />
                                                )}
                                                {already ? "Eklendi" : "Ekle"}
                                            </button>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                        <Pagination
                            className="border-t border-border"
                            page={storyPoolPage}
                            totalPages={storyPoolTotalPages}
                            total={storyPoolTotal}
                            itemLabel="masal"
                            prevLabel="Önceki"
                            nextLabel="Sonraki"
                            onPageChange={setStoryPoolPage}
                            disabled={storyPoolLoading}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
