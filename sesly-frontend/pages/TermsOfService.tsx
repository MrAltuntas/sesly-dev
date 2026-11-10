import React from 'react';
import { useTranslation } from 'react-i18next';
import { LegalPage } from '../components/LegalPage';

const TermsOfService: React.FC = () => {
  const { t } = useTranslation();
  return (
    <LegalPage
      slug="tos"
      fallbackTitle={t('legal.fallbackTitle.tos')}
      seoTitleKey="seo.tos.title"
      seoDescriptionKey="seo.tos.description"
      seoPath="/terms"
    />
  );
};

export default TermsOfService;
