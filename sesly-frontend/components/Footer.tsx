import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { APP_CONFIG, NAVIGATION_LINKS } from '../constants';
import { LogoGooglePlaystoreIcon, MailOutlineIcon } from './Icons';

const linkClass = 'text-text2 transition-colors hover:text-text';

const Footer: React.FC = () => {
  const { t } = useTranslation();

  return (
    <footer className="border-t border-bar-line bg-bar">
      <div className="wrap py-12 md:py-16">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            <Link to="/" className="inline-flex items-center gap-2.5 rounded-sm" aria-label={t('nav.logoAlt')}>
              <img
                src="/image/sesly-icon-96.webp"
                alt=""
                width={40}
                height={40}
                loading="lazy"
                className="h-10 w-10 rounded-[11px] shadow-lip-sm"
              />
              <span className="font-display text-[28px] leading-none text-text pt-1">Sesly</span>
            </Link>
            <p className="mt-4 max-w-xs text-[15px] leading-relaxed text-text2">{t('footer.tagline')}</p>
          </div>

          <div>
            <h2 className="text-lg text-text">{t('footer.columns.app')}</h2>
            <ul className="mt-3 space-y-2.5 text-[15px]">
              {NAVIGATION_LINKS.map((link) => (
                <li key={link.path}>
                  <Link to={{ pathname: '/', hash: `#${link.path}` }} className={linkClass}>
                    {t(link.labelKey)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-lg text-text">{t('footer.columns.legal')}</h2>
            <ul className="mt-3 space-y-2.5 text-[15px]">
              <li><Link to="/privacy" className={linkClass}>{t('nav.privacyPolicy')}</Link></li>
              <li><Link to="/terms" className={linkClass}>{t('nav.terms')}</Link></li>
              <li><Link to="/data-deletion" className={linkClass}>{t('nav.dataDeletion')}</Link></li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg text-text">{t('footer.columns.contact')}</h2>
            <ul className="mt-3 space-y-2.5 text-[15px]">
              <li>
                <a href={`mailto:${APP_CONFIG.contactEmail}`} className={`${linkClass} inline-flex items-center gap-2`}>
                  <MailOutlineIcon className="h-5 w-5 text-action" />
                  {APP_CONFIG.contactEmail}
                </a>
              </li>
              <li>
                <a href={APP_CONFIG.playStoreLink} rel="noopener" className={`${linkClass} inline-flex items-center gap-2`}>
                  <LogoGooglePlaystoreIcon className="h-5 w-5 text-action" />
                  Google Play
                </a>
              </li>
              <li className="text-text3">{t('store.iosSoon')}</li>
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-bar-line pt-6 text-sm text-text3">
          {t('footer.copyright', { year: new Date().getFullYear() })}
        </div>
      </div>
    </footer>
  );
};

export default Footer;
