import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, Link } from 'react-router-dom';
import {
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
  useAuth,
  useUser,
} from '@clerk/clerk-react';
import Book from './pages/Book.jsx';
import Bookings from './pages/Bookings.jsx';
import Admin from './pages/Admin.jsx';
import { setTokenSource } from './api.js';
import { useT, LanguageToggle } from './i18n/index.jsx';
import {
  onUpdateReady,
  applyUpdate,
  onInstallReady,
  install,
  dismissInstall,
} from './pwa.js';

/** Emails allowed the admin tab. The API enforces this too — this only hides it. */
const OWNER_EMAILS = (import.meta.env.VITE_OWNER_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export default function App({ clerkMissing = false }) {
  return (
    <div className="min-h-dvh flex flex-col">
      {!clerkMissing && <TokenBridge />}
      <Header clerkMissing={clerkMissing} />

      {/* The container is wide; each page narrows itself. Book needs the room
          for a map beside the form, the others read better at a column width. */}
      <main className="flex-1 w-full mx-auto max-w-6xl px-4 py-6 sm:py-10">
        {clerkMissing && (
          <div className="mx-auto max-w-3xl">
            <ClerkBanner />
          </div>
        )}
        <Routes>
          <Route path="/" element={<Book clerkMissing={clerkMissing} />} />
          <Route path="/bookings" element={<Narrow><Bookings clerkMissing={clerkMissing} /></Narrow>} />
          <Route path="/bookings/:ref" element={<Narrow><Bookings clerkMissing={clerkMissing} /></Narrow>} />
          <Route path="/admin" element={<Narrow><Admin clerkMissing={clerkMissing} /></Narrow>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <Footer />
      <InstallPrompt />
      <UpdatePrompt />
    </div>
  );
}

/**
 * "A new version is available."
 *
 * Offered rather than applied. Updating means reloading, and reloading a
 * half-filled booking form to pick up a CSS tweak would be a poor trade — so
 * the customer decides when. It sits above the mobile price bar and below a
 * modal, out of the way until it is wanted.
 */
/**
 * The install offer.
 *
 * Chrome hands the page an event and shows nothing itself, so without this the
 * site is installable and looks like it is not. Dismissal is remembered — an
 * install bar that returns on every visit is an advert.
 *
 * iOS gets words instead of a button. Safari has no install API at all; the
 * only route is Share → Add to Home Screen, so the only useful thing to do is
 * say so.
 */
function InstallPrompt() {
  const { t } = useT();
  const [kind, setKind] = useState(null);

  useEffect(() => {
    onInstallReady(setKind);
  }, []);

  if (!kind) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border border-line bg-paper px-4 py-3 text-sm shadow-lg">
        <img src="/icon-192.png?v=2" alt="" width="32" height="32" className="h-8 w-8 shrink-0 rounded-lg" />
        <span className="min-w-0 break-words">
          {kind === 'ios' ? t('install.ios') : t('install.ready')}
        </span>
        {kind === 'prompt' && (
          <button type="button" onClick={install} className="btn-primary shrink-0 px-3 py-1.5 text-xs">
            {t('install.action')}
          </button>
        )}
        <button
          type="button"
          onClick={dismissInstall}
          aria-label={t('install.dismiss')}
          className="shrink-0 text-ink-400 transition hover:text-ink-900"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function UpdatePrompt() {
  const { t } = useT();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onUpdateReady(setReady);
  }, []);

  if (!ready) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-line bg-ink-900 px-4 py-3 text-sm text-white shadow-lg">
        <span>{t('update.ready')}</span>
        <button
          type="button"
          onClick={applyUpdate}
          className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-canvas"
        >
          {t('update.action')}
        </button>
      </div>
    </div>
  );
}

/**
 * Hands Clerk's token getter to the API client.
 *
 * A component rather than a hook call in `App` because it must sit inside the
 * provider, and rendering nothing keeps it out of the layout entirely.
 */
function TokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setTokenSource(getToken);
  }, [getToken]);
  return null;
}

function Narrow({ children }) {
  return <div className="mx-auto max-w-3xl">{children}</div>;
}

function Header({ clerkMissing }) {
  const { t } = useT();
  return (
    // Sticky: on a phone the booking form is long, and reaching "My trips"
    // should not mean scrolling back past five sections to find the bar.
    <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur">
      {/* The same max width and padding as <main>, so the logo starts on exactly
          the line the content beneath it does. */}
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Link to="/" className="flex min-w-0 items-center gap-2">
          <Logo />
          {/* "Ravensoft" as it is written; "Fleet" in the brand green, so the
              wordmark reads as the logo's own. */}
          <span className="truncate text-base font-semibold tracking-tight sm:text-lg">
            Ravensoft<span className="text-brand"> Fleet</span>
          </span>
        </Link>

        <nav className="ml-auto flex shrink-0 items-center gap-0.5 text-sm">
          <LanguageToggle className="mr-1" />
          {/* The logo already goes home, so this tab earns its space only where
              there is space to earn. */}
          <span className="hidden sm:contents">
            <Tab to="/">{t('nav.book')}</Tab>
          </span>
          {!clerkMissing && (
            <SignedIn>
              <Tab to="/bookings">
                <span className="sm:hidden">{t('nav.trips.short')}</span>
                <span className="hidden sm:inline">{t('nav.trips')}</span>
              </Tab>
              <OwnerTab />
              <span className="pl-1 sm:pl-2">
                <UserButton />
              </span>
            </SignedIn>
          )}
          {!clerkMissing && (
            <SignedOut>
              <SignInButton mode="modal">
                <button type="button" className="btn-quiet px-3 py-2">
                  {t('nav.signIn')}
                </button>
              </SignInButton>
            </SignedOut>
          )}
        </nav>
      </div>
    </header>
  );
}

/** Shown only to the owner — and only as a convenience; the API decides. */
function OwnerTab() {
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (!email || !OWNER_EMAILS.includes(email)) return null;
  return <Tab to="/admin">Admin</Tab>;
}

function Tab({ to, children }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `whitespace-nowrap rounded-lg px-2.5 py-1.5 transition sm:px-3 ${
          isActive ? 'bg-brand-soft text-brand-dark font-medium' : 'text-ink-500 hover:text-ink-900'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

function ClerkBanner() {
  return (
    <div className="card border-warn/30 bg-warn/5 p-4 mb-6 text-sm">
      <p className="font-medium text-warn">Sign-in is not configured</p>
      <p className="mt-1 text-ink-700">
        Prices work, but nobody can book until <code>VITE_CLERK_PUBLISHABLE_KEY</code> is set at
        build time. See <code>deploy.md</code>.
      </p>
    </div>
  );
}

function Footer() {
  const { t } = useT();
  return (
    <footer className="border-t border-line bg-paper">
      {/* Matched to the header and to <main>: one margin down the whole page. */}
      <div className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-1 px-4 py-5 text-xs text-ink-500">
        <span>{t('footer.where')}</span>
        <span className="sm:ml-auto">{t('footer.note')}</span>
      </div>
    </footer>
  );
}

/**
 * The Ravensoft shield, served from `src/static` (Vite's publicDir).
 *
 * A plain <img> with a fixed box rather than an import: the file is a square
 * PNG, the header height is fixed, and reserving the space up front stops the
 * wordmark jumping sideways when the image decodes on a slow connection.
 */
function Logo() {
  return (
    <img
      src="/RavensoftLogo.png"
      alt=""
      width="28"
      height="28"
      className="h-7 w-7 shrink-0 object-contain"
    />
  );
}
