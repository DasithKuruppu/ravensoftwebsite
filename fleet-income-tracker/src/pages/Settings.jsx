import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { calculatePay } from '../../shared/commission.mjs';
import { money, amount } from '../format.js';
import ChargerEditor from '../components/ChargerEditor.jsx';
import CostEditor from '../components/CostEditor.jsx';

const CHECK_REVENUE = 406789.2;
const CHECK_EXPECTED = 121394.6;

const FIELDS = [
  { key: 'base', label: 'Tier 1 — base pay (LKR)', step: '1000' },
  { key: 'bandStart', label: 'Tier 2 — band start (LKR)', step: '10000' },
  { key: 'bandEnd', label: 'Tier 2 — band end (LKR)', step: '10000' },
  { key: 'bandRate', label: 'Tier 2 — rate (0–1)', step: '0.01' },
  { key: 'topRate', label: 'Tier 3 — rate above band end (0–1)', step: '0.01' },
];

export default function Settings() {
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setSaved(s);
        setForm(s);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const next = await api.saveSettings({
        ...form,
        startDate: form.startDate || null,
        capitalInvested: form.capitalInvested === '' ? null : Number(form.capitalInvested),
        alternativeRatePct: Number(form.alternativeRatePct) || 0,
        leasedPercent: Number(form.leasedPercent) || 0,
        driverName: (form.driverName || '').trim() || 'Driver',
        base: Number(form.base),
        bandStart: Number(form.bandStart),
        bandEnd: Number(form.bandEnd),
        bandRate: Number(form.bandRate),
        topRate: Number(form.topRate),
      });
      setSaved(next);
      setForm(next);
      setStatus('Saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!form) {
    return error ? <Banner>{error}</Banner> : <p className="text-slate-500 text-sm">Loading…</p>;
  }

  // Live check against the same calc the API uses, with the *unsaved* form values.
  const live = calculatePay(CHECK_REVENUE, {
    base: Number(form.base),
    bandStart: Number(form.bandStart),
    bandEnd: Number(form.bandEnd),
    bandRate: Number(form.bandRate),
    topRate: Number(form.topRate),
  });
  const matches = live.total === CHECK_EXPECTED;

  return (
    <div className="max-w-4xl space-y-5">
      {error && <Banner>{error}</Banner>}

      <form onSubmit={save} className="card space-y-4">
        <h2 className="label">Commission plan</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <div key={f.key} className="grid gap-1">
              <label className="label" htmlFor={f.key}>
                {f.label}
              </label>
              <input
                id={f.key}
                type="number"
                step={f.step}
                className="num"
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              />
            </div>
          ))}
        </div>

        <div className="grid gap-1 max-w-xs">
          <label className="label" htmlFor="driverName">
            Driver name
          </label>
          <input
            id="driverName"
            value={form.driverName || ''}
            onChange={(e) => setForm({ ...form, driverName: e.target.value })}
            placeholder="Driver"
          />
          <p className="text-xs text-slate-500">
            Used throughout the app, and accepted as a sign-in name as well as “driver”.
          </p>
        </div>

        <div className="grid gap-1 max-w-xs">
          <label className="label" htmlFor="startDate">
            Start date
          </label>
          <input
            id="startDate"
            type="date"
            value={form.startDate || ''}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          />
          <p className="text-xs text-slate-500">
            The month containing this date is prorated to the days actually worked — base
            and both band edges scale down. Every later month runs the plan at full value.
            Leave blank to treat every month as complete.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save plan'}
          </button>
          {saved && (
            <button type="button" className="btn" onClick={() => setForm(saved)} disabled={busy}>
              Reset
            </button>
          )}
          {status && <span className="text-sm text-accent">{status}</span>}
        </div>
      </form>

      <div className={`card border ${matches ? 'border-accent/30' : 'border-warn/40'}`}>
        <h2 className="label mb-2">Live check</h2>
        <p className="text-sm text-slate-400">
          At revenue <span className="num text-slate-200">{money(CHECK_REVENUE)}</span> this plan
          pays{' '}
          <span className={`num ${matches ? 'text-accent' : 'text-warn'}`}>
            {money(live.total)}
          </span>
          .
        </p>
        <p className="text-xs mt-1">
          {matches ? (
            <span className="text-accent">Matches the reference figure of {money(CHECK_EXPECTED)}.</span>
          ) : (
            <span className="text-warn">
              Reference figure is {money(CHECK_EXPECTED)} — this plan differs by{' '}
              <span className="num">{amount(live.total - CHECK_EXPECTED)}</span>.
            </span>
          )}
        </p>
        <dl className="mt-3 space-y-1.5 border-t border-ink-800 pt-3">
          {live.tiers.map((t) => (
            <div key={t.key} className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-slate-400">{t.label}</dt>
              <dd className="num text-slate-300">{amount(t.amount)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Capital, for the return-on-capital comparison. */}
      <div className="card">
        <h2 className="label mb-3">Vehicle capital</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="grid gap-1">
            <label className="label" htmlFor="capitalInvested">
              What the vehicle cost (LKR)
            </label>
            <input
              id="capitalInvested"
              type="number"
              step="10000"
              className="num"
              value={form.capitalInvested ?? ''}
              onChange={(e) => setForm({ ...form, capitalInvested: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <label className="label" htmlFor="leasedPercent">
              Share financed by lease (%)
            </label>
            <input
              id="leasedPercent"
              type="number"
              step="5"
              className="num"
              value={form.leasedPercent ?? ''}
              onChange={(e) => setForm({ ...form, leasedPercent: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <label className="label" htmlFor="alternativeRatePct">
              Fixed deposit rate to compare against (%)
            </label>
            <input
              id="alternativeRatePct"
              type="number"
              step="0.5"
              className="num"
              value={form.alternativeRatePct ?? ''}
              onChange={(e) => setForm({ ...form, alternativeRatePct: e.target.value })}
            />
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Used to compare what the car returns against leaving the money on deposit. Saved with the
          plan above.
        </p>
      </div>

      <CostEditor />

      <ChargerEditor />

      {saved?.csvMapping && (
        <div className="card">
          <h2 className="label mb-2">Saved CSV column mapping</h2>
          <dl className="space-y-1.5">
            {Object.entries(saved.csvMapping).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 text-sm">
                <dt className="text-slate-400">{k}</dt>
                <dd className="num text-slate-300">{v || '—'}</dd>
              </div>
            ))}
          </dl>
          <button
            className="btn text-xs mt-3"
            onClick={async () => {
              const next = await api.saveSettings({ ...saved, csvMapping: null });
              setSaved(next);
              setForm(next);
            }}
          >
            Forget mapping
          </button>
        </div>
      )}
    </div>
  );
}

function Banner({ children }) {
  return (
    <p className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2">
      {children}
    </p>
  );
}
