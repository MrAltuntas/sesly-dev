"use client";

import { Loader2 } from "lucide-react";
import { progressLabel, progressPercent } from "@/lib/bulk";

interface Props {
    label: string;
    done: number;
    total: number;
    note?: string;
}

/** Progress of a bulk action sent in batches ("120 / 339 masal işlendi"). */
export function ProgressBar({ label, done, total, note }: Props) {
    return (
        <div className="space-y-3 py-2" aria-live="polite">
            <p className="text-sm font-medium flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                {label}
            </p>
            <div
                className="h-2 rounded-full bg-muted overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={done}
            >
                <div
                    className="h-full bg-primary transition-[width] duration-300"
                    style={{ width: `${progressPercent(done, total)}%` }}
                />
            </div>
            <p className="text-xs text-muted-foreground">
                {progressLabel(done, total)}.{note ? ` ${note}` : ""}
            </p>
        </div>
    );
}
