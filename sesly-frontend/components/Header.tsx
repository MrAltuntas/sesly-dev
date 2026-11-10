import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { APP_CONFIG, NAVIGATION_LINKS } from '../constants';
import { CloseIcon, LogoGooglePlaystoreIcon, MenuOutlineIcon } from './Icons';
import LanguageSwitch from './LanguageSwitch';

const Header: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { t } = useTranslation();
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the mobile menu on navigation and on Escape.
  useEffect(() => setIsOpen(false), [location.pathname, location.hash]);
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setIsOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  const solid = scrolled || isOpen;

  return (
    <header
      className={`sticky top-0 z-50 w-full transition-colors duration-200 ${
        solid ? 'bg-bg/90 backdrop-blur-md border-b border-bar-line' : 'bg-bg border-b border-transparent'
      }`}
    >
      <a href="#main" className="sr-only-focusable absolute left-4 top-3 z-50 btn btn-md btn-secondary">
        {t('nav.skip')}
      </a>
      <div className="wrap flex h-16 items-center justify-between gap-3">
        <Link to="/" className="flex items-center gap-2.5 rounded-sm" aria-label={t('nav.logoAlt')}>
          <img
            src="/image/sesly-icon-96.webp"
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 rounded-[10px] shadow-lip-sm"
          />
          <span className="font-display text-[26px] leading-none text-text pt-1">Sesly</span>
        </Link>

        <nav aria-label={t('nav.main')} className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAVIGATION_LINKS.map((link) => (
              <li key={link.path}>
                <Link
                  to={{ pathname: '/', hash: `#${link.path}` }}
                  className="block rounded-sm px-3 py-2 text-[15px] font-extrabold text-text2 transition-colors hover:bg-surface hover:text-text"
                >
                  {t(link.labelKey)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <LanguageSwitch className="hidden sm:flex" />
          <a
            href={APP_CONFIG.playStoreLink}
            className="btn btn-md btn-primary hidden sm:inline-flex"
            rel="noopener"
          >
            <LogoGooglePlaystoreIcon />
            {t('nav.download')}
          </a>
          <button
            type="button"
            className="md:hidden flex h-11 w-11 items-center justify-center rounded-md bg-surface text-text shadow-lip-sm active:translate-y-[2px] active:shadow-none transition-transform"
            onClick={() => setIsOpen((v) => !v)}
            aria-expanded={isOpen}
            aria-controls="mobile-menu"
            aria-label={isOpen ? t('nav.closeMenu') : t('nav.openMenu')}
          >
            {isOpen ? <CloseIcon className="h-6 w-6" /> : <MenuOutlineIcon className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {isOpen && (
        <div id="mobile-menu" className="md:hidden border-t border-bar-line bg-bg">
          <nav aria-label={t('nav.main')} className="wrap py-3">
            <ul className="flex flex-col">
              {NAVIGATION_LINKS.map((link) => (
                <li key={link.path}>
                  <Link
                    to={{ pathname: '/', hash: `#${link.path}` }}
                    className="block rounded-md px-3 py-3 text-lg font-extrabold text-text hover:bg-surface"
                    onClick={() => setIsOpen(false)}
                  >
                    {t(link.labelKey)}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-bar-line pt-4">
              <LanguageSwitch />
              <a href={APP_CONFIG.playStoreLink} className="btn btn-md btn-primary" rel="noopener">
                <LogoGooglePlaystoreIcon />
                {t('nav.download')}
              </a>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
};

export default Header;
