import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, monthLabel, currentMonth } from '../format.js';

/**
 * Cash the owner hands the driver to start a month with.
 *
 * A float, not income and not pay: it is the owner's own money, parked in the
 * driver's pocket so he can buy a wash or pay parking without being out of
 * pocket himself. It settles with everything else at month end — he hands it
 * back with the takings and is given a fresh one — so the cash card counts it
 * inside what is owed rather than beside it.
 *
 * Kept per MONTH rather than as one standing figure. It is a decision taken each
 * month, and a single number would silently apply itself to months it was never
 * handed over in, quietly inflating what the driver appeared to owe for every
 * month in the record.
 */
export default function StartingCash() {
  const [settings, setSettings] = useState(null);
  const [month, setMonth] = useState(currentMonth);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setSettings(s);
        setValue(String(s.cashFloats?.[currentMonth()] ?? ''));
      })
      .catch((e) => setError(e.message));
  }, []);

  function pickMonth(next) {
    setMonth(next);
    setStatus('');
    setValue(String(settings?.cashFloats?.[next] ?? ''));
  }

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const cashFloats = { ...(settings.cashFloats || {}) };
      const amount = Number(value);
      // Zero and blank both mean "no float this month", and clearing has to be
      // possible — a float entered by mistake must not be permanent.
      if (Number.isFinite(amount) && amount > 0) cashFloats[month] = amount;
      else delete cashFloats[month];

      const saved = await api.saveSettings({ ...settings, cashFloats });
      setSettings(saved);
      setStatus('Saved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const entries = Object.entries(settings?.cashFloats || {}).sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <section className="card">
      <h2 className="label">Starting cash</h2>
      <p className="text-xs text-slate-400 mt-1 leading-relaxed">
        Cash handed to the driver at the start of a month, so he can pay for small things without
        being out of pocket. It is a float, not pay: it is added to what he is holding and settles
        with the takings at month end. Set it for each month it is actually given — leave a month
        blank and nothing is counted.
      </p>

      <div className="flex items-end gap-2 flex-wrap mt-3">
        <div className="grid gap-1">
          <label className="label" htmlFor="floatMonth">
            Month
          </label>
          <input
            id="floatMonth"
            type="month"
            value={month}
            onChange={(e) => pickMonth(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <label className="label" htmlFor="floatAmount">
            Amount (LKR)
          </label>
          <input
            id="floatAmount"
            type="number"
            step="500"
            min="0"
            inputMode="decimal"
            className="num"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0"
          />
        </div>
        <button className="btn btn-primary" onClick={save} disabled={busy || !settings}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {status && <span className="text-sm text-slate-100">{status}</span>}
      </div>

      {error && <p className="text-sm text-danger mt-3">{error}</p>}

      {entries.length > 0 && (
        <div className="mt-4 pt-3 border-t border-ink-700">
          <div className="label mb-2">Floats on record</div>
          <dl className="space-y-1.5">
            {entries.map(([m, amount]) => (
              <div key={m} className="flex items-baseline justify-between gap-4">
                <dt className="text-sm text-slate-300">{monthLabel(`${m}-01`)}</dt>
                <dd className="num shrink-0 text-slate-100">{money(amount)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
