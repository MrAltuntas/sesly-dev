import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import trCommon from './tr/common.json';
import enCommon from './en/common.json';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      tr: { common: trCommon },
      en: { common: enCommon },
    },
    fallbackLng: 'tr',
    supportedLngs: ['tr', 'en'],
    defaultNS: 'common',
    ns: ['common'],
    // Treat empty strings (the E5 Haiku agent hasn't filled them yet) as
    // missing so that i18next's fallbackLng kicks in and the user sees
    // Turkish instead of a blank label.
    returnEmptyString: false,
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
