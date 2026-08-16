import { useState } from 'react';
import { api } from '../api.js';
import { useT, LanguageToggle } from '../i18n/index.jsx';

export default function Login({ onLogin }) {
  const { t } = useT();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.login(username, password);
      onLogin(res.token, res.role);
    } catch (err) {
      setError(err.status === 401 ? t('login.badCredentials') : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-100">
              Ravensoft<span className="text-slate-400"> Fleet</span>
            </h1>
            <p className="text-sm text-slate-400 mt-1">{t('login.tagline')}</p>
          </div>
          {/* The switch has to be reachable before sign-in: a driver handed a
              phone with the app already installed meets this screen first. */}
          <LanguageToggle className="shrink-0 mt-0.5" />
        </div>

        <div className="space-y-3">
          <div className="grid gap-1">
            <label className="label" htmlFor="username">{t('login.username')}</label>
            <input
              id="username"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('login.usernamePlaceholder')}
            />
          </div>
          <div className="grid gap-1">
            <label className="label" htmlFor="password">{t('login.password')}</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary w-full" disabled={busy || !username || !password}>
          {busy ? t('login.signingIn') : t('login.signIn')}
        </button>
      </form>
    </div>
  );
}
