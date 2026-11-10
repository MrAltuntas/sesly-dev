"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
    AlertCircle,
    AlertTriangle,
    CheckCircle2,
    ChevronRight,
    Code2,
    Copy,
    Eye,
    FileText,
    History,
    Languages,
    Loader2,
    Plus,
    Save,
    Upload,
    X,
} from "lucide-react";
import { LegalService } from "@/services/admin.service";
import { LegalDocument, LegalDocumentVersion, LegalLanguage } from "@/types/api.types";
import {
    FALLBACK_LEGAL_LANGUAGE,
    LEGAL_LANGUAGES,
    LEGAL_LANGUAGE_LABELS,
    LEGAL_LANGUAGE_NAMES,
    LegalNotice,
    defaultLegalTitle,
    findLegalDoc,
    formatLegalDate,
    hasUnpublishedChanges,
    legalContentIssues,
    legalDocKey,
    legalDocState,
    legalLanguageNotice,
    legalSlugs,
    legalStateBadge,
    legalTabTitle,
} from "@/lib/legal";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { usePermissions } from "@/hooks/usePermissions";
import { ErrorState, getErrorMessage } from "@/components/ui/error-state";

type Mode = "edit" | "split" | "preview" | "compare";

interface Selection {
    slug: string;
    language: LegalLanguage;
}

interface CreateForm {
    slug: string;
    language: LegalLanguage;
    title: string;
    contentMd: string;
    /** Adding a language to an existing document: slug and language are fixed. */
    locked: boolean;
}

interface VersionsState {
    key: string;
    items: LegalDocumentVersion[];
    failed: boolean;
}

const EMPTY_CREATE_FORM: CreateForm = {
    slug: "",
    language: FALLBACK_LEGAL_LANGUAGE,
    title: "",
    contentMd: "",
    locked: false,
};

const TITLE_PLACEHOLDERS: Record<LegalLanguage, string> = {
    tr: "Kullanım Şartları",
    en: "Terms of Use",
};

export default function LegalPage() {
    const toast = useToast();
    const confirm = useConfirm();
    const { canEditLegal } = usePermissions();

    // Every language of every document (`?language=all`), keyed by slug + language.
    const [documents, setDocuments] = useState<LegalDocument[]>([]);
    const [selection, setSelection] = useState<Selection | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Editor state for the selected (slug, language) document.
    const [title, setTitle] = useState("");
    const [contentMd, setContentMd] = useState("");
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [mode, setMode] = useState<Mode>("split");

    // Published versions of the selected document (history drawer + change check).
    const [versionsState, setVersionsState] = useState<VersionsState | null>(null);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [viewingVersion, setViewingVersion] = useState<LegalDocumentVersion | null>(null);

    const [createForm, setCreateForm] = useState<CreateForm | null>(null);
    const [creating, setCreating] = useState(false);

    const activeSlug = selection?.slug ?? null;
    const activeLanguage = selection?.language ?? FALLBACK_LEGAL_LANGUAGE;
    const slugs = useMemo(() => legalSlugs(documents), [documents]);
    const activeDoc = activeSlug ? findLegalDoc(documents, activeSlug, activeLanguage) : null;
    const turkishDoc = activeSlug ? findLegalDoc(documents, activeSlug, FALLBACK_LEGAL_LANGUAGE) : null;
    const canCompare = activeLanguage !== FALLBACK_LEGAL_LANGUAGE && !!turkishDoc;
    const effectiveMode: Mode = mode === "compare" && !canCompare ? "split" : mode;

    const notice = activeSlug ? legalLanguageNotice(documents, activeSlug, activeLanguage) : null;
    const issues = useMemo(() => legalContentIssues(title, contentMd), [title, contentMd]);

    const versionsKey = activeDoc && activeDoc.currentVersion > 0 ? `${activeDoc.id}:${activeDoc.currentVersion}` : null;
    const versions: LegalDocumentVersion[] | null = !activeDoc
        ? []
        : !versionsKey
          ? []
          : versionsState?.key === versionsKey
            ? versionsState.items
            : null;
    const versionsFailed = !!versionsKey && versionsState?.key === versionsKey && versionsState.failed;
    const unpublished = dirty ? null : hasUnpublishedChanges(activeDoc, versions?.[0]);
    const nothingToPublish = !dirty && unpublished === false;

    const seedEditor = (doc: LegalDocument | null) => {
        setTitle(doc?.title ?? "");
        setContentMd(doc?.contentMd ?? "");
        setDirty(false);
    };

    const loadList = useCallback(async (select?: Selection) => {
        setLoading(true);
        setLoadError(null);
        try {
            const res = await LegalService.list("all");
            const docs = res.data;
            const available = legalSlugs(docs);
            const next =
                select && available.includes(select.slug)
                    ? select
                    : available[0]
                      ? { slug: available[0], language: select?.language ?? FALLBACK_LEGAL_LANGUAGE }
                      : null;
            setDocuments(docs);
            setSelection(next);
            const doc = next ? findLegalDoc(docs, next.slug, next.language) : null;
            setTitle(doc?.title ?? "");
            setContentMd(doc?.contentMd ?? "");
            setDirty(false);
        } catch (e) {
            console.error("Failed to load legal docs", e);
            setLoadError(getErrorMessage(e, "Yasal belgeler yüklenemedi."));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadList();
    }, [loadList]);

    // Published versions of the selected document. Refetched after a publish
    // (the key carries currentVersion). A never-published draft has none.
    useEffect(() => {
        if (!versionsKey || !activeSlug) return;
        let cancelled = false;
        LegalService.getVersions(activeSlug, activeLanguage)
            .then((res) => {
                if (!cancelled) setVersionsState({ key: versionsKey, items: res.data, failed: false });
            })
            .catch((e) => {
                console.error("Failed to load versions", e);
                if (!cancelled) setVersionsState({ key: versionsKey, items: [], failed: true });
            });
        return () => {
            cancelled = true;
        };
    }, [versionsKey, activeSlug, activeLanguage]);

    // Closing the tab with unsaved edits asks first.
    useEffect(() => {
        if (!dirty) return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [dirty]);

    const replaceDoc = (doc: LegalDocument) => {
        setDocuments((prev) =>
            prev.map((d) => (legalDocKey(d.slug, d.language) === legalDocKey(doc.slug, doc.language) ? doc : d)),
        );
    };

    const select = async (slug: string, language: LegalLanguage) => {
        if (selection?.slug === slug && selection.language === language) return;
        if (dirty) {
            const ok = await confirm({
                title: "Kaydedilmemiş değişiklikler var",
                message: "Bu metinde kaydedilmemiş değişiklikler var. Başka bir belgeye ya da dile geçersen kaybolur.",
                confirmLabel: "Değişiklikleri at",
                cancelLabel: "Vazgeç",
                variant: "destructive",
            });
            if (!ok) return;
        }
        setSelection({ slug, language });
        seedEditor(findLegalDoc(documents, slug, language));
        setViewingVersion(null);
    };

    const saveDraft = async (): Promise<boolean> => {
        if (!activeDoc) return false;
        if (!title.trim() || !contentMd.trim()) {
            toast.error("Başlık ve metin boş olamaz.");
            return false;
        }
        try {
            const res = await LegalService.update(activeDoc.slug, activeDoc.language, { title, contentMd });
            replaceDoc(res.data);
            setDirty(false);
            return true;
        } catch (e) {
            toast.error(getErrorMessage(e, "Taslak kaydedilemedi."));
            return false;
        }
    };

    const handleSaveDraft = async () => {
        setSaving(true);
        try {
            if (await saveDraft()) toast.success("Taslak kaydedildi. Uygulamaya yansıması için yayınla.");
        } finally {
            setSaving(false);
        }
    };

    const handlePublish = async () => {
        if (!activeDoc) return;
        const name = LEGAL_LANGUAGE_NAMES[activeDoc.language];
        const nextVersion = activeDoc.currentVersion + 1;
        const firstOwnText =
            activeDoc.language !== FALLBACK_LEGAL_LANGUAGE && legalDocState(activeDoc) !== "published";
        const lines = [
            `"${title || activeDoc.title}" belgesinin ${name} sürümü v${nextVersion} olarak yayınlanacak. Yayınlanan sürüm değiştirilemez ve uygulama bu metni göstermeye başlar. Diğer diller etkilenmez.`,
        ];
        if (firstOwnText) {
            lines.push(
                `Uygulama dili ${name} olan kullanıcılar bundan sonra ${LEGAL_LANGUAGE_NAMES[FALLBACK_LEGAL_LANGUAGE]} metin yerine bu metni görür.`,
            );
        }
        if (dirty) lines.push("Kaydedilmemiş değişiklikler önce taslağa kaydedilir.");
        if (issues.length > 0) {
            lines.push(`Dikkat, metinde düzeltilmesi gereken ${issues.length} sorun var:\n${issues.map((i) => `- ${i.message}`).join("\n")}`);
        }
        const ok = await confirm({
            title: `${name} sürüm yayınlansın mı?`,
            message: lines.join("\n\n"),
            confirmLabel: `v${nextVersion} yayınla`,
            cancelLabel: "Vazgeç",
        });
        if (!ok) return;

        if (dirty) {
            setSaving(true);
            const saved = await saveDraft();
            setSaving(false);
            if (!saved) return;
        }

        setPublishing(true);
        try {
            const res = await LegalService.publish(activeDoc.slug, activeDoc.language);
            replaceDoc(res.data);
            toast.success(`${name} sürüm v${res.data.currentVersion} yayınlandı.`);
        } catch (e) {
            toast.error(getErrorMessage(e, "Yayınlanamadı."));
        } finally {
            setPublishing(false);
        }
    };

    const openCreate = (form: Partial<CreateForm> = {}) => {
        setCreateForm({ ...EMPTY_CREATE_FORM, ...form });
    };

    const openAddLanguage = () => {
        if (!activeSlug) return;
        openCreate({
            slug: activeSlug,
            language: activeLanguage,
            title: defaultLegalTitle(activeSlug, activeLanguage),
            locked: true,
        });
    };

    const handleCreate = async () => {
        if (!createForm) return;
        const slug = createForm.slug.trim();
        const docTitle = createForm.title.trim();
        if (!slug || !docTitle) {
            toast.error("Kısa ad ve başlık gerekli.");
            return;
        }
        if (!/^[a-z0-9-]+$/.test(slug) || slug.length < 2) {
            toast.error("Kısa ad en az 2 karakter olmalı ve yalnızca küçük harf, rakam ve tire içermeli.");
            return;
        }
        if (findLegalDoc(documents, slug, createForm.language)) {
            toast.error(`Bu belgenin ${LEGAL_LANGUAGE_NAMES[createForm.language]} sürümü zaten var.`);
            return;
        }
        setCreating(true);
        try {
            const res = await LegalService.create({
                slug,
                language: createForm.language,
                title: docTitle,
                contentMd: createForm.contentMd.trim() ? createForm.contentMd : `# ${docTitle}\n\n`,
            });
            toast.success(`${LEGAL_LANGUAGE_NAMES[res.data.language]} taslak oluşturuldu. Yayınlanana kadar uygulamada görünmez.`);
            setCreateForm(null);
            await loadList({ slug: res.data.slug, language: res.data.language });
        } catch (e) {
            toast.error(getErrorMessage(e, "Belge oluşturulamadı."));
        } finally {
            setCreating(false);
        }
    };

    const openHistory = () => {
        setViewingVersion(null);
        setHistoryOpen(true);
    };

    return (
        <div className="space-y-6 h-[calc(100vh-6rem)] flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Yasal Belgeler</h2>
                    <p className="text-muted-foreground">
                        Kullanım şartları, gizlilik politikası ve veri silme metinleri. Her dil ayrı düzenlenir ve ayrı
                        yayınlanır.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {activeDoc && (
                        <button
                            type="button"
                            onClick={openHistory}
                            className="bg-secondary hover:bg-secondary/80 text-secondary-foreground px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2"
                        >
                            <History className="w-4 h-4" />
                            Sürüm geçmişi
                        </button>
                    )}
                    {canEditLegal && (
                        <button
                            type="button"
                            onClick={() => openCreate()}
                            className="bg-primary hover:bg-primary/90 text-white px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2"
                        >
                            <Plus className="w-4 h-4" /> Yeni belge
                        </button>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
            ) : loadError ? (
                <ErrorState
                    message={loadError}
                    onRetry={() => loadList(selection ?? undefined)}
                    retryLabel="Tekrar dene"
                    className="flex-1"
                />
            ) : slugs.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                        <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                        <p className="text-muted-foreground">Henüz yasal belge yok.</p>
                        {canEditLegal && (
                            <button
                                type="button"
                                onClick={() => openCreate()}
                                className="mt-4 bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-md text-sm font-medium inline-flex items-center gap-2"
                            >
                                <Plus className="w-4 h-4" /> İlk belgeyi oluştur
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col min-h-0">
                    {/* Document tabs: one per slug, with the state of every language. */}
                    <div className="flex items-center gap-1 border-b border-border shrink-0 overflow-x-auto">
                        {slugs.map((slug) => (
                            <button
                                key={slug}
                                type="button"
                                onClick={() => select(slug, activeLanguage)}
                                className={cn(
                                    "px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap",
                                    activeSlug === slug
                                        ? "border-primary text-primary"
                                        : "border-transparent text-muted-foreground hover:text-foreground",
                                )}
                            >
                                <FileText className="w-4 h-4" />
                                {legalTabTitle(documents, slug)}
                                <span className="flex items-center gap-1">
                                    {LEGAL_LANGUAGES.map((language) => (
                                        <StateBadge
                                            key={language}
                                            doc={findLegalDoc(documents, slug, language)}
                                            prefix={language}
                                        />
                                    ))}
                                </span>
                            </button>
                        ))}
                    </div>

                    {activeSlug && (
                        <>
                            {/* Language switch + what the app shows in that language. */}
                            <div className="flex flex-wrap items-start gap-3 pt-3 shrink-0">
                                <div
                                    role="group"
                                    aria-label="Belge dili"
                                    className="flex items-center border border-border rounded-md overflow-hidden text-sm shrink-0"
                                >
                                    <span className="px-2.5 py-2 text-muted-foreground border-r border-border flex items-center">
                                        <Languages className="w-4 h-4" />
                                    </span>
                                    {LEGAL_LANGUAGES.map((language, index) => (
                                        <button
                                            key={language}
                                            type="button"
                                            aria-pressed={activeLanguage === language}
                                            onClick={() => select(activeSlug, language)}
                                            className={cn(
                                                "px-3 py-2 flex items-center gap-2 font-medium transition-colors",
                                                index > 0 && "border-l border-border",
                                                activeLanguage === language
                                                    ? "bg-primary/10 text-primary"
                                                    : "text-muted-foreground hover:bg-muted/50",
                                            )}
                                        >
                                            {LEGAL_LANGUAGE_LABELS[language]}
                                            <StateBadge doc={findLegalDoc(documents, activeSlug, language)} />
                                        </button>
                                    ))}
                                </div>
                                {notice && <NoticeBox notice={notice} />}
                            </div>

                            {!activeDoc ? (
                                <MissingLanguage
                                    language={activeLanguage}
                                    fallback={turkishDoc}
                                    canEdit={canEditLegal}
                                    onCreate={openAddLanguage}
                                />
                            ) : (
                                <>
                                    {/* Editor toolbar */}
                                    <div className="flex flex-wrap items-center justify-between gap-2 py-3 shrink-0">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <input
                                                value={title}
                                                disabled={!canEditLegal}
                                                aria-label="Başlık"
                                                onChange={(e) => {
                                                    setTitle(e.target.value);
                                                    setDirty(true);
                                                }}
                                                className="bg-transparent border-b border-border focus:border-primary focus:outline-none px-1 py-1 text-lg font-semibold w-96 max-w-full disabled:opacity-60"
                                            />
                                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                                                /{activeDoc.slug}
                                            </span>
                                            {dirty && (
                                                <span className="text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded whitespace-nowrap">
                                                    kaydedilmedi
                                                </span>
                                            )}
                                            {unpublished === true && (
                                                <span className="text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded whitespace-nowrap">
                                                    yayınlanmamış değişiklik var
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center border border-border rounded-md overflow-hidden text-xs">
                                                <ModeButton current={effectiveMode} value="edit" onSelect={setMode}>
                                                    <Code2 className="w-3.5 h-3.5" /> Düzenle
                                                </ModeButton>
                                                <ModeButton current={effectiveMode} value="split" onSelect={setMode}>
                                                    Yan yana
                                                </ModeButton>
                                                <ModeButton current={effectiveMode} value="preview" onSelect={setMode}>
                                                    <Eye className="w-3.5 h-3.5" /> Önizle
                                                </ModeButton>
                                                {canCompare && (
                                                    <ModeButton
                                                        current={effectiveMode}
                                                        value="compare"
                                                        onSelect={setMode}
                                                        title="Sağda Türkçe metni göster"
                                                    >
                                                        <Languages className="w-3.5 h-3.5" /> Türkçe ile
                                                    </ModeButton>
                                                )}
                                            </div>
                                            {canEditLegal && (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={handleSaveDraft}
                                                        disabled={saving || publishing || !dirty}
                                                        className="bg-secondary hover:bg-secondary/80 text-secondary-foreground px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                                                    >
                                                        {saving ? (
                                                            <Loader2 className="w-4 h-4 animate-spin" />
                                                        ) : (
                                                            <Save className="w-4 h-4" />
                                                        )}
                                                        Taslağı kaydet
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={handlePublish}
                                                        disabled={publishing || saving || nothingToPublish}
                                                        title={
                                                            nothingToPublish
                                                                ? `Metin yayındaki v${activeDoc.currentVersion} ile aynı. Yayınlanacak değişiklik yok.`
                                                                : undefined
                                                        }
                                                        className="bg-primary hover:bg-primary/90 text-white px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                                                    >
                                                        {publishing ? (
                                                            <Loader2 className="w-4 h-4 animate-spin" />
                                                        ) : (
                                                            <Upload className="w-4 h-4" />
                                                        )}
                                                        Yayınla v{activeDoc.currentVersion + 1}
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {/* Metadata strip */}
                                    <div className="text-xs text-muted-foreground pb-2 shrink-0">
                                        {LEGAL_LANGUAGE_NAMES[activeDoc.language]} sürüm:{" "}
                                        {legalDocState(activeDoc) === "published" ? (
                                            <>
                                                v{activeDoc.currentVersion}, {formatLegalDate(activeDoc.publishedAt)}{" "}
                                                tarihinde yayınlandı
                                                {activeDoc.publishedBy && <> ({activeDoc.publishedBy})</>}.
                                            </>
                                        ) : (
                                            <>henüz yayınlanmadı.</>
                                        )}{" "}
                                        Son kayıt: {formatLegalDate(activeDoc.updatedAt)}.
                                        {nothingToPublish && (
                                            <> Taslak yayındaki v{activeDoc.currentVersion} ile aynı, yayınlanacak değişiklik yok.</>
                                        )}
                                    </div>

                                    {issues.length > 0 && (
                                        <div className="border border-amber-500/30 bg-amber-500/5 rounded-md p-3 mb-3 text-xs flex items-start gap-2 shrink-0">
                                            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-px" />
                                            <div className="min-w-0">
                                                <p className="font-semibold text-amber-400">
                                                    Yayınlamadan önce düzeltilmesi gerekenler
                                                </p>
                                                <ul className="list-disc pl-4 mt-1 space-y-0.5 text-muted-foreground">
                                                    {issues.map((issue) => (
                                                        <li key={issue.id}>
                                                            {issue.message}
                                                            {issue.count > 1 && ` (${issue.count} yerde)`}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        </div>
                                    )}

                                    {/* Editor + preview */}
                                    <div
                                        className={cn(
                                            "flex-1 min-h-0 grid border border-border rounded-xl overflow-hidden bg-card",
                                            effectiveMode === "split" || effectiveMode === "compare"
                                                ? "grid-cols-2"
                                                : "grid-cols-1",
                                        )}
                                    >
                                        {effectiveMode !== "preview" && (
                                            <textarea
                                                value={contentMd}
                                                disabled={!canEditLegal}
                                                aria-label="Markdown metni"
                                                onChange={(e) => {
                                                    setContentMd(e.target.value);
                                                    setDirty(true);
                                                }}
                                                spellCheck={false}
                                                className="w-full h-full bg-background p-4 font-mono text-sm resize-none focus:outline-none disabled:opacity-60 leading-relaxed"
                                                placeholder={"# Başlık\n\nMarkdown yazın..."}
                                            />
                                        )}
                                        {(effectiveMode === "preview" || effectiveMode === "split") && (
                                            <div
                                                className={cn(
                                                    "overflow-y-auto p-6 bg-background prose prose-invert max-w-none prose-sm",
                                                    effectiveMode === "split" && "border-l border-border",
                                                )}
                                            >
                                                <MarkdownPreview md={contentMd} />
                                            </div>
                                        )}
                                        {effectiveMode === "compare" && turkishDoc && (
                                            <div className="min-h-0 flex flex-col border-l border-border bg-background">
                                                <div className="px-4 py-2 border-b border-border text-xs text-muted-foreground shrink-0">
                                                    Türkçe metin (kaydedilmiş taslak
                                                    {legalDocState(turkishDoc) === "published"
                                                        ? `, yayındaki v${turkishDoc.currentVersion}`
                                                        : ", yayınlanmadı"}
                                                    )
                                                </div>
                                                <div className="flex-1 overflow-y-auto p-6 prose prose-invert max-w-none prose-sm">
                                                    <MarkdownPreview md={turkishDoc.contentMd} />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* Version history drawer */}
            {historyOpen && activeDoc && (
                <div className="fixed inset-0 bg-black/60 z-40 flex justify-end" onClick={() => setHistoryOpen(false)}>
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="w-full max-w-2xl bg-card border-l border-border h-full flex flex-col"
                    >
                        <div className="p-4 border-b border-border flex items-center justify-between gap-2">
                            <div className="min-w-0">
                                <h3 className="font-semibold flex items-center gap-2">
                                    <History className="w-4 h-4 shrink-0" />
                                    <span className="truncate">
                                        Sürüm geçmişi: {activeDoc.title} ({LEGAL_LANGUAGE_NAMES[activeDoc.language]})
                                    </span>
                                </h3>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Her dilin sürüm numaraları ayrıdır. Burada yalnızca{" "}
                                    {LEGAL_LANGUAGE_NAMES[activeDoc.language]} sürümler listelenir.
                                </p>
                            </div>
                            <button
                                type="button"
                                aria-label="Kapat"
                                onClick={() => setHistoryOpen(false)}
                                className="text-muted-foreground hover:text-foreground p-1"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="flex-1 flex min-h-0">
                            {/* Versions list */}
                            <div className="w-56 border-r border-border overflow-y-auto shrink-0">
                                {versions === null ? (
                                    <div className="flex items-center justify-center p-6">
                                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                                    </div>
                                ) : versionsFailed ? (
                                    <div className="p-6 text-xs text-red-400 text-center">Sürümler yüklenemedi.</div>
                                ) : versions.length === 0 ? (
                                    <div className="p-6 text-xs text-muted-foreground text-center">
                                        Bu dilde henüz yayınlanmış sürüm yok.
                                    </div>
                                ) : (
                                    versions.map((v) => (
                                        <button
                                            key={v.id}
                                            type="button"
                                            onClick={() => setViewingVersion(v)}
                                            className={cn(
                                                "w-full text-left px-4 py-3 border-b border-border hover:bg-muted/30 transition-colors flex items-center justify-between",
                                                viewingVersion?.id === v.id && "bg-primary/10 text-primary",
                                            )}
                                        >
                                            <div className="min-w-0">
                                                <div className="font-medium text-sm flex items-center gap-2">
                                                    v{v.version}
                                                    {v.version === activeDoc.currentVersion && (
                                                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border bg-green-500/10 text-green-300 border-green-500/30">
                                                            yayında
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-muted-foreground truncate">
                                                    {formatLegalDate(v.publishedAt)}
                                                </div>
                                            </div>
                                            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                        </button>
                                    ))
                                )}
                            </div>
                            {/* Version detail */}
                            <div className="flex-1 overflow-y-auto">
                                {!viewingVersion ? (
                                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-6 text-center">
                                        {versions && versions.length === 0
                                            ? "Yayınladığın her sürüm burada saklanır."
                                            : "Önizlemek için bir sürüm seç."}
                                    </div>
                                ) : (
                                    <div className="p-6">
                                        <div className="text-xs text-muted-foreground mb-4">
                                            <div>
                                                <span className="font-medium text-foreground">{viewingVersion.title}</span>{" "}
                                                v{viewingVersion.version} ({LEGAL_LANGUAGE_NAMES[viewingVersion.language]})
                                            </div>
                                            <div>
                                                {formatLegalDate(viewingVersion.publishedAt)} tarihinde yayınlandı
                                                {viewingVersion.publishedBy && ` (${viewingVersion.publishedBy})`}
                                            </div>
                                        </div>
                                        <div className="prose prose-invert max-w-none prose-sm">
                                            <MarkdownPreview md={viewingVersion.contentMd} />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Create modal: a new document, or a missing language of an existing one. */}
            {createForm && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-card border border-border rounded-xl w-full max-w-xl max-h-full overflow-hidden flex flex-col">
                        <div className="p-4 border-b border-border flex items-center justify-between">
                            <h3 className="font-semibold">
                                {createForm.locked
                                    ? `${LEGAL_LANGUAGE_NAMES[createForm.language]} sürüm oluştur`
                                    : "Yeni yasal belge"}
                            </h3>
                            <button
                                type="button"
                                aria-label="Kapat"
                                onClick={() => setCreateForm(null)}
                                className="text-muted-foreground hover:text-foreground p-1"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4 overflow-y-auto">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                                    Kısa ad (slug) *
                                </label>
                                <input
                                    value={createForm.slug}
                                    readOnly={createForm.locked}
                                    onChange={(e) => setCreateForm({ ...createForm, slug: e.target.value })}
                                    placeholder="tos"
                                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none read-only:opacity-60"
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                    Küçük harf, rakam ve tire. Oluşturduktan sonra değiştirilemez; bütün diller aynı kısa
                                    adı kullanır.
                                </p>
                            </div>
                            <div>
                                <span className="text-xs font-medium text-muted-foreground mb-1 block">Dil *</span>
                                <div
                                    role="group"
                                    aria-label="Belge dili"
                                    className="inline-flex items-center border border-border rounded-md overflow-hidden text-sm"
                                >
                                    {LEGAL_LANGUAGES.map((language, index) => (
                                        <button
                                            key={language}
                                            type="button"
                                            aria-pressed={createForm.language === language}
                                            disabled={createForm.locked && createForm.language !== language}
                                            onClick={() => setCreateForm({ ...createForm, language })}
                                            className={cn(
                                                "px-3 py-1.5 font-medium transition-colors disabled:opacity-40",
                                                index > 0 && "border-l border-border",
                                                createForm.language === language
                                                    ? "bg-muted text-foreground"
                                                    : "text-muted-foreground hover:bg-muted/50",
                                            )}
                                        >
                                            {LEGAL_LANGUAGE_LABELS[language]}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Türkçe ana metindir. Bir dilde yayınlanmış sürüm yoksa uygulama o dildeki
                                    kullanıcılara yayındaki Türkçe metni gösterir.
                                </p>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1 block">Başlık *</label>
                                <input
                                    value={createForm.title}
                                    onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                                    placeholder={TITLE_PLACEHOLDERS[createForm.language]}
                                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                                />
                            </div>
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-xs font-medium text-muted-foreground block">
                                        İlk markdown metni (isteğe bağlı)
                                    </label>
                                    {(() => {
                                        const source =
                                            createForm.language !== FALLBACK_LEGAL_LANGUAGE
                                                ? findLegalDoc(documents, createForm.slug.trim(), FALLBACK_LEGAL_LANGUAGE)
                                                : null;
                                        return source ? (
                                            <button
                                                type="button"
                                                onClick={() => setCreateForm({ ...createForm, contentMd: source.contentMd })}
                                                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                                            >
                                                <Copy className="w-3.5 h-3.5" /> Türkçe metni kopyala
                                            </button>
                                        ) : null;
                                    })()}
                                </div>
                                <textarea
                                    value={createForm.contentMd}
                                    onChange={(e) => setCreateForm({ ...createForm, contentMd: e.target.value })}
                                    rows={8}
                                    placeholder={"# Başlık\n\nMarkdown içeriği..."}
                                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-primary focus:outline-none"
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                    Taslak olarak oluşturulur ve Yayınla&apos;ya basılana kadar uygulamada görünmez.
                                </p>
                            </div>
                        </div>
                        <div className="p-4 border-t border-border flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setCreateForm(null)}
                                className="px-4 py-2 rounded-md text-sm font-medium hover:bg-muted"
                            >
                                Vazgeç
                            </button>
                            <button
                                type="button"
                                onClick={handleCreate}
                                disabled={creating}
                                className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                            >
                                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                Taslak oluştur
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/** "v3" green when published, "taslak" yellow, "yok" muted. With a prefix: "TR v3". */
function StateBadge({ doc, prefix }: { doc: LegalDocument | null; prefix?: string }) {
    const state = legalDocState(doc);
    return (
        <span
            className={cn(
                "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap",
                state === "published" && "bg-green-500/10 text-green-300 border-green-500/30",
                state === "draft" && "bg-yellow-500/10 text-yellow-300 border-yellow-500/30",
                state === "missing" && "border-dashed border-border text-muted-foreground",
            )}
        >
            {prefix ? `${prefix} ${legalStateBadge(doc)}` : legalStateBadge(doc)}
        </span>
    );
}

function NoticeBox({ notice }: { notice: LegalNotice }) {
    const Icon = notice.tone === "ok" ? CheckCircle2 : notice.tone === "warn" ? AlertTriangle : AlertCircle;
    return (
        <div
            role="status"
            className={cn(
                "flex-1 min-w-[16rem] border rounded-md px-3 py-2 text-xs flex items-start gap-2",
                notice.tone === "ok" && "border-green-500/30 bg-green-500/5",
                notice.tone === "warn" && "border-amber-500/30 bg-amber-500/5",
                notice.tone === "error" && "border-red-500/30 bg-red-500/5",
            )}
        >
            <Icon
                className={cn(
                    "w-4 h-4 shrink-0 mt-px",
                    notice.tone === "ok" && "text-green-400",
                    notice.tone === "warn" && "text-amber-400",
                    notice.tone === "error" && "text-red-400",
                )}
            />
            <p className="text-muted-foreground">
                <span
                    className={cn(
                        "font-semibold",
                        notice.tone === "ok" && "text-green-400",
                        notice.tone === "warn" && "text-amber-400",
                        notice.tone === "error" && "text-red-400",
                    )}
                >
                    {notice.title}.
                </span>{" "}
                {notice.body}
            </p>
        </div>
    );
}

function MissingLanguage({
    language,
    fallback,
    canEdit,
    onCreate,
}: {
    language: LegalLanguage;
    fallback: LegalDocument | null;
    canEdit: boolean;
    onCreate: () => void;
}) {
    const name = LEGAL_LANGUAGE_NAMES[language];
    return (
        <div className="flex-1 mt-3 border border-dashed border-border rounded-xl flex items-center justify-center p-6">
            <div className="text-center max-w-md">
                <Languages className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="font-medium">Bu belgenin {name} sürümü henüz oluşturulmadı.</p>
                <p className="text-sm text-muted-foreground mt-1">
                    {fallback
                        ? `Taslak olarak oluşturup ${name} metni yazabilirsin. Yayınlayana kadar uygulama ${LEGAL_LANGUAGE_NAMES[FALLBACK_LEGAL_LANGUAGE]} metni göstermeye devam eder.`
                        : `Taslak olarak oluşturup ${name} metni yazabilirsin.`}
                </p>
                {canEdit && (
                    <button
                        type="button"
                        onClick={onCreate}
                        className="mt-4 bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-md text-sm font-medium inline-flex items-center gap-2"
                    >
                        <Plus className="w-4 h-4" /> {name} taslak oluştur
                    </button>
                )}
            </div>
        </div>
    );
}

function ModeButton({
    current,
    value,
    onSelect,
    title,
    children,
}: {
    current: Mode;
    value: Mode;
    onSelect: (mode: Mode) => void;
    title?: string;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            title={title}
            aria-pressed={current === value}
            onClick={() => onSelect(value)}
            className={cn(
                "px-2.5 py-1.5 flex items-center gap-1 [&:not(:first-child)]:border-l border-border",
                current === value ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50",
            )}
        >
            {children}
        </button>
    );
}

function MarkdownPreview({ md }: { md: string }) {
    if (!md.trim()) {
        return (
            <p className="text-muted-foreground italic text-sm">
                Soldaki alana markdown yazdıkça önizleme burada görünür.
            </p>
        );
    }
    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>;
}
