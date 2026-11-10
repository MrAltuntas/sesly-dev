import React from 'react';
import { useTranslation } from 'react-i18next';
import { LegalPage } from '../components/LegalPage';

const PrivacyPolicy: React.FC = () => {
  const { t } = useTranslation();
  return (
    <LegalPage
      slug="privacy"
      fallbackTitle={t('legal.fallbackTitle.privacy')}
      seoTitleKey="seo.privacy.title"
      seoDescriptionKey="seo.privacy.description"
      seoPath="/privacy"
    />
  );
};

export default PrivacyPolicy;
