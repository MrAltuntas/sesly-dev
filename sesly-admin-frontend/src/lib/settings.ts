import type { SettingSource, SettingValue, SettingView } from "@/types/api.types";

// Helpers for the runtime settings form (GET/PATCH /admin/settings).
//
// The form keeps a "draft" per touched setting. Numbers stay strings while the
// admin types (so "0." or an empty field are representable) and are parsed
// only for validation, the change summary and the PATCH body.

export type SettingDraft = string | boolean | string[];

export type ParsedDraft =
    | { ok: true; value: SettingValue }
    | { ok: false; error: string };

export const SOURCE_LABELS: Record<SettingSource, string> = {
    panel: "Panel",
    env: "Ortam değişkeni",
    default: "Varsayılan",
};

export function isNumericSetting(setting: SettingView): boolean {
    return setting.type === "int" || setting.type === "float";
}

/** Server value in the shape the inputs edit. */
export function toDraft(setting: SettingView, value: SettingValue): SettingDraft {
    if (setting.type === "boolean") return value === true;
    if (setting.type === "stringList") {
        return Array.isArray(value) ? value.map((item) => String(item)) : [];
    }
    if (value === null || value === undefined) return "";
    return String(value);
}

/**
 * Client-side check that mirrors the server rules closely enough to catch
 * typos before a round trip. The server stays the authority: whatever it
 * rejects is shown on the field as well.
 */
export function parseDraft(setting: SettingView, draft: SettingDraft): ParsedDraft {
    const { min, max, options, pattern, maxLength } = setting.constraints;

    switch (setting.type) {
        case "boolean":
            return { ok: true, value: draft === true };

        case "stringList": {
            const items = Array.isArray(draft) ? draft : [];
            if (options) {
                const unknown = items.find((item) => !options.includes(item));
                if (unknown !== undefined) {
                    return { ok: false, error: `"${unknown}" geçerli bir değer değil.` };
                }
            }
            return { ok: true, value: items };
        }

        case "int":
        case "float": {
            const text = typeof draft === "string" ? draft.trim().replace(",", ".") : "";
            if (text === "") return { ok: false, error: "Bu alan boş olamaz." };
            const num = Number(text);
            if (!Number.isFinite(num)) return { ok: false, error: "Bu alan sayı olmalıdır." };
            if (setting.type === "int" && !Number.isInteger(num)) {
                return { ok: false, error: "Bu alan tam sayı olmalıdır." };
            }
            if (min !== null && max !== null && (num < min || num > max)) {
                return { ok: false, error: `Değer ${min} ile ${max} arasında olmalıdır.` };
            }
            if (min !== null && num < min) {
                return { ok: false, error: `Değer en az ${min} olmalıdır.` };
            }
            if (max !== null && num > max) {
                return { ok: false, error: `Değer en fazla ${max} olmalıdır.` };
            }
            return { ok: true, value: num };
        }

        case "enum": {
            const text = typeof draft === "string" ? draft : "";
            if (text === "") return { ok: false, error: "Bir değer seçilmelidir." };
            if (options && !options.includes(text)) {
                return { ok: false, error: `"${text}" geçerli bir değer değil.` };
            }
            return { ok: true, value: text };
        }

        default: {
            const text = typeof draft === "string" ? draft.trim() : "";
            if (text === "") return { ok: false, error: "Bu alan boş olamaz." };
            if (maxLength !== null && text.length > maxLength) {
                return { ok: false, error: `En fazla ${maxLength} karakter olabilir.` };
            }
            if (pattern) {
                let matches = true;
                try {
                    matches = new RegExp(pattern).test(text);
                } catch {
                    // A pattern this browser cannot compile is left to the server.
                    matches = true;
                }
                if (!matches) {
                    return {
                        ok: false,
                        error: "Geçersiz biçim. Yalnızca harf, rakam, nokta, tire ve alt çizgi kullanılabilir.",
                    };
                }
            }
            return { ok: true, value: text };
        }
    }
}

export function sameSettingValue(a: SettingValue, b: SettingValue): boolean {
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        return a.length === b.length && a.every((item, index) => item === b[index]);
    }
    return a === b;
}

/** True when the draft would change the value the server has now. */
export function isDraftDirty(setting: SettingView, draft: SettingDraft): boolean {
    const parsed = parseDraft(setting, draft);
    // An unparsable draft is still an edit the admin has to fix or discard.
    if (!parsed.ok) return !sameSettingValue(draft, toDraft(setting, setting.value));
    return !sameSettingValue(parsed.value, setting.value);
}

/**
 * Draft map after an input change. The draft is always stored, even when it
 * parses to the value the server already has: dropping it mid-typing would
 * make the controlled input fall back to the canonical server text and eat
 * characters ("1.0" on the way to "1.05" parses to 1). Pending changes are
 * derived with isDraftDirty, so a stored but equal draft never counts as one.
 */
export function withDraft(
    drafts: Record<string, SettingDraft>,
    setting: SettingView,
    draft: SettingDraft,
): Record<string, SettingDraft> {
    return { ...drafts, [setting.key]: draft };
}

/**
 * Draft map after an input lost focus: a draft that would not change the
 * server value is removed, so the field shows the canonical text again
 * ("1.0" becomes "1"). Dirty and unparsable drafts are kept untouched.
 * Returns the same object when nothing changes.
 */
export function withoutCleanDraft(
    drafts: Record<string, SettingDraft>,
    setting: SettingView,
): Record<string, SettingDraft> {
    if (!(setting.key in drafts)) return drafts;
    if (isDraftDirty(setting, drafts[setting.key])) return drafts;
    const next = { ...drafts };
    delete next[setting.key];
    return next;
}

/**
 * Turkish display name of an option of an enum or list setting. The stored
 * value stays the raw one; a value the backend names no label for (an older
 * backend, a value the registry no longer lists) is shown as it is.
 */
export function settingOptionLabel(setting: Pick<SettingView, "constraints">, value: string): string {
    return setting.constraints.optionLabels?.find((option) => option.value === value)?.label ?? value;
}

/** Human readable value for badges, the reset hint and the change summary. */
export function formatSettingValue(setting: SettingView, value: SettingValue): string {
    if (typeof value === "boolean") return value ? "Açık" : "Kapalı";
    if (Array.isArray(value)) {
        return value.length > 0 ? value.map((item) => settingOptionLabel(setting, item)).join(", ") : "(boş)";
    }
    if (value === null || value === undefined || value === "") return "(boş)";
    if (setting.type === "enum" && typeof value === "string") return settingOptionLabel(setting, value);
    return setting.unit ? `${value} ${setting.unit}` : String(value);
}

/** Same as formatSettingValue but for a draft that may not parse yet. */
export function formatDraft(setting: SettingView, draft: SettingDraft): string {
    const parsed = parseDraft(setting, draft);
    if (parsed.ok) return formatSettingValue(setting, parsed.value);
    if (typeof draft === "string") return draft.trim() === "" ? "(boş)" : draft;
    return formatSettingValue(setting, draft);
}

/**
 * PATCH /admin/settings answers with one Turkish message that names the
 * offending key in double quotes. Returns that key so the message can be
 * shown next to its field. Longest key first, so "a.b" never shadows "a.b.c".
 */
export function findSettingKeyInMessage(message: string, keys: string[]): string | null {
    const sorted = [...keys].sort((a, b) => b.length - a.length);
    return sorted.find((key) => message.includes(`"${key}"`)) ?? null;
}

/** Inclusive range hint, e.g. "10 - 3600 saniye". Null when unbounded. */
export function formatRange(setting: SettingView): string | null {
    const { min, max } = setting.constraints;
    const unit = setting.unit ? ` ${setting.unit}` : "";
    if (min !== null && max !== null) return `${min} - ${max}${unit}`;
    if (min !== null) return `en az ${min}${unit}`;
    if (max !== null) return `en fazla ${max}${unit}`;
    return null;
}
