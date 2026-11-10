"use client";

import { MouseEvent } from "react";
import { CheckCircle2, Clock, FileText, Loader2, RotateCcw, XCircle } from "lucide-react";
import type {
    StoriesMeta,
    StoryLlmAgeGroupResult,
    StoryLlmLevelResult,
    StoryLlmTaskRow,
    StoryLlmTaskStatus,
    StoryLlmTranslateResult,
} from "@/types/api.types";
import { formatDateTime, languageName, optionLabel } from "@/lib/stories";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./form-fields";

const STATUS_STYLE: Record<StoryLlmTaskStatus, { className: string; icon: typeof Clock; spin?: boolean }> = {
    PENDING: { className: "border-amber-500/30 bg-amber-500/10 text-amber-400", icon: Clock },
    RUNNING: { className: "border-primary/40 bg-primary/10 text-primary", icon: Loader2, spin: true },
    DONE: { className: "border-green-500/30 bg-green-500/10 text-green-400", icon: CheckCircle2 },
    FAILED: { className: "border-red-500/30 bg-red-500/10 text-red-400", icon: XCircle },
};

export function TaskStatusBadge({ status, meta }: { status: StoryLlmTaskStatus; meta: StoriesMeta | null }) {
    const style = STATUS_STYLE[status] ?? STATUS_STYLE.PENDING;
    const Icon = style.icon;
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium whitespace-nowrap",
                style.className,
            )}
        >
            <Icon className={cn("w-3 h-3", style.spin && "animate-spin")} aria-hidden />
            {optionLabel(meta?.enums.llmTaskStatus, status)}
        </span>
    );
}

function isLevelResult(result: StoryLlmTaskRow["result"]): result is StoryLlmLevelResult {
    return !!result && "level" in result;
}

function isAgeGroupResult(result: StoryLlmTaskRow["result"]): result is StoryLlmAgeGroupResult {
    return !!result && "ageGroup" in result;
}

function isTranslateResult(result: StoryLlmTaskRow["result"]): result is StoryLlmTranslateResult {
    return !!result && "translatedParagraphs" in result;
}

interface Props {
    task: StoryLlmTaskRow;
    meta: StoriesMeta | null;
    /** Show which story the task belongs to (the all-stories view). */
    showStory?: boolean;
    hrefFor: (id: string) => string;
    onOpenStory: (id: string) => void;
    /** Shown on a FAILED task when given. */
    onRetry?: (task: StoryLlmTaskRow) => void;
    retrying?: boolean;
}

export function LlmTaskItem({ task, meta, showStory, hrefFor, onOpenStory, onRetry, retrying }: Props) {
    const open = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpenStory(id);
    };

    const typeLabel = optionLabel(meta?.enums.llmTaskType, task.type);
    const heading =
        task.type === "TRANSLATE" && task.targetLanguage
            ? `${typeLabel}: ${languageName(meta, task.targetLanguage)}`
            : typeLabel;

    return (
        <li className="border border-border rounded-md bg-background/40 p-3 space-y-1.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
                <TaskStatusBadge status={task.status} meta={meta} />
                <span className="font-medium text-foreground">{heading}</span>
                <span className="text-muted-foreground ml-auto">{formatDateTime(task.createdAt)}</span>
            </div>

            {showStory && (
                <div className="text-muted-foreground">
                    Masal:{" "}
                    <a
                        href={hrefFor(task.story.id)}
                        onClick={(e) => open(e, task.story.id)}
                        className="text-primary hover:underline"
                    >
                        {task.story.title}
                    </a>{" "}
                    ({task.story.language})
                </div>
            )}

            {task.status === "PENDING" && (
                <p className={task.error ? "text-amber-400" : "text-muted-foreground"}>
                    {task.error ?? "Sırada bekliyor."}
                </p>
            )}

            {task.status === "RUNNING" && (
                <p className="text-muted-foreground">
                    Çalışıyor{task.attempts > 1 ? ` (deneme ${task.attempts})` : ""}. Uzun masallarda birkaç dakika
                    sürebilir.
                </p>
            )}

            {task.status === "FAILED" && (
                <div className="space-y-2">
                    <p role="alert" className="text-red-400">
                        {task.error ?? "Görev başarısız oldu."}
                    </p>
                    {onRetry && (
                        <button
                            type="button"
                            onClick={() => onRetry(task)}
                            disabled={retrying}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border font-medium hover:bg-muted transition-colors disabled:opacity-50"
                        >
                            {retrying ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <RotateCcw className="w-3.5 h-3.5" />
                            )}
                            Yeniden dene
                        </button>
                    )}
                </div>
            )}

            {task.status === "DONE" && task.type === "TRANSLATE" && (
                <div className="space-y-1">
                    {task.resultStory ? (
                        <p className="flex flex-wrap items-center gap-1.5">
                            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                            <a
                                href={hrefFor(task.resultStory.id)}
                                onClick={(e) => open(e, task.resultStory!.id)}
                                className="text-primary font-medium hover:underline"
                            >
                                {task.resultStory.title}
                            </a>
                            <StatusBadge
                                status={task.resultStory.status}
                                label={optionLabel(meta?.enums.status, task.resultStory.status)}
                            />
                        </p>
                    ) : (
                        <p className="text-muted-foreground">Oluşan masal sonradan silinmiş.</p>
                    )}
                    {isTranslateResult(task.result) && (
                        <p className="text-muted-foreground">
                            {task.result.translatedParagraphs} / {task.result.sourceParagraphs} paragraf, uzunluk
                            oranı {task.result.lengthRatio.toFixed(2)}
                            {task.result.replaced ? ". Önceki taslağın üzerine yazıldı." : "."}
                        </p>
                    )}
                    {task.resultStory?.status === "DRAFT" && (
                        <p className="text-amber-400">
                            Makine çevirisi taslak olarak duruyor. Yayınlamadan önce bir kişinin baştan sona okuması
                            gerekir.
                        </p>
                    )}
                </div>
            )}

            {task.status === "DONE" && task.type === "ASSESS_LEVEL" && isLevelResult(task.result) && (
                <p className="text-muted-foreground">
                    <span className="text-foreground font-medium">Seviye {task.result.level}</span>, güven %
                    {Math.round(task.result.confidence * 100)}. {task.result.note}
                </p>
            )}

            {task.status === "DONE" && task.type === "ASSESS_AGE_GROUP" && isAgeGroupResult(task.result) && (
                <p className="text-muted-foreground">
                    <span className="text-foreground font-medium">
                        {optionLabel(meta?.enums.ageGroup, task.result.ageGroup)}
                    </span>
                    , güven %{Math.round(task.result.confidence * 100)}. {task.result.note}
                </p>
            )}

            {(task.model || task.finishedAt) && (
                <p className="text-[10px] text-muted-foreground">
                    {[task.model ? `Model: ${task.model}` : "", task.finishedAt ? `Bitiş: ${formatDateTime(task.finishedAt)}` : ""]
                        .filter(Boolean)
                        .join(", ")}
                </p>
            )}
        </li>
    );
}
