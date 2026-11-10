import type {
    AdminStoriesQueryDto,
    AdminStoryIdsQueryDto,
    AdminStoryListItem,
    ContentWarning,
    EnumOption,
    StoriesMeta,
    StoryCatalogueFields,
    StoryLlmTask,
} from "@/types/api.types";
import type { StoryBrief } from "@/lib/bulk";

// Pure helpers of the stories page. No React and no runtime imports, so the
// file can be unit tested with `node --test` (see stories.test.mjs).

// ============================================
// LIST FILTERS (kept in the URL query)
// ============================================

export interface StoryFilters {
    language: string;
    status: string;
    /** CEFR levels, any number of them. */
    levels: string[];
    category: string;
    ageGroup: string;
    origin: string;
    /** "Translation missing in this language". */
    missingLanguage: string;
    /** "" any, "yes" only imported stories, "no" only the others. */
    imported: string;
    /** Created on or after / on or before this day (YYYY-MM-DD). */
    createdFrom: string;
    createdTo: string;
    q: string;
    sort: string;
    page: number;
}

/** Default rows per page (one of PAGE_SIZE_OPTIONS); the chosen size is kept in localStorage. */
export const STORY_PAGE_SIZE = 25;

/** Name of the query parameter that holds the story open in the editor. */
export const STORY_PARAM = "story";

export const EMPTY_STORY_FILTERS: StoryFilters = {
    language: "",
    status: "",
    levels: [],
    category: "",
    ageGroup: "",
    origin: "",
    missingLanguage: "",
    imported: "",
    createdFrom: "",
    createdTo: "",
    q: "",
    sort: "",
    page: 1,
};

/** A calendar day as the date inputs and the API write it. */
const DAY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

interface ParamReader {
    get(name: string): string | null;
}

const LEVEL_PATTERN = /^[A-C][12]$/;

export function parseStoryFilters(params: ParamReader): StoryFilters {
    const text = (name: string) => (params.get(name) ?? "").trim();
    const levels = text("level")
        .split(",")
        .map((level) => level.trim().toUpperCase())
        .filter((level, index, all) => LEVEL_PATTERN.test(level) && all.indexOf(level) === index);
    const page = Number.parseInt(text("page"), 10);
    return {
        language: text("language").toLowerCase(),
        status: text("status").toUpperCase(),
        levels,
        category: text("category").toUpperCase(),
        ageGroup: text("ageGroup").toUpperCase(),
        origin: text("origin").toUpperCase(),
        missingLanguage: text("missing").toLowerCase(),
        imported: ["yes", "no"].includes(text("imported")) ? text("imported") : "",
        createdFrom: DAY_PATTERN.test(text("from")) ? text("from") : "",
        createdTo: DAY_PATTERN.test(text("to")) ? text("to") : "",
        q: text("q").slice(0, 200),
        sort: text("sort"),
        page: Number.isFinite(page) && page > 1 ? page : 1,
    };
}

/** Query string entries of the filters. Defaults are left out to keep the URL short. */
export function storyFiltersToQuery(filters: StoryFilters): Record<string, string> {
    const query: Record<string, string> = {};
    if (filters.language) query.language = filters.language;
    if (filters.status) query.status = filters.status;
    if (filters.levels.length > 0) query.level = filters.levels.join(",");
    if (filters.category) query.category = filters.category;
    if (filters.ageGroup) query.ageGroup = filters.ageGroup;
    if (filters.origin) query.origin = filters.origin;
    if (filters.missingLanguage) query.missing = filters.missingLanguage;
    if (filters.imported) query.imported = filters.imported;
    if (filters.createdFrom) query.from = filters.createdFrom;
    if (filters.createdTo) query.to = filters.createdTo;
    if (filters.q) query.q = filters.q;
    if (filters.sort) query.sort = filters.sort;
    if (filters.page > 1) query.page = String(filters.page);
    return query;
}

/** Full query string of the page: filters plus the open story. */
export function buildStoriesUrl(pathname: string, filters: StoryFilters, storyId: string | null): string {
    const search = new URLSearchParams(storyFiltersToQuery(filters));
    if (storyId) search.set(STORY_PARAM, storyId);
    const qs = search.toString();
    return qs ? `${pathname}?${qs}` : pathname;
}

export function storyFiltersToApiParams(filters: StoryFilters, pageSize = STORY_PAGE_SIZE): AdminStoriesQueryDto {
    const params: AdminStoriesQueryDto = { page: filters.page, limit: pageSize };
    if (filters.language) params.language = filters.language;
    if (filters.status) params.status = filters.status;
    if (filters.levels.length > 0) params.languageLevel = filters.levels.join(",");
    if (filters.category) params.category = filters.category;
    if (filters.ageGroup) params.ageGroup = filters.ageGroup;
    if (filters.origin) params.origin = filters.origin;
    if (filters.missingLanguage) params.missingLanguage = filters.missingLanguage;
    if (filters.imported) params.imported = filters.imported === "yes" ? "true" : "false";
    if (filters.createdFrom) params.createdFrom = filters.createdFrom;
    if (filters.createdTo) params.createdTo = filters.createdTo;
    if (filters.q) params.q = filters.q;
    if (filters.sort) params.sort = filters.sort;
    return params;
}

/** GET /admin/stories/ids for every story of the list filters (all pages, the list order). */
export function storyFiltersToIdParams(filters: StoryFilters): AdminStoryIdsQueryDto {
    const params: AdminStoryIdsQueryDto = { ...storyFiltersToApiParams(filters), view: "list" };
    delete params.page;
    delete params.limit;
    return params;
}

/** Number of narrowing filters in use (sort and page do not narrow). */
export function activeStoryFilterCount(filters: StoryFilters): number {
    return (
        [
            filters.language,
            filters.status,
            filters.category,
            filters.ageGroup,
            filters.origin,
            filters.missingLanguage,
            filters.imported,
            filters.q,
        ].filter(Boolean).length +
        (filters.levels.length > 0 ? 1 : 0) +
        (filters.createdFrom || filters.createdTo ? 1 : 0)
    );
}

// ============================================
// CATALOGUE FORM (status, credit, rights, level)
// ============================================

/** Every catalogue input of the editor as text, the way the inputs hold it. */
export type CatalogueForm = Required<Omit<StoryCatalogueFields, "translatedFromId">>;
export type CatalogueKey = keyof CatalogueForm;

export const CATALOGUE_KEYS: CatalogueKey[] = [
    "slug",
    "status",
    "summary",
    "originalTitle",
    "originalLanguage",
    "authorName",
    "authorDeathYear",
    "collectorName",
    "collectorDeathYear",
    "translatorName",
    "translatorDeathYear",
    "adaptedBy",
    "firstPublishedYear",
    "editionYear",
    "sourceName",
    "sourceUrl",
    "origin",
    "textFidelity",
    "sourceRetrievedAt",
    "rightsBasis",
    "rightsNote",
    "licenseUrl",
    "licenseName",
    "attribution",
    "sourceEdition",
    "contentWarnings",
    "rightsVerifiedAt",
    "rightsVerifiedBy",
    "translationMethod",
    "languageLevel",
    "languageLevelNote",
];

export function emptyCatalogueForm(): CatalogueForm {
    const form = {} as CatalogueForm;
    for (const key of CATALOGUE_KEYS) form[key] = "";
    form.status = "DRAFT";
    return form;
}

const text = (value: string | number | null | undefined): string =>
    value === null || value === undefined ? "" : String(value);

/** "2026-10-13T00:00:00.000Z" as "2026-10-13" for a date input. */
export function toDateInput(iso: string | null | undefined): string {
    return typeof iso === "string" && iso.length >= 10 ? iso.slice(0, 10) : "";
}

export function catalogueFromStory(story: AdminStoryListItem): CatalogueForm {
    return {
        slug: text(story.slug),
        status: story.status || "DRAFT",
        summary: text(story.summary),
        originalTitle: text(story.originalTitle),
        originalLanguage: text(story.originalLanguage),
        authorName: text(story.authorName),
        authorDeathYear: text(story.authorDeathYear),
        collectorName: text(story.collectorName),
        collectorDeathYear: text(story.collectorDeathYear),
        translatorName: text(story.translatorName),
        translatorDeathYear: text(story.translatorDeathYear),
        adaptedBy: text(story.adaptedBy),
        firstPublishedYear: text(story.firstPublishedYear),
        editionYear: text(story.editionYear),
        sourceName: text(story.sourceName),
        sourceUrl: text(story.sourceUrl),
        origin: text(story.origin),
        textFidelity: text(story.textFidelity),
        sourceRetrievedAt: toDateInput(story.sourceRetrievedAt),
        rightsBasis: text(story.rightsBasis),
        rightsNote: text(story.rightsNote),
        licenseUrl: text(story.licenseUrl),
        licenseName: text(story.licenseName),
        attribution: text(story.attribution),
        sourceEdition: text(story.sourceEdition),
        contentWarnings: (story.contentWarnings ?? []).join(","),
        rightsVerifiedAt: toDateInput(story.rightsVerifiedAt),
        rightsVerifiedBy: text(story.rightsVerifiedBy),
        translationMethod: text(story.translationMethod),
        languageLevel: text(story.languageLevel),
        languageLevelNote: text(story.languageLevelNote),
    };
}

/**
 * Fields to send on PATCH: only the ones that differ from the saved story.
 * Sending just the changes keeps a save from touching what the admin did not
 * edit (the level source, the slug, the translation group). An emptied field
 * goes out as "" which clears the column. An emptied slug is not sent: the
 * backend keeps the current slug in that case anyway.
 */
export function catalogueChanges(form: CatalogueForm, base: CatalogueForm): StoryCatalogueFields {
    const changes: StoryCatalogueFields = {};
    for (const key of CATALOGUE_KEYS) {
        const next = form[key].trim();
        if (next === base[key].trim()) continue;
        if (key === "slug" && next === "") continue;
        changes[key] = next;
    }
    return changes;
}

// ============================================
// CONTENT WARNINGS (backend Prisma enum ContentWarning)
// ============================================

/**
 * The values of the backend enum, in its order (the meta endpoint's
 * `enums.contentWarning` carries the same values with the same labels).
 */
export const CONTENT_WARNINGS: readonly ContentWarning[] = [
    "SCARY",
    "VIOLENCE",
    "DEATH",
    "SAD_ENDING",
    "BAD_EXAMPLE",
    "OLD_LANGUAGE",
    "LONELINESS",
];

/** Turkish labels, for places without the meta labels (the import preview) and as a fallback. */
export const CONTENT_WARNING_LABELS: Record<ContentWarning, string> = {
    SCARY: "Korkutucu sahne",
    VIOLENCE: "Şiddet",
    DEATH: "Ölüm",
    SAD_ENDING: "Üzücü son",
    BAD_EXAMPLE: "Kötü davranış örneği",
    OLD_LANGUAGE: "Eski dil / ağır anlatım",
    LONELINESS: "Yalnızlık / ayrılık",
};

export function isContentWarning(value: unknown): value is ContentWarning {
    return typeof value === "string" && (CONTENT_WARNINGS as readonly string[]).includes(value);
}

/** The meta options when loaded, else the local enum with its Turkish labels. */
export function contentWarningOptions(options?: EnumOption[] | null): EnumOption[] {
    if (options && options.length > 0) return options;
    return CONTENT_WARNINGS.map((value) => ({ value, label: CONTENT_WARNING_LABELS[value] }));
}

/**
 * Labels of the `contentWarnings` of an import item (enum order, once each)
 * and the values the backend will refuse (an old Turkish key such as
 * "korkutucu" too), so the preview shows them before the import. Values are
 * trimmed and upper-cased like the backend does.
 */
export function describeContentWarnings(values: unknown): { labels: string[]; unknown: string[] } {
    if (!Array.isArray(values)) return { labels: [], unknown: [] };
    const known = new Set<ContentWarning>();
    const unknown: string[] = [];
    for (const raw of values) {
        const value = typeof raw === "string" ? raw.trim().toUpperCase() : raw;
        if (value === "") continue;
        if (isContentWarning(value)) known.add(value);
        else if (!unknown.includes(String(raw))) unknown.push(String(raw));
    }
    return {
        labels: CONTENT_WARNINGS.filter((v) => known.has(v)).map((v) => CONTENT_WARNING_LABELS[v]),
        unknown,
    };
}

/** Content warning values of the form value ("SCARY,DEATH"). */
export function parseContentWarnings(value: string): string[] {
    return value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
}

/**
 * Adds or removes one warning; the result keeps the enum order, so
 * ticking and unticking back gives the stored value (an untouched form).
 */
export function toggleContentWarning(value: string, key: string, order: string[]): string {
    const set = new Set(parseContentWarnings(value));
    if (set.has(key)) set.delete(key);
    else set.add(key);
    const rank = (k: string) => {
        const i = order.indexOf(k);
        return i === -1 ? order.length : i;
    };
    return [...set].sort((a, b) => rank(a) - rank(b)).join(",");
}

/** Fields to send on POST: every filled one. */
export function catalogueForCreate(form: CatalogueForm): StoryCatalogueFields {
    const fields: StoryCatalogueFields = {};
    for (const key of CATALOGUE_KEYS) {
        const value = form[key].trim();
        if (value !== "") fields[key] = value;
    }
    return fields;
}

export function isCatalogueDirty(form: CatalogueForm, base: CatalogueForm): boolean {
    return CATALOGUE_KEYS.some((key) => form[key].trim() !== base[key].trim());
}

/**
 * The saved story changed behind the form (an AI level landed, a link was
 * made). Inputs the admin did not touch follow the new saved value, edited
 * inputs keep the edit.
 */
export function rebaseCatalogueForm(
    form: CatalogueForm,
    oldBase: CatalogueForm,
    newBase: CatalogueForm,
): CatalogueForm {
    const next = { ...form };
    for (const key of CATALOGUE_KEYS) {
        if (form[key] === oldBase[key]) next[key] = newBase[key];
    }
    return next;
}

// ============================================
// PUBLISH REQUIREMENTS
// ============================================

/** Keys of the `missing` list of the STORY_PUBLISH_REQUIREMENTS error. */
export const PUBLISH_MISSING_LABELS: Record<string, string> = {
    origin: "Köken",
    textFidelity: "Metin sadakati",
    rightsBasis: "Hak dayanağı",
    source: "Kaynak adı ya da kaynak bağlantısı",
    attribution: "Yazar ya da derleyen",
    ccAttribution: "Atıf metni (CC BY lisansı için zorunlu)",
    ccLicense: "Lisans adı (CC BY lisansı için zorunlu)",
};

/** Form inputs each missing key points at (for the red outline). */
export const PUBLISH_MISSING_FIELDS: Record<string, CatalogueKey[]> = {
    origin: ["origin"],
    textFidelity: ["textFidelity"],
    rightsBasis: ["rightsBasis"],
    source: ["sourceName", "sourceUrl"],
    attribution: ["authorName", "collectorName"],
    ccAttribution: ["attribution"],
    ccLicense: ["licenseName"],
};

/**
 * Client-side copy of the backend publish rule, driven by the rules the meta
 * endpoint returns. It only feeds an early hint; the backend decides.
 */
export function missingPublishFields(
    form: CatalogueForm,
    rules: StoriesMeta["publishRules"] | null | undefined,
): string[] {
    const always = rules?.always ?? ["origin", "textFidelity"];
    const rightsOrigins = rules?.rightsRequiredOrigins ?? ["PUBLIC_DOMAIN", "FOLK_ANONYMOUS", "LICENSED"];
    const filled = (key: CatalogueKey) => form[key].trim() !== "";
    const missing: string[] = [];
    for (const key of always) {
        if (key in form && !filled(key as CatalogueKey)) missing.push(key);
    }
    if (form.origin && rightsOrigins.includes(form.origin)) {
        if (!filled("rightsBasis")) missing.push("rightsBasis");
        if (!filled("sourceName") && !filled("sourceUrl")) missing.push("source");
        if (!filled("authorName") && !filled("collectorName") && form.origin !== "FOLK_ANONYMOUS") {
            missing.push("attribution");
        }
    }
    // A CC BY text is only usable with its credit, whatever the origin.
    if (form.rightsBasis === "CC_BY") {
        if (!filled("attribution")) missing.push("ccAttribution");
        if (!filled("licenseName")) missing.push("ccLicense");
    }
    return missing;
}

/** What the bulk actions need of a list row: status, review mark and the publish rule. */
export function storyBrief(
    story: AdminStoryListItem,
    rules: StoriesMeta["publishRules"] | null | undefined,
): StoryBrief {
    return {
        id: story.id,
        title: story.title,
        status: story.status,
        reviewed: !!story.reviewedAt,
        publishable: missingPublishFields(catalogueFromStory(story), rules).length === 0,
    };
}

// ============================================
// BULK DELETE CONFIRMATION
// ============================================

/** The word typed to confirm a bulk delete: "SİL" (dotless I and any case accepted). */
export function deleteConfirmMatches(typed: string): boolean {
    const word = typed.trim().toLocaleUpperCase("tr");
    return word === "SİL" || word === "SIL";
}

// ============================================
// API ERRORS
// ============================================

/** Body of a failed request: the global envelope plus the extras of a coded error. */
export interface ApiErrorData {
    statusCode?: number;
    message?: string;
    code?: string;
    missing?: string[];
    storyId?: string;
    storyIds?: string[];
    replaceable?: boolean;
    taskId?: string;
    problems?: string[];
}

export function getApiErrorData(error: unknown): ApiErrorData {
    const response = (error as { response?: { status?: number; data?: unknown } })?.response;
    const data = response?.data;
    if (!data || typeof data !== "object") {
        return response?.status ? { statusCode: response.status } : {};
    }
    const raw = data as Record<string, unknown>;
    const strings = (value: unknown): string[] | undefined =>
        Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
    return {
        statusCode: typeof raw.statusCode === "number" ? raw.statusCode : response?.status,
        message: typeof raw.message === "string" ? raw.message : undefined,
        code: typeof raw.code === "string" ? raw.code : undefined,
        missing: strings(raw.missing),
        storyId: typeof raw.storyId === "string" ? raw.storyId : undefined,
        storyIds: strings(raw.storyIds),
        replaceable: typeof raw.replaceable === "boolean" ? raw.replaceable : undefined,
        taskId: typeof raw.taskId === "string" ? raw.taskId : undefined,
        problems: strings(raw.problems),
    };
}

/** Editor inputs an API message can be attached to. */
export type StoryFieldKey = CatalogueKey | "language" | "title" | "content" | "estimatedDuration";

// The backend validation messages start with the Turkish label of the field.
// Longer labels come first so "Yazarın ölüm yılı" is not read as "Yazar".
const FIELD_MESSAGE_PREFIXES: Array<[string, StoryFieldKey]> = [
    ["Hakların doğrulandığı tarih", "rightsVerifiedAt"],
    ["Kaynağın alındığı tarih", "sourceRetrievedAt"],
    ["Çevirmenin ölüm yılı", "translatorDeathYear"],
    ["Derleyenin ölüm yılı", "collectorDeathYear"],
    ["Geçersiz içerik dili", "language"],
    ["Hakları doğrulayan", "rightsVerifiedBy"],
    ["Yazarın ölüm yılı", "authorDeathYear"],
    ["Dil seviyesi notu", "languageLevelNote"],
    ["Kaynak bağlantısı", "sourceUrl"],
    ["Lisans bağlantısı", "licenseUrl"],
    ["Kaynak baskı", "sourceEdition"],
    ["İçerik uyarı", "contentWarnings"],
    ["En fazla 7 içerik uyarısı", "contentWarnings"],
    ["Atıf metni", "attribution"],
    ["Çeviri yöntemi", "translationMethod"],
    ["Metin sadakati", "textFidelity"],
    ["İlk yayım yılı", "firstPublishedYear"],
    ["Özgün başlık", "originalTitle"],
    ["Hak dayanağı", "rightsBasis"],
    ["Dil seviyesi", "languageLevel"],
    ["Kaynak adı", "sourceName"],
    ["Baskı yılı", "editionYear"],
    ["Özgün dil", "originalLanguage"],
    ["Uyarlayan", "adaptedBy"],
    ["Hak notu", "rightsNote"],
    ["Çevirmen", "translatorName"],
    ["Derleyen", "collectorName"],
    ["Kısa ad", "slug"],
    ["Lisans", "licenseName"],
    ["Yazar", "authorName"],
    ["Köken", "origin"],
    ["Durum", "status"],
    ["Özet", "summary"],
];

const CODE_FIELDS: Record<string, StoryFieldKey> = {
    STORY_SLUG_TAKEN: "slug",
    STORY_PUBLISH_REQUIREMENTS: "status",
    TRANSLATION_LANGUAGE_TAKEN: "language",
    TRANSLATION_SAME_LANGUAGE: "language",
};

/** The input a save error belongs to, or null when it is not about one field. */
export function fieldForApiError(data: ApiErrorData): StoryFieldKey | null {
    if (data.code && CODE_FIELDS[data.code]) return CODE_FIELDS[data.code];
    const message = data.message ?? "";
    for (const [prefix, field] of FIELD_MESSAGE_PREFIXES) {
        if (message.startsWith(prefix)) return field;
    }
    return null;
}

// ============================================
// LABELS AND FORMATTING
// ============================================

export function optionLabel(options: EnumOption[] | undefined, value: string | null | undefined): string {
    if (!value) return "";
    return options?.find((option) => option.value === value)?.label ?? value;
}

/** "Türkçe (tr)". Falls back to the bare code for a language the meta does not know. */
export function languageName(meta: StoriesMeta | null, code: string | null | undefined): string {
    if (!code) return "";
    const info = meta?.languages.all.find((language) => language.code === code);
    return info ? `${info.nativeName} (${info.code})` : code;
}

export function formatDateTime(iso: string | null | undefined): string {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("tr-TR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/** Pace used when the language is not in the metadata (the backend default). */
const DEFAULT_WORDS_PER_MINUTE = 150;

/**
 * The formula the backend uses for Story.estimatedDuration: whole minutes,
 * at least one. Shown as a preview while the text or language is edited.
 */
export function estimateDurationMinutes(content: string, wordsPerMinute?: number | null): number {
    const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
    const pace = wordsPerMinute && wordsPerMinute > 0 ? wordsPerMinute : DEFAULT_WORDS_PER_MINUTE;
    return Math.max(1, Math.ceil(wordCount / pace));
}

export function isTaskActive(task: Pick<StoryLlmTask, "status">): boolean {
    return task.status === "PENDING" || task.status === "RUNNING";
}
