import type {
    EmailFieldSpec,
    EmailTemplateFieldKey,
    EmailTemplateFields,
    EmailTemplateKind,
    EmailTemplateView,
} from "@/types/api.types";

// Helpers for the email templates page (/admin/email-templates).
//
// A template is one (kind, language). The backend owns the HTML layout and
// every rule (required fields, limits, placeholders, text rules); the panel
// only edits the text fields and shows the backend's preview and problems.

export const EMAIL_FIELD_KEYS: readonly EmailTemplateFieldKey[] = [
    "subject",
    "preheader",
    "heading",
    "body",
    "buttonLabel",
    "note",
    "footer",
];

export function emailTemplateKey(kind: EmailTemplateKind, language: string): string {
    return `${kind}:${language}`;
}

export function findEmailTemplate(
    templates: readonly EmailTemplateView[],
    kind: EmailTemplateKind,
    language: string,
): EmailTemplateView | undefined {
    return templates.find((t) => t.kind === kind && t.language === language);
}

/** Same text in every field (what the server would store: trimmed, Unix newlines). */
export function sameEmailFields(a: EmailTemplateFields, b: EmailTemplateFields): boolean {
    return EMAIL_FIELD_KEYS.every((key) => normaliseText(a[key]) === normaliseText(b[key]));
}

export function normaliseText(value: string | undefined): string {
    return (value ?? "").replace(/\r\n?/g, "\n").trim();
}

/** Fields of `draft` that differ from `saved`. */
export function changedEmailFields(
    saved: EmailTemplateFields,
    draft: EmailTemplateFields,
): EmailTemplateFieldKey[] {
    return EMAIL_FIELD_KEYS.filter((key) => normaliseText(saved[key]) !== normaliseText(draft[key]));
}

/** Character count as the server counts it (code points, after trimming). */
export function emailFieldLength(value: string): number {
    return [...normaliseText(value)].length;
}

/** Placeholders used in a text, without braces, once each. */
export function placeholdersIn(value: string): string[] {
    const found: string[] = [];
    for (const match of value.matchAll(/\{\{\s*([A-Za-z]+)\s*\}\}/g)) {
        if (!found.includes(match[1])) found.push(match[1]);
    }
    return found;
}

/** Placeholders in `value` the field does not allow (shown before the server says so). */
export function unknownPlaceholders(spec: EmailFieldSpec, value: string): string[] {
    return placeholdersIn(value).filter((name) => !spec.placeholders.includes(name));
}

export function placeholderToken(name: string): string {
    return `{{${name}}}`;
}

/** Turkish source label of a template. */
export function emailSourceLabel(view: Pick<EmailTemplateView, "source">): string {
    return view.source === "custom" ? "Panelden" : "Varsayılan";
}

/** Problems list of a 400 EMAIL_TEMPLATE_INVALID response, else null. */
export function problemsFromError(error: unknown): string[] | null {
    const data = (error as { response?: { status?: number; data?: { problems?: unknown } } })?.response;
    if (data?.status !== 400) return null;
    const problems = data.data?.problems;
    if (!Array.isArray(problems)) return null;
    const list = problems.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
    return list.length > 0 ? list : null;
}

/** Very small client check before the test email button calls the API. */
export function looksLikeEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
