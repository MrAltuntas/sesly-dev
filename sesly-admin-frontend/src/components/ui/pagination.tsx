"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
    page: number;
    totalPages: number;
    total: number;
    onPageChange: (page: number) => void;
    disabled?: boolean;
    /** Noun for the total, e.g. "users". */
    itemLabel?: string;
    prevLabel?: string;
    nextLabel?: string;
    className?: string;
}

/** Prev / next pager for the backend's PaginatedResult envelope. */
export function Pagination({
    page,
    totalPages,
    total,
    onPageChange,
    disabled = false,
    itemLabel = "items",
    prevLabel = "Previous",
    nextLabel = "Next",
    className,
}: PaginationProps) {
    const safeTotalPages = Math.max(totalPages, 1);
    const canPrev = page > 1 && !disabled;
    const canNext = page < safeTotalPages && !disabled;

    return (
        <div
            className={cn(
                "flex items-center justify-between gap-4 px-4 py-3 text-sm text-muted-foreground",
                className,
            )}
        >
            <span>
                {total} {itemLabel} - page {Math.min(page, safeTotalPages)} of {safeTotalPages}
            </span>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => onPageChange(page - 1)}
                    disabled={!canPrev}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <ChevronLeft className="w-4 h-4" />
                    {prevLabel}
                </button>
                <button
                    type="button"
                    onClick={() => onPageChange(page + 1)}
                    disabled={!canNext}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {nextLabel}
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
