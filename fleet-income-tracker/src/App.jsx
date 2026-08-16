import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import {
  api,
  getToken,
  getRole,
  setSession,
  getDriverName,
  getDriverNameSi,
  rememberDriverName,
} from './api.js';
import Dashboard from './pages/Dashboard.jsx';
import DailyLog from './pages/DailyLog.jsx';
import Validate from './pages/Validate.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import Payslip from './pages/Payslip.jsx';
import { currentMonth } from './format.js';
import { useT, useLocale, LanguageToggle } from './i18n/index.jsx';
import { UpdatePrompt, InstallPrompt } from './components/PwaPrompts.jsx';

export default function App() {
  const [role, setRole] = useState(() => (getToken() ? getRole() : null));
  const [month, setMonth] = useState(currentMonth);
  const [driverName, setDriverName] = useState(getDriverName);
  const [driverNameSi, setDriverNameSi] = useState(getDriverNameSi);
  const [locale] = useLocale();
  // Whichever spelling the language being read has. Chosen at render rather than
  // at fetch, so flipping the toggle renames the header immediately.
  const shownName = locale === 'si' && driverNameSi ? driverNameSi : driverName;

  // The API client fires this whenever a call comes back 401 (expired token).
  useEffect(() => {
    const onLogout = () => setRole(null);
    window.addEventListener('fleet:logout', onLogout);
    return () => window.removeEventListener('fleet:logout', onLogout);
  }, []);

  const handleLogin = useCallback((token, nextRole) => {
    setSession(token, nextRole);
    setRole(nextRole);
  }, []);

  const handleLogout = useCallback(() => {
    setSession(null, null);
    setRole(null);
    setDriverName('');
    setDriverNameSi('');
  }, []);

  /** The summary is the only call that knows the name; hold on to it. */
  const handleDriverName = useCallback((name, nameSi) => {
    setDriverName(name || '');
    setDriverNameSi(nameSi || '');
    rememberDriverName(name, nameSi);
  }, []);

  if (!role)
    return (
      <>
        <Login onLogin={handleLogin} />
        <InstallPrompt />
        <UpdatePrompt />
      </>
    );

  const isOwner = role === 'owner';

  return (
    <div className="min-h-screen">
      <Header
        role={role === 'driver' && shownName ? shownName : role}
        isOwner={isOwner}
        onLogout={handleLogout}
      />
      {/* Bottom padding clears the mobile tab bar, which is position: fixed. */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-28 sm:pb-6">
        <Routes>
          <Route
            path="/"
            element={
              <Dashboard
                month={month}
                setMonth={setMonth}
                isOwner={isOwner}
                onDriverName={handleDriverName}
              />
            }
          />
          <Route path="/log" element={<DailyLog month={month} setMonth={setMonth} isOwner={isOwner} />} />
          {/* His own pay document. Not in the tab bar: it is something you go
              and fetch at the end of a month, not a screen you live on. */}
          <Route path="/payslip" element={<Payslip month={month} />} />
          <Route
            path="/validate"
            element={isOwner ? <Validate month={month} setMonth={setMonth} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/settings"
            element={isOwner ? <Settings /> : <Navigate to="/" replace />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <MobileNav isOwner={isOwner} />
      <InstallPrompt />
      <UpdatePrompt />
    </div>
  );
}

/**
 * Tab bar for small screens.
 *
 * The tabs used to sit in the top bar alongside the brand, role badge and sign
 * out, which on a phone meant six things in one 56px row and a horizontal
 * scroll to reach the last tab. Here they get the full width at the bottom of
 * the screen, within thumb reach and with no scrolling at any count.
 */
function MobileNav({ isOwner }) {
  const { t } = useT();
  const tabs = navTabs(isOwner, t);
  return (
    <nav
      className="no-print sm:hidden fixed bottom-0 inset-x-0 z-20 border-t border-ink-800
                 bg-ink-950 backdrop-blur"
      // Keep the tabs clear of the iPhone home indicator.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] transition-colors ${
                isActive ? 'text-slate-100' : 'text-slate-400 active:text-slate-200'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <TabIcon name={t.icon} active={isActive} />
                <span className="leading-none">{t.short}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function TabIcon({ name, active }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: active ? 2.2 : 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };
  switch (name) {
    case 'dashboard':
      return (
        <svg {...common}>
          <path d="M3 13h6V3H3zM15 21h6V11h-6zM3 21h6v-4H3zM15 7h6V3h-6z" />
        </svg>
      );
    case 'log':
      return (
        <svg {...common}>
          <path d="M4 4h16v16H4z" />
          <path d="M8 9h8M8 13h8M8 17h5" />
        </svg>
      );
    case 'gps':
      return (
        <svg {...common}>
          <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 5 8.9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9.5a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
  }
}

/** Single source of truth for the tabs, shared by both navs. */
function navTabs(isOwner, t) {
  return [
    { to: '/', label: t('nav.dashboard'), short: t('nav.dashboard.short'), icon: 'dashboard' },
    { to: '/log', label: t('nav.log'), short: t('nav.log.short'), icon: 'log' },
    ...(isOwner
      ? [
          { to: '/validate', label: t('nav.gps'), short: t('nav.gps.short'), icon: 'gps' },
          { to: '/settings', label: t('nav.settings'), short: t('nav.settings.short'), icon: 'settings' },
        ]
      : []),
  ];
}

function Header({ role, isOwner, onLogout }) {
  const navigate = useNavigate();
  const { t } = useT();
  const tabs = navTabs(isOwner, t);

  return (
    /* Opaque, and the top of the stack. It was `bg-ink-900/60`, so anything
       scrolling underneath — the month nav, the partial-month banner — showed
       through the bar and read as two things overlapping. z-30 keeps it above
       every card and above the bottom tab bar. */
    // `no-print`: the bar carries sign-out, the language switch and the tabs —
    // all of them controls, none of them meaningful on a printed statement.
    <header className="no-print border-b border-ink-800 bg-ink-950 sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4 sm:gap-6">
        <button
          onClick={() => navigate('/')}
          className="font-semibold tracking-tight text-slate-100 shrink-0"
        >
          Ravensoft<span className="text-slate-400"> Fleet</span>
        </button>
        {/* Desktop tabs. On phones these move to the bottom bar instead. */}
        <nav className="hidden sm:flex gap-1">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
                  isActive ? 'bg-ink-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Before the name, not after: the switch is the one control here that
              a driver who cannot read the rest of the header still has to find. */}
          <LanguageToggle />
          {/* Who is signed in. For the driver that is his name rather than his
              job title — it is the one place on his screens a name belongs,
              because it answers "whose phone is this logged into", not "how is
              Chandima doing". Truncated rather than allowed to push the sign-out
              button off a 380px header. */}
          <span className="text-xs px-2 py-1 rounded bg-ink-800 text-slate-300 max-w-[9rem] truncate">
            {/* A driver's own name is not a translatable string; a role is. */}
            {role === 'driver' || role === 'owner' ? t(`role.${role}`) : role}
          </span>
          <button
            onClick={onLogout}
            className="text-sm text-slate-400 hover:text-slate-200 whitespace-nowrap"
          >
            {t('header.signOut')}
          </button>
        </div>
      </div>
    </header>
  );
}
