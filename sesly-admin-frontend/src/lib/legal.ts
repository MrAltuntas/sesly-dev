import type { LegalDocument, LegalDocumentVersion, LegalLanguage } from "@/types/api.types";

// Helpers for the legal documents page (GET/PATCH/POST /admin/legal).
//
// A document is identified by (slug, language). Turkish is the canonical
// text: when a language has no published version, the app is served the
// published Turkish one (GET /legal/:slug?language=en answers with
// language "tr"). A draft is never served.

/** Languages a legal document can be written in, in switch order. Mirrors the backend list. */
export const LEGAL_LANGUAGES: readonly LegalLanguage[] = ["tr", "en"];

/** The canonical language, and the one the app falls back to. */
export const FALLBACK_LEGAL_LANGUAGE: LegalLanguage = "tr";

/** Label on the language switch, each language in its own words. */
export const LEGAL_LANGUAGE_LABELS: Record<LegalLanguage, string> = {
    tr: "Türkçe",
    en: "English",
};

/** Name inside a Turkish sentence ("İngilizce sürüm"). */
export const LEGAL_LANGUAGE_NAMES: Record<LegalLanguage, string> = {
    tr: "Türkçe",
    en: "İngilizce",
};

/** Titles the backend seeder gives the English drafts. Used to prefill a new English document. */
const DEFAULT_TITLES: Partial<Record<LegalLanguage, Record<string, string>>> = {
    en: {
        tos: "Terms of Use",
        privacy: "Privacy Policy",
        "data-deletion": "Data Deletion",
    },
};

export type LegalDocState = "published" | "draft" | "missing";

type DocLike = Pick<LegalDocument, "slug" | "language" | "status" | "currentVersion">;

/** Rows of `?language=all` share a slug, so a row is keyed by slug and language. */
export function legalDocKey(slug: string, language: LegalLanguage): string {
    return `${slug}:${language}`;
}

export function findLegalDoc<T extends DocLike>(
    docs: readonly T[],
    slug: string,
    language: LegalLanguage,
): T | null {
    return docs.find((d) => d.slug === slug && d.language === language) ?? null;
}

/** Slugs in the order the backend returned them (slug ascending). */
export function legalSlugs(docs: readonly DocLike[]): string[] {
    const seen: string[] = [];
    for (const d of docs) if (!seen.includes(d.slug)) seen.push(d.slug);
    return seen;
}

export function legalDocState(doc: DocLike | null): LegalDocState {
    if (!doc) return "missing";
    // Publishing is the only way to leave DRAFT and it always bumps the version.
    return String(doc.status) === "PUBLISHED" && doc.currentVersion > 0 ? "published" : "draft";
}

/** Short badge text for a (slug, language) pair: "v3", "taslak", "yok". */
export function legalStateBadge(doc: DocLike | null): string {
    const state = legalDocState(doc);
    if (state === "published") return `v${doc!.currentVersion}`;
    return state === "draft" ? "taslak" : "yok";
}

/** Tab label of a slug: the Turkish title, else any title, else the slug. */
export function legalTabTitle(docs: readonly LegalDocument[], slug: string): string {
    return (
        findLegalDoc(docs, slug, FALLBACK_LEGAL_LANGUAGE)?.title ??
        docs.find((d) => d.slug === slug)?.title ??
        slug
    );
}

export function defaultLegalTitle(slug: string, language: LegalLanguage): string {
    return DEFAULT_TITLES[language]?.[slug] ?? "";
}

/** What the app shows to users whose app language is `language`. */
export type ServedText =
    | { kind: "own"; version: number }
    | { kind: "fallback"; language: LegalLanguage; version: number }
    | { kind: "none" };

export function servedText(docs: readonly DocLike[], slug: string, language: LegalLanguage): ServedText {
    const own = findLegalDoc(docs, slug, language);
    if (legalDocState(own) === "published") return { kind: "own", version: own!.currentVersion };
    if (language !== FALLBACK_LEGAL_LANGUAGE) {
        const fallback = findLegalDoc(docs, slug, FALLBACK_LEGAL_LANGUAGE);
        if (legalDocState(fallback) === "published") {
            return { kind: "fallback", language: FALLBACK_LEGAL_LANGUAGE, version: fallback!.currentVersion };
        }
    }
    return { kind: "none" };
}

export type NoticeTone = "ok" | "warn" | "error";

export interface LegalNotice {
    tone: NoticeTone;
    title: string;
    body: string;
}

/**
 * The status line above the editor: is this language live, a draft or
 * missing, and what does the app show its users meanwhile.
 */
export function legalLanguageNotice(
    docs: readonly DocLike[],
    slug: string,
    language: LegalLanguage,
): LegalNotice {
    const name = LEGAL_LANGUAGE_NAMES[language];
    const state = legalDocState(findLegalDoc(docs, slug, language));
    const served = servedText(docs, slug, language);
    const audience = `Uygulama dili ${name} olan kullanıcılar`;

    if (served.kind === "own") {
        const others = LEGAL_LANGUAGES.filter(
            (other) => other !== language && servedText(docs, slug, other).kind === "fallback",
        );
        const extra =
            language === FALLBACK_LEGAL_LANGUAGE && others.length > 0
                ? ` ${others.map((o) => LEGAL_LANGUAGE_NAMES[o]).join(", ")} sürüm yayında olmadığı için o dildeki kullanıcılar da bu metni görür.`
                : "";
        return {
            tone: "ok",
            title: `${name} sürüm yayında (v${served.version})`,
            body: `${audience} yayınlanmış son sürümü görür. Kaydedilen taslak, Yayınla'ya basılana kadar uygulamaya yansımaz.${extra}`,
        };
    }

    const title =
        state === "missing"
            ? `${name} sürüm yok`
            : `${name} sürüm taslak, hiç yayınlanmadı`;

    if (served.kind === "fallback") {
        const fallbackName = LEGAL_LANGUAGE_NAMES[served.language];
        return {
            tone: "warn",
            title,
            body: `${audience} şu an ${fallbackName} metni (v${served.version}) görür. ${
                state === "missing" ? "Oluşturup yayınladığında" : "Yayınladığında"
            } ${name} metin gösterilmeye başlar.`,
        };
    }

    // Nothing to serve: no published text in this language and no Turkish one to fall back on.
    const fallbackName = LEGAL_LANGUAGE_NAMES[FALLBACK_LEGAL_LANGUAGE];
    if (language !== FALLBACK_LEGAL_LANGUAGE) {
        return {
            tone: "error",
            title,
            body: `${fallbackName} sürüm de yayında olmadığı için ${audience.charAt(0).toLowerCase()}${audience.slice(1)} bu belgeyi göremez.`,
        };
    }
    const nobody = LEGAL_LANGUAGES.every((other) => servedText(docs, slug, other).kind === "none");
    return {
        tone: "error",
        title,
        body: nobody
            ? `Uygulama bu belgeyi hiçbir kullanıcıya gösteremez. ${name} sürüm yayınlanınca kendi dilinde yayında sürüm olmayan herkes ${name} metni görür.`
            : `${audience} bu belgeyi göremez.`,
    };
}

/**
 * Has the saved draft moved on from the latest published version?
 * `null` when it cannot be told: never published, or the history did not load.
 */
export function hasUnpublishedChanges(
    doc: Pick<LegalDocument, "title" | "contentMd" | "currentVersion"> | null,
    latest: Pick<LegalDocumentVersion, "title" | "contentMd" | "version"> | null | undefined,
): boolean | null {
    if (!doc || doc.currentVersion === 0 || !latest || latest.version !== doc.currentVersion) return null;
    return latest.title !== doc.title || latest.contentMd !== doc.contentMd;
}

export interface ContentIssue {
    id: string;
    message: string;
    count: number;
}

// Things the shipped texts must not contain (the backend content spec rejects
// the same list): the retired support address, the removed payment provider,
// and the characters the UI text rules forbid. Escapes keep this file clean.
const CONTENT_RULES: { id: string; pattern: RegExp; message: string }[] = [
    {
        id: "old-email",
        pattern: /destek@sesly\.app/gi,
        message: "Eski destek adresi destek@sesly.app geçiyor. Doğru adres info@sesly.io.",
    },
    {
        id: "stripe",
        pattern: /\bstripe\b/gi,
        message:
            "Stripe geçiyor. Ödemeler yalnızca Google Play Billing ve Apple uygulama içi satın alma ile alınıyor.",
    },
    {
        id: "em-dash",
        pattern: /\u2014/g,
        message: "Uzun tire var. Kısa tire, virgül ya da yeni bir cümle kullan.",
    },
    {
        id: "ellipsis",
        pattern: /\u2026/g,
        message: "Tek karakterlik üç nokta var. Üç ayrı nokta yaz.",
    },
    {
        id: "arrow",
        pattern: /[\u2190-\u21FF\u27F0-\u27FF\u2900-\u297F]/g,
        message: "Ok işareti var. Yerine kelime kullan.",
    },
    {
        id: "emoji",
        pattern: /\p{Extended_Pictographic}/gu,
        message: "Emoji var. Yasal metinde emoji kullanılmaz.",
    },
];

/** Problems in a title + markdown pair, in rule order. Empty when the text is clean. */
export function legalContentIssues(title: string, contentMd: string): ContentIssue[] {
    const text = `${title}\n${contentMd}`;
    const issues: ContentIssue[] = [];
    for (const rule of CONTENT_RULES) {
        const count = text.match(rule.pattern)?.length ?? 0;
        if (count > 0) issues.push({ id: rule.id, message: rule.message, count });
    }
    return issues;
}

/** "14.10.2026 09:30". Empty for a missing or broken date. */
export function formatLegalDate(iso: string | null | undefined): string {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("tr-TR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}
