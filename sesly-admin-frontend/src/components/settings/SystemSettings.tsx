"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, Eye, KeyRound, Loader2, Lock, Save, SlidersHorizontal, Undo2 } from "lucide-react";
import { SettingsService } from "@/services/admin.service";
import type {
    GeminiModelOptionsResponse,
    SettingsGroup,
    SettingValue,
    SettingView,
} from "@/types/api.types";
import { useToast } from "@/hooks/useToast";
import { usePermissions } from "@/hooks/usePermissions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ErrorState, getErrorMessage } from "@/components/ui/error-state";
import {
    SOURCE_LABELS,
    SettingDraft,
    findSettingKeyInMessage,
    formatDraft,
    formatSettingValue,
    isDraftDirty,
    parseDraft,
    toDraft,
    withDraft,
    withoutCleanDraft,
} from "@/lib/settings";
import { SettingField } from "./SettingField";

const GEMINI_MODEL_KEY = "llm.gemini.model";

/**
 * The axios interceptor in lib/api.ts already toasts 403, 404, 500 and
 * network failures. Skip our own toast for those so the admin sees one.
 */
function alreadyToasted(error: unknown): boolean {
    const response = (error as { response?: { status?: number } })?.response;
    if (!response) return true;
    return response.status === 403 || response.status === 404 || response.status === 500;
}

interface PendingChange {
    setting: SettingView;
    draft: SettingDraft;
    /** Client-side validation message, null when the draft parses. */
    clientError: string | null;
    value: SettingValue | null;
}

export function SystemSettings() {
    const toast = useToast();
    const confirm = useConfirm();
    const { canViewSystemSettings, canEditSystemSettings } = usePermissions();
    const readOnly = !canEditSystemSettings;

    const [groups, setGroups] = useState<SettingsGroup[] | null>(null);
    const [loading, setLoading] = useState(canViewSystemSettings);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Only touched settings live here. An edit back to the server value is
    // removed when its input loses focus, never while the admin is typing.
    const [drafts, setDrafts] = useState<Record<string, SettingDraft>>({});
    // Messages the API attached to a key (PATCH validation, failed reset).
    const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [resettingKey, setResettingKey] = useState<string | null>(null);

    const [modelsLoading, setModelsLoading] = useState(canViewSystemSettings);
    const [modelsData, setModelsData] = useState<GeminiModelOptionsResponse | null>(null);
    const [modelsError, setModelsError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const res = await SettingsService.getAll();
            setGroups(res.data.groups ?? []);
        } catch (e) {
            console.error("Failed to load settings", e);
            setGroups(null);
            setLoadError(getErrorMessage(e, "Sistem ayarları yüklenemedi."));
        } finally {
            setLoading(false);
        }
    }, []);

    const loadModels = useCallback(async () => {
        setModelsLoading(true);
        setModelsError(null);
        try {
            const res = await SettingsService.getGeminiModels();
            setModelsData(res.data);
        } catch (e) {
            console.error("Failed to load Gemini models", e);
            setModelsData(null);
            setModelsError(getErrorMessage(e, "Gemini model listesi alınamadı."));
        } finally {
            setModelsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!canViewSystemSettings) return;
        load();
        loadModels();
    }, [canViewSystemSettings, load, loadModels]);

    const allSettings = useMemo(() => (groups ?? []).flatMap((group) => group.settings), [groups]);

    const pending = useMemo<PendingChange[]>(() => {
        const list: PendingChange[] = [];
        for (const setting of allSettings) {
            if (!(setting.key in drafts)) continue;
            const draft = drafts[setting.key];
            if (!isDraftDirty(setting, draft)) continue;
            const parsed = parseDraft(setting, draft);
            list.push({
                setting,
                draft,
                clientError: parsed.ok ? null : parsed.error,
                value: parsed.ok ? parsed.value : null,
            });
        }
        return list;
    }, [allSettings, drafts]);

    const pendingByKey = useMemo(() => {
        const map = new Map<string, PendingChange>();
        for (const change of pending) map.set(change.setting.key, change);
        return map;
    }, [pending]);

    const hasPending = pending.length > 0;
    const invalidCount = pending.filter((change) => change.clientError !== null).length;

    // Warn before a reload or tab close throws unsaved edits away.
    useEffect(() => {
        if (!hasPending) return;
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [hasPending]);

    const clearServerError = (key: string) => {
        setServerErrors((prev) => {
            if (!(key in prev)) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
        });
    };

    const changeDraft = (setting: SettingView, draft: SettingDraft) => {
        // Always keep the typed text. `pending` filters with isDraftDirty, so a
        // draft equal to the server value is not listed as a change.
        setDrafts((prev) => withDraft(prev, setting, draft));
        clearServerError(setting.key);
        setSaveError(null);
    };

    // On blur a draft that changes nothing is dropped and the field shows the
    // canonical server text again.
    const normaliseDraft = (setting: SettingView) => {
        setDrafts((prev) => withoutCleanDraft(prev, setting));
    };

    const discardAll = () => {
        setDrafts({});
        setServerErrors({});
        setSaveError(null);
    };

    const scrollToSetting = (key: string) => {
        document.getElementById(`setting-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    };

    const save = async () => {
        if (!hasPending || saving) return;
        const firstInvalid = pending.find((change) => change.clientError !== null);
        if (firstInvalid) {
            scrollToSetting(firstInvalid.setting.key);
            toast.error("Kaydetmeden önce işaretli alanları düzeltin.");
            return;
        }

        const values: Record<string, SettingValue> = {};
        for (const change of pending) {
            if (change.value !== null) values[change.setting.key] = change.value;
        }

        setSaving(true);
        setSaveError(null);
        setServerErrors({});
        try {
            const res = await SettingsService.update(values);
            setGroups(res.data.groups ?? []);
            setDrafts({});
            toast.success(
                pending.length === 1 ? "1 ayar kaydedildi." : `${pending.length} ayar kaydedildi.`,
            );
        } catch (e) {
            console.error("Failed to save settings", e);
            const message = getErrorMessage(e, "Ayarlar kaydedilemedi.");
            // The API validates all or nothing and names the offending key.
            const key = findSettingKeyInMessage(
                message,
                allSettings.map((setting) => setting.key),
            );
            if (key) {
                setServerErrors({ [key]: message });
                setSaveError("Bir ayar sunucu tarafından reddedildi. Hiçbir değişiklik kaydedilmedi.");
                scrollToSetting(key);
            } else {
                setSaveError(`${message} Hiçbir değişiklik kaydedilmedi.`);
            }
            if (!alreadyToasted(e)) toast.error("Ayarlar kaydedilemedi.");
        } finally {
            setSaving(false);
        }
    };

    const reset = async (setting: SettingView) => {
        if (setting.source !== "panel" || resettingKey) return;
        const fallback = formatSettingValue(setting, setting.fallbackValue);
        const ok = await confirm({
            title: "Ayar sıfırlansın mı?",
            message: `"${setting.label}" için panelden girilen değer silinecek.\n\nYeni değer: ${fallback} (${SOURCE_LABELS[setting.fallbackSource]})\n\nDeğişiklik hemen geçerli olur.`,
            confirmLabel: "Sıfırla",
            cancelLabel: "Vazgeç",
            variant: "destructive",
        });
        if (!ok) return;

        setResettingKey(setting.key);
        clearServerError(setting.key);
        try {
            const res = await SettingsService.reset(setting.key);
            const updated = res.data;
            setGroups((prev) =>
                (prev ?? []).map((group) => ({
                    ...group,
                    settings: group.settings.map((item) => (item.key === updated.key ? updated : item)),
                })),
            );
            setDrafts((prev) => {
                if (!(setting.key in prev)) return prev;
                const next = { ...prev };
                delete next[setting.key];
                return next;
            });
            toast.success(`"${setting.label}" sıfırlandı.`);
        } catch (e) {
            console.error("Failed to reset setting", e);
            const message = getErrorMessage(e, "Ayar sıfırlanamadı.");
            setServerErrors((prev) => ({ ...prev, [setting.key]: message }));
            if (!alreadyToasted(e)) toast.error(message);
        } finally {
            setResettingKey(null);
        }
    };

    return (
        <section aria-labelledby="system-settings-title" className="space-y-6">
            <div className="flex items-start gap-3">
                <SlidersHorizontal className="text-primary w-5 h-5 mt-1 shrink-0" />
                <div>
                    <h3 id="system-settings-title" className="text-xl font-semibold tracking-tight">
                        Sistem ayarları
                    </h3>
                    <p className="text-sm text-muted-foreground">
                        Sunucuyu yeniden başlatmadan değiştirilebilen çalışma zamanı ayarları. Panelden girilen
                        değer ortam değişkeninin ve kod varsayılanının önüne geçer.
                    </p>
                </div>
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4">
                <KeyRound className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                    API anahtarları, gizli değerler ve servis adresleri (Gemini ve Cartesia anahtarları ile
                    adresleri, veritabanı, Redis, JWT, CORS, depolama) buradan görüntülenemez ve değiştirilemez.
                    Bunlar yalnızca sunucunun ortam değişkenlerinde durur.
                </p>
            </div>

            {!canViewSystemSettings ? (
                <div className="flex items-start gap-2 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
                    <Lock className="w-4 h-4 mt-0.5 shrink-0" />
                    Sistem ayarlarını yalnızca Admin ve Süper Admin hesapları görebilir.
                </div>
            ) : loading ? (
                <div
                    role="status"
                    className="flex items-center gap-2 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground"
                >
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sistem ayarları yükleniyor...
                </div>
            ) : loadError || groups === null ? (
                <div className="rounded-xl border border-border bg-card">
                    <ErrorState
                        message={loadError ?? "Sistem ayarları yüklenemedi."}
                        onRetry={load}
                        retryLabel="Tekrar dene"
                    />
                </div>
            ) : allSettings.length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                    Sunucu düzenlenebilir bir ayar döndürmedi.
                </div>
            ) : (
                <>
                    {readOnly && (
                        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-300">
                            <Eye className="w-4 h-4 mt-0.5 shrink-0" />
                            Salt okunur görünüm. Sistem ayarlarını yalnızca Süper Admin hesapları değiştirebilir
                            ve sıfırlayabilir.
                        </div>
                    )}

                    {groups
                        .filter((group) => group.settings.length > 0)
                        .map((group) => (
                            <div
                                key={group.id}
                                className="border border-border rounded-xl bg-card overflow-hidden"
                            >
                                <div className="px-6 py-4 border-b border-border bg-muted/20">
                                    <h4 className="font-semibold">{group.label}</h4>
                                    <p className="text-xs text-muted-foreground mt-0.5">{group.description}</p>
                                </div>
                                <div className="divide-y divide-border">
                                    {group.settings.map((setting) => {
                                        const change = pendingByKey.get(setting.key);
                                        const draft =
                                            setting.key in drafts
                                                ? drafts[setting.key]
                                                : toDraft(setting, setting.value);
                                        return (
                                            <SettingField
                                                key={setting.key}
                                                setting={setting}
                                                draft={draft}
                                                dirty={!!change}
                                                error={serverErrors[setting.key] ?? change?.clientError ?? null}
                                                readOnly={readOnly}
                                                busy={saving}
                                                resetting={resettingKey === setting.key}
                                                onChange={(next) => changeDraft(setting, next)}
                                                onBlur={() => normaliseDraft(setting)}
                                                onReset={() => reset(setting)}
                                                geminiModels={
                                                    setting.key === GEMINI_MODEL_KEY
                                                        ? {
                                                              loading: modelsLoading,
                                                              data: modelsData,
                                                              error: modelsError,
                                                              reload: loadModels,
                                                          }
                                                        : undefined
                                                }
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        ))}

                    {!readOnly && hasPending && (
                        <div className="sticky bottom-0 z-20 -mx-2">
                            <div className="rounded-xl border border-primary/40 bg-card shadow-2xl shadow-black/60">
                                <div className="px-5 pt-4">
                                    <div className="text-sm font-semibold">
                                        {pending.length} kaydedilmemiş değişiklik
                                    </div>
                                    <ul className="mt-2 max-h-40 overflow-y-auto space-y-1 pr-1">
                                        {pending.map((change) => (
                                            <li key={change.setting.key}>
                                                <button
                                                    type="button"
                                                    onClick={() => scrollToSetting(change.setting.key)}
                                                    className="w-full flex flex-wrap items-center gap-x-2 gap-y-0.5 text-left text-xs rounded px-1.5 py-1 hover:bg-muted transition-colors"
                                                >
                                                    <span className="font-medium">{change.setting.label}</span>
                                                    <span className="font-mono text-muted-foreground line-through break-all">
                                                        {formatSettingValue(change.setting, change.setting.value)}
                                                    </span>
                                                    <ArrowRight
                                                        className="w-3 h-3 text-muted-foreground shrink-0"
                                                        aria-label="yeni değer"
                                                    />
                                                    <span className="font-mono text-primary break-all">
                                                        {formatDraft(change.setting, change.draft)}
                                                    </span>
                                                    {(change.clientError || serverErrors[change.setting.key]) && (
                                                        <span className="inline-flex items-center gap-1 text-red-400">
                                                            <AlertCircle className="w-3 h-3" />
                                                            Geçersiz
                                                        </span>
                                                    )}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                {saveError && (
                                    <p
                                        role="alert"
                                        className="mx-5 mt-3 flex items-start gap-1.5 text-xs text-red-400"
                                    >
                                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                        <span>{saveError}</span>
                                    </p>
                                )}

                                <div className="mt-3 px-5 py-3 border-t border-border bg-muted/20 rounded-b-xl flex flex-wrap items-center justify-between gap-3">
                                    <p className="text-xs text-muted-foreground">
                                        {invalidCount > 0
                                            ? `${invalidCount} alan geçersiz. Düzeltilmeden kaydedilemez.`
                                            : "Değişiklikler birlikte kaydedilir. Biri reddedilirse hiçbiri yazılmaz."}
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={discardAll}
                                            disabled={saving}
                                            className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                                        >
                                            <Undo2 className="w-4 h-4" />
                                            Vazgeç
                                        </button>
                                        <button
                                            type="button"
                                            onClick={save}
                                            disabled={saving || invalidCount > 0}
                                            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white bg-primary hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {saving ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <Save className="w-4 h-4" />
                                            )}
                                            {saving ? "Kaydediliyor..." : "Kaydet"}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
