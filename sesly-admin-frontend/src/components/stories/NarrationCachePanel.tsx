"use client";

import { useCallback, useEffect, useState } from "react";
import { HardDrive, Loader2, RefreshCw, Share2, Trash2 } from "lucide-react";
import { StoriesService } from "@/services/admin.service";
import { NarrationCacheSummary } from "@/types/api.types";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { getErrorMessage } from "@/components/ui/error-state";
import { useToast } from "@/hooks/useToast";
import { cacheConfirmMessage, cacheIsEmpty, sharingNote } from "@/lib/segments";

interface NarrationCachePanelProps {
    storyId: string;
    canClear: boolean;
    /** Changes whenever the segments were saved (the save clears the cache). */
    refreshKey?: number;
}

/**
 * What the backend stores for the narrations of a story (every user) and
 * the "Seslendirme önbelleğini temizle" action.
 */
export function NarrationCachePanel({ storyId, canClear, refreshKey = 0 }: NarrationCachePanelProps) {
    const confirm = useConfirm();
    const toast = useToast();
    const [summary, setSummary] = useState<NarrationCacheSummary | null>(null);
    const [loading, setLoading] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await StoriesService.getNarrationCache(storyId);
            setSummary(res.data);
        } catch (e) {
            setError(getErrorMessage(e, "Seslendirme önbelleği okunamadı"));
        } finally {
            setLoading(false);
        }
    }, [storyId]);

    useEffect(() => {
        void load();
    }, [load, refreshKey]);

    const handleClear = async () => {
        // Fresh numbers for the dialog: users may have narrated meanwhile.
        let current = summary;
        try {
            current = (await StoriesService.getNarrationCache(storyId)).data;
            setSummary(current);
        } catch (e) {
            toast.error(getErrorMessage(e, "Seslendirme önbelleği okunamadı"));
            return;
        }
        if (cacheIsEmpty(current)) {
            toast.info("Bu masalın sunucuda saklanan seslendirmesi yok.");
            return;
        }
        const ok = await confirm({
            title: "Seslendirme önbelleği temizlensin mi?",
            message: cacheConfirmMessage(current!, "clear"),
            confirmLabel: "Temizle",
            cancelLabel: "Vazgeç",
            variant: "destructive",
        });
        if (!ok) return;

        setClearing(true);
        try {
            const res = await StoriesService.clearNarrationCache(storyId);
            const r = res.data;
            if (r.failedAudios > 0) {
                toast.error(`${r.removedAudios} ses kaydı silindi, ${r.failedAudios} kayıt silinemedi.`);
            } else {
                toast.success(`${r.removedAudios} ses kaydı ve ${r.files} dosya silindi.`);
            }
            await load();
        } catch (e) {
            toast.error(getErrorMessage(e, "Seslendirme önbelleği temizlenemedi"));
        } finally {
            setClearing(false);
        }
    };

    return (
        <div className="border border-border rounded-lg bg-muted/10 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-start gap-2">
                    <HardDrive className="w-4 h-4 mt-0.5 text-muted-foreground" />
                    <div>
                        <h3 className="text-sm font-semibold">Seslendirme önbelleği</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Kullanıcıların bu masal için oluşturduğu ve sunucuda saklanan seslendirmeler.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => void load()}
                        disabled={loading}
                        title="Yenile"
                        className="text-muted-foreground hover:text-primary p-1.5 rounded transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={loading ? "w-3.5 h-3.5 animate-spin" : "w-3.5 h-3.5"} />
                    </button>
                    {canClear && (
                        <button
                            type="button"
                            onClick={handleClear}
                            disabled={clearing || loading || cacheIsEmpty(summary)}
                            className="bg-destructive/10 hover:bg-destructive/20 text-destructive px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
                        >
                            {clearing ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                            )}
                            Seslendirme önbelleğini temizle
                        </button>
                    )}
                </div>
            </div>

            {error ? (
                <p className="text-xs text-destructive">{error}</p>
            ) : summary ? (
                <div className="space-y-2">
                    <dl className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <Stat label="Seslendirme" value={summary.narrations} />
                        <Stat label="Hazır" value={summary.readyNarrations} />
                        <Stat label="Hazırlanıyor" value={summary.generatingNarrations} />
                        <Stat label="Eski segmentlerle" value={summary.staleAudios} />
                        <Stat label="Ses kaydı" value={summary.audios} />
                        <Stat label="Paylaşılan ses" value={summary.sharedAudios ?? 0} />
                        <Stat label="Paylaşılanı kullanan seslendirme" value={summary.sharedNarrations ?? 0} />
                        <Stat label="Dosya" value={summary.files} />
                    </dl>
                    <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                        <Share2 className="w-3 h-3 mt-0.5 shrink-0" />
                        {sharingNote(summary)}
                    </p>
                </div>
            ) : (
                <p className="text-xs text-muted-foreground">Yükleniyor...</p>
            )}
        </div>
    );
}

function Stat({ label, value }: { label: string; value: number }) {
    return (
        <div className="bg-background border border-border rounded-md px-2 py-1.5">
            <dt className="text-[10px] text-muted-foreground">{label}</dt>
            <dd className="font-semibold">{value}</dd>
        </div>
    );
}
