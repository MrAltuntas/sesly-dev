export interface NavLink {
  /** i18n translation key (e.g. `nav.features`). */
  labelKey: string;
  /** Id of the home page section the link scrolls to. */
  path: string;
}

export interface AppConfig {
  appName: string;
  contactEmail: string;
  appStoreLink?: string;
  playStoreLink: string;
  /** Canonical base URL used for SEO meta tags (no trailing slash). */
  baseUrl: string;
  /** Fully-qualified URL to the default OG/Twitter share image. */
  ogImageUrl: string;
}
