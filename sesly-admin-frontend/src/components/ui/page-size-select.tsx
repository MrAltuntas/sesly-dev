"use client";

import { PAGE_SIZE_OPTIONS } from "@/lib/bulk";
import { cn } from "@/lib/utils";

interface Props {
    value: number;
    onChange: (size: number) => void;
    disabled?: boolean;
    className?: string;
}

/** "Sayfada 25 / 50 / 100 / 200 masal". */
export function PageSizeSelect({ value, onChange, disabled, className }: Props) {
    return (
        <label className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
            Sayfada
            <select
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                disabled={disabled}
                aria-label="Sayfadaki masal sayısı"
                className="bg-background border border-border rounded-md px-1.5 py-1 text-xs text-foreground focus:ring-2 focus:ring-primary focus:outline-none disabled:opacity-50"
            >
                {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                        {size}
                    </option>
                ))}
            </select>
            masal
        </label>
    );
}
