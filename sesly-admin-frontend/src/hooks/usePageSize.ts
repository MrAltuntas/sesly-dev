"use client";

import { useCallback, useSyncExternalStore } from "react";
import { readPageSize, writePageSize } from "@/lib/bulk";

function browserStorage(): Storage | null {
    try {
        return typeof window === "undefined" ? null : window.localStorage;
    } catch {
        return null;
    }
}

// Sizes chosen in this tab. They win over localStorage, so the choice holds
// even where the storage is blocked (it is then only not remembered).
const chosen = new Map<string, number>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
    listeners.add(listener);
    window.addEventListener("storage", listener);
    return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", listener);
    };
}

/**
 * Rows per page of a list, remembered in localStorage under `key`. The
 * server render (and hydration) uses `fallback`; the stored size follows
 * on the client.
 */
export function usePageSize(key: string, fallback: number): [number, (size: number) => void] {
    const size = useSyncExternalStore(
        subscribe,
        () => chosen.get(key) ?? readPageSize(browserStorage(), key, fallback),
        () => fallback,
    );
    const update = useCallback(
        (next: number) => {
            chosen.set(key, next);
            writePageSize(browserStorage(), key, next);
            for (const listener of listeners) listener();
        },
        [key],
    );
    return [size, update];
}
