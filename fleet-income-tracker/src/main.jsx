import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { I18nProvider } from './i18n/index.jsx';
import './index.css';
import { registerServiceWorker, watchInstallability } from './pwa.js';

registerServiceWorker();
// Before first paint: Chrome fires beforeinstallprompt early, and a listener
// attached afterwards never hears it.
watchInstallability();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </I18nProvider>
  </React.StrictMode>,
);
