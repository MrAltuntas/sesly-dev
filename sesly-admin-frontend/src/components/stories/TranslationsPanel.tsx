"use client";

import { FormEvent, MouseEvent, useState } from "react";
import {
    AlertTriangle,
    Languages,
    Link2,
    Loader2,
    RefreshCw,
    Search,
    Sparkles,
    Unlink,
} from "lucide-react";
import { StoriesService } from "@/services/admin.service";
import type { AdminStoryListItem, StoriesMeta, StoryDetail, StoryLlmTaskRow } from "@/types/api.types";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { getErrorMessage } from "@/components/ui/error-state";
import { getApiErrorData, isTaskActive, languageName, optionLabel } from "@/lib/stories";
import { LanguageBadge, StatusBadge, inputClass } from "./form-fields";
import { LlmTaskItem } from "./LlmTaskItem";

const VISIBLE_TASKS = 5;

interface Props {
    meta: StoriesMeta | null;
    story: StoryDetail;
    canEdit: boolean;
    /** Title, text or language edited but not saved: a translation would read the saved text. */
    textChanged: boolean;
    /** Translation tasks of this story, newest first. */
    tasks: StoryLlmTaskRow[];
    tasksLoading: boolean;
    tasksError: string | null;
    onRefreshTasks: () => void;
    /** A link or unlink changed the group; the page re-syncs the story and the list. */
    onStoryUpdated: (story: StoryDetail) => void;
    hrefFor: (id: string) => string;
    onOpenStory: (id: string) => void;
}

interface ExistsError {
    message: string;
    storyId?: string;
}

export function TranslationsPanel({
    meta,
    story,
    canEdit,
    textChanged,
    tasks,
    tasksLoading,
    tasksError,
    onRefreshTasks,
    onStoryUpdated,
    hrefFor,
    onOpenStory,
}: Props) {
    const toast = useToast();
    const confirm = useConfirm();

    // ----- Translate -----
    const [translateOpen, setTranslateOpen] = useState(false);
    const [targetLanguage, setTargetLanguage] = useState("");
    const [translating, setTranslating] = useState(false);
    const [translateError, setTranslateError] = useState<ExistsError | null>(null);
    const [retryingTaskId, setRetryingTaskId] = useState<string | null>(null);

    // ----- Manual link -----
    const [linkOpen, setLinkOpen] = useState(false);
    const [linkQuery, setLinkQuery] = useState("");
    const [linkResults, setLinkResults] = useState<AdminStoryListItem[] | null>(null);
    const [linkSearching, setLinkSearching] = useState(false);
    const [linkError, setLinkError] = useState<string | null>(null);
    const [linkingId, setLinkingId] = useState<string | null>(null);
    const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

    const siblings = story.translations ?? [];
    const groupLanguages = new Set([story.language, ...siblings.map((sibling) => sibling.language)]);
    const languages = meta?.languages.all ?? [];
    const targetOptions = languages.filter((language) => language.code !== story.language);
    const provenance = story.translatedFromId
        ? siblings.find((sibling) => sibling.id === story.translatedFromId) ?? null
        : null;

    const open = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpenStory(id);
    };

    /** Returns true when a task was queued. */
    const startTranslation = async (language: string, replaceDraft: boolean): Promise<boolean> => {
        setTranslateError(null);
        try {
            await StoriesService.translate(story.id, language, replaceDraft);
            toast.success(`${languageName(meta, language)} çevirisi sıraya alındı`);
            onRefreshTasks();
            return true;
        } catch (e) {
            const data = getApiErrorData(e);
            if (data.code === "TRANSLATION_EXISTS" && data.replaceable && !replaceDraft) {
                const ok = await confirm({
                    title: "Taslak çeviri yeniden üretilsin mi?",
                    message: `${data.message ?? "Bu dilde bir taslak makine çevirisi zaten var."}\n\nDevam edersen o taslağın başlığı ve metni yeni çeviriyle değiştirilir. Taslakta elle yapılmış düzeltmeler kaybolur.`,
                    confirmLabel: "Taslağı değiştir",
                    cancelLabel: "Vazgeç",
                    variant: "destructive",
                });
                if (ok) return startTranslation(language, true);
                return false;
            }
            if (data.code === "STORY_LLM_TASK_ACTIVE") {
                toast.info(data.message ?? "Bu dile bir çeviri görevi zaten çalışıyor.");
                onRefreshTasks();
                return true;
            }
            console.error("Translation failed to start", e);
            setTranslateError({
                message: getErrorMessage(e, "Çeviri başlatılamadı."),
                storyId: data.code === "TRANSLATION_EXISTS" ? data.storyId : undefined,
            });
            return false;
        }
    };

    const handleTranslate = async (e: FormEvent) => {
        e.preventDefault();
        if (!targetLanguage) {
            setTranslateError({ message: "Hedef dili seç." });
            return;
        }
        if (textChanged) {
            toast.error("Önce değişiklikleri kaydet. Çeviri kayıtlı metin üzerinde çalışır.");
            return;
        }
        setTranslating(true);
        const queued = await startTranslation(targetLanguage, false);
        setTranslating(false);
        if (queued) {
            setTranslateOpen(false);
            setTargetLanguage("");
        }
    };

    const handleRetry = async (task: StoryLlmTaskRow) => {
        if (!task.targetLanguage) return;
        setRetryingTaskId(task.id);
        await startTranslation(task.targetLanguage, task.force);
        setRetryingTaskId(null);
    };

    const searchLinkCandidates = async (e: FormEvent) => {
        e.preventDefault();
        setLinkSearching(true);
        setLinkError(null);
        try {
            const res = await StoriesService.getAll({ page: 1, limit: 10, q: linkQuery.trim() || undefined });
            setLinkResults(res.data.data.filter((row) => row.id !== story.id));
        } catch (err) {
            console.error("Link search failed", err);
            setLinkResults(null);
            setLinkError(getErrorMessage(err, "Masallar aranamadı."));
        } finally {
            setLinkSearching(false);
        }
    };

    const handleLink = async (other: AdminStoryListItem) => {
        setLinkingId(other.id);
        setLinkError(null);
        try {
            const res = await StoriesService.linkTranslation(story.id, other.id);
            toast.success(`"${other.title}" çeviri olarak bağlandı`);
            onStoryUpdated(res.data);
            setLinkOpen(false);
            setLinkQuery("");
            setLinkResults(null);
        } catch (err) {
            console.error("Link failed", err);
            setLinkError(getErrorMessage(err, "Masallar bağlanamadı."));
        } finally {
            setLinkingId(null);
        }
    };

    /** Takes `targetId` (this story or a sibling) out of the group. */
    const handleUnlink = async (targetId: string, title: string) => {
        const isSelf = targetId === story.id;
        const ok = await confirm({
            title: "Çeviri bağı kaldırılsın mı?",
            message: isSelf
                ? "Bu masal çeviri grubundan çıkarılır. Masalların kendisi silinmez. Grupta tek masal kalırsa grup da dağılır."
                : `"${title}" çeviri grubundan çıkarılır. Masalın kendisi silinmez. Grupta tek masal kalırsa grup da dağılır.`,
            confirmLabel: "Bağı kaldır",
            cancelLabel: "Vazgeç",
            variant: "destructive",
        });
        if (!ok) return;
        setUnlinkingId(targetId);
        try {
            const res = await StoriesService.unlinkTranslation(targetId);
            // Unlinking a sibling answers with the sibling, so read this story again.
            const fresh = isSelf ? res.data : (await StoriesService.getById(story.id)).data;
            toast.success("Çeviri bağı kaldırıldı");
            onStoryUpdated(fresh);
        } catch (err) {
            console.error("Unlink failed", err);
            toast.error(getErrorMessage(err, "Çeviri bağı kaldırılamadı."));
        } finally {
            setUnlinkingId(null);
        }
    };

    const visibleTasks = tasks.slice(0, VISIBLE_TASKS);
    // Retry only makes sense on the newest task of a language.
    const newestByLanguage = new Map<string, string>();
    for (const task of tasks) {
        const key = task.targetLanguage ?? "";
        if (!newestByLanguage.has(key)) newestByLanguage.set(key, task.id);
    }

    return (
        <section className="border border-border rounded-lg bg-muted/10 p-4 space-y-4">
            <div className="flex items-center gap-2">
                <Languages className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Çeviriler</h3>
                <span className="text-xs text-muted-foreground">
                    Bu masal: {languageName(meta, story.language)}
                </span>
            </div>

            {/* Siblings */}
            {siblings.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                    Bu masalın başka dilde bir karşılığı yok. Yapay zekayla çevirebilir ya da var olan bir masalı
                    bağlayabilirsin.
                </p>
            ) : (
                <ul className="space-y-1.5">
                    {siblings.map((sibling) => (
                        <li
                            key={sibling.id}
                            className="flex flex-wrap items-center gap-2 border border-border rounded-md bg-background/40 px-3 py-2 text-xs"
                        >
                            <LanguageBadge code={sibling.language} title={languageName(meta, sibling.language)} />
                            <a
                                href={hrefFor(sibling.id)}
                                onClick={(e) => open(e, sibling.id)}
                                className="font-medium text-primary hover:underline min-w-0 truncate"
                            >
                                {sibling.title}
                            </a>
                            <StatusBadge status={sibling.status} label={optionLabel(meta?.enums.status, sibling.status)} />
                            {canEdit && (
                                <button
                                    type="button"
                                    onClick={() => handleUnlink(sibling.id, sibling.title)}
                                    disabled={unlinkingId !== null}
                                    title="Bu masalı gruptan çıkar"
                                    className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-50"
                                >
                                    {unlinkingId === sibling.id ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                        <Unlink className="w-3.5 h-3.5" />
                                    )}
                                    Gruptan çıkar
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {story.translatedFromId && (
                <p className="text-xs text-muted-foreground">
                    Kaynak metin:{" "}
                    {provenance ? (
                        <a
                            href={hrefFor(provenance.id)}
                            onClick={(e) => open(e, provenance.id)}
                            className="text-primary hover:underline"
                        >
                            {provenance.title} ({provenance.language})
                        </a>
                    ) : (
                        <a
                            href={hrefFor(story.translatedFromId)}
                            onClick={(e) => open(e, story.translatedFromId!)}
                            className="text-primary hover:underline"
                        >
                            çevirinin yapıldığı masalı aç
                        </a>
                    )}
                    {story.translationMethod
                        ? `, ${optionLabel(meta?.enums.translationMethod, story.translationMethod)}`
                        : ""}
                    . Bu kayıt gruptan çıkarılsa da korunur.
                </p>
            )}

            {/* Machine translation is always a draft: say so before anyone starts one. */}
            <div className="border border-amber-500/30 bg-amber-500/5 rounded-md p-3 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-px" />
                <p className="text-muted-foreground">
                    <span className="font-semibold text-amber-400">Makine çevirisi her zaman taslak olarak kaydedilir.</span>{" "}
                    Uygulamada görünmez. Bir kişi metni baştan sona okuyup düzelttikten sonra durumunu Yayında
                    yapmalıdır.
                </p>
            </div>

            {canEdit && (
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => {
                            setTranslateOpen((value) => !value);
                            setTranslateError(null);
                        }}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-white text-xs font-medium transition-colors"
                    >
                        <Sparkles className="w-3.5 h-3.5" />
                        Çevir
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setLinkOpen((value) => !value);
                            setLinkError(null);
                        }}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-muted transition-colors"
                    >
                        <Link2 className="w-3.5 h-3.5" />
                        Var olan masalı bağla
                    </button>
                    {story.translationGroupId && (
                        <button
                            type="button"
                            onClick={() => handleUnlink(story.id, story.title)}
                            disabled={unlinkingId !== null}
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
                        >
                            {unlinkingId === story.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <Unlink className="w-3.5 h-3.5" />
                            )}
                            Bu masalı gruptan çıkar
                        </button>
                    )}
                </div>
            )}

            {/* Translate form */}
            {canEdit && translateOpen && (
                <form
                    onSubmit={handleTranslate}
                    className="border border-border rounded-md bg-background/40 p-3 space-y-2"
                >
                    <label htmlFor="translate-target" className="text-xs font-medium text-muted-foreground block">
                        Hedef dil
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            id="translate-target"
                            value={targetLanguage}
                            onChange={(e) => {
                                setTargetLanguage(e.target.value);
                                setTranslateError(null);
                            }}
                            disabled={translating}
                            className={`${inputClass} max-w-xs`}
                        >
                            <option value="">Dil seç</option>
                            {targetOptions.map((language) => (
                                <option key={language.code} value={language.code}>
                                    {language.nativeName} ({language.code})
                                    {groupLanguages.has(language.code) ? ", çevirisi var" : ""}
                                    {language.enabled ? "" : ", uygulamada kapalı"}
                                </option>
                            ))}
                        </select>
                        <button
                            type="submit"
                            disabled={translating || !targetLanguage}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary hover:bg-primary/90 text-white text-xs font-medium transition-colors disabled:opacity-50"
                        >
                            {translating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            {translating ? "Başlatılıyor..." : "Çeviriyi başlat"}
                        </button>
                    </div>
                    {textChanged && (
                        <p className="text-xs text-amber-400">
                            Kaydedilmemiş değişiklikler var. Çeviri kayıtlı metin üzerinde çalışır, önce kaydet.
                        </p>
                    )}
                    {targetLanguage && groupLanguages.has(targetLanguage) && !translateError && (
                        <p className="text-xs text-muted-foreground">
                            Bu dilde bir çeviri zaten var. Yalnızca taslak bir makine çevirisi yeniden üretilebilir.
                        </p>
                    )}
                    {translateError && (
                        <p role="alert" className="text-xs text-red-400">
                            {translateError.message}{" "}
                            {translateError.storyId && (
                                <a
                                    href={hrefFor(translateError.storyId)}
                                    onClick={(e) => open(e, translateError.storyId!)}
                                    className="text-primary hover:underline"
                                >
                                    Masalı aç
                                </a>
                            )}
                        </p>
                    )}
                </form>
            )}

            {/* Manual link */}
            {canEdit && linkOpen && (
                <div className="border border-border rounded-md bg-background/40 p-3 space-y-2">
                    <p className="text-xs text-muted-foreground">
                        Aynı masalı başka dilde anlatan, zaten kayıtlı bir masalı ara ve bağla. Bir grupta her dilden
                        yalnızca bir masal olabilir.
                    </p>
                    <form onSubmit={searchLinkCandidates} className="flex flex-wrap items-center gap-2">
                        <input
                            type="search"
                            value={linkQuery}
                            onChange={(e) => setLinkQuery(e.target.value)}
                            maxLength={200}
                            placeholder="Başlık ya da metin"
                            aria-label="Bağlanacak masalı ara"
                            className={`${inputClass} max-w-xs`}
                        />
                        <button
                            type="submit"
                            disabled={linkSearching}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
                        >
                            {linkSearching ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <Search className="w-3.5 h-3.5" />
                            )}
                            Ara
                        </button>
                    </form>
                    {linkError && (
                        <p role="alert" className="text-xs text-red-400">
                            {linkError}
                        </p>
                    )}
                    {linkResults && linkResults.length === 0 && (
                        <p className="text-xs text-muted-foreground">Eşleşen masal bulunamadı.</p>
                    )}
                    {linkResults && linkResults.length > 0 && (
                        <ul className="space-y-1.5">
                            {linkResults.map((row) => {
                                const sameLanguage = row.language === story.language;
                                const alreadyLinked = siblings.some((sibling) => sibling.id === row.id);
                                return (
                                    <li
                                        key={row.id}
                                        className="flex flex-wrap items-center gap-2 border border-border rounded-md px-3 py-2 text-xs"
                                    >
                                        <LanguageBadge code={row.language} title={languageName(meta, row.language)} />
                                        <span className="font-medium min-w-0 truncate">{row.title}</span>
                                        <StatusBadge status={row.status} label={optionLabel(meta?.enums.status, row.status)} />
                                        <span className="ml-auto">
                                            {alreadyLinked ? (
                                                <span className="text-muted-foreground">Zaten bağlı</span>
                                            ) : sameLanguage ? (
                                                <span className="text-muted-foreground">Aynı dilde, bağlanamaz</span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => handleLink(row)}
                                                    disabled={linkingId !== null}
                                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border font-medium hover:bg-muted transition-colors disabled:opacity-50"
                                                >
                                                    {linkingId === row.id ? (
                                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    ) : (
                                                        <Link2 className="w-3.5 h-3.5" />
                                                    )}
                                                    Bağla
                                                </button>
                                            )}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}

            {/* Tasks */}
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    <h4 className="text-xs font-semibold">Çeviri görevleri</h4>
                    {tasks.some(isTaskActive) && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Durum kendiliğinden yenileniyor
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={onRefreshTasks}
                        title="Görevleri yenile"
                        aria-label="Görevleri yenile"
                        className="ml-auto p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                </div>
                {tasksError ? (
                    <div role="alert" className="text-xs text-red-400 flex flex-wrap items-center gap-2">
                        {tasksError}
                        <button
                            type="button"
                            onClick={onRefreshTasks}
                            className="px-2 py-0.5 rounded-md border border-border text-foreground hover:bg-muted transition-colors"
                        >
                            Tekrar dene
                        </button>
                    </div>
                ) : tasksLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Görevler yükleniyor...
                    </div>
                ) : visibleTasks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Bu masal için henüz çeviri görevi yok.</p>
                ) : (
                    <ul className="space-y-2">
                        {visibleTasks.map((task) => (
                            <LlmTaskItem
                                key={task.id}
                                task={task}
                                meta={meta}
                                hrefFor={hrefFor}
                                onOpenStory={onOpenStory}
                                onRetry={
                                    canEdit && newestByLanguage.get(task.targetLanguage ?? "") === task.id
                                        ? handleRetry
                                        : undefined
                                }
                                retrying={retryingTaskId === task.id}
                            />
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}
