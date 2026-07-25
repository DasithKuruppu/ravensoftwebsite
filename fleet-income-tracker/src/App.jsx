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
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
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
    </div>
  );
}

function Header({ role, isOwner, onLogout }) {
  const navigate = useNavigate();
  const tabs = [
    { to: '/', label: 'Dashboard' },
    { to: '/log', label: 'Daily log' },
    ...(isOwner
      ? [
          { to: '/validate', label: 'GPS check' },
          { to: '/settings', label: 'Settings' },
        ]
      : []),
  ];

  return (
    <header className="border-b border-ink-800 bg-ink-900/60 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-6">
        <button
          onClick={() => navigate('/')}
          className="font-semibold tracking-tight text-slate-100 shrink-0"
        >
          Ravensoft<span className="text-accent"> Fleet</span>
        </button>
        <nav className="flex gap-1 overflow-x-auto">
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
        <div className="ml-auto flex items-center gap-3 shrink-0">
          <span className="text-xs px-2 py-1 rounded bg-ink-800 text-slate-400 uppercase tracking-wider">
            {role}
          </span>
          <button onClick={onLogout} className="text-sm text-slate-400 hover:text-slate-200">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
