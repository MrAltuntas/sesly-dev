"use client";

import { useEffect, useState, useCallback } from "react";
import {
    HardDrive,
    RefreshCcw,
    Loader2,
    Trash2,
    FileAudio,
    Image as ImageIcon,
    Mic,
    File,
    ChevronLeft,
    ChevronRight,
    AlertTriangle,
} from "lucide-react";
import { StorageService } from "@/services/admin.service";
import {
    StorageStats,
    StorageClassification,
    OrphanedFile,
    StorageTypeBucket,
} from "@/types/api.types";
import { cn, formatBytes } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { usePermissions } from "@/hooks/usePermissions";

const classificationLabels: Record<StorageClassification, string> = {
    audio: "Audio",
    image: "Image",
    voiceSample: "Voice Sample",
    other: "Other",
};

const classificationChipClass: Record<StorageClassification, string> = {
    audio: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    image: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    voiceSample: "bg-green-500/15 text-green-300 border-green-500/30",
    other: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

const PAGE_LIMIT = 20;

interface TypeCardProps {
    label: string;
    bucket: StorageTypeBucket | undefined;
    icon: React.ComponentType<{ className?: string }>;
    accent: string;
}

function TypeCard({ label, bucket, icon: Icon, accent }: TypeCardProps) {
    return (
        <div className="p-6 rounded-xl border border-border bg-card text-card-foreground shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Icon className={cn("w-4 h-4", accent)} />
                {label}
            </div>
            <div className="text-2xl font-bold mt-2">
                {bucket?.count?.toLocaleString() ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
                {formatBytes(bucket?.sizeBytes ?? 0)}
            </div>
        </div>
    );
}

export default function StoragePage() {
    const toast = useToast();
    const confirm = useConfirm();
    const { canViewStorage, canDeleteStorage } = usePermissions();

    const [stats, setStats] = useState<StorageStats | null>(null);
    const [statsLoading, setStatsLoading] = useState(true);

    const [orphans, setOrphans] = useState<OrphanedFile[]>([]);
    const [orphansLoading, setOrphansLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);

    const [deletingKey, setDeletingKey] = useState<string | null>(null);

    const loadStats = useCallback(async () => {
        setStatsLoading(true);
        try {
            const res = await StorageService.getStats();
            setStats(res.data);
        } catch (e) {
            console.error("Failed to load storage stats", e);
            toast.error("Failed to load storage stats");
        } finally {
            setStatsLoading(false);
        }
    }, [toast]);

    const loadOrphans = useCallback(
        async (targetPage: number) => {
            setOrphansLoading(true);
            try {
                const res = await StorageService.getOrphans(targetPage, PAGE_LIMIT);
                setOrphans(res.data.data);
                setTotalPages(res.data.totalPages);
                setTotal(res.data.total);
                setPage(res.data.page);
            } catch (e) {
                console.error("Failed to load orphaned files", e);
                toast.error("Failed to load orphaned files");
            } finally {
                setOrphansLoading(false);
            }
        },
        [toast],
    );

    useEffect(() => {
        if (!canViewStorage) return;
        loadStats();
        loadOrphans(1);
    }, [canViewStorage, loadStats, loadOrphans]);

    const handleRefresh = () => {
        loadStats();
        loadOrphans(page);
    };

    const handleDelete = async (file: OrphanedFile) => {
        if (!canDeleteStorage) {
            toast.error("Only SUPER_ADMIN can delete storage files");
            return;
        }
        const ok = await confirm({
            title: "Delete orphan?",
            message: `Permanently delete "${file.key}" from storage?\n\nThis cannot be undone.`,
            confirmLabel: "Delete",
            variant: "destructive",
        });
        if (!ok) {
            return;
        }

        setDeletingKey(file.key);
        try {
            await StorageService.deleteOrphan(file.key);
            toast.success("Orphan deleted");
            // Refresh stats + current orphan page. If the current page just
            // became empty (last item on last page), step back one page.
            const newTotal = Math.max(0, total - 1);
            const newTotalPages = Math.max(1, Math.ceil(newTotal / PAGE_LIMIT));
            const nextPage = Math.min(page, newTotalPages);
            await Promise.all([loadStats(), loadOrphans(nextPage)]);
        } catch (e: unknown) {
            const err = e as {
                response?: { status?: number; data?: { message?: string } };
            };
            const status = err.response?.status;
            if (status === 409) {
                // Race: DB row now references this key. Refresh to hide it.
                toast.error(
                    "Bu dosya yeni bir kayda bağlandı, silinemedi",
                );
                await loadOrphans(page);
            } else if (status === 404) {
                toast.error("File not found in storage (already deleted?)");
                await loadOrphans(page);
            } else {
                toast.error(err.response?.data?.message || "Delete failed");
            }
        } finally {
            setDeletingKey(null);
        }
    };

    if (!canViewStorage) {
        return (
            <div className="space-y-6">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">
                        Depolama Yönetimi
                    </h2>
                </div>
                <div className="flex flex-col items-center justify-center h-[400px] border border-dashed border-border rounded-xl bg-card/50 text-muted-foreground">
                    <AlertTriangle className="w-8 h-8 mb-3 opacity-60" />
                    <p className="text-sm">
                        You don&apos;t have permission to view storage.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <HardDrive className="w-7 h-7 text-primary" />
                        Depolama Yönetimi
                    </h2>
                    <p className="text-muted-foreground">
                        GCS bucket stats and orphaned-file cleanup.
                    </p>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={statsLoading || orphansLoading}
                    className="flex items-center gap-2 border border-border bg-card hover:bg-muted/40 text-foreground px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                >
                    <RefreshCcw
                        className={cn(
                            "w-4 h-4",
                            (statsLoading || orphansLoading) && "animate-spin",
                        )}
                    />
                    Refresh
                </button>
            </div>

            {/* Stats section */}
            <section className="space-y-3">
                <div className="flex items-baseline justify-between">
                    <h3 className="text-lg font-semibold">Bucket Stats</h3>
                    {stats && (
                        <p className="text-xs text-muted-foreground">
                            Last updated:{" "}
                            {new Date(stats.generatedAt).toLocaleString()}
                        </p>
                    )}
                </div>

                {statsLoading && !stats ? (
                    <div className="flex items-center justify-center h-32 border border-border rounded-xl bg-card">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <>
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                            <TypeCard
                                label="Audio"
                                bucket={stats?.byType.audio}
                                icon={FileAudio}
                                accent="text-purple-400"
                            />
                            <TypeCard
                                label="Image"
                                bucket={stats?.byType.image}
                                icon={ImageIcon}
                                accent="text-blue-400"
                            />
                            <TypeCard
                                label="Voice Sample"
                                bucket={stats?.byType.voiceSample}
                                icon={Mic}
                                accent="text-green-400"
                            />
                            <TypeCard
                                label="Other"
                                bucket={stats?.byType.other}
                                icon={File}
                                accent="text-slate-400"
                            />
                        </div>

                        <div className="p-6 rounded-xl border border-border bg-gradient-to-br from-primary/10 via-card to-card">
                            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                                <HardDrive className="w-4 h-4 text-primary" />
                                Total
                            </div>
                            <div className="flex items-baseline gap-4 mt-2">
                                <div className="text-3xl font-bold">
                                    {stats?.total.count.toLocaleString() ?? 0}
                                </div>
                                <div className="text-lg text-muted-foreground">
                                    {formatBytes(stats?.total.sizeBytes ?? 0)}
                                </div>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                                {stats?.total.count === 1
                                    ? "file"
                                    : "files"}{" "}
                                across all categories
                            </div>
                        </div>
                    </>
                )}
            </section>

            {/* Orphans section */}
            <section className="space-y-3">
                <div className="flex items-baseline justify-between">
                    <div>
                        <h3 className="text-lg font-semibold">Orphaned Files</h3>
                        <p className="text-xs text-muted-foreground">
                            GCS objects not referenced by any DB row.{" "}
                            {total.toLocaleString()} total
                        </p>
                    </div>
                </div>

                <div className="border border-border rounded-xl bg-card overflow-hidden">
                    {orphansLoading && orphans.length === 0 ? (
                        <div className="flex items-center justify-center h-48">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : orphans.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                            <HardDrive className="w-8 h-8 mb-2 opacity-50" />
                            <p className="text-sm">No orphaned files.</p>
                            <p className="text-xs mt-1">
                                Every GCS object is referenced by a DB row.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/30 text-muted-foreground text-xs uppercase">
                                    <tr>
                                        <th className="px-4 py-3 text-left font-medium">
                                            Key
                                        </th>
                                        <th className="px-4 py-3 text-left font-medium w-36">
                                            Type
                                        </th>
                                        <th className="px-4 py-3 text-right font-medium w-28">
                                            Size
                                        </th>
                                        <th className="px-4 py-3 text-left font-medium w-44">
                                            Updated
                                        </th>
                                        <th className="px-4 py-3 text-right font-medium w-28">
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {orphans.map((file) => (
                                        <tr
                                            key={file.key}
                                            className="hover:bg-muted/20 transition-colors"
                                        >
                                            <td className="px-4 py-3 font-mono text-xs max-w-md">
                                                <span
                                                    className="truncate block"
                                                    title={file.key}
                                                >
                                                    {file.key}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span
                                                    className={cn(
                                                        "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border",
                                                        classificationChipClass[
                                                            file.classifiedAs
                                                        ],
                                                    )}
                                                >
                                                    {
                                                        classificationLabels[
                                                            file.classifiedAs
                                                        ]
                                                    }
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                                                {formatBytes(file.sizeBytes)}
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground text-xs">
                                                {new Date(
                                                    file.updatedAt,
                                                ).toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <button
                                                    onClick={() =>
                                                        handleDelete(file)
                                                    }
                                                    disabled={
                                                        !canDeleteStorage ||
                                                        deletingKey === file.key
                                                    }
                                                    title={
                                                        canDeleteStorage
                                                            ? "Delete orphan"
                                                            : "SUPER_ADMIN only"
                                                    }
                                                    className={cn(
                                                        "inline-flex items-center gap-1 text-xs px-2 py-1 rounded font-medium transition-colors",
                                                        canDeleteStorage
                                                            ? "text-destructive hover:bg-destructive/10"
                                                            : "text-muted-foreground/50 cursor-not-allowed",
                                                        "disabled:opacity-50 disabled:cursor-not-allowed",
                                                    )}
                                                >
                                                    {deletingKey === file.key ? (
                                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    ) : (
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    )}
                                                    Delete
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Pagination */}
                    {orphans.length > 0 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20 text-sm">
                            <div className="text-xs text-muted-foreground">
                                Page {page} of {totalPages} - {total.toLocaleString()}{" "}
                                orphan{total === 1 ? "" : "s"}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => loadOrphans(page - 1)}
                                    disabled={page <= 1 || orphansLoading}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    <ChevronLeft className="w-3.5 h-3.5" />
                                    Prev
                                </button>
                                <button
                                    onClick={() => loadOrphans(page + 1)}
                                    disabled={
                                        page >= totalPages || orphansLoading
                                    }
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    Next
                                    <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {!canDeleteStorage && orphans.length > 0 && (
                    <p className="text-xs text-muted-foreground italic">
                        Only SUPER_ADMIN can delete orphaned files.
                    </p>
                )}
            </section>
        </div>
    );
}
