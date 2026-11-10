import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * Format a raw byte count as a human-readable string.
 * Uses binary (1024-based) units: B / KB / MB / GB / TB.
 * `0 B` for null/zero. Precision is 1 decimal for >=1 KB, 0 for bytes.
 */
export function formatBytes(bytes: number | null | undefined): string {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(
        Math.floor(Math.log(bytes) / Math.log(1024)),
        units.length - 1,
    );
    const value = bytes / Math.pow(1024, i);
    const decimals = i === 0 ? 0 : 1;
    return `${value.toFixed(decimals)} ${units[i]}`;
}
