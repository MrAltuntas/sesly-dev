"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2, Mic2, Share2 } from "lucide-react";
import { AudioService } from "@/services/admin.service";
import { Audio, AudioStatus } from "@/types/api.types";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { usePermissions } from "@/hooks/usePermissions";
import { ErrorState, getErrorMessage } from "@/components/ui/error-state";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

type StatusFilter = "ALL" | AudioStatus;

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: AudioStatus.PENDING, label: "Pending" },
  { value: AudioStatus.GENERATING, label: "Generating" },
  { value: AudioStatus.READY, label: "Ready" },
  { value: AudioStatus.FAILED, label: "Failed" },
];

const statusBadgeClass: Record<AudioStatus, string> = {
  [AudioStatus.PENDING]: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  [AudioStatus.GENERATING]: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  [AudioStatus.READY]: "bg-green-500/10 text-green-500 border-green-500/20",
  [AudioStatus.FAILED]: "bg-red-500/10 text-red-400 border-red-500/20",
};

function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "-";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const AudioPage = () => {
  const toast = useToast();
  const confirm = useConfirm();
  const { canDeleteAudio } = usePermissions();

  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [page, setPage] = useState(1);
  const [audios, setAudios] = useState<Audio[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchAudios = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await AudioService.getAll({
        page,
        limit: PAGE_SIZE,
        status: status === "ALL" ? undefined : status,
      });
      setAudios(response.data.data);
      setTotal(response.data.total);
      setTotalPages(response.data.totalPages);
    } catch (e) {
      console.error("Error fetching audios:", e);
      setAudios([]);
      setError(getErrorMessage(e, "Could not load audio files."));
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    fetchAudios();
  }, [fetchAudios]);

  const changeStatus = (next: StatusFilter) => {
    setStatus(next);
    setPage(1);
  };

  const handleDelete = async (audio: Audio) => {
    const ok = await confirm({
      title: "Delete audio file?",
      message: `Delete "${audio.title || "Untitled audio"}"?\n\nThis cannot be undone.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;

    setDeleting(audio.id);
    try {
      await AudioService.delete(audio.id);
      toast.success("Audio file deleted");
      if (audios.length === 1 && page > 1) {
        setPage(page - 1); // effect refetches
      } else {
        await fetchAudios();
      }
    } catch (e) {
      console.error("Error deleting audio:", e);
      toast.error(getErrorMessage(e, "Failed to delete audio file"));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Audio Files</h2>
        <p className="text-muted-foreground">Generated narrations across all users.</p>
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
          <div className="flex items-center justify-center p-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={fetchAudios} />
        ) : audios.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Mic2 className="w-6 h-6" />
            {status === "ALL" ? "No audio files yet." : `No audio files with status ${status}.`}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground border-b border-border">
                  <tr>
                    <th className="px-4 py-3 font-medium">Title</th>
                    <th className="px-4 py-3 font-medium">Voice</th>
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Duration</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                    <th className="px-4 py-3 font-medium">Playback</th>
                    {canDeleteAudio && (
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {audios.map((audio) => (
                    <tr key={audio.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium max-w-[240px] truncate" title={audio.title ?? undefined}>
                          {audio.title || <span className="text-muted-foreground italic">Untitled</span>}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">{audio.id.slice(0, 8)}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {audio.shared ? (
                          <span className="italic">Hazır ses (paylaşılan)</span>
                        ) : (
                          audio.voiceProfile?.name ?? <span className="italic">Deleted voice</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {audio.shared ? (
                          <span className="inline-flex items-center gap-1">
                            <Share2 className="w-3 h-3" />
                            {audio.narrationCount ?? 0} seslendirme kullanıyor
                          </span>
                        ) : (
                          <div className="max-w-[220px] truncate" title={audio.user?.email}>
                            {audio.user?.email ?? <span className="italic">Unknown user</span>}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-full text-xs font-semibold border",
                            statusBadgeClass[audio.status] ?? "bg-muted text-muted-foreground border-border",
                          )}
                        >
                          {audio.status}
                        </span>
                        {audio.status === AudioStatus.GENERATING && typeof audio.progress === "number" && (
                          <div className="text-xs text-muted-foreground mt-1">{audio.progress}%</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDuration(audio.duration)}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {new Date(audio.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        {audio.url ? (
                          <audio src={audio.url} controls preload="none" className="h-8 max-w-[220px]" />
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Not available</span>
                        )}
                      </td>
                      {canDeleteAudio && (
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleDelete(audio)}
                            disabled={deleting === audio.id}
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {deleting === audio.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              className="border-t border-border"
              page={page}
              totalPages={totalPages}
              total={total}
              itemLabel="audio files"
              onPageChange={setPage}
              disabled={loading}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default AudioPage;
