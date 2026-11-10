"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
    message: string;
    onRetry?: () => void;
    retryLabel?: string;
    className?: string;
}

/**
 * Explicit "request failed" block. Use instead of rendering an empty list
 * when a fetch fails, so admins can tell "nothing here" from "could not load".
 */
export function ErrorState({ message, onRetry, retryLabel = "Retry", className }: ErrorStateProps) {
    return (
        <div
            role="alert"
            className={cn(
                "flex flex-col items-center justify-center gap-3 p-8 text-center",
                className,
            )}
        >
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
                <AlertTriangle className="w-5 h-5" />
            </div>
            <p className="text-sm text-muted-foreground max-w-md">{message}</p>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors"
                >
                    <RefreshCw className="w-4 h-4" />
                    {retryLabel}
                </button>
            )}
        </div>
    );
}

/** Pull a readable message out of an axios error, falling back to `fallback`. */
export function getErrorMessage(error: unknown, fallback: string): string {
    const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
    if (typeof message === "string" && message.trim()) return message;
    if (Array.isArray(message) && message.length > 0) return message.join(", ");
    return fallback;
}
