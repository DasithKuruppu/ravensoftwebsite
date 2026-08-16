import { useEffect, useState } from 'react';
import { useT } from '../i18n/index.jsx';
import {
  onUpdateReady,
  applyUpdate,
  onInstallReady,
  install,
  dismissInstall,
} from '../pwa.js';

/**
 * The two things a service worker needs a page for: offering an update it has
 * already downloaded, and offering the install Chrome no longer offers itself.
 *
 * Both sit at the bottom, above everything, and neither blocks the app. An
 * update is offered rather than applied because applying it means reloading,
 * and reloading a half-typed daily entry to pick up a styling change would be a
 * poor trade.
 */
export function UpdatePrompt() {
  const { t } = useT();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onUpdateReady(setReady);
  }, []);

  if (!ready) return null;

  return (
    <Bar>
      <span className="text-slate-200">{t('update.ready')}</span>
      <button
        type="button"
        onClick={applyUpdate}
        className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-ink-950 transition hover:bg-accent-dim"
      >
        {t('update.action')}
      </button>
    </Bar>
  );
}

/**
 * Chrome stopped showing an install banner of its own on Android in version 76 —
 * it hands the decision to the page and displays nothing. Without this the
 * tracker is installable and appears not to be.
 */
export function InstallPrompt() {
  const { t } = useT();
  const [kind, setKind] = useState(null);

  useEffect(() => {
    onInstallReady(setKind);
  }, []);

  if (!kind) return null;

  return (
    <Bar>
      <img src="/icon-192.png?v=2" alt="" width="28" height="28" className="h-7 w-7 shrink-0 rounded-md" />
      <span className="min-w-0 break-words text-slate-200">
        {kind === 'ios' ? t('install.ios') : t('install.ready')}
      </span>
      {kind === 'prompt' && (
        <button
          type="button"
          onClick={install}
          className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-ink-950 transition hover:bg-accent-dim"
        >
          {t('install.action')}
        </button>
      )}
      <button
        type="button"
        onClick={dismissInstall}
        aria-label={t('install.dismiss')}
        className="shrink-0 text-slate-500 transition hover:text-slate-200"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
          <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </Bar>
  );
}

function Bar({ children }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center p-3 sm:bottom-0 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border border-ink-700 bg-ink-850 px-4 py-3 text-sm shadow-lg">
        {children}
      </div>
    </div>
  );
}
