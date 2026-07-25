import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { api, getToken, getRole, setSession } from './api.js';
import Dashboard from './pages/Dashboard.jsx';
import DailyLog from './pages/DailyLog.jsx';
import Validate from './pages/Validate.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import { currentMonth } from './format.js';

export default function App() {
  const [role, setRole] = useState(() => (getToken() ? getRole() : null));
  const [month, setMonth] = useState(currentMonth);

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
  }, []);

  if (!role) return <Login onLogin={handleLogin} />;

  const isOwner = role === 'owner';

  return (
    <div className="min-h-screen">
      <Header role={role} isOwner={isOwner} onLogout={handleLogout} />
      {/* Bottom padding clears the mobile tab bar, which is position: fixed. */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-28 sm:pb-6">
        <Routes>
          <Route path="/" element={<Dashboard month={month} setMonth={setMonth} isOwner={isOwner} />} />
          <Route path="/log" element={<DailyLog month={month} setMonth={setMonth} isOwner={isOwner} />} />
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
  const tabs = navTabs(isOwner);
  return (
    <nav
      className="sm:hidden fixed bottom-0 inset-x-0 z-20 border-t border-ink-800
                 bg-ink-900/95 backdrop-blur"
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
                isActive ? 'text-accent' : 'text-slate-500 active:text-slate-300'
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
function navTabs(isOwner) {
  return [
    { to: '/', label: 'Dashboard', short: 'Dashboard', icon: 'dashboard' },
    { to: '/log', label: 'Daily log', short: 'Log', icon: 'log' },
    ...(isOwner
      ? [
          { to: '/validate', label: 'GPS check', short: 'GPS', icon: 'gps' },
          { to: '/settings', label: 'Settings', short: 'Settings', icon: 'settings' },
        ]
      : []),
  ];
}

function Header({ role, isOwner, onLogout }) {
  const navigate = useNavigate();
  const tabs = navTabs(isOwner);

  return (
    <header className="border-b border-ink-800 bg-ink-900/60 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4 sm:gap-6">
        <button
          onClick={() => navigate('/')}
          className="font-semibold tracking-tight text-slate-100 shrink-0"
        >
          Ravensoft<span className="text-accent"> Fleet</span>
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
          <span className="text-[10px] sm:text-xs px-2 py-1 rounded bg-ink-800 text-slate-400 uppercase tracking-wider">
            {role}
          </span>
          <button
            onClick={onLogout}
            className="text-sm text-slate-400 hover:text-slate-200 whitespace-nowrap"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
