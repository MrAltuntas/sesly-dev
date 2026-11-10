"use client";

import { useState } from "react";
import { AlertCircle, Loader2, PencilLine, List, Plus, RefreshCw, RotateCcw, X } from "lucide-react";
import type { GeminiModelOptionsResponse, SettingView } from "@/types/api.types";
import { cn } from "@/lib/utils";
import {
    SOURCE_LABELS,
    SettingDraft,
    formatRange,
    formatSettingValue,
    settingOptionLabel,
    isNumericSetting,
} from "@/lib/settings";

const INPUT_CLASS =
    "w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed";

const SOURCE_BADGE: Record<SettingView["source"], string> = {
    panel: "bg-primary/15 text-primary border-primary/30",
    env: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    default: "bg-muted text-muted-foreground border-border",
};

/** State of the live Gemini model list (GET /admin/settings/options/gemini-models). */
export interface GeminiModelsState {
    loading: boolean;
    data: GeminiModelOptionsResponse | null;
    /** Set when the request itself failed (the endpoint normally answers 200). */
    error: string | null;
    reload: () => void;
}

interface SettingFieldProps {
    setting: SettingView;
    draft: SettingDraft;
    dirty: boolean;
    /** Client or server validation message for this field. */
    error: string | null;
    readOnly: boolean;
    /** Save in flight: inputs are locked. */
    busy: boolean;
    resetting: boolean;
    onChange: (draft: SettingDraft) => void;
    /** A typed input lost focus: the parent drops a draft that changes nothing. */
    onBlur: () => void;
    onReset: () => void;
    /** Only passed for llm.gemini.model. */
    geminiModels?: GeminiModelsState;
}

function formatDate(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
}

export function SettingField({
    setting,
    draft,
    dirty,
    error,
    readOnly,
    busy,
    resetting,
    onChange,
    onBlur,
    onReset,
    geminiModels,
}: SettingFieldProps) {
    const inputId = `setting-input-${setting.key}`;
    const errorId = `setting-error-${setting.key}`;
    const disabled = readOnly || busy || resetting;
    const isOverride = setting.source === "panel";
    const range = isNumericSetting(setting) ? formatRange(setting) : null;

    return (
        <div
            id={`setting-${setting.key}`}
            className={cn(
                "grid gap-4 px-6 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] scroll-mt-8",
                dirty && "bg-primary/5",
                error && "bg-destructive/5",
            )}
        >
            <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={inputId} className="text-sm font-medium">
                        {setting.label}
                    </label>
                    <span
                        className={cn(
                            "px-2 py-0.5 text-[11px] rounded-full border font-medium",
                            SOURCE_BADGE[setting.source],
                        )}
                        title="Geçerli değerin kaynağı"
                    >
                        {SOURCE_LABELS[setting.source]}
                    </span>
                    {dirty && (
                        <span className="px-2 py-0.5 text-[11px] rounded-full border border-primary/40 text-primary font-medium">
                            Kaydedilmedi
                        </span>
                    )}
                </div>
                <p className="text-xs text-muted-foreground">{setting.description}</p>
                <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <div className="flex gap-1">
                        <dt>Anahtar:</dt>
                        <dd className="font-mono text-foreground/80">{setting.key}</dd>
                    </div>
                    <div className="flex gap-1">
                        <dt>Ortam değişkeni:</dt>
                        <dd className="font-mono text-foreground/80">{setting.envVar}</dd>
                    </div>
                    <div className="flex gap-1">
                        <dt>Kod varsayılanı:</dt>
                        <dd className="font-mono text-foreground/80 break-all">
                            {formatSettingValue(setting, setting.defaultValue)}
                        </dd>
                    </div>
                    {range && (
                        <div className="flex gap-1">
                            <dt>Aralık:</dt>
                            <dd className="font-mono text-foreground/80">{range}</dd>
                        </div>
                    )}
                    {setting.updatedAt && (
                        <div className="flex gap-1" title={setting.updatedByAdminId ?? undefined}>
                            <dt>Panelden değiştirildi:</dt>
                            <dd className="text-foreground/80">{formatDate(setting.updatedAt)}</dd>
                        </div>
                    )}
                </dl>
            </div>

            <div className="min-w-0 space-y-2">
                <SettingInput
                    setting={setting}
                    draft={draft}
                    inputId={inputId}
                    errorId={error ? errorId : undefined}
                    disabled={disabled}
                    readOnly={readOnly}
                    invalid={!!error}
                    onChange={onChange}
                    onBlur={onBlur}
                    geminiModels={geminiModels}
                />

                {error && (
                    <p id={errorId} role="alert" className="flex items-start gap-1.5 text-xs text-red-400">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>{error}</span>
                    </p>
                )}

                {!readOnly && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] text-muted-foreground min-w-0 break-words">
                            {isOverride ? (
                                <>
                                    Sıfırlanırsa:{" "}
                                    <span className="font-mono text-foreground/80">
                                        {formatSettingValue(setting, setting.fallbackValue)}
                                    </span>{" "}
                                    ({SOURCE_LABELS[setting.fallbackSource]})
                                </>
                            ) : (
                                "Panel değeri yok, sıfırlanacak bir şey yok."
                            )}
                        </p>
                        <button
                            type="button"
                            onClick={onReset}
                            disabled={!isOverride || busy || resetting}
                            title={
                                isOverride
                                    ? "Panel değerini sil ve yedek değere dön"
                                    : "Yalnızca panelden değiştirilmiş ayarlar sıfırlanabilir"
                            }
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border text-xs font-medium hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                        >
                            {resetting ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <RotateCcw className="w-3.5 h-3.5" />
                            )}
                            Sıfırla
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Input per setting type
// ─────────────────────────────────────────────────────────────────────────────

interface SettingInputProps {
    setting: SettingView;
    draft: SettingDraft;
    inputId: string;
    errorId?: string;
    disabled: boolean;
    readOnly: boolean;
    invalid: boolean;
    onChange: (draft: SettingDraft) => void;
    onBlur: () => void;
    geminiModels?: GeminiModelsState;
}

function SettingInput(props: SettingInputProps) {
    const { setting, draft, inputId, errorId, disabled, invalid, onChange, onBlur, geminiModels } = props;
    const { min, max, step, options, maxLength } = setting.constraints;
    const invalidClass = invalid && "border-red-500/60 focus:ring-red-500/60";

    if (setting.type === "boolean") {
        const checked = draft === true;
        return (
            <div className="flex items-center gap-3">
                <button
                    id={inputId}
                    type="button"
                    role="switch"
                    aria-checked={checked}
                    aria-describedby={errorId}
                    disabled={disabled}
                    onClick={() => onChange(!checked)}
                    className={cn(
                        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60 disabled:cursor-not-allowed",
                        checked ? "bg-primary border-primary" : "bg-muted border-border",
                    )}
                >
                    <span
                        className={cn(
                            "inline-block h-4 w-4 rounded-full bg-white transition-transform",
                            checked ? "translate-x-6" : "translate-x-1",
                        )}
                    />
                </button>
                <span className="text-sm">{checked ? "Açık" : "Kapalı"}</span>
            </div>
        );
    }

    if (setting.type === "stringList") {
        return (
            <TagInput
                inputId={inputId}
                errorId={errorId}
                values={Array.isArray(draft) ? draft : []}
                options={options}
                labelFor={(value) => settingOptionLabel(setting, value)}
                disabled={disabled}
                invalid={invalid}
                onChange={onChange}
            />
        );
    }

    const text = typeof draft === "string" ? draft : "";

    if (geminiModels) {
        return (
            <GeminiModelInput
                {...props}
                text={text}
                serverValue={typeof setting.value === "string" ? setting.value : ""}
                geminiModels={geminiModels}
            />
        );
    }

    if (setting.type === "enum") {
        const list = options ?? [];
        // Never hide the stored value, even if the registry stopped listing it.
        const choices = text !== "" && !list.includes(text) ? [text, ...list] : list;
        return (
            <select
                id={inputId}
                value={text}
                disabled={disabled}
                aria-invalid={invalid}
                aria-describedby={errorId}
                onChange={(e) => onChange(e.target.value)}
                className={cn(INPUT_CLASS, invalidClass)}
            >
                {choices.map((option) => (
                    <option key={option} value={option}>
                        {settingOptionLabel(setting, option)}
                    </option>
                ))}
            </select>
        );
    }

    if (setting.type === "int" || setting.type === "float") {
        return (
            <div className="flex items-center gap-2">
                <input
                    id={inputId}
                    type="number"
                    inputMode={setting.type === "int" ? "numeric" : "decimal"}
                    value={text}
                    min={min ?? undefined}
                    max={max ?? undefined}
                    step={step ?? (setting.type === "int" ? 1 : "any")}
                    disabled={disabled}
                    aria-invalid={invalid}
                    aria-describedby={errorId}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={onBlur}
                    className={cn(INPUT_CLASS, "font-mono", invalidClass)}
                />
                {setting.unit && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{setting.unit}</span>
                )}
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2">
            <input
                id={inputId}
                type="text"
                value={text}
                maxLength={maxLength ?? undefined}
                disabled={disabled}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={invalid}
                aria-describedby={errorId}
                onChange={(e) => onChange(e.target.value)}
                onBlur={onBlur}
                className={cn(INPUT_CLASS, "font-mono", invalidClass)}
            />
            {setting.unit && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">{setting.unit}</span>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini model: select fed by the live model list, free text as fallback
// ─────────────────────────────────────────────────────────────────────────────

function GeminiModelInput({
    setting,
    text,
    serverValue,
    inputId,
    errorId,
    disabled,
    readOnly,
    invalid,
    onChange,
    onBlur,
    geminiModels,
}: SettingInputProps & { text: string; serverValue: string; geminiModels: GeminiModelsState }) {
    const [manual, setManual] = useState(false);
    const invalidClass = invalid && "border-red-500/60 focus:ring-red-500/60";
    const models = geminiModels.data?.models ?? [];
    const hasList = models.length > 0;
    const reason = geminiModels.error ?? geminiModels.data?.reason ?? null;
    const useSelect = hasList && !manual;

    // The stored value and the value being edited are always selectable, even
    // when the key can no longer list them (that is how an outdated model
    // becomes visible instead of silently switching to the first option).
    const extras = [text, serverValue].filter(
        (value, index, all) => value !== "" && !models.includes(value) && all.indexOf(value) === index,
    );

    return (
        <div className="space-y-2">
            {geminiModels.loading ? (
                <div className={cn(INPUT_CLASS, "flex items-center gap-2 text-muted-foreground")}>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="font-mono text-foreground">{text}</span>
                    <span className="text-xs">Model listesi yükleniyor...</span>
                </div>
            ) : useSelect ? (
                <select
                    id={inputId}
                    value={text}
                    disabled={disabled}
                    aria-invalid={invalid}
                    aria-describedby={errorId}
                    onChange={(e) => onChange(e.target.value)}
                    className={cn(INPUT_CLASS, "font-mono", invalidClass)}
                >
                    {extras.length > 0 && (
                        <optgroup label="Listede olmayan değer">
                            {extras.map((value) => (
                                <option key={value} value={value}>
                                    {value}
                                </option>
                            ))}
                        </optgroup>
                    )}
                    <optgroup label="Bu anahtarla kullanılabilen modeller">
                        {models.map((model) => (
                            <option key={model} value={model}>
                                {model}
                            </option>
                        ))}
                    </optgroup>
                </select>
            ) : (
                <input
                    id={inputId}
                    type="text"
                    value={text}
                    maxLength={setting.constraints.maxLength ?? undefined}
                    disabled={disabled}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="gemini-..."
                    aria-invalid={invalid}
                    aria-describedby={errorId}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={onBlur}
                    className={cn(INPUT_CLASS, "font-mono", invalidClass)}
                />
            )}

            {!geminiModels.loading && hasList && serverValue !== "" && !models.includes(serverValue) && (
                <p className="flex items-start gap-1.5 text-xs text-amber-400">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                        Kayıtlı model ({serverValue}) Gemini&apos;nin bu anahtar için döndürdüğü listede yok.
                        Kullanımdan kalkmış olabilir.
                    </span>
                </p>
            )}

            {!geminiModels.loading && !hasList && (
                <p className="flex items-start gap-1.5 text-xs text-amber-400">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                        {reason ?? "Model listesi alınamadı."} Model adı elle yazılabilir.
                    </span>
                </p>
            )}

            {!geminiModels.loading && (
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {hasList && !readOnly && (
                        <button
                            type="button"
                            onClick={() => setManual((prev) => !prev)}
                            disabled={disabled}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-40"
                        >
                            {manual ? <List className="w-3 h-3" /> : <PencilLine className="w-3 h-3" />}
                            {manual ? "Listeden seç" : "Elle yaz"}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={geminiModels.reload}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border hover:bg-muted transition-colors"
                    >
                        <RefreshCw className="w-3 h-3" />
                        Listeyi yenile
                    </button>
                    {hasList && (
                        <span>
                            {models.length} model
                            {geminiModels.data?.fetchedAt
                                ? `, ${formatDate(geminiModels.data.fetchedAt)} tarihinde alındı`
                                : ""}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tag input for stringList settings
// ─────────────────────────────────────────────────────────────────────────────

interface TagInputProps {
    inputId: string;
    errorId?: string;
    values: string[];
    /** Allowed items. Null means free text. */
    options: string[] | null;
    /** Display name of an item (the Turkish label of an option). */
    labelFor: (value: string) => string;
    disabled: boolean;
    invalid: boolean;
    onChange: (values: string[]) => void;
}

function TagInput({ inputId, errorId, values, options, labelFor, disabled, invalid, onChange }: TagInputProps) {
    const [text, setText] = useState("");
    const remaining = options ? options.filter((option) => !values.includes(option)) : [];

    const add = (raw: string) => {
        const item = raw.trim();
        if (item === "" || values.includes(item)) return;
        onChange([...values, item]);
    };

    const commitText = () => {
        // Commas split, so a pasted "tr, en" becomes two tags.
        const next = [...values];
        for (const part of text.split(",")) {
            const item = part.trim();
            if (item !== "" && !next.includes(item)) next.push(item);
        }
        if (next.length !== values.length) onChange(next);
        setText("");
    };

    return (
        <div
            className={cn(
                "rounded-md border border-border bg-background p-2 space-y-2",
                invalid && "border-red-500/60",
                disabled && "opacity-60",
            )}
        >
            <ul className="flex flex-wrap gap-1.5 min-h-7">
                {values.length === 0 && (
                    <li className="text-xs text-muted-foreground px-1 py-1">Liste boş.</li>
                )}
                {values.map((value) => (
                    <li
                        key={value}
                        title={value}
                        className={cn(
                            "inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-muted border border-border text-xs",
                            !options && "font-mono",
                        )}
                    >
                        {labelFor(value)}
                        <button
                            type="button"
                            disabled={disabled}
                            onClick={() => onChange(values.filter((item) => item !== value))}
                            aria-label={`${labelFor(value)} değerini kaldır`}
                            className="rounded-full p-0.5 hover:bg-background disabled:cursor-not-allowed"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </li>
                ))}
            </ul>

            {options ? (
                <select
                    id={inputId}
                    value=""
                    disabled={disabled || remaining.length === 0}
                    aria-invalid={invalid}
                    aria-describedby={errorId}
                    onChange={(e) => add(e.target.value)}
                    className={cn(INPUT_CLASS, "py-1.5")}
                >
                    <option value="">
                        {remaining.length === 0 ? "Bütün değerler eklendi" : "Değer ekle..."}
                    </option>
                    {remaining.map((option) => (
                        <option key={option} value={option}>
                            {labelFor(option)}
                        </option>
                    ))}
                </select>
            ) : (
                <div className="flex items-center gap-2">
                    <input
                        id={inputId}
                        type="text"
                        value={text}
                        disabled={disabled}
                        spellCheck={false}
                        autoComplete="off"
                        placeholder="Değer yazıp Enter'a basın"
                        aria-invalid={invalid}
                        aria-describedby={errorId}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === ",") {
                                e.preventDefault();
                                commitText();
                            } else if (e.key === "Backspace" && text === "" && values.length > 0) {
                                onChange(values.slice(0, -1));
                            }
                        }}
                        onBlur={commitText}
                        className={cn(INPUT_CLASS, "py-1.5 font-mono")}
                    />
                    <button
                        type="button"
                        onClick={commitText}
                        disabled={disabled || text.trim() === ""}
                        aria-label="Değeri ekle"
                        className="shrink-0 p-2 rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-40"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
            )}
        </div>
    );
}
