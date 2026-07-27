import { useState } from 'react';
import { api } from '../api.js';
import { amount, money, rate as rateOf, dayLabel, todayLocal } from '../format.js';
import { dayKm } from '../../shared/costs.mjs';

/**
 * Logging what a charge actually cost.
 *
 * The driver writes this, and it is the only cost figure he does. He is the one
 * standing at the charger, so nobody else can record it — and the alternative is
 * what the app had before: a configured 2,600 a day, which is the same number
 * every day by construction and therefore says nothing about any particular day.
 *
 * Several sessions a day are normal: a top-up at lunch and a full charge at
 * night. Amount is the only thing required, because it is the only thing that
 * always exists — a receipt has a price, and the station name and kWh are worth
 * having but not worth blocking the entry over.
 *
 * Sessions count on the day they were PAID. Charging tonight for tomorrow's
 * driving does skew a single day, and the honest answer to that is not a guess at
 * attribution but a seven-day rate, which is what the dashboard judges on.
 */
export default function ChargeLog({ entries, onSaved, canEdit = true }) {
  const [date, setDate] = useState(todayLocal);
  const [rows, setRows] = useState([blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const entry = entries.find((e) => e.date === date);
  const existing = entry?.chargeSessions || [];
  const km = entry ? dayKm(entry) : 0;
  const dayTotal = existing.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

  function pick(nextDate) {
    setDate(nextDate);
    setStatus('');
    const found = entries.find((e) => e.date === nextDate);
    const sessions = found?.chargeSessions || [];
    setRows(sessions.length ? sessions.map((s) => ({ ...s })) : [blank()]);
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const sessions = rows
        .filter((r) => Number(r.amount) > 0)
        .map((r) => ({
          id: r.id,
          amount: Number(r.amount),
          station: r.station || '',
          kwh: r.kwh === '' || r.kwh === null || r.kwh === undefined ? null : Number(r.kwh),
        }));
      await api.saveCharging(date, sessions);
      setStatus(sessions.length ? 'Saved.' : 'Cleared.');
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="label">Charging log</h2>
        <span className="text-xs text-slate-400">what you paid to plug in</span>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        Amount is all that is needed. Sessions count on the day you paid — the dashboard judges the
        rate over seven days, so charging tonight for tomorrow's driving comes out in the wash.
      </p>

      <form onSubmit={save} className="space-y-3">
        <div className="grid gap-1 max-w-xs">
          <label className="label" htmlFor="charge-date">
            Day
          </label>
          <input
            id="charge-date"
            type="date"
            value={date}
            onChange={(e) => pick(e.target.value)}
          />
          {km > 0 && (
            <p className="text-xs text-slate-400 num">
              {amount(km)} km driven
              {dayTotal > 0 && (
                <>
                  {' · '}
                  {rateOf(dayTotal / km)} a km at {money(dayTotal)}
                </>
              )}
            </p>
          )}
        </div>

        {rows.map((row, i) => (
          <div key={row.id || i} className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
            <Field label="Amount paid (LKR)">
              <input
                type="number"
                step="10"
                min="0"
                inputMode="decimal"
                className="num w-full"
                value={row.amount ?? ''}
                onChange={(e) => patch(setRows, i, 'amount', e.target.value)}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Station (optional)">
              <input
                className="w-full"
                value={row.station ?? ''}
                onChange={(e) => patch(setRows, i, 'station', e.target.value)}
                placeholder="Keells Kottawa"
                disabled={!canEdit}
              />
            </Field>
            <Field label="kWh (optional)">
              <input
                type="number"
                step="0.1"
                min="0"
                inputMode="decimal"
                className="num w-full"
                value={row.kwh ?? ''}
                onChange={(e) => patch(setRows, i, 'kwh', e.target.value)}
                disabled={!canEdit}
              />
            </Field>
            <div className="flex items-center gap-2">
              {rows.length > 1 && canEdit && (
                <button
                  type="button"
                  className="btn btn-danger text-xs px-2 py-1"
                  onClick={() => setRows(rows.filter((_, n) => n !== i))}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}

        {canEdit && (
          <div className="flex items-center gap-2 flex-wrap">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save charging'}
            </button>
            <button type="button" className="btn" onClick={() => setRows([...rows, blank()])}>
              Add session
            </button>
            {total > 0 && (
              <span className="text-sm text-slate-300 num">
                {money(total)} for {dayLabel(date)}
              </span>
            )}
            {status && <span className="text-sm text-slate-100">{status}</span>}
          </div>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
      </form>

      {/* What is already logged this month, so a gap is visible at a glance. */}
      <LoggedDays entries={entries} onPick={pick} selected={date} />
    </div>
  );
}

/**
 * The month's logged days.
 *
 * Per km leads, because that is the figure worth judging: a big-rupee day after a
 * long shift is a good day, and ranking days by what they cost in rupees would
 * punish exactly the shifts worth having.
 */
function LoggedDays({ entries, onPick, selected }) {
  const logged = entries
    .filter((e) => (e.chargeSessions || []).length > 0)
    .map((e) => {
      const cost = e.chargeSessions.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
      const km = dayKm(e);
      return { date: e.date, cost, km, perKm: km > 0 ? cost / km : null, sessions: e.chargeSessions.length };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!logged.length) {
    return (
      <p className="text-xs text-slate-400 mt-4 pt-3 border-t border-ink-700">
        Nothing logged this month yet. Days without a session fall back to the configured rate and
        are marked as estimates.
      </p>
    );
  }

  return (
    <div className="mt-4 pt-3 border-t border-ink-700">
      <div className="label mb-2">Logged this month</div>
      <dl className="space-y-1.5">
        {logged.map((d) => (
          <div key={d.date} className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-slate-300 min-w-0">
              <button
                type="button"
                onClick={() => onPick(d.date)}
                className={`text-left ${d.date === selected ? 'text-slate-50 underline underline-offset-2' : ''}`}
              >
                {dayLabel(d.date)}
              </button>
              <span className="block text-xs text-slate-400 num">
                {money(d.cost)}
                {d.km > 0 ? ` · ${amount(d.km)} km` : ' · no distance recorded'}
                {d.sessions > 1 ? ` · ${d.sessions} sessions` : ''}
              </span>
            </dt>
            <dd className="num shrink-0 text-warn">
              {d.perKm === null ? '—' : `${rateOf(d.perKm)}/km`}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="grid gap-1 min-w-0">
      <span className="text-[11px] text-slate-400">{label}</span>
      {children}
    </div>
  );
}

function patch(setRows, index, key, value) {
  setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
}

function blank() {
  return { id: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, amount: '', station: '', kwh: '' };
}
