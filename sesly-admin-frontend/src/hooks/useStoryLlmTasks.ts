"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StoriesService } from "@/services/admin.service";
import type { StoryLlmTaskRow } from "@/types/api.types";
import { getErrorMessage } from "@/components/ui/error-state";
import { isTaskActive } from "@/lib/stories";

const POLL_INTERVAL_MS = 4000;

interface Options {
    /** Tasks of one story. Leave out for the newest tasks of every story. */
    storyId?: string;
    /** False: nothing is fetched (no story open, or the role may not see tasks). */
    enabled: boolean;
    limit?: number;
    /** Called once for every task that leaves PENDING / RUNNING while we watch. */
    onSettled?: (task: StoryLlmTaskRow) => void;
}

interface State {
    /** What the tasks belong to, so a story switch never shows the old list. */
    scope: string;
    tasks: StoryLlmTaskRow[];
    error: string | null;
    loaded: boolean;
}

/**
 * Background LLM tasks (translation, level assessment), newest first.
 * Polls GET /admin/stories/llm-tasks while at least one task is pending or
 * running and stops when everything has settled.
 */
export function useStoryLlmTasks({ storyId, enabled, limit = 20, onSettled }: Options) {
    const scope = `${enabled ? "on" : "off"}:${storyId ?? "*"}`;
    const [state, setState] = useState<State>({ scope, tasks: [], error: null, loaded: false });
    const current = state.scope === scope ? state : { scope, tasks: [], error: null, loaded: false };

    const onSettledRef = useRef(onSettled);
    useEffect(() => {
        onSettledRef.current = onSettled;
    }, [onSettled]);

    // Ids we have seen active, per scope. A task that is already DONE on the
    // first fetch must not fire onSettled.
    const activeIdsRef = useRef<{ scope: string; ids: Set<string> }>({ scope, ids: new Set() });
    const requestRef = useRef(0);

    const refresh = useCallback(async () => {
        if (!enabled) return;
        const request = ++requestRef.current;
        try {
            const res = await StoriesService.getLlmTasks({ page: 1, limit, ...(storyId ? { storyId } : {}) });
            if (request !== requestRef.current) return;
            const tasks = res.data.data ?? [];

            if (activeIdsRef.current.scope !== scope) activeIdsRef.current = { scope, ids: new Set() };
            const seen = activeIdsRef.current.ids;
            const settled: StoryLlmTaskRow[] = [];
            for (const task of tasks) {
                if (isTaskActive(task)) {
                    seen.add(task.id);
                } else if (seen.has(task.id)) {
                    seen.delete(task.id);
                    settled.push(task);
                }
            }

            setState({ scope, tasks, error: null, loaded: true });
            for (const task of settled) onSettledRef.current?.(task);
        } catch (e) {
            if (request !== requestRef.current) return;
            console.error("Failed to load LLM tasks", e);
            setState((prev) => ({
                scope,
                tasks: prev.scope === scope ? prev.tasks : [],
                error: getErrorMessage(e, "Görev listesi alınamadı."),
                loaded: true,
            }));
        }
    }, [enabled, limit, scope, storyId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const hasActive = useMemo(() => current.tasks.some(isTaskActive), [current.tasks]);

    useEffect(() => {
        if (!enabled || !hasActive) return;
        const timer = setInterval(() => {
            // A hidden tab does not need live progress; the next tick catches up.
            if (typeof document !== "undefined" && document.hidden) return;
            refresh();
        }, POLL_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [enabled, hasActive, refresh]);

    return {
        tasks: current.tasks,
        error: current.error,
        loading: enabled && !current.loaded,
        hasActive,
        refresh,
    };
}
