import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HelmetProvider } from 'react-helmet-async';
import Header from './components/Header';
import Footer from './components/Footer';

// Lazy load pages for better performance
const Home = lazy(() => import('./pages/Home'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const TermsOfService = lazy(() => import('./pages/TermsOfService'));
const DataDeletion = lazy(() => import('./pages/DataDeletion'));
// Firebase email action links (password reset, email verification). Lazy, so
// the Firebase SDK only loads on this route.
const AuthAction = lazy(() => import('./pages/AuthAction'));

// Suspense fallback: an empty block of the page's height, no spinner.
const PageLoader = () => <div className="min-h-[70vh]" aria-hidden="true" />;

// Scroll to the top on a route change, or to the section named by the hash.
const ScrollManager = () => {
  const { pathname, hash } = useLocation();

  React.useEffect(() => {
    if (hash) {
      const id = decodeURIComponent(hash.slice(1));
      // The page may still be loading (lazy route): try for a short while.
      let tries = 0;
      const tick = () => {
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ block: 'start' });
          return;
        }
        if (tries++ < 20) window.setTimeout(tick, 50);
      };
      tick();
      return;
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);

  return null;
};

const App: React.FC = () => {
  const { i18n } = useTranslation();

  React.useEffect(() => {
    // Keep the <html lang> attribute in sync with the active locale so
    // screen readers and search crawlers pick up the language switch.
    const lang = (i18n.language || 'tr').split('-')[0];
    document.documentElement.lang = lang;
  }, [i18n.language]);

  return (
    <HelmetProvider>
      <BrowserRouter>
        <ScrollManager />
        <div className="flex min-h-screen flex-col bg-bg text-text">
          <Header />
          <main id="main" className="flex-grow" tabIndex={-1}>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/privacy" element={<PrivacyPolicy />} />
                <Route path="/terms" element={<TermsOfService />} />
                <Route path="/data-deletion" element={<DataDeletion />} />
                <Route path="/auth/action" element={<AuthAction />} />
                {/* Catch all route - redirect to home if route not found */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </main>
          <Footer />
        </div>
      </BrowserRouter>
    </HelmetProvider>
  );
};

export default App;
