import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { MarkdownBlock } from './MarkdownBlock';
import { ChevronBackIcon, InformationCircleOutlineIcon } from './Icons';
import { fetchLegalDocument, LegalDocument, LegalLanguage } from '../lib/legalClient';
import { SEO } from '../src/components/SEO';

interface LegalPageProps {
  /** Backend slug (`privacy`, `tos`, `data-deletion`). */
  slug: string;
  /** Title shown while loading or if the fetch fails, before `doc.title` is known. */
  fallbackTitle: string;
  /** i18n key for the default SEO title (rendered before/while the doc loads). */
  seoTitleKey: string;
  /** i18n key for the default SEO description. */
  seoDescriptionKey: string;
  /** Canonical path for this legal page (e.g. `/privacy`). */
  seoPath: string;
}

/**
 * Shared shell for all legal pages. Fetches the markdown from the backend in
 * the site language (the backend falls back to Turkish while a translation is
 * unpublished), handles loading and error states, and renders the body through
 * <MarkdownBlock />.
 */
export const LegalPage: React.FC<LegalPageProps> = ({
  slug,
  fallbackTitle,
  seoTitleKey,
  seoDescriptionKey,
  seoPath,
}) => {
  const { t, i18n } = useTranslation();
  const [doc, setDoc] = useState<LegalDocument | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const language: LegalLanguage = (i18n.language || 'tr').startsWith('en') ? 'en' : 'tr';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchLegalDocument(slug, language);
      setDoc(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('legal.unknownError'));
    } finally {
      setLoading(false);
    }
  }, [slug, language, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const title = doc?.title ?? fallbackTitle;
  const dateLocale = language === 'en' ? 'en-GB' : 'tr-TR';
  // The backend serves Turkish while the English text is unpublished.
  const servedOtherLanguage = !!doc && (doc.language ?? 'tr') !== language;
  const publishedLabel = doc?.publishedAt
    ? new Date(doc.publishedAt).toLocaleDateString(dateLocale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <div className="py-10 md:py-16">
      {/* Baseline SEO meta (i18n defaults), emitted immediately so crawlers
          that don't wait for the async fetch still see useful tags. */}
      <SEO titleKey={seoTitleKey} descriptionKey={seoDescriptionKey} path={seoPath} />
      {/* Once the backend document has loaded, override the title (and publish
          date) with the fetched values. Later Helmet entries win per tag key. */}
      {doc && !error && (
        <Helmet>
          <title>{`${doc.title} - Sesly`}</title>
          {doc.publishedAt && <meta property="article:modified_time" content={doc.publishedAt} />}
          {doc.publishedAt && <meta property="og:updated_time" content={doc.publishedAt} />}
        </Helmet>
      )}
      <div className="wrap max-w-[860px]">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-sm py-1 pr-2 text-[15px] font-extrabold text-text2 transition-colors hover:text-text"
        >
          <ChevronBackIcon className="h-5 w-5" />
          {t('legal.backHome')}
        </Link>

        <div className="card mt-5 px-5 py-8 sm:px-10 sm:py-10">
          <h1 className="text-[34px] leading-[1.25] text-text sm:text-[42px]">{title}</h1>

          {publishedLabel && !loading && !error && (
            <p className="mt-2 flex flex-wrap gap-x-3 text-[15px] text-text3">
              <span>{t('legal.lastUpdated')} {publishedLabel}</span>
              {doc?.version != null && <span className="whitespace-nowrap">{t('legal.version', { version: doc.version })}</span>}
            </p>
          )}

          {servedOtherLanguage && !loading && !error && (
            <p className="mt-5 flex gap-3 rounded-md bg-surface2 p-4 text-[15px] text-text2">
              <InformationCircleOutlineIcon className="mt-0.5 h-5 w-5 flex-none text-text3" />
              <span>{t('legal.turkishOnly')}</span>
            </p>
          )}

          <div className="mt-8 border-t border-line pt-8">
            {loading && <LegalSkeleton />}

            {!loading && error && (
              <div className="py-8 text-center" role="alert">
                <p className="text-[17px] text-text">{t('legal.error')}</p>
                <p className="mt-1 text-[14px] text-text3">{error}</p>
                <button type="button" className="btn btn-md btn-secondary mt-6" onClick={load}>
                  {t('legal.retry')}
                </button>
              </div>
            )}

            {!loading && !error && doc && (
              <div lang={doc.language ?? 'tr'}>
                <MarkdownBlock content={doc.contentMd} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/** Text-shaped bones while the document loads (no spinner). */
const LegalSkeleton: React.FC = () => {
  const { t } = useTranslation();
  const bone = 'h-3.5 rounded-xs bg-surface2';
  return (
    <div className="animate-pulse space-y-4" role="status" aria-label={t('legal.loading')}>
      <div className={`${bone} h-5 w-1/3`} />
      <div className={`${bone} w-full`} />
      <div className={`${bone} w-11/12`} />
      <div className={`${bone} w-10/12`} />
      <div className={`${bone} mt-8 h-5 w-1/4`} />
      <div className={`${bone} w-full`} />
      <div className={`${bone} w-9/12`} />
      <div className={`${bone} w-11/12`} />
    </div>
  );
};

export default LegalPage;
