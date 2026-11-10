import React from 'react';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';
import { APP_CONFIG } from '../../constants';

export interface SEOProps {
  /** i18n key resolving to the <title> and og:title (e.g. `seo.home.title`). */
  titleKey: string;
  /** i18n key resolving to the description / og:description. */
  descriptionKey: string;
  /** Path relative to the site root, e.g. `/` or `/privacy`. */
  path: string;
  /**
   * Absolute URL to the OG / Twitter preview image. Defaults to
   * `APP_CONFIG.ogImageUrl` (the Sesly logo served from /public/image).
   */
  imageUrl?: string;
  /** Locale override, defaults to i18n.language. Used when a fetched document dictates its own lang. */
  locale?: string;
  /** Emit `<meta name="robots" content="noindex, nofollow" />` when true. */
  noIndex?: boolean;
}

/**
 * Reusable per-page SEO component. Renders title/description/OG/Twitter/canonical
 * tags into <head> via react-helmet-async. Later `<Helmet>` instances (e.g. a
 * legal page overriding with its fetched document title) win per-tag-key, which
 * is the standard Helmet behaviour we rely on.
 */
export const SEO: React.FC<SEOProps> = ({
  titleKey,
  descriptionKey,
  path,
  imageUrl,
  locale,
  noIndex,
}) => {
  const { t, i18n } = useTranslation();
  const canonical = `${APP_CONFIG.baseUrl}${path}`;
  const lang = (locale ?? i18n.language ?? 'tr').split('-')[0];
  const title = t(titleKey);
  const description = t(descriptionKey);
  const image = imageUrl ?? APP_CONFIG.ogImageUrl;

  return (
    <Helmet>
      <html lang={lang} />
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta httpEquiv="content-language" content={lang} />
      <link rel="canonical" href={canonical} />

      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={APP_CONFIG.appName} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:locale" content={lang === 'tr' ? 'tr_TR' : 'en_US'} />
      {image && <meta property="og:image" content={image} />}

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      {image && <meta name="twitter:image" content={image} />}

      {noIndex && <meta name="robots" content="noindex, nofollow" />}
    </Helmet>
  );
};

export default SEO;
