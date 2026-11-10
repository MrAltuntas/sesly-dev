import { AppConfig, NavLink } from './types';

// Canonical public URL for the marketing site. Can be overridden at build time
// via `VITE_SITE_URL` (e.g. for preview deployments); otherwise we fall back to
// the production apex on sesly.io.
const RESOLVED_BASE_URL = (
  import.meta.env.VITE_SITE_URL || 'https://sesly.io'
).replace(/\/$/, '');

export const APP_CONFIG: AppConfig = {
  appName: 'Sesly',
  contactEmail: 'info@sesly.io',
  // iOS is not released yet; the site shows an "iOS yakında" note instead of a link.
  appStoreLink: undefined,
  playStoreLink: 'https://play.google.com/store/apps/details?id=com.sesly',
  baseUrl: RESOLVED_BASE_URL,
  ogImageUrl: `${RESOLVED_BASE_URL}/image/og-sesly.png`,
};

// Sections of the home page. Label values are i18n keys resolved via
// `t(link.labelKey)` at render time; `path` is the section id.
export const NAVIGATION_LINKS: NavLink[] = [
  { labelKey: 'nav.howItWorks', path: 'nasil-calisir' },
  { labelKey: 'nav.features', path: 'ozellikler' },
  { labelKey: 'nav.plans', path: 'planlar' },
  { labelKey: 'nav.faq', path: 'sorular' },
];
