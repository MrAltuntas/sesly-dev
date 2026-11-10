"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, XCircle } from "lucide-react";
import { ModerationService } from "@/services/admin.service";
import { ModerationVoiceProfile, VoiceProfileStatus } from "@/types/api.types";
import { useToast } from "@/hooks/useToast";
import { usePermissions } from "@/hooks/usePermissions";
import { ErrorState, getErrorMessage } from "@/components/ui/error-state";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

type StatusFilter = "ALL" | VoiceProfileStatus;

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
    { value: "ALL", label: "All" },
    { value: VoiceProfileStatus.PENDING, label: "Pending" },
    { value: VoiceProfileStatus.PROCESSING, label: "Processing" },
    { value: VoiceProfileStatus.FAILED, label: "Failed" },
    { value: VoiceProfileStatus.READY, label: "Ready" },
];

const statusBadgeClass: Record<VoiceProfileStatus, string> = {
    [VoiceProfileStatus.PENDING]: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    [VoiceProfileStatus.PROCESSING]: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    [VoiceProfileStatus.READY]: "bg-green-500/10 text-green-500 border-green-500/20",
    [VoiceProfileStatus.FAILED]: "bg-red-500/10 text-red-400 border-red-500/20",
};

function ownerLabel(voice: ModerationVoiceProfile): string {
    if (!voice.user) return "Unknown user";
    const name = [voice.user.firstName, voice.user.lastName].filter(Boolean).join(" ");
    return name ? `${name} (${voice.user.email})` : voice.user.email;
}

export default function ModerationPage() {
    const toast = useToast();
    const { canRejectVoice } = usePermissions();

    const [status, setStatus] = useState<StatusFilter>("ALL");
    const [page, setPage] = useState(1);
    const [voices, setVoices] = useState<ModerationVoiceProfile[]>([]);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Reject dialog
    const [rejectTarget, setRejectTarget] = useState<ModerationVoiceProfile | null>(null);
    const [rejectReason, setRejectReason] = useState("");
    const [rejecting, setRejecting] = useState(false);

    const loadVoices = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await ModerationService.listVoiceProfiles({
                page,
                limit: PAGE_SIZE,
                status: status === "ALL" ? undefined : status,
            });
            setVoices(res.data.data);
            setTotal(res.data.total);
            setTotalPages(res.data.totalPages);
        } catch (e) {
            console.error("Failed to load voice profiles", e);
            setVoices([]);
            setError(getErrorMessage(e, "Could not load voice profiles."));
        } finally {
            setLoading(false);
        }
    }, [page, status]);

    useEffect(() => {
        loadVoices();
    }, [loadVoices]);

    const changeStatus = (next: StatusFilter) => {
        setStatus(next);
        setPage(1);
    };

    const openReject = (voice: ModerationVoiceProfile) => {
        setRejectTarget(voice);
        setRejectReason("");
    };

    const closeReject = () => {
        if (rejecting) return;
        setRejectTarget(null);
        setRejectReason("");
    };

    const submitReject = async () => {
        if (!rejectTarget) return;
        setRejecting(true);
        try {
            const reason = rejectReason.trim();
            await ModerationService.rejectVoice(rejectTarget.id, reason ? { reason } : undefined);
            toast.success(`"${rejectTarget.name}" marked as failed. The owner was notified.`);
            setRejectTarget(null);
            setRejectReason("");
            await loadVoices();
        } catch (e) {
            toast.error(getErrorMessage(e, "Could not mark the voice as failed"));
        } finally {
            setRejecting(false);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Voice Profiles</h2>
                <p className="text-muted-foreground">
                    Monitor cloned and ready-made voices. Voices go live automatically when the provider finishes;
                    use &quot;Mark as failed&quot; to pull a problematic voice and notify its owner.
                </p>
            </div>

            <div className="flex flex-wrap gap-2">
                {STATUS_TABS.map((tab) => (
                    <button
                        key={tab.value}
                        type="button"
                        onClick={() => changeStatus(tab.value)}
                        className={cn(
                            "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
                            status === tab.value
                                ? "bg-primary/15 text-primary border-primary/30"
                                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="border border-border rounded-xl bg-card text-card-foreground overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center gap-2 p-10 text-muted-foreground">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Loading voice profiles...
                    </div>
                ) : error ? (
                    <ErrorState message={error} onRetry={loadVoices} />
                ) : voices.length === 0 ? (
                    <div className="p-10 text-center text-sm text-muted-foreground">
                        {status === "ALL"
                            ? "No voice profiles yet."
                            : `No voice profiles with status ${status}.`}
                    </div>
                ) : (
                    <>
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/50 text-muted-foreground border-b border-border">
                                <tr>
                                    <th className="px-6 py-3 font-medium">Voice</th>
                                    <th className="px-6 py-3 font-medium">Owner</th>
                                    <th className="px-6 py-3 font-medium">Status</th>
                                    <th className="px-6 py-3 font-medium">Created</th>
                                    <th className="px-6 py-3 font-medium">Sample</th>
                                    <th className="px-6 py-3 font-medium text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {voices.map((voice) => (
                                    <tr key={voice.id} className="hover:bg-muted/30 transition-colors align-top">
                                        <td className="px-6 py-4">
                                            <div className="font-medium">{voice.name}</div>
                                            <div className="text-xs text-muted-foreground">{voice.provider}</div>
                                        </td>
                                        <td className="px-6 py-4 text-muted-foreground">
                                            <div className="max-w-[240px] truncate" title={ownerLabel(voice)}>
                                                {ownerLabel(voice)}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span
                                                className={cn(
                                                    "px-2 py-0.5 rounded-full text-xs font-semibold border",
                                                    statusBadgeClass[voice.status] ?? "bg-muted text-muted-foreground border-border",
                                                )}
                                            >
                                                {voice.status}
                                            </span>
                                            {voice.errorMessage && (
                                                <div
                                                    className="text-xs text-red-400 mt-1 max-w-[260px] line-clamp-2"
                                                    title={voice.errorMessage}
                                                >
                                                    {voice.errorMessage}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">
                                            {new Date(voice.createdAt).toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4">
                                            {voice.sampleUrl ? (
                                                <audio
                                                    src={voice.sampleUrl}
                                                    controls
                                                    preload="none"
                                                    className="h-8 max-w-[220px]"
                                                />
                                            ) : (
                                                <span className="text-xs text-muted-foreground italic">No sample</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            {canRejectVoice && voice.status !== VoiceProfileStatus.FAILED && (
                                                <button
                                                    type="button"
                                                    onClick={() => openReject(voice)}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium transition-colors"
                                                >
                                                    <XCircle className="w-4 h-4" />
                                                    Mark as failed
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <Pagination
                            className="border-t border-border"
                            page={page}
                            totalPages={totalPages}
                            total={total}
                            itemLabel="voice profiles"
                            onPageChange={setPage}
                            disabled={loading}
                        />
                    </>
                )}
            </div>

            {rejectTarget && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="reject-dialog-title"
                    className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                    onClick={closeReject}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="bg-card text-card-foreground border border-border rounded-xl w-full max-w-md overflow-hidden shadow-2xl"
                    >
                        <div className="p-6 space-y-4">
                            <div>
                                <h3 id="reject-dialog-title" className="font-semibold text-lg mb-1">
                                    Mark &quot;{rejectTarget.name}&quot; as failed?
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                    The voice will be set to FAILED and can no longer be used for narration.
                                    The owner ({rejectTarget.user?.email ?? "unknown user"}) will be notified.
                                </p>
                            </div>
                            <div>
                                <label htmlFor="reject-reason" className="text-sm font-medium mb-1 block">
                                    Reason (optional, shown to the owner)
                                </label>
                                <textarea
                                    id="reject-reason"
                                    value={rejectReason}
                                    onChange={(e) => setRejectReason(e.target.value)}
                                    rows={3}
                                    maxLength={500}
                                    placeholder="e.g. Background noise makes the sample unusable"
                                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                            </div>
                        </div>
                        <div className="px-6 py-4 bg-muted/20 border-t border-border flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeReject}
                                disabled={rejecting}
                                className="px-4 py-2 rounded-md text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={submitReject}
                                disabled={rejecting}
                                className="px-4 py-2 rounded-md text-sm font-medium text-white bg-destructive hover:bg-destructive/90 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
                            >
                                {rejecting && <Loader2 className="w-4 h-4 animate-spin" />}
                                Mark as failed
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
