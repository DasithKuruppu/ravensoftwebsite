/**
 * Service worker registration, and noticing when a new version is ready.
 *
 * The browser downloads a new worker on its own, but then it *waits* — by
 * design, so a page mid-booking never has its JavaScript swapped underneath it.
 * Without something to notice that waiting worker and act on it, an installed
 * app can sit on the version it was installed with for as long as it is never
 * fully closed, which on a phone can be weeks.
 *
 * So: watch for a waiting worker, tell the app, and when the customer accepts,
 * ask it to take over and reload once it has.
 */
let onUpdate = () => {};
let waitingWorker = null;

/** Called by App with a setter that shows the update prompt. */
export function onUpdateReady(fn) {
  onUpdate = fn || (() => {});
  // A worker may already be waiting by the time the UI is listening.
  if (waitingWorker) onUpdate(true);
}

/** Accept the update: hand over, then reload once the new worker is in charge. */
export function applyUpdate() {
  if (!waitingWorker) {
    window.location.reload();
    return;
  }
  // `controllerchange` fires once the waiting worker has claimed the page.
  // Reloading before that would just re-run the old assets.
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
    once: true,
  });
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;

  window.addEventListener('load', async () => {
    let registration;
    try {
      registration = await navigator.serviceWorker.register('/sw.js');
    } catch {
      // Installability is a nicety; a browser that refuses it still gets a
      // working booking form.
      return;
    }

    const note = (worker) => {
      if (!worker) return;
      // Only when one is already controlling the page. On a first-ever visit
      // the worker installs and activates immediately, and telling somebody
      // their brand-new install has an update would be nonsense.
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        waitingWorker = worker;
        onUpdate(true);
      }
    };

    note(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      installing?.addEventListener('statechange', () => note(installing));
    });

    // An installed app is often resumed rather than launched, so `load` may not
    // fire again for days. Check on the way back to the app, throttled so a
    // customer flicking between apps is not re-checking every second.
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastCheck < 60_000) return;
      lastCheck = Date.now();
      registration.update().catch(() => {});
    });
  });
}

/* ────────────────────────────── installing ────────────────────────────── */

/**
 * Chrome stopped showing an install banner of its own on Android in version 76.
 * The browser still decides *whether* a site may be installed, but it now hands
 * that decision to the page as an event and shows nothing itself. A site with no
 * install button is therefore installable and yet appears not to be — which is
 * exactly what "the install option never came back after I uninstalled" looks
 * like from the outside.
 *
 * So the event is captured, kept, and offered through our own button.
 */
let deferredPrompt = null;
let onInstallable = () => {};
const DISMISSED = 'fleet-tracker:install-dismissed';

/** True when the app is already running from a home screen. */
export function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

/** iOS never fires the event and never prompts; it only ever offers Share → Add. */
export function isIosSafari() {
  const ua = window.navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export function onInstallReady(fn) {
  onInstallable = fn || (() => {});
  if (deferredPrompt) onInstallable('prompt');
  else if (isIosSafari() && !isStandalone() && !dismissed()) onInstallable('ios');
}

function dismissed() {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
}

export function dismissInstall() {
  try {
    localStorage.setItem(DISMISSED, '1');
  } catch {
    /* a browser that refuses storage just gets asked again next visit */
  }
  onInstallable(null);
}

/** Show the browser's own install dialog. Only ever called from a click. */
export async function install() {
  if (!deferredPrompt) return;
  const prompt = deferredPrompt;
  // The event is single-use: once prompt() has been called it cannot be reused,
  // so it is cleared before awaiting rather than after.
  deferredPrompt = null;
  onInstallable(null);
  try {
    await prompt.prompt();
    await prompt.userChoice;
  } catch {
    /* dismissed, or fired twice — nothing to do either way */
  }
}

export function watchInstallability() {
  if (isStandalone()) return;

  window.addEventListener('beforeinstallprompt', (event) => {
    // Without this Chrome may show its own UI on some surfaces, and the page
    // loses the ability to choose the moment.
    event.preventDefault();
    deferredPrompt = event;
    if (!dismissed()) onInstallable('prompt');
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    onInstallable(null);
  });
}
