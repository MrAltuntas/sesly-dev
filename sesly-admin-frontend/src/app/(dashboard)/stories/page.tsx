"use client";

import { ChangeEvent, MouseEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
    AlertCircle,
    AlertTriangle,
    Bot,
    ClipboardCheck,
    Clock,
    FileUp,
    ImageUp,
    Languages,
    Loader2,
    Plus,
    Save,
    Upload,
    X,
} from "lucide-react";
import { StoriesService } from "@/services/admin.service";
import {
    AdminStoryListItem,
    CoverCredit,
    StoriesMeta,
    StoryDetail,
    StoryCategory,
    AgeGroup,
    StoryLlmTaskRow,
    StorySegment,
} from "@/types/api.types";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { usePageSize } from "@/hooks/usePageSize";
import { useToast } from "@/hooks/useToast";
import { useStoryLlmTasks } from "@/hooks/useStoryLlmTasks";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ErrorState, getErrorMessage } from "@/components/ui/error-state";
import { CartesiaSettings } from "@/components/stories/CartesiaSettings";
import { SegmentEditor } from "@/components/stories/SegmentEditor";
import { NarrationCachePanel } from "@/components/stories/NarrationCachePanel";
import {
    cacheConfirmMessage,
    cacheIsEmpty,
    cleanSegments,
    oversizedSegments,
    segmentsMatchContent,
} from "@/lib/segments";
import { StoryFilterBar } from "@/components/stories/StoryFilterBar";
import { StoryListPanel } from "@/components/stories/StoryListPanel";
import { StoryRightsSection } from "@/components/stories/StoryRightsSection";
import { ContentWarningsField } from "@/components/stories/ContentWarningsField";
import { LanguageLevelControl } from "@/components/stories/LanguageLevelControl";
import { AgeGroupControl } from "@/components/stories/AgeGroupControl";
import { TranslationRequestsDialog } from "@/components/stories/TranslationRequestsDialog";
import { TranslationsPanel } from "@/components/stories/TranslationsPanel";
import { StoryBulkActions } from "@/components/stories/StoryBulkActions";
import { ID_LIST_MAX, PAGE_SIZE_KEYS, type StoryBrief } from "@/lib/bulk";
import { LlmTasksDialog } from "@/components/stories/LlmTasksDialog";
import { FieldShell, SelectField, TextAreaField, TextField, inputClass } from "@/components/stories/form-fields";
import { SONIC3_DEFAULT_EMOTION } from "@/lib/cartesia-emotions";
import { CoverCreditFields } from "@/components/stories/CoverCreditFields";
import { coverCreditLine, normalizeCoverCredit } from "@/lib/covers";
import {
    CatalogueForm,
    CatalogueKey,
    EMPTY_STORY_FILTERS,
    PUBLISH_MISSING_FIELDS,
    PUBLISH_MISSING_LABELS,
    STORY_PARAM,
    StoryFieldKey,
    StoryFilters,
    activeStoryFilterCount,
    buildStoriesUrl,
    catalogueChanges,
    catalogueForCreate,
    catalogueFromStory,
    emptyCatalogueForm,
    estimateDurationMinutes,
    fieldForApiError,
    getApiErrorData,
    isCatalogueDirty,
    isTaskActive,
    languageName,
    missingPublishFields,
    parseStoryFilters,
    rebaseCatalogueForm,
    STORY_PAGE_SIZE,
    storyBrief,
    storyFiltersToApiParams,
    storyFiltersToIdParams,
    storyFiltersToQuery,
} from "@/lib/stories";

const EMPTY_CATALOGUE = emptyCatalogueForm();

/** GET /admin/stories/llm-tasks serves at most 100 rows per page. */
const ALL_TASKS_LIMIT = 100;

interface LanguageConflict {
    message: string;
    storyIds: string[];
}

function PageSpinner() {
    return (
        <div className="flex items-center justify-center p-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
    );
}

// useSearchParams needs a Suspense boundary for the production build.
export default function StoriesPage() {
    return (
        <Suspense fallback={<PageSpinner />}>
            <StoriesStudio />
        </Suspense>
    );
}

function StoriesStudio() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { canViewStories, canCreateStory, canEditStory, canDeleteStory, canReviewStories } = usePermissions();
    const toast = useToast();
    const confirm = useConfirm();

    // ============================================
    // URL STATE: filters and the open story
    // ============================================

    // The filter part of the query string, normalised. It stays the same
    // string while only the open story changes, so the list is not refetched.
    const filtersKey = useMemo(
        () => new URLSearchParams(storyFiltersToQuery(parseStoryFilters(searchParams))).toString(),
        [searchParams],
    );
    const filters = useMemo<StoryFilters>(() => parseStoryFilters(new URLSearchParams(filtersKey)), [filtersKey]);
    const storyParam = searchParams.get(STORY_PARAM);

    const updateUrl = useCallback(
        (nextFilters: StoryFilters, nextStoryId: string | null) => {
            router.replace(buildStoriesUrl(pathname, nextFilters, nextStoryId), { scroll: false });
        },
        [router, pathname],
    );

    const handleFilterChange = useCallback(
        (changes: Partial<StoryFilters>) => {
            // Any narrowing change starts again from the first page.
            updateUrl({ ...filters, ...changes, page: changes.page ?? 1 }, storyParam);
        },
        [filters, storyParam, updateUrl],
    );

    const handleClearFilters = useCallback(() => {
        updateUrl(EMPTY_STORY_FILTERS, storyParam);
    }, [storyParam, updateUrl]);

    const hrefFor = useCallback((id: string) => buildStoriesUrl(pathname, filters, id), [pathname, filters]);

    // ============================================
    // METADATA (languages, enum labels, sorts, publish rules)
    // ============================================

    const [meta, setMeta] = useState<StoriesMeta | null>(null);
    const [metaLoading, setMetaLoading] = useState(true);
    const [metaError, setMetaError] = useState<string | null>(null);

    // ============================================
    // LIST
    // ============================================

    const [stories, setStories] = useState<AdminStoryListItem[]>([]);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [listError, setListError] = useState<string | null>(null);
    const listRequestRef = useRef(0);

    // Bulk selection. Titles are remembered so the "skipped" report can name
    // stories that are no longer on the visible page.
    const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
    const [knownTitles, setKnownTitles] = useState<Record<string, string>>({});
    // Status, review mark and publish rule of every story seen (rows and the
    // id list), for the bulk publish plan of a selection across pages.
    const [known, setKnown] = useState<Map<string, StoryBrief>>(new Map());
    const [selectingAll, setSelectingAll] = useState(false);
    const [pageSize, setPageSize] = usePageSize(PAGE_SIZE_KEYS.stories, STORY_PAGE_SIZE);

    // ============================================
    // EDITOR
    // ============================================

    const [selectedStory, setSelectedStory] = useState<StoryDetail | null>(null);
    const selectedStoryRef = useRef<StoryDetail | null>(null);
    useEffect(() => {
        selectedStoryRef.current = selectedStory;
    }, [selectedStory]);
    // Id the editor shows (or is loading), so the URL effect does not refetch it.
    const editorStoryIdRef = useRef<string | null>(null);
    const storyRequestRef = useRef(0);
    const [storyLoading, setStoryLoading] = useState(false);
    const [storyError, setStoryError] = useState<string | null>(null);

    const [saving, setSaving] = useState(false);
    const [autoSplitting, setAutoSplitting] = useState(false);
    const [clearingSegments, setClearingSegments] = useState(false);
    const [llmFilling, setLlmFilling] = useState(false);
    const [llmWarnings, setLlmWarnings] = useState<string[]>([]);
    const [tasksDialogOpen, setTasksDialogOpen] = useState(false);
    const [requestsDialogOpen, setRequestsDialogOpen] = useState(false);

    // Form fields
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [category, setCategory] = useState<string>(StoryCategory.BEDTIME);
    // Empty on a new story: the backend asks the AI for the age group.
    const [ageGroup, setAgeGroup] = useState<string>("");
    const [language, setLanguage] = useState("tr");
    const [isPremium, setIsPremium] = useState(false);
    const [coverImage, setCoverImage] = useState<File | null>(null);
    // "Bu kapağı tüm dillere ve bölümlere uygula": covers carry no text.
    const [applyCoverToTale, setApplyCoverToTale] = useState(true);
    const [coverImagePreview, setCoverImagePreview] = useState<string>("");
    // Credit of the cover picture (CC BY or public domain illustration).
    // Sent only when edited, or with a new picture (a new picture starts empty).
    const [coverCredit, setCoverCredit] = useState<CoverCredit>({});
    const [coverCreditDirty, setCoverCreditDirty] = useState(false);
    const [coverCreditError, setCoverCreditError] = useState<string | null>(null);

    // Catalogue: status, slug, summary, credit, rights audit, level.
    const [catalogue, setCatalogue] = useState<CatalogueForm>(EMPTY_CATALOGUE);
    // API messages attached to the input they are about.
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<StoryFieldKey, string>>>({});
    // `missing` of the last STORY_PUBLISH_REQUIREMENTS answer.
    const [serverMissing, setServerMissing] = useState<string[] | null>(null);
    const [languageConflict, setLanguageConflict] = useState<LanguageConflict | null>(null);

    // Cartesia Phase 2A
    const [defaultEmotion, setDefaultEmotion] = useState<string>(SONIC3_DEFAULT_EMOTION);
    const [defaultSpeed, setDefaultSpeed] = useState<number | null>(null);
    const [cartesiaPronunciationDictId, setCartesiaPronunciationDictId] = useState("");
    const [segments, setSegments] = useState<StorySegment[]>([]);
    const [preprocessedAt, setPreprocessedAt] = useState<string | null>(null);
    const [preprocessedModel, setPreprocessedModel] = useState<string | null>(null);
    // Story.segmentationVersion the editor loaded (sent back as expectedVersion).
    const [segmentationVersion, setSegmentationVersion] = useState<number | null>(null);
    // Bumped after a segment save (which clears the narration cache).
    const [cacheRefreshKey, setCacheRefreshKey] = useState(0);
    // Only send defaultEmotion when the admin actually touched it, so a save
    // does not silently stamp "neutral" onto every story.
    const [emotionDirty, setEmotionDirty] = useState(false);
    // Only PATCH /segments when the admin edited / regenerated them, so a
    // plain metadata save does not overwrite preprocessedModel with "manual".
    const [segmentsDirty, setSegmentsDirty] = useState(false);

    const catalogueBase = useMemo(
        () => (selectedStory ? catalogueFromStory(selectedStory) : EMPTY_CATALOGUE),
        [selectedStory],
    );

    // Content differs from what the backend has. Saving it makes the backend
    // drop preprocessedSegments, and server-side split / LLM fill would still
    // work on the old text.
    const contentChanged = !!selectedStory && content !== selectedStory.content;

    // What a translation or a level assessment reads. They run on the saved
    // story, so unsaved edits here must be saved first.
    const textChanged =
        !!selectedStory &&
        (contentChanged ||
            title !== selectedStory.title ||
            language !== (selectedStory.language || "tr") ||
            catalogue.summary.trim() !== catalogueBase.summary.trim());

    const catalogueDirty = isCatalogueDirty(catalogue, catalogueBase);

    // Duration is computed by the backend from the word count and the pace of
    // the language. The saved value is shown as it is; while the text or the
    // language is being edited the same formula gives a preview.
    const durationPreview = useMemo(
        () => estimateDurationMinutes(content, meta?.languages.all.find((l) => l.code === language)?.wordsPerMinute),
        [content, language, meta],
    );
    const durationIsPreview =
        !selectedStory || contentChanged || language !== (selectedStory.language || "tr");
    const durationMinutes = durationIsPreview ? durationPreview : selectedStory.estimatedDuration;

    const hasUnsavedChanges = selectedStory
        ? title !== selectedStory.title ||
          contentChanged ||
          category !== selectedStory.category ||
          ageGroup !== selectedStory.ageGroup ||
          language !== (selectedStory.language || "tr") ||
          isPremium !== selectedStory.isPremium ||
          coverImage !== null ||
          coverCreditDirty ||
          emotionDirty ||
          defaultSpeed !== (selectedStory.defaultSpeed ?? null) ||
          cartesiaPronunciationDictId !== (selectedStory.cartesiaPronunciationDictId || "") ||
          segmentsDirty ||
          catalogueDirty
        : title.trim() !== "" || content.trim() !== "" || coverImage !== null || catalogueDirty;

    // ============================================
    // LOADERS
    // ============================================

    const loadMeta = useCallback(async () => {
        setMetaLoading(true);
        setMetaError(null);
        try {
            const res = await StoriesService.getMeta();
            setMeta(res.data);
            // A fresh, untouched form starts in the default content language.
            if (!editorStoryIdRef.current && res.data.languages?.default) {
                setLanguage((prev) => (prev === "tr" ? res.data.languages.default : prev));
            }
        } catch (e) {
            console.error("Failed to load story metadata", e);
            setMetaError(getErrorMessage(e, "Masal ayarları (diller ve seçenekler) yüklenemedi."));
        } finally {
            setMetaLoading(false);
        }
    }, []);

    const loadStories = useCallback(async () => {
        const request = ++listRequestRef.current;
        const current = parseStoryFilters(new URLSearchParams(filtersKey));
        setLoading(true);
        setListError(null);
        try {
            const res = await StoriesService.getAll(storyFiltersToApiParams(current, pageSize));
            if (request !== listRequestRef.current) return;
            const rows = res.data.data ?? [];
            setStories(rows);
            setTotal(res.data.total ?? rows.length);
            setTotalPages(res.data.totalPages ?? 1);
            if (rows.length > 0) {
                setKnownTitles((prev) => {
                    const next = { ...prev };
                    for (const row of rows) next[row.id] = row.title;
                    return next;
                });
                // The default publish rules: the backend checks each story again anyway.
                setKnown((prev) => {
                    const next = new Map(prev);
                    for (const row of rows) next.set(row.id, storyBrief(row, null));
                    return next;
                });
            }
        } catch (e) {
            if (request !== listRequestRef.current) return;
            console.error("Failed to load stories", e);
            setStories([]);
            setTotal(0);
            setTotalPages(1);
            setListError(getErrorMessage(e, "Masallar yüklenemedi."));
        } finally {
            if (request === listRequestRef.current) setLoading(false);
        }
    }, [filtersKey, pageSize]);

    useEffect(() => {
        if (!canViewStories) return;
        loadMeta();
    }, [canViewStories, loadMeta]);

    useEffect(() => {
        if (!canViewStories) return;
        loadStories();
    }, [canViewStories, loadStories]);

    // The last page emptied out (a delete, a status change under a filter).
    useEffect(() => {
        if (loading || listError) return;
        if (stories.length === 0 && total > 0 && filters.page > 1) {
            updateUrl({ ...filters, page: Math.max(1, totalPages) }, storyParam);
        }
    }, [loading, listError, stories.length, total, totalPages, filters, storyParam, updateUrl]);

    // Browser-level guard (tab close / reload) while edits are pending.
    useEffect(() => {
        if (!hasUnsavedChanges) return;
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [hasUnsavedChanges]);

    const confirmDiscardChanges = async () => {
        if (!hasUnsavedChanges) return true;
        return confirm({
            title: "Kaydedilmemiş değişiklikler var",
            message: "Bu masaldaki kaydedilmemiş değişiklikler kaybolacak. Devam etmek istiyor musun?",
            confirmLabel: "Değişiklikleri at",
            cancelLabel: "Vazgeç",
            variant: "destructive",
        });
    };

    const populateFromStory = useCallback((fullStory: StoryDetail) => {
        editorStoryIdRef.current = fullStory.id;
        setSelectedStory(fullStory);
        setStoryError(null);
        setTitle(fullStory.title);
        setContent(fullStory.content);
        setCategory(fullStory.category);
        setAgeGroup(fullStory.ageGroup);
        setLanguage(fullStory.language || "tr");
        setIsPremium(fullStory.isPremium);
        setCoverImagePreview(fullStory.coverImageUrl || "");
        setCoverImage(null);
        setCoverCredit(fullStory.coverCredit ?? {});
        setCoverCreditDirty(false);
        setCoverCreditError(null);
        setCatalogue(catalogueFromStory(fullStory));
        setFieldErrors({});
        setServerMissing(null);
        setLanguageConflict(null);

        setDefaultEmotion(fullStory.defaultEmotion || SONIC3_DEFAULT_EMOTION);
        setDefaultSpeed(fullStory.defaultSpeed ?? null);
        setCartesiaPronunciationDictId(fullStory.cartesiaPronunciationDictId || "");
        setSegments(
            Array.isArray(fullStory.preprocessedSegments)
                ? fullStory.preprocessedSegments
                : [],
        );
        setPreprocessedAt(fullStory.preprocessedAt ?? null);
        setPreprocessedModel(fullStory.preprocessedModel ?? null);
        setSegmentationVersion(fullStory.segmentationVersion ?? null);
        setEmotionDirty(false);
        setSegmentsDirty(false);
        setLlmWarnings([]);
    }, []);

    const loadStory = useCallback(
        async (id: string) => {
            const request = ++storyRequestRef.current;
            editorStoryIdRef.current = id;
            setStoryLoading(true);
            setStoryError(null);
            try {
                const res = await StoriesService.getById(id);
                if (request !== storyRequestRef.current) return;
                populateFromStory(res.data);
            } catch (e) {
                if (request !== storyRequestRef.current) return;
                console.error("Failed to load story details", e);
                setStoryError(getErrorMessage(e, "Masal yüklenemedi."));
            } finally {
                if (request === storyRequestRef.current) setStoryLoading(false);
            }
        },
        [populateFromStory],
    );

    // The open story lives in the URL (?story=), so a reload, a shared link
    // and the links between translations all land on the same editor state.
    useEffect(() => {
        if (!canViewStories || !storyParam) return;
        if (storyParam === editorStoryIdRef.current) return;
        loadStory(storyParam);
    }, [canViewStories, storyParam, loadStory]);

    /**
     * The saved story changed behind the form (an AI level landed, a link was
     * made or removed). Untouched inputs follow the server, edits are kept.
     */
    const syncServerStory = useCallback((fresh: StoryDetail) => {
        const prev = selectedStoryRef.current;
        if (!prev || prev.id !== fresh.id) return;
        const oldBase = catalogueFromStory(prev);
        const newBase = catalogueFromStory(fresh);
        selectedStoryRef.current = fresh;
        setSelectedStory(fresh);
        setCatalogue((form) => rebaseCatalogueForm(form, oldBase, newBase));
        // An age group the admin did not touch follows the server (an AI
        // assessment landed); otherwise the next save would write the old
        // value back as a manual choice.
        setAgeGroup((current) => (current === prev.ageGroup ? fresh.ageGroup : current));
    }, []);

    const refreshSelectedStory = useCallback(
        async (id: string) => {
            try {
                const res = await StoriesService.getById(id);
                syncServerStory(res.data);
            } catch (e) {
                console.error("Failed to refresh story", e);
            }
        },
        [syncServerStory],
    );

    // ============================================
    // BACKGROUND LLM TASKS
    // ============================================

    const handleStoryTaskSettled = useCallback(
        (task: StoryLlmTaskRow) => {
            if (task.status === "DONE") {
                toast.success(
                    task.type === "TRANSLATE"
                        ? "Çeviri hazır. Taslak olarak kaydedildi, yayınlamadan önce okunmalı."
                        : task.type === "ASSESS_AGE_GROUP"
                          ? "Yaş grubu değerlendirildi"
                          : "Dil seviyesi değerlendirildi",
                );
                refreshSelectedStory(task.storyId);
                loadStories();
            } else if (task.status === "FAILED") {
                toast.error(task.error ?? "Yapay zeka görevi başarısız oldu.");
            }
        },
        [toast, refreshSelectedStory, loadStories],
    );

    const storyTasks = useStoryLlmTasks({
        storyId: selectedStory?.id,
        enabled: canViewStories && !!selectedStory,
        onSettled: handleStoryTaskSettled,
    });

    // A finished task changes badges in the list (level, translations).
    const handleAnyTaskSettled = useCallback(() => {
        loadStories();
    }, [loadStories]);

    // Newest tasks of every story. The window is the largest page the API
    // serves; a bigger backlog shows as "100+".
    const allTasks = useStoryLlmTasks({
        enabled: canViewStories,
        limit: ALL_TASKS_LIMIT,
        onSettled: handleAnyTaskSettled,
    });
    const activeTaskCount = allTasks.tasks.filter(isTaskActive).length;
    const activeTaskLabel =
        activeTaskCount >= ALL_TASKS_LIMIT ? `${ALL_TASKS_LIMIT}+` : String(activeTaskCount);

    const refreshTasks = useCallback(() => {
        storyTasks.refresh();
        allTasks.refresh();
    }, [storyTasks, allTasks]);

    const translateTasks = useMemo(
        () => storyTasks.tasks.filter((task) => task.type === "TRANSLATE"),
        [storyTasks.tasks],
    );
    const levelTask = useMemo(
        () => storyTasks.tasks.find((task) => task.type === "ASSESS_LEVEL") ?? null,
        [storyTasks.tasks],
    );
    const ageGroupTask = useMemo(
        () => storyTasks.tasks.find((task) => task.type === "ASSESS_AGE_GROUP") ?? null,
        [storyTasks.tasks],
    );

    // ============================================
    // EDITOR ACTIONS
    // ============================================

    const handleNew = () => {
        editorStoryIdRef.current = null;
        storyRequestRef.current++;
        setStoryLoading(false);
        setStoryError(null);
        setSelectedStory(null);
        setTitle("");
        setContent("");
        setCategory(StoryCategory.BEDTIME);
        setAgeGroup("");
        setLanguage(meta?.languages.default ?? "tr");
        setIsPremium(false);
        setCoverImage(null);
        setCoverImagePreview("");
        setCoverCredit({});
        setCoverCreditDirty(false);
        setCoverCreditError(null);
        setCatalogue(EMPTY_CATALOGUE);
        setFieldErrors({});
        setServerMissing(null);
        setLanguageConflict(null);
        setDefaultEmotion(SONIC3_DEFAULT_EMOTION);
        setDefaultSpeed(null);
        setCartesiaPronunciationDictId("");
        setSegments([]);
        setPreprocessedAt(null);
        setPreprocessedModel(null);
        setSegmentationVersion(null);
        setEmotionDirty(false);
        setSegmentsDirty(false);
        setLlmWarnings([]);
    };

    const openStory = async (id: string) => {
        if (id === selectedStory?.id && !storyError) return;
        if (!(await confirmDiscardChanges())) return;
        updateUrl(filters, id);
    };

    const handleNewClick = async () => {
        if (!(await confirmDiscardChanges())) return;
        handleNew();
        updateUrl(filters, null);
    };

    const clearFieldError = (key: StoryFieldKey) => {
        setFieldErrors((prev) => {
            if (!(key in prev)) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
        });
    };

    const handleCatalogueChange = (key: CatalogueKey, value: string) => {
        setCatalogue((prev) => ({ ...prev, [key]: value }));
        clearFieldError(key);
        // The list the backend sent describes the form as it was.
        setServerMissing(null);
    };

    const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        // Reset so picking the same file again still fires onChange.
        e.target.value = "";
        if (file) {
            setCoverImage(file);
            setApplyCoverToTale(true);
            // The credit of the old picture does not describe the new one.
            setCoverCredit({});
            setCoverCreditDirty(true);
            const reader = new FileReader();
            reader.onloadend = () => {
                setCoverImagePreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    // The PATCH endpoint cannot clear a saved cover (it only replaces it with
    // an uploaded file), so this only discards a newly picked, unsaved file.
    const handleDiscardNewImage = () => {
        setCoverImage(null);
        setCoverImagePreview(selectedStory?.coverImageUrl || "");
        setCoverCredit(selectedStory?.coverCredit ?? {});
        setCoverCreditDirty(false);
    };

    const handleAutoSplit = async () => {
        if (!selectedStory) {
            toast.error("Önce masalı kaydetmen gerekiyor");
            return;
        }
        if (contentChanged) {
            toast.error("Önce içerik değişikliklerini kaydet. Bölme kayıtlı metin üzerinde çalışır.");
            return;
        }
        setAutoSplitting(true);
        setLlmWarnings([]);
        try {
            const res = await StoriesService.previewSegments(selectedStory.id);
            const next: StorySegment[] = res.data.segments.map((s) => ({
                text: s.text,
            }));
            setSegments(next);
            setSegmentsDirty(true);
            toast.success(`${next.length} segment oluşturuldu`);
        } catch (e) {
            console.error("Auto-split failed", e);
            toast.error("Otomatik bölme başarısız oldu");
        } finally {
            setAutoSplitting(false);
        }
    };

    const handleLlmFill = async () => {
        if (!selectedStory) {
            toast.error("Önce masalı kaydetmen gerekiyor");
            return;
        }
        if (contentChanged) {
            toast.error("Önce içerik değişikliklerini kaydet. LLM doldurma kayıtlı metin üzerinde çalışır.");
            return;
        }
        setLlmFilling(true);
        setLlmWarnings([]);
        try {
            const res = await StoriesService.llmFillSegments(selectedStory.id);
            setSegments(res.data.segments);
            setSegmentsDirty(true);
            setLlmWarnings(res.data.warnings ?? []);
            const tokenInfo = res.data.usage?.totalTokens
                ? `${res.data.usage.totalTokens} token`
                : "";
            toast.success(
                `${res.data.segments.length} segment ${res.data.modelUsed} ile oluşturuldu` +
                (tokenInfo ? ` (${tokenInfo}, ${res.data.durationMs}ms)` : ""),
            );
        } catch (e) {
            console.error("LLM fill failed", e);
            toast.error(getErrorMessage(e, "LLM doldurma başarısız oldu"));
        } finally {
            setLlmFilling(false);
        }
    };

    const handleClearSegments = async () => {
        if (!selectedStory) return;
        const ok = await confirm({
            title: "Segmentler sıfırlansın mı?",
            message:
                "Bu masalın kayıtlı segmentleri ve etiketleri silinecek. Bir sonraki seslendirme isteği masalı Gemini ile yeniden böler. Mevcut seslendirmeler silinmez; onlar için seslendirme önbelleğini ayrıca temizleyebilirsin.",
            confirmLabel: "Sıfırla",
            cancelLabel: "Vazgeç",
            variant: "destructive",
        });
        if (!ok) return;

        setClearingSegments(true);
        try {
            const res = await StoriesService.clearSegments(selectedStory.id);
            // Only sync segment state; keep any unsaved metadata edits in the form.
            syncServerStory(res.data);
            setSegments([]);
            setPreprocessedAt(res.data.preprocessedAt ?? null);
            setPreprocessedModel(res.data.preprocessedModel ?? null);
            setSegmentsDirty(false);
            setLlmWarnings([]);
            toast.success("Segmentler sıfırlandı");
        } catch (e) {
            console.error("Clear segments failed", e);
            toast.error("Segmentler sıfırlanamadı");
        } finally {
            setClearingSegments(false);
        }
    };

    const handleSave = async () => {
        if (selectedStory && !canEditStory) {
            toast.error("Masal düzenleme yetkin yok");
            return;
        }
        if (!selectedStory && !canCreateStory) {
            toast.error("Masal oluşturma yetkin yok");
            return;
        }

        const clientErrors: Partial<Record<StoryFieldKey, string>> = {};
        if (!title.trim()) clientErrors.title = "Başlık zorunlu.";
        if (!content.trim()) clientErrors.content = "İçerik zorunlu.";
        if (Object.keys(clientErrors).length > 0) {
            setFieldErrors(clientErrors);
            toast.error(Object.values(clientErrors)[0] ?? "Formda eksik alanlar var");
            return;
        }

        // Saving edited segments clears the story's narration cache: ask
        // first, with the numbers, before anything is written.
        const saveSegments = !!selectedStory && !contentChanged && segmentsDirty && segments.length > 0;
        if (saveSegments) {
            const tooLong = oversizedSegments(segments);
            if (tooLong.length > 0) {
                toast.error(`Çok uzun segment: ${tooLong.join(", ")}. Kaydetmeden önce bölün.`);
                return;
            }
            try {
                const cache = (await StoriesService.getNarrationCache(selectedStory.id)).data;
                if (!cacheIsEmpty(cache)) {
                    const ok = await confirm({
                        title: "Segmentler kaydedilsin mi?",
                        message: cacheConfirmMessage(cache, "save"),
                        confirmLabel: "Kaydet ve temizle",
                        cancelLabel: "Vazgeç",
                        variant: "destructive",
                    });
                    if (!ok) return;
                }
            } catch (e) {
                toast.error(getErrorMessage(e, "Seslendirme önbelleği okunamadı"));
                return;
            }
        }

        setSaving(true);
        setFieldErrors({});
        setServerMissing(null);
        setLanguageConflict(null);
        try {
            // 1) Persist story metadata + Cartesia defaults + catalogue fields
            const common = {
                title,
                category: category as StoryCategory,
                // Empty (new story only): the backend asks the AI.
                ageGroup: ageGroup ? (ageGroup as AgeGroup) : undefined,
                isPremium,
                coverImage: coverImage || undefined,
                applyCoverToTale: coverImage ? applyCoverToTale : undefined,
                coverCredit: coverCreditDirty ? normalizeCoverCredit(coverCredit) : undefined,
                defaultEmotion: emotionDirty ? defaultEmotion : undefined,
                defaultSpeed: defaultSpeed ?? undefined,
                cartesiaPronunciationDictId: cartesiaPronunciationDictId || undefined,
            };

            const hadSegments = segments.length > 0;
            let storyAfterSave: StoryDetail;
            if (selectedStory) {
                const res = await StoriesService.update(selectedStory.id, {
                    ...common,
                    // Only resend content when it changed: the backend rebuilds
                    // chunks whenever content is present and drops the curated
                    // segments when it differs.
                    content: contentChanged ? content : undefined,
                    // Same for the language: a grouped story is checked against
                    // its translation group whenever a language is sent.
                    language: language !== selectedStory.language ? language : undefined,
                    // Only the edited fields, so a save never turns an AI level
                    // into a manual one or touches the translation group.
                    catalogue: catalogueChanges(catalogue, catalogueBase),
                });
                storyAfterSave = res.data;
            } else {
                const res = await StoriesService.create({
                    ...common,
                    content,
                    language,
                    catalogue: catalogueForCreate(catalogue),
                });
                storyAfterSave = res.data;
            }

            // 2) Persist preprocessedSegments only when the admin changed them
            //    AND the content did not change. On a content change the
            //    backend has just cleared the segments because they were
            //    written against the old text; re-sending them would undo that.
            //    The save bumps the segmentation version and clears the
            //    narration cache (confirmed above).
            let removedAudios = 0;
            if (saveSegments) {
                const cleanedSegments = cleanSegments(segments);
                if (cleanedSegments.length > 0) {
                    const res = await StoriesService.updateSegments(
                        storyAfterSave.id,
                        cleanedSegments,
                        segmentationVersion ?? undefined,
                    );
                    removedAudios = res.data.cacheCleared?.removedAudios ?? 0;
                    storyAfterSave = (await StoriesService.getById(storyAfterSave.id)).data;
                    setCacheRefreshKey((k) => k + 1);
                }
            }

            populateFromStory(storyAfterSave);
            if (storyAfterSave.id !== storyParam) updateUrl(filters, storyAfterSave.id);
            loadStories();
            // A save can queue an automatic level assessment (new story
            // without a level, changed text or language).
            refreshTasks();
            if (contentChanged && hadSegments) {
                toast.info(
                    "Masal kaydedildi. İçerik değiştiği için özel segmentler silindi; Otomatik Böl veya LLM ile yeniden oluşturman gerekiyor.",
                );
            } else if (removedAudios > 0) {
                toast.success(`Masal kaydedildi. ${removedAudios} seslendirme önbellekten silindi.`);
            } else {
                toast.success("Masal kaydedildi");
            }
        } catch (e) {
            console.error("Failed to save story", e);
            const data = getApiErrorData(e);
            const message = getErrorMessage(e, "Masal kaydedilemedi");
            if (data.code === "STORY_PUBLISH_REQUIREMENTS") {
                setServerMissing(data.missing ?? []);
            }
            if (data.code === "TRANSLATION_LANGUAGE_TAKEN") {
                setLanguageConflict({
                    message,
                    storyIds: [...(data.storyId ? [data.storyId] : []), ...(data.storyIds ?? [])],
                });
            }
            const field = fieldForApiError(data);
            if (field) setFieldErrors({ [field]: message });
            toast.error(message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (story: AdminStoryListItem) => {
        if (!canDeleteStory) {
            toast.error("Yalnızca Super Admin masal silebilir");
            return;
        }
        const ok = await confirm({
            title: "Masal silinsin mi?",
            message: `"${story.title}" KALICI olarak silinecek.\n\nBu işlem geri alınamaz.`,
            confirmLabel: "Sil",
            cancelLabel: "Vazgeç",
            variant: "destructive",
        });
        if (!ok) return;

        try {
            await StoriesService.delete(story.id);
            setCheckedIds((prev) => {
                if (!prev.has(story.id)) return prev;
                const next = new Set(prev);
                next.delete(story.id);
                return next;
            });
            if (selectedStory?.id === story.id) {
                handleNew();
                updateUrl(filters, null);
            } else if (selectedStory) {
                // The deleted story may have been a translation of the open one.
                refreshSelectedStory(selectedStory.id);
            }
            loadStories();
            toast.success("Masal silindi");
        } catch (e) {
            console.error("Failed to delete story", e);
            toast.error(getErrorMessage(e, "Masal silinemedi"));
        }
    };

    // ============================================
    // BULK SELECTION
    // ============================================

    const toggleChecked = (id: string) => {
        setCheckedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleAllChecked = (ids: string[], checked: boolean) => {
        setCheckedIds((prev) => {
            const next = new Set(prev);
            for (const id of ids) {
                if (checked) next.add(id);
                else next.delete(id);
            }
            return next;
        });
    };

    /** Selects every story of the current filters across pages (at most ID_LIST_MAX). */
    const selectAllMatching = async () => {
        setSelectingAll(true);
        try {
            const res = await StoriesService.getIds(storyFiltersToIdParams(filters));
            const items = res.data.items;
            setKnown((prev) => {
                const next = new Map(prev);
                for (const item of items) next.set(item.id, item);
                return next;
            });
            setKnownTitles((prev) => {
                const next = { ...prev };
                for (const item of items) next[item.id] = item.title;
                return next;
            });
            setCheckedIds(new Set(items.map((item) => item.id)));
            if (res.data.truncated) {
                toast.info(`Filtreye uyan ${res.data.total} masaldan ilk ${ID_LIST_MAX} tanesi seçildi.`);
            }
        } catch (e) {
            toast.error(getErrorMessage(e, "Filtreye uyan masallar alınamadı."));
        } finally {
            setSelectingAll(false);
        }
    };

    const selectedIds = useMemo(() => Array.from(checkedIds), [checkedIds]);
    const titleFor = useCallback((id: string) => knownTitles[id] ?? id, [knownTitles]);

    // ============================================
    // DERIVED VIEW STATE
    // ============================================

    const enums = meta?.enums;
    const languageOptions = useMemo(
        () =>
            (meta?.languages.all ?? []).map((item) => ({
                value: item.code,
                label: `${item.nativeName} (${item.code})${item.enabled ? "" : ", uygulamada kapalı"}`,
            })),
        [meta],
    );
    const languageEnabled = meta ? meta.languages.enabled.includes(language) : true;

    // Early, non-blocking copy of the publish rule. The backend answer wins.
    const localMissing = useMemo(
        () => (catalogue.status === "PUBLISHED" ? missingPublishFields(catalogue, meta?.publishRules) : []),
        [catalogue, meta],
    );
    const missingKeys = serverMissing ?? localMissing;
    const missingInputs = useMemo(() => {
        const set = new Set<CatalogueKey>();
        for (const key of missingKeys) {
            for (const input of PUBLISH_MISSING_FIELDS[key] ?? []) {
                if (catalogue[input].trim() === "") set.add(input);
            }
        }
        return set;
    }, [missingKeys, catalogue]);

    const openConflictStory = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        openStory(id);
    };

    const canSaveCurrent = selectedStory ? canEditStory : canCreateStory;
    const formDisabled = saving || storyLoading;

    return (
        <div className="space-y-4 h-[calc(100vh-6rem)] flex flex-col">
            <div className="flex items-center justify-between shrink-0 gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">İçerik Stüdyosu</h2>
                    <p className="text-muted-foreground">Masalları oluştur, çevir ve yönet</p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                    <button
                        onClick={() => setRequestsDialogOpen(true)}
                        className="bg-secondary/30 hover:bg-secondary/50 text-foreground border border-border px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                    >
                        <Languages className="w-4 h-4" />
                        Çeviri istekleri
                    </button>
                    <button
                        onClick={() => {
                            setTasksDialogOpen(true);
                            allTasks.refresh();
                        }}
                        className="bg-secondary/30 hover:bg-secondary/50 text-foreground border border-border px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                    >
                        {activeTaskCount > 0 ? (
                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        ) : (
                            <Bot className="w-4 h-4" />
                        )}
                        Yapay zeka görevleri{activeTaskCount > 0 ? ` (${activeTaskLabel})` : ""}
                    </button>
                    {canCreateStory && (
                        <Link
                            href="/stories/import"
                            className="bg-secondary/30 hover:bg-secondary/50 text-foreground border border-border px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                        >
                            <FileUp className="w-4 h-4" /> Toplu aktarım (JSON)
                        </Link>
                    )}
                    <Link
                        href="/stories/review"
                        className="bg-secondary/30 hover:bg-secondary/50 text-foreground border border-border px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                    >
                        <ClipboardCheck className="w-4 h-4" /> Yayından önce inceleme
                    </Link>
                    {canReviewStories && (
                        <Link
                            href="/stories/covers"
                            className="bg-secondary/30 hover:bg-secondary/50 text-foreground border border-border px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                        >
                            <ImageUp className="w-4 h-4" /> Toplu kapak yükle
                        </Link>
                    )}
                    {canCreateStory && (
                        <button
                            onClick={handleNewClick}
                            className="bg-secondary hover:bg-secondary/80 text-secondary-foreground px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                        >
                            <Plus className="w-4 h-4" /> Yeni Masal
                        </button>
                    )}
                    {(canCreateStory || canEditStory) && (
                        <button
                            onClick={handleSave}
                            disabled={saving || storyLoading || !!storyError || !!metaError || metaLoading}
                            className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {saving ? "Kaydediliyor..." : "Kaydet"}
                        </button>
                    )}
                </div>
            </div>

            {metaError ? (
                <div className="border border-border rounded-xl bg-card">
                    <ErrorState message={metaError} onRetry={loadMeta} retryLabel="Tekrar dene" />
                </div>
            ) : metaLoading && !meta ? (
                <PageSpinner />
            ) : (
                <>
                    <StoryFilterBar
                        meta={meta}
                        filters={filters}
                        onChange={handleFilterChange}
                        onClear={handleClearFilters}
                    />

                    {canEditStory && (
                        <StoryBulkActions
                            meta={meta}
                            selectedIds={selectedIds}
                            known={known}
                            titleFor={titleFor}
                            onClearSelection={() => setCheckedIds(new Set())}
                            onQueued={refreshTasks}
                            canArchive={canEditStory}
                            canDelete={canDeleteStory}
                            onChanged={(removedIds) => {
                                if (removedIds.length > 0) {
                                    setCheckedIds((prev) => new Set([...prev].filter((id) => !removedIds.includes(id))));
                                    if (selectedStory && removedIds.includes(selectedStory.id)) {
                                        handleNew();
                                        updateUrl(filters, null);
                                    }
                                }
                                if (selectedStory && !removedIds.includes(selectedStory.id)) refreshSelectedStory(selectedStory.id);
                                loadStories();
                            }}
                        />
                    )}

                    <div className="grid grid-cols-12 gap-4 flex-1 min-h-0">
                        {/* Story List */}
                        <div className="col-span-4 min-h-0">
                            <StoryListPanel
                                meta={meta}
                                rows={stories}
                                total={total}
                                page={filters.page}
                                totalPages={totalPages}
                                loading={loading}
                                error={listError}
                                onRetry={loadStories}
                                hasFilters={activeStoryFilterCount(filters) > 0}
                                onClearFilters={handleClearFilters}
                                onPageChange={(page) => handleFilterChange({ page })}
                                selectedId={selectedStory?.id ?? null}
                                hrefFor={hrefFor}
                                onOpen={openStory}
                                canSelect={canEditStory}
                                checkedIds={checkedIds}
                                onToggle={toggleChecked}
                                onToggleAll={toggleAllChecked}
                                onSelectAllMatching={selectAllMatching}
                                selectingAll={selectingAll}
                                pageSize={pageSize}
                                onPageSizeChange={(size) => {
                                    setPageSize(size);
                                    if (filters.page !== 1) handleFilterChange({ page: 1 });
                                }}
                                canDelete={canDeleteStory}
                                onDelete={handleDelete}
                                canEditCover={canEditStory}
                                onCoverUploaded={(storyIds) => {
                                    loadStories();
                                    // The open story may be one of the tale that got the cover.
                                    if (selectedStory && storyIds.includes(selectedStory.id) && !hasUnsavedChanges) {
                                        loadStory(selectedStory.id);
                                    }
                                }}
                            />
                        </div>

                        {/* Editor */}
                        <div className="col-span-8 flex flex-col gap-4 h-full min-h-0 overflow-hidden">
                            {storyError ? (
                                <div className="bg-card border border-border rounded-xl flex-1 flex items-center justify-center">
                                    <ErrorState
                                        message={storyError}
                                        onRetry={storyParam ? () => loadStory(storyParam) : undefined}
                                        retryLabel="Tekrar dene"
                                    />
                                </div>
                            ) : (
                                <div className="relative bg-card border border-border rounded-xl p-6 overflow-y-auto flex-1 space-y-6">
                                    {storyLoading && (
                                        <div className="absolute inset-0 z-10 bg-card/70 flex items-start justify-center pt-24">
                                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                                        </div>
                                    )}

                                    {!selectedStory && !storyLoading && (
                                        <p className="text-xs text-muted-foreground border border-dashed border-border rounded-lg px-3 py-2">
                                            {canCreateStory
                                                ? "Yeni masal yazıyorsun. Kaydedene kadar taslak bile oluşmaz. Var olan bir masalı düzenlemek için listeden seç."
                                                : "Bir masalı görmek için listeden seç."}
                                        </p>
                                    )}

                                    {/* Title */}
                                    <div>
                                        <label
                                            htmlFor="story-title"
                                            className="text-sm font-medium text-muted-foreground mb-2 block"
                                        >
                                            Masal Başlığı *
                                        </label>
                                        <input
                                            id="story-title"
                                            className={cn(
                                                "w-full text-2xl font-bold bg-transparent border-b border-border focus:border-primary focus:outline-none pb-2",
                                                fieldErrors.title && "border-destructive",
                                            )}
                                            placeholder="Masalın başlığını gir..."
                                            value={title}
                                            onChange={(e) => {
                                                setTitle(e.target.value);
                                                clearFieldError("title");
                                            }}
                                            disabled={formDisabled}
                                        />
                                        {fieldErrors.title && (
                                            <p role="alert" className="text-xs text-red-400 mt-1">
                                                {fieldErrors.title}
                                            </p>
                                        )}
                                    </div>

                                    {/* Status + slug */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <SelectField
                                            id="story-status"
                                            label="Durum"
                                            value={catalogue.status}
                                            onChange={(value) => handleCatalogueChange("status", value)}
                                            options={enums?.status ?? []}
                                            disabled={formDisabled}
                                            hint={
                                                selectedStory?.publishedAt
                                                    ? "Yalnızca Yayında olan masallar uygulamada listelenir."
                                                    : "Yeni masal taslak başlar. Yalnızca Yayında olan masallar uygulamada listelenir."
                                            }
                                            error={
                                                fieldErrors.status && missingKeys.length === 0
                                                    ? fieldErrors.status
                                                    : undefined
                                            }
                                        />
                                        <TextField
                                            id="story-slug"
                                            label="Kısa ad (slug)"
                                            value={catalogue.slug}
                                            onChange={(value) => handleCatalogueChange("slug", value)}
                                            placeholder="ör. kirmizi-baslikli-kiz"
                                            maxLength={80}
                                            disabled={formDisabled}
                                            error={fieldErrors.slug}
                                            hint={
                                                selectedStory
                                                    ? "Küçük harf, rakam ve tire. Her dilde benzersiz olmalı."
                                                    : "Boş bırakılırsa başlıktan üretilir."
                                            }
                                        />
                                    </div>

                                    {catalogue.status === "PUBLISHED" && missingKeys.length > 0 && (
                                        <div
                                            role={serverMissing ? "alert" : undefined}
                                            className={cn(
                                                "rounded-lg border p-3 text-xs space-y-2",
                                                serverMissing
                                                    ? "border-red-500/40 bg-red-500/5"
                                                    : "border-amber-500/40 bg-amber-500/5",
                                            )}
                                        >
                                            <div
                                                className={cn(
                                                    "flex items-center gap-2 font-semibold",
                                                    serverMissing ? "text-red-400" : "text-amber-400",
                                                )}
                                            >
                                                {serverMissing ? (
                                                    <AlertCircle className="w-4 h-4" />
                                                ) : (
                                                    <AlertTriangle className="w-4 h-4" />
                                                )}
                                                {serverMissing
                                                    ? "Masal yayınlanamadı. Şu alanlar eksik:"
                                                    : "Yayınlamak için şu alanlar doldurulmalı:"}
                                            </div>
                                            <ul className="list-disc pl-6 space-y-0.5 text-foreground">
                                                {missingKeys.map((key) => (
                                                    <li key={key}>{PUBLISH_MISSING_LABELS[key] ?? key}</li>
                                                ))}
                                            </ul>
                                            <p className="text-muted-foreground">
                                                {serverMissing
                                                    ? "Değişiklikler kaydedilmedi. Aşağıdaki Kaynak ve telif bölümünde işaretlenen alanları doldurup yeniden kaydet ya da durumu Taslak yap."
                                                    : "Alanlar aşağıdaki Kaynak ve telif bölümünde işaretlendi. Doldurmadan kaydedersen sunucu yayınlamayı reddeder."}
                                            </p>
                                        </div>
                                    )}

                                    {/* Metadata Grid */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <SelectField
                                            id="story-category"
                                            label="Kategori *"
                                            value={category}
                                            onChange={setCategory}
                                            options={enums?.category ?? []}
                                            disabled={formDisabled}
                                        />
                                        <AgeGroupControl
                                            key={`age-${selectedStory?.id ?? "new"}`}
                                            meta={meta}
                                            story={selectedStory}
                                            value={ageGroup}
                                            onChange={setAgeGroup}
                                            canEdit={canSaveCurrent}
                                            disabled={formDisabled}
                                            textChanged={contentChanged}
                                            task={ageGroupTask}
                                            onTaskStarted={refreshTasks}
                                        />
                                        <div>
                                            <SelectField
                                                id="story-language"
                                                label="Dil"
                                                value={language}
                                                onChange={(value) => {
                                                    setLanguage(value);
                                                    clearFieldError("language");
                                                    setLanguageConflict(null);
                                                }}
                                                options={languageOptions}
                                                disabled={formDisabled}
                                                error={fieldErrors.language}
                                                hint={
                                                    !languageEnabled
                                                        ? "Bu dil uygulamada kapalı. Masal, dil Ayarlar sayfasından açılana kadar kullanıcılara gösterilmez."
                                                        : selectedStory && language !== selectedStory.language
                                                          ? "Dil değişince kısa ad ve dil seviyesi yeni dile göre yeniden ele alınır."
                                                          : "Her masal kaydı tek bir dildedir. Başka diller çeviri olarak bağlanır."
                                                }
                                            />
                                            {languageConflict && languageConflict.storyIds.length > 0 && (
                                                <p className="text-xs mt-1 flex flex-wrap gap-x-3">
                                                    {languageConflict.storyIds.map((id, index) => (
                                                        <a
                                                            key={id}
                                                            href={hrefFor(id)}
                                                            onClick={(e) => openConflictStory(e, id)}
                                                            className="text-primary hover:underline"
                                                        >
                                                            {knownTitles[id]
                                                                ? `"${knownTitles[id]}" masalını aç`
                                                                : `Çakışan masalı aç (${index + 1})`}
                                                        </a>
                                                    ))}
                                                </p>
                                            )}
                                        </div>
                                        <div>
                                            <span className="text-sm font-medium text-muted-foreground mb-1.5 block">
                                                Tahmini süre
                                            </span>
                                            <p
                                                id="story-duration"
                                                className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm"
                                            >
                                                <Clock className="w-4 h-4 text-muted-foreground" aria-hidden />
                                                {content.trim() ? `${durationMinutes} dakika` : "Metin yok"}
                                            </p>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                {durationIsPreview
                                                    ? "Kelime sayısından ve dilin okuma hızından hesaplanır. Kaydedince kesinleşir."
                                                    : "Kelime sayısından ve dilin okuma hızından hesaplanır. Elle değiştirilemez."}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Premium Toggle */}
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="checkbox"
                                            id="isPremium"
                                            checked={isPremium}
                                            onChange={(e) => setIsPremium(e.target.checked)}
                                            disabled={formDisabled}
                                            className="w-4 h-4 rounded border-border"
                                        />
                                        <label htmlFor="isPremium" className="text-sm font-medium cursor-pointer">
                                            Premium Masal (Pro abonelik gerekir)
                                        </label>
                                    </div>

                                    <ContentWarningsField
                                        options={enums?.contentWarning ?? []}
                                        value={catalogue.contentWarnings}
                                        onChange={(value) => handleCatalogueChange("contentWarnings", value)}
                                        error={fieldErrors.contentWarnings}
                                        disabled={formDisabled}
                                    />

                                    {/* Cover Image Upload */}
                                    <div>
                                        <label className="text-sm font-medium text-muted-foreground mb-2 block">
                                            Kapak Görseli
                                        </label>
                                        {coverImagePreview ? (
                                            <div className="flex items-end gap-3">
                                                <div className="relative inline-block">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                        src={coverImagePreview}
                                                        alt="Kapak önizleme"
                                                        className="w-48 h-48 object-cover rounded-lg border border-border"
                                                    />
                                                    {coverImage && (
                                                        <button
                                                            type="button"
                                                            onClick={handleDiscardNewImage}
                                                            title="Seçilen yeni görseli bırak"
                                                            aria-label="Seçilen yeni görseli bırak"
                                                            className="absolute -top-2 -right-2 bg-destructive text-white rounded-full p-1 hover:bg-destructive/90"
                                                        >
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="inline-flex items-center gap-2 px-3 py-1.5 border border-border rounded-md text-xs font-medium cursor-pointer hover:bg-muted transition-colors">
                                                        <Upload className="w-3.5 h-3.5" />
                                                        {coverImage ? "Başka görsel seç" : "Görseli değiştir"}
                                                        <input
                                                            type="file"
                                                            accept="image/*"
                                                            onChange={handleImageChange}
                                                            className="hidden"
                                                        />
                                                    </label>
                                                    {coverImage ? (
                                                        <div className="space-y-1.5">
                                                            <p className="text-xs text-muted-foreground">Yeni görsel kaydedince yüklenecek.</p>
                                                            <label className="flex items-start gap-2 text-xs cursor-pointer max-w-[260px]">
                                                                <input
                                                                    type="checkbox"
                                                                    className="mt-0.5 accent-primary"
                                                                    checked={applyCoverToTale}
                                                                    onChange={(e) => setApplyCoverToTale(e.target.checked)}
                                                                    data-testid="apply-cover-to-tale"
                                                                />
                                                                <span>
                                                                    Bu kapağı tüm dillere ve bölümlere uygula
                                                                    <span className="block text-muted-foreground">
                                                                        Kapakta yazı olmadığı için aynı masalın bütün dilleri ve bölümleri bu kapağı kullanır.
                                                                    </span>
                                                                </span>
                                                            </label>
                                                        </div>
                                                    ) : (
                                                        <p className="text-xs text-muted-foreground max-w-[220px]">
                                                            Kayıtlı kapak sadece yenisiyle değiştirilebilir, kaldırılamaz.
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        ) : (
                                            <label className="flex flex-col items-center justify-center w-48 h-48 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary transition-colors">
                                                <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                                                <span className="text-sm text-muted-foreground">Kapak yükle</span>
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    onChange={handleImageChange}
                                                    className="hidden"
                                                />
                                            </label>
                                        )}
                                        {(coverImage || selectedStory?.coverImageUrl) && (
                                            <div className="mt-3 border border-border rounded-lg p-3">
                                                <CoverCreditFields
                                                    idPrefix="story-cover-credit"
                                                    value={coverCredit}
                                                    onChange={(value) => {
                                                        setCoverCredit(value);
                                                        setCoverCreditDirty(true);
                                                    }}
                                                    onError={setCoverCreditError}
                                                    disabled={formDisabled}
                                                />
                                                {coverCreditError && <p className="text-xs text-amber-500 mt-1">{coverCreditError}</p>}
                                                {!coverImage && coverCreditDirty && (
                                                    <p className="text-xs text-muted-foreground mt-1">
                                                        Kaydedince künye bu kapağı gösteren bütün masallara yazılır.
                                                        {coverCreditLine(normalizeCoverCredit(coverCredit)) ? "" : " Boş künye kaldırılır."}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Summary */}
                                    <TextAreaField
                                        id="story-summary"
                                        label="Özet"
                                        value={catalogue.summary}
                                        onChange={(value) => handleCatalogueChange("summary", value)}
                                        maxLength={1000}
                                        rows={3}
                                        disabled={formDisabled}
                                        error={fieldErrors.summary}
                                        hint={`Uygulamada masal kartında görünür. Boş bırakılırsa metnin ilk 150 karakteri kullanılır. ${catalogue.summary.length} / 1000`}
                                    />

                                    {/* Content */}
                                    <FieldShell label="Masal İçeriği *" htmlFor="story-content" error={fieldErrors.content}>
                                        <textarea
                                            id="story-content"
                                            className={cn(
                                                inputClass,
                                                "h-64 rounded-lg p-4 resize-none leading-relaxed font-serif text-base",
                                                fieldErrors.content && "border-destructive",
                                            )}
                                            placeholder="Bir zamanlar..."
                                            value={content}
                                            onChange={(e) => {
                                                setContent(e.target.value);
                                                clearFieldError("content");
                                            }}
                                            disabled={formDisabled}
                                        />
                                        {contentChanged && segments.length > 0 ? (
                                            <p className="text-xs text-amber-500 mt-1 flex items-start gap-1.5">
                                                <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
                                                İçerik değişti. Kaydedince mevcut {segments.length} özel segment silinecek; sonra
                                                Otomatik Böl veya LLM ile yeniden oluşturman gerekecek.
                                            </p>
                                        ) : (
                                            <p className="text-xs text-muted-foreground mt-1">
                                                İçerik değiştirilip kaydedilirse özel segmentler silinir ve yeniden oluşturulmaları gerekir.
                                            </p>
                                        )}
                                    </FieldShell>

                                    {/* Language level: not set / AI / manual */}
                                    <LanguageLevelControl
                                        key={`level-${selectedStory?.id ?? "new"}`}
                                        meta={meta}
                                        story={selectedStory}
                                        level={catalogue.languageLevel}
                                        note={catalogue.languageLevelNote}
                                        onChange={handleCatalogueChange}
                                        errors={fieldErrors}
                                        canEdit={canSaveCurrent}
                                        disabled={formDisabled}
                                        textChanged={textChanged}
                                        task={levelTask}
                                        onTaskStarted={refreshTasks}
                                        hrefFor={hrefFor}
                                        onOpenStory={openStory}
                                    />

                                    {/* Source and rights */}
                                    <StoryRightsSection
                                        meta={meta}
                                        form={catalogue}
                                        onChange={handleCatalogueChange}
                                        errors={fieldErrors}
                                        missing={missingInputs}
                                        disabled={formDisabled}
                                    />

                                    {/* Translations: only meaningful for saved stories */}
                                    {selectedStory ? (
                                        <TranslationsPanel
                                            key={`translations-${selectedStory.id}`}
                                            meta={meta}
                                            story={selectedStory}
                                            canEdit={canEditStory}
                                            textChanged={textChanged}
                                            tasks={translateTasks}
                                            tasksLoading={storyTasks.loading}
                                            tasksError={storyTasks.error}
                                            onRefreshTasks={refreshTasks}
                                            onStoryUpdated={(fresh) => {
                                                syncServerStory(fresh);
                                                loadStories();
                                            }}
                                            hrefFor={hrefFor}
                                            onOpenStory={openStory}
                                        />
                                    ) : (
                                        <div className="border border-dashed border-border rounded-lg p-4 text-center text-xs text-muted-foreground">
                                            Çeviriler için önce masalı kaydet. Şu anki dil:{" "}
                                            {languageName(meta, language)}.
                                        </div>
                                    )}

                                    {/* Cartesia Settings (story-level defaults) */}
                                    <CartesiaSettings
                                        defaultEmotion={defaultEmotion}
                                        defaultSpeed={defaultSpeed}
                                        cartesiaPronunciationDictId={cartesiaPronunciationDictId}
                                        onChange={(changes) => {
                                            if (changes.defaultEmotion !== undefined) {
                                                setDefaultEmotion(changes.defaultEmotion);
                                                setEmotionDirty(true);
                                            }
                                            if (changes.defaultSpeed !== undefined) {
                                                setDefaultSpeed(changes.defaultSpeed);
                                            }
                                            if (changes.cartesiaPronunciationDictId !== undefined) {
                                                setCartesiaPronunciationDictId(
                                                    changes.cartesiaPronunciationDictId,
                                                );
                                            }
                                        }}
                                        disabled={formDisabled}
                                    />

                                    {/* Segment Editor: only meaningful for saved stories */}
                                    {selectedStory ? (
                                        <SegmentEditor
                                            segments={segments}
                                            onChange={(next) => {
                                                setSegments(next);
                                                setSegmentsDirty(true);
                                                if (llmWarnings.length > 0) setLlmWarnings([]);
                                            }}
                                            onAutoSplit={handleAutoSplit}
                                            onClear={handleClearSegments}
                                            onLlmFill={handleLlmFill}
                                            isAutoSplitting={autoSplitting}
                                            isClearing={clearingSegments}
                                            isLlmFilling={llmFilling}
                                            disabled={formDisabled}
                                            preprocessedAt={preprocessedAt}
                                            preprocessedModel={preprocessedModel}
                                            version={segmentationVersion}
                                            matchesContent={
                                                segments.length === 0 || segmentsMatchContent(segments, content)
                                            }
                                            llmWarnings={llmWarnings}
                                        />
                                    ) : (
                                        <div className="border border-dashed border-border rounded-lg p-4 text-center text-xs text-muted-foreground">
                                            Segment yönetimi için önce masalı kaydet.
                                        </div>
                                    )}

                                    {selectedStory && (
                                        <NarrationCachePanel
                                            storyId={selectedStory.id}
                                            canClear={canEditStory}
                                            refreshKey={cacheRefreshKey}
                                        />
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}

            {requestsDialogOpen && (
                <TranslationRequestsDialog
                    meta={meta}
                    canTranslate={canEditStory}
                    onClose={() => setRequestsDialogOpen(false)}
                    onQueued={refreshTasks}
                    hrefFor={hrefFor}
                    onOpenStory={openStory}
                />
            )}

            {tasksDialogOpen && (
                <LlmTasksDialog
                    meta={meta}
                    tasks={allTasks.tasks}
                    loading={allTasks.loading}
                    error={allTasks.error}
                    onRefresh={allTasks.refresh}
                    onClose={() => setTasksDialogOpen(false)}
                    hrefFor={hrefFor}
                    onOpenStory={openStory}
                />
            )}
        </div>
    );
}
