"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    AlertCircle,
    Eye,
    Info,
    Languages,
    Loader2,
    Mail,
    Monitor,
    RotateCcw,
    Save,
    Send,
    Smartphone,
    Undo2,
} from "lucide-react";
import { EmailTemplatesService } from "@/services/admin.service";
import type {
    EmailFieldSpec,
    EmailTemplateFields,
    EmailTemplateKind,
    EmailTemplatePreview,
    EmailTemplatesResponse,
    EmailTemplateView,
} from "@/types/api.types";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { usePermissions } from "@/hooks/usePermissions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ErrorState, getErrorMessage } from "@/components/ui/error-state";
import {
    changedEmailFields,
    emailFieldLength,
    emailSourceLabel,
    findEmailTemplate,
    looksLikeEmail,
    placeholderToken,
    problemsFromError,
    sameEmailFields,
    unknownPlaceholders,
} from "@/lib/email-templates";

const PREVIEW_DEBOUNCE_MS = 400;

/** The axios interceptor already toasts 403, 404, 500 and network errors. */
function alreadyToasted(error: unknown): boolean {
    const response = (error as { response?: { status?: number } })?.response;
    if (!response) return true;
    return response.status === 403 || response.status === 404 || response.status === 500;
}

export default function EmailTemplatesPage() {
    const toast = useToast();
    const confirm = useConfirm();
    const { canViewEmailTemplates, canEditEmailTemplates } = usePermissions();
    const readOnly = !canEditEmailTemplates;

    const [data, setData] = useState<EmailTemplatesResponse | null>(null);
    const [loading, setLoading] = useState(canViewEmailTemplates);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [kind, setKind] = useState<EmailTemplateKind>("welcome");
    const [language, setLanguage] = useState("tr");
    const [draft, setDraft] = useState<EmailTemplateFields | null>(null);

    const [preview, setPreview] = useState<EmailTemplatePreview | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [previewWidth, setPreviewWidth] = useState<"desktop" | "mobile">("desktop");
    const previewSeq = useRef(0);

    const [saving, setSaving] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [saveProblems, setSaveProblems] = useState<string[] | null>(null);
    const [testTo, setTestTo] = useState("");
    const [sendingTest, setSendingTest] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const res = await EmailTemplatesService.getAll();
            setData(res.data);
        } catch (e) {
            console.error("Failed to load email templates", e);
            setData(null);
            setLoadError(getErrorMessage(e, "E-posta şablonları yüklenemedi."));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (canViewEmailTemplates) load();
    }, [canViewEmailTemplates, load]);

    const current = useMemo<EmailTemplateView | undefined>(
        () => (data ? findEmailTemplate(data.templates, kind, language) : undefined),
        [data, kind, language],
    );
    const kindSpec = data?.kinds.find((k) => k.kind === kind);

    // A fresh draft whenever another template is opened or the saved text changes.
    useEffect(() => {
        setDraft(current ? { ...current.fields } : null);
        setSaveProblems(null);
    }, [current]);

    const dirty = !!(current && draft && !sameEmailFields(current.fields, draft));
    const changed = current && draft ? changedEmailFields(current.fields, draft) : [];
    const differsFromDefault = !!(current && draft && !sameEmailFields(current.defaults, draft));

    // Warn before a reload or tab close throws unsaved edits away.
    useEffect(() => {
        if (!dirty) return;
        const handler = (e: BeforeUnloadEvent) => e.preventDefault();
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [dirty]);

    // Live preview of the draft, debounced; only the latest answer is shown.
    useEffect(() => {
        if (!draft || !current) return;
        const seq = ++previewSeq.current;
        setPreviewLoading(true);
        const timer = window.setTimeout(async () => {
            try {
                const res = await EmailTemplatesService.preview(kind, language, draft);
                if (seq !== previewSeq.current) return;
                setPreview(res.data);
                setPreviewError(null);
            } catch (e) {
                if (seq !== previewSeq.current) return;
                setPreviewError(getErrorMessage(e, "Önizleme oluşturulamadı."));
            } finally {
                if (seq === previewSeq.current) setPreviewLoading(false);
            }
        }, PREVIEW_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [draft, current, kind, language]);

    const select = async (nextKind: EmailTemplateKind, nextLanguage: string) => {
        if (nextKind === kind && nextLanguage === language) return;
        if (dirty) {
            const ok = await confirm({
                title: "Kaydedilmemiş değişiklikler silinsin mi?",
                message: "Bu şablonda kaydetmediğin değişiklikler var. Başka bir şablona geçersen kaybolur.",
                confirmLabel: "Değişiklikleri sil",
                cancelLabel: "Vazgeç",
                variant: "destructive",
            });
            if (!ok) return;
        }
        setPreview(null);
        setKind(nextKind);
        setLanguage(nextLanguage);
    };

    const replaceTemplate = (view: EmailTemplateView) => {
        setData((prev) =>
            prev
                ? {
                      ...prev,
                      templates: prev.templates.map((t) =>
                          t.kind === view.kind && t.language === view.language ? view : t,
                      ),
                  }
                : prev,
        );
    };

    const save = async () => {
        if (!draft || !dirty || saving) return;
        setSaving(true);
        setSaveProblems(null);
        try {
            const res = await EmailTemplatesService.save(kind, language, draft);
            replaceTemplate(res.data);
            toast.success("Şablon kaydedildi. Sonraki e-postalar bu metinle gider.");
        } catch (e) {
            console.error("Failed to save email template", e);
            const problems = problemsFromError(e);
            if (problems) {
                setSaveProblems(problems);
                toast.error("Şablon kaydedilmedi. İşaretli sorunları düzelt.");
            } else if (!alreadyToasted(e)) {
                toast.error(getErrorMessage(e, "Şablon kaydedilemedi."));
            }
        } finally {
            setSaving(false);
        }
    };

    const resetToDefault = async () => {
        if (!current || current.source !== "custom" || resetting) return;
        const ok = await confirm({
            title: "Varsayılan metne dönülsün mü?",
            message: `"${kindSpec?.label ?? kind}" (${languageLabel(data, language)}) için panelden kaydedilen metin silinir ve koddaki varsayılan metin kullanılır.`,
            confirmLabel: "Varsayılana dön",
            cancelLabel: "Vazgeç",
            variant: "destructive",
        });
        if (!ok) return;
        setResetting(true);
        try {
            const res = await EmailTemplatesService.reset(kind, language);
            replaceTemplate(res.data);
            toast.success("Varsayılan metne dönüldü.");
        } catch (e) {
            console.error("Failed to reset email template", e);
            if (!alreadyToasted(e)) toast.error(getErrorMessage(e, "Şablon sıfırlanamadı."));
        } finally {
            setResetting(false);
        }
    };

    const sendTest = async () => {
        if (!draft || sendingTest) return;
        if (!looksLikeEmail(testTo)) {
            toast.error("Geçerli bir e-posta adresi gir.");
            return;
        }
        setSendingTest(true);
        try {
            const res = await EmailTemplatesService.sendTest(kind, language, testTo.trim(), draft);
            toast.success(`Test e-postası ${res.data.to} adresine gönderildi.`);
        } catch (e) {
            console.error("Failed to send test email", e);
            const problems = problemsFromError(e);
            if (problems) {
                setSaveProblems(problems);
                toast.error("Test e-postası gönderilmedi. İşaretli sorunları düzelt.");
            } else if (!alreadyToasted(e)) {
                toast.error(getErrorMessage(e, "Test e-postası gönderilemedi."));
            }
        } finally {
            setSendingTest(false);
        }
    };

    const updateField = (key: keyof EmailTemplateFields, value: string) => {
        setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
        setSaveProblems(null);
    };

    const loadDefaults = () => {
        if (current) setDraft({ ...current.defaults });
    };

    const problems = saveProblems ?? preview?.problems ?? [];

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">E-posta şablonları</h2>
                <p className="text-muted-foreground">
                    Hoş geldin ve şifre sıfırlama e-postalarının her dildeki metni. Tasarım sabittir, burada yalnızca
                    metinler değişir.
                </p>
            </div>

            {!canViewEmailTemplates ? (
                <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
                    E-posta şablonlarını yalnızca Admin ve Süper Admin hesapları görebilir.
                </div>
            ) : loading ? (
                <div role="status" className="flex items-center gap-2 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    E-posta şablonları yükleniyor...
                </div>
            ) : loadError || !data ? (
                <div className="rounded-xl border border-border bg-card">
                    <ErrorState message={loadError ?? "E-posta şablonları yüklenemedi."} onRetry={load} retryLabel="Tekrar dene" />
                </div>
            ) : (
                <>
                    {readOnly && (
                        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-300">
                            <Eye className="w-4 h-4 mt-0.5 shrink-0" />
                            Salt okunur görünüm. Metinleri yalnızca Süper Admin hesapları kaydedebilir, sıfırlayabilir ve
                            test e-postası gönderebilir. Önizlemede deneme yapabilirsin.
                        </div>
                    )}

                    {/* Kind tabs with the source of every language. */}
                    <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
                        {data.kinds.map((spec) => (
                            <button
                                key={spec.kind}
                                type="button"
                                onClick={() => select(spec.kind, language)}
                                className={cn(
                                    "px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap",
                                    kind === spec.kind
                                        ? "border-primary text-primary"
                                        : "border-transparent text-muted-foreground hover:text-foreground",
                                )}
                            >
                                <Mail className="w-4 h-4" />
                                {spec.label}
                                <span className="flex items-center gap-1">
                                    {data.languages.map((lang) => {
                                        const view = findEmailTemplate(data.templates, spec.kind, lang.code);
                                        return (
                                            <SourceBadge key={lang.code} custom={view?.source === "custom"} prefix={lang.code} />
                                        );
                                    })}
                                </span>
                            </button>
                        ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <div role="group" aria-label="Şablon dili" className="flex items-center border border-border rounded-md overflow-hidden text-sm">
                            <span className="px-2.5 py-2 text-muted-foreground border-r border-border flex items-center">
                                <Languages className="w-4 h-4" />
                            </span>
                            {data.languages.map((lang, index) => (
                                <button
                                    key={lang.code}
                                    type="button"
                                    aria-pressed={language === lang.code}
                                    onClick={() => select(kind, lang.code)}
                                    className={cn(
                                        "px-3 py-2 font-medium transition-colors",
                                        index > 0 && "border-l border-border",
                                        language === lang.code ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50",
                                    )}
                                >
                                    {lang.label}
                                </button>
                            ))}
                        </div>
                        {current && (
                            <span className="text-xs text-muted-foreground">
                                Kaynak: {emailSourceLabel(current)}
                                {current.updatedAt && ` (son kayıt ${new Date(current.updatedAt).toLocaleString("tr-TR")})`}
                            </span>
                        )}
                        {kindSpec && <span className="text-xs text-muted-foreground">{kindSpec.description}</span>}
                    </div>

                    {!current || !draft ? (
                        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
                            Bu dil için şablon bulunamadı.
                        </div>
                    ) : (
                        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                            {/* Editor */}
                            <section aria-label="Metin" className="space-y-4">
                                <div className="rounded-xl border border-border bg-card divide-y divide-border">
                                    {data.fields.map((spec) => (
                                        <FieldEditor
                                            key={spec.key}
                                            spec={spec}
                                            value={draft[spec.key]}
                                            required={
                                                spec.key === "subject" ||
                                                spec.key === "heading" ||
                                                spec.key === "body" ||
                                                (spec.key === "buttonLabel" && !!kindSpec?.buttonRequired)
                                            }
                                            changed={changed.includes(spec.key)}
                                            readOnly={readOnly}
                                            onChange={(value) => updateField(spec.key, value)}
                                        />
                                    ))}
                                </div>

                                <div className="rounded-xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground space-y-1.5">
                                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                                        <Info className="w-3.5 h-3.5" /> Yer tutucular
                                    </div>
                                    {data.placeholders.map((p) => (
                                        <p key={p.key}>
                                            <code className="text-primary">{placeholderToken(p.key)}</code>{" "}
                                            {p.key === "link" && kindSpec ? `${p.label} Bu e-postada: ${kindSpec.linkDescription}` : p.label}
                                        </p>
                                    ))}
                                    <p>Metin, buton altı notu ve alt bilgide boş bir satır yeni paragraf açar, **iki yıldız** arasındaki yazı kalın olur.</p>
                                </div>

                                {!readOnly && (
                                    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={save}
                                                disabled={!dirty || saving}
                                                className="bg-primary hover:bg-primary/90 text-white px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                                            >
                                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                                Kaydet
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setDraft({ ...current.fields })}
                                                disabled={!dirty || saving}
                                                className="bg-secondary hover:bg-secondary/80 text-secondary-foreground px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                                            >
                                                <Undo2 className="w-4 h-4" /> Değişiklikleri geri al
                                            </button>
                                            <button
                                                type="button"
                                                onClick={loadDefaults}
                                                disabled={!differsFromDefault || saving}
                                                className="bg-secondary hover:bg-secondary/80 text-secondary-foreground px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                                                title="Varsayılan metni düzenleyiciye yükler, kaydetmeden önce önizleyebilirsin."
                                            >
                                                <RotateCcw className="w-4 h-4" /> Varsayılanı yükle
                                            </button>
                                            {current.source === "custom" && (
                                                <button
                                                    type="button"
                                                    onClick={resetToDefault}
                                                    disabled={resetting || saving}
                                                    className="border border-destructive/40 text-destructive hover:bg-destructive/10 px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                                                >
                                                    {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                                                    Varsayılana dön
                                                </button>
                                            )}
                                            {dirty && (
                                                <span className="text-xs text-amber-300">
                                                    {changed.length} alanda kaydedilmemiş değişiklik
                                                </span>
                                            )}
                                        </div>

                                        <div className="border-t border-border pt-4">
                                            <label htmlFor="test-to" className="text-sm font-medium">
                                                Test e-postası
                                            </label>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                Ekrandaki metin (kaydedilmemiş olsa da) örnek bir adla ve çalışmayan örnek bir
                                                bağlantıyla gönderilir. Konunun başında [Test] yazar.
                                            </p>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                <input
                                                    id="test-to"
                                                    type="email"
                                                    value={testTo}
                                                    onChange={(e) => setTestTo(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter") sendTest();
                                                    }}
                                                    placeholder="ornek@sesly.io"
                                                    className="flex-1 min-w-56 bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={sendTest}
                                                    disabled={sendingTest || !testTo.trim()}
                                                    className="bg-secondary hover:bg-secondary/80 text-secondary-foreground px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                                                >
                                                    {sendingTest ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                                    Gönder
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </section>

                            {/* Preview */}
                            <section aria-label="Önizleme" className="space-y-3 xl:sticky xl:top-4 self-start">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-xs text-muted-foreground">Konu</div>
                                        <div className="text-sm font-semibold break-words">{preview?.subject ?? "..."}</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {previewLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-label="Önizleme yenileniyor" />}
                                        <div role="group" aria-label="Önizleme genişliği" className="flex items-center border border-border rounded-md overflow-hidden text-xs">
                                            <button
                                                type="button"
                                                aria-pressed={previewWidth === "desktop"}
                                                onClick={() => setPreviewWidth("desktop")}
                                                className={cn("px-2.5 py-1.5 flex items-center gap-1", previewWidth === "desktop" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50")}
                                            >
                                                <Monitor className="w-3.5 h-3.5" /> Masaüstü
                                            </button>
                                            <button
                                                type="button"
                                                aria-pressed={previewWidth === "mobile"}
                                                onClick={() => setPreviewWidth("mobile")}
                                                className={cn("px-2.5 py-1.5 flex items-center gap-1 border-l border-border", previewWidth === "mobile" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50")}
                                            >
                                                <Smartphone className="w-3.5 h-3.5" /> Telefon
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {problems.length > 0 && (
                                    <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs">
                                        <p className="font-semibold text-red-400 flex items-center gap-1.5">
                                            <AlertCircle className="w-3.5 h-3.5" />
                                            Bu metin bu haliyle kaydedilemez
                                        </p>
                                        <ul className="list-disc pl-5 mt-1 space-y-0.5 text-muted-foreground">
                                            {problems.map((p) => (
                                                <li key={p}>{p}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {previewError && <p className="text-xs text-red-400">{previewError}</p>}

                                <div className="rounded-xl border border-border bg-[#08090A] overflow-hidden flex justify-center">
                                    {preview ? (
                                        <iframe
                                            title="E-posta önizlemesi"
                                            srcDoc={preview.html}
                                            sandbox=""
                                            className="block h-[760px] bg-[#08090A] transition-[width]"
                                            style={{ width: previewWidth === "mobile" ? 375 : "100%" }}
                                        />
                                    ) : (
                                        <div className="h-[760px] flex items-center justify-center text-sm text-muted-foreground">
                                            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Önizleme hazırlanıyor...
                                        </div>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Örnek değerlerle gösterilir. E-posta istemcileri yazı tiplerini farklı gösterebilir, renkler
                                    ve yerleşim aynı kalır.
                                </p>
                                {preview && (
                                    <details className="rounded-md border border-border bg-card text-xs">
                                        <summary className="cursor-pointer px-3 py-2 text-muted-foreground">Düz metin sürümü</summary>
                                        <pre className="whitespace-pre-wrap break-words px-3 pb-3 font-mono text-muted-foreground">{preview.text}</pre>
                                    </details>
                                )}
                            </section>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function languageLabel(data: EmailTemplatesResponse | null, code: string): string {
    return data?.languages.find((l) => l.code === code)?.label ?? code;
}

function SourceBadge({ custom, prefix }: { custom: boolean; prefix: string }) {
    return (
        <span
            className={cn(
                "text-[10px] uppercase px-1.5 py-0.5 rounded",
                custom ? "text-blue-400 bg-blue-500/10" : "text-muted-foreground bg-muted/40",
            )}
            title={custom ? "Panelden kaydedilmiş metin" : "Varsayılan metin"}
        >
            {prefix}
        </span>
    );
}

function FieldEditor({
    spec,
    value,
    required,
    changed,
    readOnly,
    onChange,
}: {
    spec: EmailFieldSpec;
    value: string;
    required: boolean;
    changed: boolean;
    readOnly: boolean;
    onChange: (value: string) => void;
}) {
    const id = `email-field-${spec.key}`;
    const length = emailFieldLength(value);
    const tooLong = length > spec.maxLength;
    const unknown = unknownPlaceholders(spec, value);
    const inputClass =
        "w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary disabled:opacity-60";

    return (
        <div className="p-4 space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={id} className="text-sm font-medium flex items-center gap-2">
                    {spec.label}
                    {required ? (
                        <span className="text-[10px] text-muted-foreground">zorunlu</span>
                    ) : (
                        <span className="text-[10px] text-muted-foreground">boş bırakılabilir</span>
                    )}
                    {changed && <span className="text-[10px] text-amber-300">değişti</span>}
                </label>
                <span className={cn("text-[11px] tabular-nums", tooLong ? "text-red-400" : "text-muted-foreground")}>
                    {length} / {spec.maxLength}
                </span>
            </div>
            {spec.multiline ? (
                <textarea
                    id={id}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={readOnly}
                    rows={spec.key === "body" ? 9 : 4}
                    className={cn(inputClass, "font-mono leading-relaxed resize-y")}
                />
            ) : (
                <input
                    id={id}
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, " "))}
                    disabled={readOnly}
                    className={inputClass}
                />
            )}
            <p className="text-xs text-muted-foreground">
                {spec.hint}
                {spec.placeholders.length > 0 && (
                    <> Kullanılabilir: {spec.placeholders.map((p) => placeholderToken(p)).join(", ")}.</>
                )}
            </p>
            {unknown.length > 0 && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Bu alanda tanınmayan yer tutucu: {unknown.map((p) => placeholderToken(p)).join(", ")}
                </p>
            )}
        </div>
    );
}
