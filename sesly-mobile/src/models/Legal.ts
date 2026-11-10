/**
 * Legal Document Models with Strict TypeScript Typing
 *
 * Mirrors the backend `PublicLegalDocumentDto` surfaced by:
 *   - GET /legal?language=tr|en
 *   - GET /legal/:slug?language=tr|en
 *
 * A document is asked for in a language (absent: tr). While a language has
 * no published copy the backend serves the Turkish one, and `language` on
 * the response says which language the text is really in.
 *
 * `contentMd` is the published markdown snapshot (uses `##` headings,
 * `-` bullets, `**bold**`, etc.), never HTML.
 *
 * The `fromCache` flag is added by the client service when a document is
 * served from the copy saved on the device (LegalService reads that copy
 * first and refreshes it in the background).
 */

// ============================================================================
// Legal Document Slug (backend-seeded set)
// ============================================================================

export const LEGAL_SLUGS = ['tos', 'privacy', 'data-deletion'] as const;
export type LegalSlug = typeof LEGAL_SLUGS[number];

export function isLegalSlug(value: unknown): value is LegalSlug {
  return (
    typeof value === 'string' &&
    (LEGAL_SLUGS as readonly string[]).includes(value)
  );
}

// ============================================================================
// Language
// ============================================================================

/** The languages a document is asked for and served in (the UI languages). */
export type LegalLanguage = 'tr' | 'en';

/** The backend's language when none is named, and its fallback. */
export const DEFAULT_LEGAL_LANGUAGE: LegalLanguage = 'tr';

/**
 * The served language of a response: 'en' is English, anything else
 * (also a missing field, from an older backend or an older saved copy) is
 * Turkish, the only language served before documents had languages.
 */
export function parseLegalLanguage(raw: unknown): LegalLanguage {
  return raw === 'en' ? 'en' : DEFAULT_LEGAL_LANGUAGE;
}

/**
 * Whether a document asked for in `requested` came back in Turkish instead
 * (its text in that language is not published yet). Never true for a
 * Turkish request.
 */
export function isLegalLanguageFallback(requested: LegalLanguage, served: LegalLanguage): boolean {
  return requested !== served && served === DEFAULT_LEGAL_LANGUAGE;
}

// ============================================================================
// Legal Document Model
// ============================================================================

export interface LegalDocument {
  readonly slug: string;
  /** The language of the text, which may differ from the one asked for. */
  readonly language: LegalLanguage;
  readonly title: string;
  readonly contentMd: string;
  readonly version: number;
  readonly publishedAt: string;
  readonly fromCache?: boolean;
}

/**
 * A read of one document: the document, or the backend's 404 for a slug
 * that has no published version (no retry can change that).
 */
export type LegalResult =
  | { readonly status: 'document'; readonly doc: LegalDocument }
  | { readonly status: 'unpublished' };

/** How the background refresh of a saved copy ended. */
export type LegalRefresh = LegalResult | { readonly status: 'failed'; readonly error: unknown };

// ============================================================================
// Parsers
// ============================================================================

export function parseLegalDocumentFromJSON(raw: unknown): LegalDocument {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid legal document data: expected object');
  }

  const data = raw as Record<string, unknown>;

  if (typeof data.slug !== 'string' || !data.slug) {
    throw new Error('Invalid legal document data: missing or invalid slug');
  }
  if (typeof data.title !== 'string' || !data.title) {
    throw new Error('Invalid legal document data: missing or invalid title');
  }
  if (typeof data.contentMd !== 'string') {
    throw new Error(
      'Invalid legal document data: missing or invalid contentMd',
    );
  }

  const version =
    typeof data.version === 'number' && Number.isFinite(data.version)
      ? data.version
      : 1;

  const publishedAtRaw = data.publishedAt;
  const publishedAt =
    typeof publishedAtRaw === 'string'
      ? publishedAtRaw
      : publishedAtRaw instanceof Date
        ? publishedAtRaw.toISOString()
        : '';

  return {
    slug: data.slug,
    language: parseLegalLanguage(data.language),
    title: data.title,
    contentMd: data.contentMd,
    version,
    publishedAt,
    fromCache: data.fromCache === true,
  };
}

export function parseLegalDocumentsFromJSON(raw: unknown): LegalDocument[] {
  if (!Array.isArray(raw)) {
    throw new Error('Invalid legal documents data: expected array');
  }

  const docs: LegalDocument[] = [];
  for (const item of raw) {
    try {
      docs.push(parseLegalDocumentFromJSON(item));
    } catch (err) {
      console.warn('Failed to parse legal document:', err);
    }
  }
  return docs;
}
