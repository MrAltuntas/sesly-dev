"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Lock } from "lucide-react";
import { OpsService } from "@/services/admin.service";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { usePermissions } from "@/hooks/usePermissions";
import { ErrorState, getErrorMessage } from "@/components/ui/error-state";
import { SystemSettings } from "@/components/settings/SystemSettings";

export default function SettingsPage() {
    const toast = useToast();
    const confirm = useConfirm();
    const { canToggleMaintenance } = usePermissions();

    const [maintenance, setMaintenance] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(canToggleMaintenance);
    const [error, setError] = useState<string | null>(null);
    const [updating, setUpdating] = useState(false);

    const loadMaintenance = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await OpsService.getMaintenanceStatus();
            setMaintenance(res.data.enabled);
        } catch (e) {
            console.error("Failed to load maintenance status", e);
            setMaintenance(null);
            setError(getErrorMessage(e, "Bakım modu durumu yüklenemedi."));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (canToggleMaintenance) loadMaintenance();
    }, [canToggleMaintenance, loadMaintenance]);

    const toggleMaintenance = async () => {
        if (maintenance === null) return;
        const next = !maintenance;
        const ok = await confirm(
            next
                ? {
                      title: "Bakım modu açılsın mı?",
                      message:
                          'Bakım modu kapatılana kadar mobil uygulamadan ve açık API\'den gelen her istek 503 "bakımda" yanıtı alır.\n\nYönetim paneli, yasal sayfalar ve sağlık kontrolleri çalışmaya devam eder.',
                      confirmLabel: "Aç",
                      cancelLabel: "Vazgeç",
                      variant: "destructive",
                  }
                : {
                      title: "Bakım modu kapatılsın mı?",
                      message: "Mobil uygulama ve açık API yeniden istek karşılamaya başlar.",
                      confirmLabel: "Kapat",
                      cancelLabel: "Vazgeç",
                  },
        );
        if (!ok) return;

        setUpdating(true);
        try {
            const res = await OpsService.toggleMaintenance(next);
            setMaintenance(res.data.enabled);
            toast.success(res.data.enabled ? "Bakım modu açıldı." : "Bakım modu kapatıldı.");
        } catch (e) {
            toast.error(getErrorMessage(e, "Bakım modu değiştirilemedi."));
        } finally {
            setUpdating(false);
        }
    };

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Ayarlar</h2>
                <p className="text-muted-foreground">Çalışma zamanı ayarları ve sistem durumu.</p>
            </div>

            <SystemSettings />

            <div className="border border-destructive/20 rounded-xl bg-destructive/5 p-6">
                <div className="flex items-center gap-3 mb-4 text-destructive">
                    <AlertTriangle className="w-5 h-5" />
                    <h3 className="font-semibold">Tehlikeli bölge</h3>
                </div>
                {!canToggleMaintenance ? (
                    <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <Lock className="w-4 h-4 mt-0.5 shrink-0" />
                        Bakım modunu yalnızca Admin ve Süper Admin hesapları görebilir ve değiştirebilir.
                    </div>
                ) : loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Bakım modu durumu yükleniyor...
                    </div>
                ) : error || maintenance === null ? (
                    <ErrorState
                        className="p-4"
                        message={error ?? "Bakım modu durumu bilinmiyor."}
                        onRetry={loadMaintenance}
                        retryLabel="Tekrar dene"
                    />
                ) : (
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <div className="text-sm font-medium">Bakım modu</div>
                            <div className="text-xs text-muted-foreground">
                                {maintenance ? "Şu anda açık: açık API 503 döndürüyor." : "Şu anda kapalı."}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={toggleMaintenance}
                            disabled={updating}
                            className={cn(
                                "px-3 py-1 border rounded text-sm transition-colors inline-flex items-center gap-2 disabled:opacity-50",
                                maintenance
                                    ? "bg-destructive text-white border-destructive hover:bg-destructive/90"
                                    : "bg-background border-border hover:bg-destructive/10",
                            )}
                        >
                            {updating && <Loader2 className="w-3 h-3 animate-spin" />}
                            {maintenance ? "Kapat" : "Aç"}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
