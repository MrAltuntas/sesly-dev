"use client";

import { useState } from "react";
import { AlertTriangle, CircleDashed, GraduationCap, Loader2, PenLine, Sparkles } from "lucide-react";
import { StoriesService } from "@/services/admin.service";
import type { StoriesMeta, StoryDetail, StoryLlmTaskRow } from "@/types/api.types";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { getErrorMessage } from "@/components/ui/error-state";
import { CatalogueKey, formatDateTime, getApiErrorData, isTaskActive, optionLabel } from "@/lib/stories";
import { cn } from "@/lib/utils";
import { SelectField, TextAreaField } from "./form-fields";
import { LlmTaskItem } from "./LlmTaskItem";

interface Props {
    meta: StoriesMeta | null;
    /** The saved story, null while a new one is being written. */
    story: StoryDetail | null;
    level: string;
    note: string;
    onChange: (key: CatalogueKey, value: string) => void;
    errors: Partial<Record<string, string>>;
    canEdit: boolean;
    disabled?: boolean;
    /** Text or language edited but not saved: an assessment would read the old text. */
    textChanged: boolean;
    /** Newest level assessment of this story, if any. */
    task: StoryLlmTaskRow | null;
    onTaskStarted: () => void;
    hrefFor: (id: string) => string;
    onOpenStory: (id: string) => void;
}

/**
 * Language level with its three states: not set, set by the AI (with its
 * note and date) and set by hand. Picking a different value in the select
 * makes it a manual level on save; the button asks the AI again.
 */
export function LanguageLevelControl({
    meta,
    story,
    level,
    note,
    onChange,
    errors,
    canEdit,
    disabled,
    textChanged,
    task,
    onTaskStarted,
    hrefFor,
    onOpenStory,
}: Props) {
    const toast = useToast();
    const confirm = useConfirm();
    const [starting, setStarting] = useState(false);
    const [startError, setStartError] = useState<string | null>(null);

    const savedLevel = story?.languageLevel ?? "";
    const savedSource = story?.languageLevelSource ?? null;
    const levelChanged = !!story && level !== savedLevel;
    const taskActive = !!task && isTaskActive(task);

    const startAssessment = async (force: boolean) => {
        if (!story) return;
        setStarting(true);
        setStartError(null);
        try {
            await StoriesService.assessLevel(story.id, force);
            toast.success("Seviye değerlendirmesi sıraya alındı");
            onTaskStarted();
        } catch (e) {
            const data = getApiErrorData(e);
            if (data.code === "LEVEL_IS_MANUAL" && !force) {
                setStarting(false);
                const ok = await confirm({
                    title: "Elle belirlenmiş seviyenin üzerine yazılsın mı?",
                    message:
                        "Bu masalın dil seviyesi elle belirlenmiş. Devam edersen yapay zekanın bulduğu seviye bunun yerine yazılır.",
                    confirmLabel: "Üzerine yaz",
                    cancelLabel: "Vazgeç",
                });
                if (ok) await startAssessment(true);
                return;
            }
            if (data.code === "STORY_LLM_TASK_ACTIVE") {
                toast.info(data.message ?? "Bu masal için bir değerlendirme zaten çalışıyor.");
                onTaskStarted();
            } else {
                console.error("Level assessment failed to start", e);
                setStartError(getErrorMessage(e, "Seviye değerlendirmesi başlatılamadı."));
            }
        } finally {
            setStarting(false);
        }
    };

    const handleAssess = () => {
        if (textChanged) {
            toast.error("Önce değişiklikleri kaydet. Değerlendirme kayıtlı metin üzerinde çalışır.");
            return;
        }
        // The stored force flag decides: a manual level needs an explicit yes.
        startAssessment(false);
    };

    let stateIcon = CircleDashed;
    let stateClass = "border-border text-muted-foreground";
    let stateTitle = "Belirlenmedi";
    let stateText = "Bu masalın dil seviyesi henüz yok.";
    if (story && savedLevel) {
        if (savedSource === "AI") {
            stateIcon = Sparkles;
            stateClass = "border-violet-500/40 bg-violet-500/10 text-violet-300";
            stateTitle = `${savedLevel} - yapay zeka belirledi`;
            stateText = story.languageLevelNote ?? "Yapay zeka bir not bırakmadı.";
        } else {
            stateIcon = PenLine;
            stateClass = "border-sky-500/40 bg-sky-500/10 text-sky-300";
            stateTitle = `${savedLevel} - elle belirlendi`;
            stateText =
                story.languageLevelNote ??
                "Elle belirlenen seviyeye yapay zeka dokunmaz. Yeniden değerlendirme ancak onayınla üzerine yazar.";
        }
    } else if (!story) {
        stateText =
            "Seviye seçmezsen masal kaydedildikten sonra yapay zeka belirler (otomatik belirleme ayarı açıksa).";
    }
    const StateIcon = stateIcon;
    const assessedAt = story?.languageLevel ? formatDateTime(story.languageLevelAssessedAt) : "";

    return (
        <section className="border border-border rounded-lg bg-muted/10 p-4 space-y-4">
            <div className="flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Dil seviyesi</h3>
            </div>

            <div className={cn("border rounded-md p-3 text-xs space-y-1", stateClass)}>
                <div className="flex flex-wrap items-center gap-2 font-semibold">
                    <StateIcon className="w-3.5 h-3.5" aria-hidden />
                    {stateTitle}
                    {assessedAt && <span className="font-normal text-muted-foreground ml-auto">{assessedAt}</span>}
                </div>
                <p className="text-muted-foreground whitespace-pre-line">{stateText}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <SelectField
                    id="story-languageLevel"
                    label="Seviye"
                    value={level}
                    onChange={(value) => onChange("languageLevel", value)}
                    options={meta?.enums.languageLevel ?? []}
                    emptyLabel="Belirlenmedi"
                    error={errors.languageLevel}
                    disabled={disabled || !canEdit}
                    hint={
                        levelChanged
                            ? level === ""
                                ? "Kaydedince seviye, kaynağı ve tarihi silinir."
                                : "Kaydedince elle belirlenmiş sayılır."
                            : story
                              ? "Farklı bir değer seçip kaydedersen elle belirlenmiş olur."
                              : undefined
                    }
                />
                <TextAreaField
                    id="story-languageLevelNote"
                    label="Seviye notu"
                    value={note}
                    onChange={(value) => onChange("languageLevelNote", value)}
                    error={errors.languageLevelNote}
                    disabled={disabled || !canEdit}
                    maxLength={2000}
                    rows={2}
                    className="md:col-span-2"
                    hint={`Seviye kaynağı: ${
                        story && savedLevel
                            ? optionLabel(meta?.enums.languageLevelSource, savedSource) || "bilinmiyor"
                            : "yok"
                    }.`}
                />
            </div>

            {story && canEdit && (
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={handleAssess}
                            disabled={disabled || starting || taskActive}
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
                        >
                            {starting || taskActive ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <Sparkles className="w-3.5 h-3.5" />
                            )}
                            {taskActive ? "Değerlendiriliyor..." : "AI ile yeniden değerlendir"}
                        </button>
                        {textChanged && (
                            <span className="text-xs text-amber-400 flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                Kaydedilmemiş metin ya da dil değişikliği var.
                            </span>
                        )}
                    </div>
                    {startError && (
                        <p role="alert" className="text-xs text-red-400">
                            {startError}
                        </p>
                    )}
                </div>
            )}

            {task && (
                <ul className="space-y-2">
                    <LlmTaskItem
                        task={task}
                        meta={meta}
                        hrefFor={hrefFor}
                        onOpenStory={onOpenStory}
                        onRetry={canEdit ? () => startAssessment(task.force) : undefined}
                        retrying={starting}
                    />
                </ul>
            )}
        </section>
    );
}
