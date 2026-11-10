/**
 * Legal document API client for the public marketing site.
 *
 * Talks to the backend's public `/legal` endpoints (same ones mobile uses) to
 * fetch markdown-backed privacy policy, terms of service, and data-deletion
 * content. Kept intentionally small: plain `fetch`, no axios.
 */

/** Languages the backend serves legal documents in. */
export type LegalLanguage = 'tr' | 'en';

export interface LegalDocument {
  slug: string;
  /**
   * Language of the text actually returned. The backend falls back to the
   * published Turkish document while the requested language is unpublished.
   */
  language: LegalLanguage;
  title: string;
  /** Published markdown content (snapshot of the latest published version). */
  contentMd: string;
  /** Version number of the snapshot being returned. */
  version: number;
  /** ISO-8601 timestamp of publication. */
  publishedAt: string;
}

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  'https://api.sesly.io';

export async function fetchLegalDocument(
  slug: string,
  language: LegalLanguage,
): Promise<LegalDocument> {
  const res = await fetch(`${API_BASE}/legal/${slug}?language=${language}`);
  if (!res.ok) throw new Error(`Legal fetch failed: ${res.status}`);
  return (await res.json()) as LegalDocument;
}

export async function fetchLegalList(language: LegalLanguage): Promise<LegalDocument[]> {
  const res = await fetch(`${API_BASE}/legal?language=${language}`);
  if (!res.ok) throw new Error(`Legal list fetch failed: ${res.status}`);
  return (await res.json()) as LegalDocument[];
}
