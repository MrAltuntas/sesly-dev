import React from 'react';
import { useTranslation } from 'react-i18next';

type Lang = 'tr' | 'en';

/** TR / EN switch drawn like the app's SegmentedControl: a well with the active pill on a lip. */
const LanguageSwitch: React.FC<{ className?: string }> = ({ className }) => {
  const { t, i18n } = useTranslation();
  const current: Lang = (i18n.language || 'tr').startsWith('en') ? 'en' : 'tr';

  const option = (lng: Lang) => {
    const active = current === lng;
    return (
      <button
        type="button"
        lang={lng}
        onClick={() => {
          if (!active) void i18n.changeLanguage(lng);
        }}
        aria-pressed={active}
        aria-label={t(lng === 'tr' ? 'language.trName' : 'language.enName')}
        className={`h-9 min-w-[44px] rounded-sm px-3 text-[13px] font-extrabold transition-colors ${
          active ? 'bg-surface2 text-text shadow-lip-sm' : 'text-text3 hover:text-text'
        }`}
      >
        {t(`language.${lng}`)}
      </button>
    );
  };

  return (
    <div
      role="group"
      aria-label={t('language.switcherLabel')}
      className={`flex items-center gap-1 rounded-md bg-surface p-1 pb-[6px] ${className ?? ''}`}
    >
      {option('tr')}
      {option('en')}
    </div>
  );
};

export default LanguageSwitch;
