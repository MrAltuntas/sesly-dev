import type { CoverCredit } from "@/types/api.types";

// Pure helpers of the cover uploads (story list thumbnails, review view,
// bulk cover upload, import preview). No React and no runtime imports, so the
// file can be unit tested with `node --test` (see covers.test.mjs).

/** Picture types the backend accepts as a cover. */
export const COVER_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;
export const COVER_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
/** Same limit as the backend (POST /admin/stories/:id/cover). */
export const COVER_MAX_BYTES = 10 * 1024 * 1024;

const CREDIT_SUFFIX = ".credit.json";

interface NamedFile {
    name: string;
}

/** File name without folders. */
export function baseName(name: string): string {
    return name.split(/[\\/]/).pop() ?? name;
}

export function isCoverImageName(name: string): boolean {
    const ext = baseName(name).split(".").pop()?.toLowerCase() ?? "";
    return (COVER_IMAGE_EXTENSIONS as readonly string[]).includes(ext);
}

export function isCreditFileName(name: string): boolean {
    return baseName(name).toLowerCase().endsWith(CREDIT_SUFFIX);
}

/**
 * The key a file is matched by, the same way the backend folds it: no
 * extension (".credit.json" counts as one), lower case, Turkish letters
 * folded, spaces and underscores as hyphens. "Temiz Kedicik Tırmık.png" is
 * "temiz-kedicik-tirmik".
 */
export function coverKeyFromFileName(name: string): string {
    const file = baseName(name).trim();
    const stem = isCreditFileName(file) ? file.slice(0, -CREDIT_SUFFIX.length) : file.replace(/\.[a-z0-9]{2,5}$/i, "");
    return stem
        .toLocaleLowerCase("tr")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/ı/g, "i")
        .replace(/[\s_]+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

export interface CoverFilePair<F extends NamedFile> {
    key: string;
    image: F;
    /** `<slug>.credit.json` next to the image, when one was dropped too. */
    credit: F | null;
}

export interface PairedCoverFiles<F extends NamedFile> {
    pairs: CoverFilePair<F>[];
    /** Credit files without a picture of the same name. */
    unusedCredits: F[];
    /** Neither a picture nor a credit file, or a second picture for the same key. */
    ignored: Array<{ file: F; reason: string }>;
}

/** Puts each picture together with its credit file, in file name order. */
export function pairCoverFiles<F extends NamedFile>(files: F[]): PairedCoverFiles<F> {
    const images = new Map<string, F>();
    const credits = new Map<string, F>();
    const ignored: Array<{ file: F; reason: string }> = [];
    const sorted = [...files].sort((a, b) => baseName(a.name).localeCompare(baseName(b.name)));
    for (const file of sorted) {
        const key = coverKeyFromFileName(file.name);
        if (!key) {
            ignored.push({ file, reason: "Dosya adından anahtar çıkmadı." });
        } else if (isCreditFileName(file.name)) {
            if (credits.has(key)) ignored.push({ file, reason: "Bu ad için ikinci künye dosyası." });
            else credits.set(key, file);
        } else if (isCoverImageName(file.name)) {
            if (images.has(key)) ignored.push({ file, reason: "Bu ad için ikinci resim (ilk dosya kullanılır)." });
            else images.set(key, file);
        } else {
            ignored.push({ file, reason: "Resim (JPEG, PNG, WebP) ya da .credit.json değil." });
        }
    }
    const pairs = [...images.entries()].map(([key, image]) => ({ key, image, credit: credits.get(key) ?? null }));
    const unusedCredits = [...credits.entries()].filter(([key]) => !images.has(key)).map(([, file]) => file);
    return { pairs, unusedCredits, ignored };
}

const CREDIT_ALIASES: Record<keyof CoverCredit, string[]> = {
    illustrator: ["illustrator"],
    licenseName: ["licenseName", "licence", "license", "licenceName"],
    licenseUrl: ["licenseUrl", "licenceUrl"],
    source: ["source"],
    attribution: ["attribution"],
};

/** A credit object with only the known, non-empty text fields (null when nothing is left). */
export function normalizeCoverCredit(raw: unknown): CoverCredit | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const input = raw as Record<string, unknown>;
    const credit: CoverCredit = {};
    for (const [field, aliases] of Object.entries(CREDIT_ALIASES) as Array<[keyof CoverCredit, string[]]>) {
        const key = aliases.find((alias) => typeof input[alias] === "string" && (input[alias] as string).trim() !== "");
        if (key) credit[field] = (input[key] as string).trim();
    }
    return Object.keys(credit).length > 0 ? credit : null;
}

/** The text of a `<slug>.credit.json`, read as a credit. */
export function parseCoverCreditText(text: string): { credit: CoverCredit | null; error: string | null } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { credit: null, error: "Künye dosyası geçerli bir JSON değil." };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { credit: null, error: "Künye dosyası bir nesne olmalı." };
    }
    const credit = normalizeCoverCredit(parsed);
    return credit ? { credit, error: null } : { credit: null, error: "Künye dosyasında çizer, lisans, kaynak ya da atıf yok." };
}

/** The line the app shows after "Kapak resmi:" (same rule as the backend). */
export function coverCreditLine(credit: CoverCredit | null | undefined): string {
    if (!credit) return "";
    if (credit.attribution) return credit.attribution;
    const licence = credit.licenseName
        ? credit.licenseUrl
            ? `${credit.licenseName} (${credit.licenseUrl})`
            : credit.licenseName
        : credit.licenseUrl;
    return [credit.illustrator, licence, credit.source].filter(Boolean).join(", ");
}

/** Keys an import file item answers to: pairKey, partOf, and the pairKey without "-p<N>". */
export function importItemCoverKeys(item: Record<string, unknown>): string[] {
    const text = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
    const pairKey = text(item.pairKey);
    const keys = [pairKey, text(item.partOf), pairKey.replace(/-p\d+$/, "")].filter(Boolean);
    return [...new Set(keys)];
}

/** The key, without a leading article, and with "the-" in front (as the backend tries). */
export function coverKeyVariants(key: string): string[] {
    const bare = key.replace(/^(the|a|an)-/, "");
    return [...new Set([key, bare, `the-${bare}`].filter(Boolean))];
}

/** The picture of an import file item among the dropped files, when its name matches. */
export function findImportItemCover<F extends NamedFile>(
    item: Record<string, unknown>,
    pairs: CoverFilePair<F>[],
): CoverFilePair<F> | null {
    const byKey = new Map<string, CoverFilePair<F>>();
    for (const pair of pairs) {
        for (const variant of coverKeyVariants(pair.key)) if (!byKey.has(variant)) byKey.set(variant, pair);
    }
    for (const key of importItemCoverKeys(item)) {
        const hit = byKey.get(key);
        if (hit) return hit;
    }
    return null;
}
