"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, PenLine, Sparkles } from "lucide-react";
import { StoriesService } from "@/services/admin.service";
import type { StoriesMeta, StoryDetail, StoryLlmTaskRow } from "@/types/api.types";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { getErrorMessage } from "@/components/ui/error-state";
import { formatDateTime, getApiErrorData, isTaskActive, optionLabel } from "@/lib/stories";
import { SelectField } from "./form-fields";

interface Props {
    meta: StoriesMeta | null;
    /** The saved story, null while a new one is being written. */
    story: StoryDetail | null;
    /** Selected value. Empty on a new story means "let the AI decide". */
    value: string;
    onChange: (value: string) => void;
    canEdit: boolean;
    disabled?: boolean;
    /** Text edited but not saved: an assessment would read the old text. */
    textChanged: boolean;
    /** Newest age group assessment of this story, if any. */
    task: StoryLlmTaskRow | null;
    onTaskStarted: () => void;
}

/**
 * Age group with its source (AI or by hand) and a re-assess button. Picking
 * a different value makes it a manual choice on save; the button asks the AI
 * again and needs a confirmation to replace a manual choice.
 */
export function AgeGroupControl({
    meta,
    story,
    value,
    onChange,
    canEdit,
    disabled,
    textChanged,
    task,
    onTaskStarted,
}: Props) {
    const toast = useToast();
    const confirm = useConfirm();
    const [starting, setStarting] = useState(false);
    const [startError, setStartError] = useState<string | null>(null);

    const source = story?.ageGroupSource ?? null;
    const changed = !!story && value !== story.ageGroup;
    const taskActive = !!task && isTaskActive(task);
    const taskFailed = task?.status === "FAILED";

    const startAssessment = async (force: boolean) => {
        if (!story) return;
        setStarting(true);
        setStartError(null);
        try {
            await StoriesService.assessAgeGroup(story.id, force);
            toast.success("Yaş grubu değerlendirmesi sıraya alındı");
            onTaskStarted();
        } catch (e) {
            const data = getApiErrorData(e);
            if (data.code === "AGE_GROUP_IS_MANUAL" && !force) {
                setStarting(false);
                const ok = await confirm({
                    title: "Elle seçilen yaş grubunun üzerine yazılsın mı?",
                    message:
                        "Bu masalın yaş grubu elle seçilmiş. Devam edersen yapay zekanın önerdiği yaş grubu bunun yerine yazılır.",
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
                console.error("Age group assessment failed to start", e);
                setStartError(getErrorMessage(e, "Yaş grubu değerlendirmesi başlatılamadı."));
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
        startAssessment(false);
    };

    let hint: string;
    if (!story) {
        hint =
            value === ""
                ? "Masal kaydedildikten sonra yapay zeka belirler (otomatik belirleme ayarı açıksa). O zamana kadar 3-6 yaş olarak durur."
                : "Kaydedince elle seçilmiş sayılır, yapay zeka dokunmaz.";
    } else if (changed) {
        hint = "Kaydedince elle seçilmiş sayılır.";
    } else {
        hint = "Farklı bir değer seçip kaydedersen elle seçilmiş olur.";
    }

    const SourceIcon = source === "AI" ? Sparkles : PenLine;
    const sourceLabel = source ? optionLabel(meta?.enums.ageGroupSource, source) : "";
    const assessedAt = source ? formatDateTime(story?.ageGroupAssessedAt) : "";

    return (
        <div className="space-y-1.5">
            <SelectField
                id="story-ageGroup"
                label="Yaş Grubu"
                value={value}
                onChange={onChange}
                options={meta?.enums.ageGroup ?? []}
                emptyLabel={story ? undefined : "Yapay zeka belirlesin"}
                disabled={disabled || !canEdit}
                hint={hint}
            />

            {story && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    {source ? (
                        <span
                            className={
                                source === "AI"
                                    ? "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-violet-500/40 bg-violet-500/10 text-violet-300 font-medium"
                                    : "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-sky-500/40 bg-sky-500/10 text-sky-300 font-medium"
                            }
                        >
                            <SourceIcon className="w-3 h-3" aria-hidden />
                            Kaynak: {sourceLabel}
                        </span>
                    ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-dashed border-border text-muted-foreground">
                            Kaynak: kayıtlı değil
                        </span>
                    )}
                    {assessedAt && <span className="text-muted-foreground">{assessedAt}</span>}
                    {canEdit && (
                        <button
                            type="button"
                            onClick={handleAssess}
                            disabled={disabled || starting || taskActive}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border font-medium hover:bg-muted transition-colors disabled:opacity-50"
                        >
                            {starting || taskActive ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <Sparkles className="w-3.5 h-3.5" />
                            )}
                            {taskActive ? "Değerlendiriliyor..." : "AI ile yeniden değerlendir"}
                        </button>
                    )}
                </div>
            )}

            {story?.ageGroupNote && source === "AI" && (
                <p className="text-xs text-muted-foreground">{story.ageGroupNote}</p>
            )}
            {story && canEdit && textChanged && (
                <p className="text-xs text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Kaydedilmemiş metin değişikliği var.
                </p>
            )}
            {taskFailed && !starting && (
                <p role="alert" className="text-xs text-red-400">
                    {task?.error ?? "Yaş grubu değerlendirmesi başarısız oldu."}
                </p>
            )}
            {startError && (
                <p role="alert" className="text-xs text-red-400">
                    {startError}
                </p>
            )}
        </div>
    );
}
