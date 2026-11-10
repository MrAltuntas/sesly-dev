import React from 'react';
import { useTranslation } from 'react-i18next';
import { LegalPage } from '../components/LegalPage';

const DataDeletion: React.FC = () => {
  const { t } = useTranslation();
  return (
    <LegalPage
      slug="data-deletion"
      fallbackTitle={t('legal.fallbackTitle.dataDeletion')}
      seoTitleKey="seo.dataDeletion.title"
      seoDescriptionKey="seo.dataDeletion.description"
      seoPath="/data-deletion"
    />
  );
};

export default DataDeletion;
