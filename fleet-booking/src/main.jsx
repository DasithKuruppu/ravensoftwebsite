import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App.jsx';
import { I18nProvider } from './i18n/index.jsx';
import { registerServiceWorker, watchInstallability } from './pwa.js';
import './index.css';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

/**
 * Without a Clerk key the app still runs and still quotes — only the sign-in
 * and booking half is missing. That matters during setup: a build with the key
 * forgotten should show a page with a clear banner, not a blank screen from a
 * provider that threw before anything rendered.
 */
function Root() {
  if (!PUBLISHABLE_KEY) {
    return (
      <I18nProvider>
        <BrowserRouter>
          <App clerkMissing />
        </BrowserRouter>
      </I18nProvider>
    );
  }
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      afterSignOutUrl="/"
      appearance={{
        variables: {
          colorPrimary: '#0f6f4f',
          borderRadius: '0.5rem',
        },
      }}
    >
      <I18nProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </I18nProvider>
    </ClerkProvider>
  );
}

registerServiceWorker();
// Must run before first paint: Chrome fires beforeinstallprompt early, and a
// listener attached afterwards never hears it.
watchInstallability();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
