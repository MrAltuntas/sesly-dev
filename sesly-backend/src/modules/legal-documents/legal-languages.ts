/**
 * Languages a legal document can be written in. One `LegalDocument` row per
 * (slug, language). Turkish is the canonical, legally reviewed text: a
 * request for a language without a published document is served the
 * published Turkish one (see `LegalDocumentsService`).
 *
 * Adding a language: add the code here, write the texts, publish them from
 * the admin panel. No migration is needed (the column is a plain string).
 */
export const LEGAL_DOCUMENT_LANGUAGES = ['tr', 'en'] as const;

export type LegalDocumentLanguage = (typeof LEGAL_DOCUMENT_LANGUAGES)[number];

/** Language of every row written before languages existed, and of a request without one. */
export const DEFAULT_LEGAL_DOCUMENT_LANGUAGE: LegalDocumentLanguage = 'tr';

/** `language=all` on the admin list returns every language. */
export const ALL_LEGAL_DOCUMENT_LANGUAGES = 'all' as const;

export const LEGAL_DOCUMENT_LANGUAGE_MESSAGE = `Geçersiz belge dili. Geçerli diller: ${LEGAL_DOCUMENT_LANGUAGES.join(', ')}.`;

export const ADMIN_LEGAL_LIST_LANGUAGE_MESSAGE = `Geçersiz belge dili. Geçerli değerler: ${[
  ...LEGAL_DOCUMENT_LANGUAGES,
  ALL_LEGAL_DOCUMENT_LANGUAGES,
].join(', ')}.`;

/** Order of the languages in a list: Turkish first, then the order above. */
export function legalLanguageRank(language: string): number {
  const index = (LEGAL_DOCUMENT_LANGUAGES as readonly string[]).indexOf(language);
  return index === -1 ? LEGAL_DOCUMENT_LANGUAGES.length : index;
}
