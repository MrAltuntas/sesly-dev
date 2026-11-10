"use client";

import { Bot, Loader2, RefreshCw } from "lucide-react";
import type { StoriesMeta, StoryLlmTaskRow } from "@/types/api.types";
import { ErrorState } from "@/components/ui/error-state";
import { isTaskActive } from "@/lib/stories";
import { LlmTaskItem } from "./LlmTaskItem";
import { StoryModal } from "./StoryModal";

interface Props {
    meta: StoriesMeta | null;
    tasks: StoryLlmTaskRow[];
    loading: boolean;
    error: string | null;
    onRefresh: () => void;
    onClose: () => void;
    hrefFor: (id: string) => string;
    onOpenStory: (id: string) => void;
}

/** Newest background tasks of every story (single and bulk runs). */
export function LlmTasksDialog({ meta, tasks, loading, error, onRefresh, onClose, hrefFor, onOpenStory }: Props) {
    const active = tasks.filter(isTaskActive).length;

    return (
        <StoryModal
            title="Yapay zeka görevleri"
            subtitle="Çeviriler, dil seviyesi ve yaş grubu değerlendirmeleri. En yeni görevler üstte, tek tek sırayla çalışır."
            icon={<Bot className="w-5 h-5 text-primary" />}
            onClose={onClose}
        >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {active > 0 ? (
                    <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {active} görev sırada ya da çalışıyor. Liste kendiliğinden yenileniyor.
                    </>
                ) : (
                    <span>Şu anda çalışan görev yok.</span>
                )}
                <button
                    type="button"
                    onClick={onRefresh}
                    className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-foreground font-medium hover:bg-muted transition-colors"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Yenile
                </button>
            </div>

            {error ? (
                <ErrorState message={error} onRetry={onRefresh} retryLabel="Tekrar dene" />
            ) : loading ? (
                <div className="flex items-center justify-center p-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
            ) : tasks.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground p-8">Henüz bir görev çalıştırılmadı.</p>
            ) : (
                <ul className="space-y-2">
                    {tasks.map((task) => (
                        <LlmTaskItem
                            key={task.id}
                            task={task}
                            meta={meta}
                            showStory
                            hrefFor={hrefFor}
                            onOpenStory={(id) => {
                                onClose();
                                onOpenStory(id);
                            }}
                        />
                    ))}
                </ul>
            )}
        </StoryModal>
    );
}
