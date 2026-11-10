import React from 'react';
import ReactDOM from 'react-dom/client';
// Self-hosted fonts, the app's faces: Baloo 2 600 (display) and Nunito 700 / 800
// (body, labels). Latin + Latin Extended only, which covers every Turkish letter.
import '@fontsource/baloo-2/latin-600.css';
import '@fontsource/baloo-2/latin-ext-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-ext-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/nunito/latin-ext-800.css';
import App from './App';
import './src/i18n';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
