import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { amount, count, dayLabel, todayLocal } from '../format.js';
import MonthNav from '../components/MonthNav.jsx';
import CsvImport from '../components/CsvImport.jsx';
import Spinner, { Refreshing } from '../components/Spinner.jsx';
import DaysOff from '../components/DaysOff.jsx';

const EMPTY = { date: '', revenue: '', trips: '', uberKm: '', gpsKm: '', cashCollected: '' };

export default function DailyLog({ month, setMonth, isOwner }) {
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState({ ...EMPTY, date: todayLocal() });
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(null);
  // `loading` is the first fetch for a month; `busy` is a refresh over data we
  // already have, which dims in place rather than blanking the table.
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (silent) setBusy(true);
      try {
        const res = await api.entries(month);
        setEntries(res.entries);
        setError('');
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
        setBusy(false);
      }
    },
    [month],
  );

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // The saved CSV mapping lives in settings, which only the owner may read.
  useEffect(() => {
    if (!isOwner) return;
    api.settings().then(setSettings).catch(() => {});
  }, [isOwner]);

  async function save(e) {
    e.preventDefault();
    if (!form.date) return;
    try {
      await api.saveEntry(form.date, {
        revenue: numOrNull(form.revenue) ?? 0,
        trips: numOrNull(form.trips),
        uberKm: numOrNull(form.uberKm),
        gpsKm: numOrNull(form.gpsKm),
        cashCollected: numOrNull(form.cashCollected),
        source: 'manual',
      });
      setForm({ ...EMPTY, date: todayLocal() });
      setEditing(null);
      await load({ silent: true });
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(date) {
    if (!window.confirm(`Delete the entry for ${date}?`)) return;
    try {
      await api.deleteEntry(date);
      if (editing === date) {
        setEditing(null);
        setForm({ ...EMPTY, date: todayLocal() });
      }
      await load({ silent: true });
    } catch (err) {
      setError(err.message);
    }
  }

  function edit(entry) {
    setEditing(entry.date);
    setForm({
      date: entry.date,
      revenue: entry.revenue ?? '',
      trips: entry.trips ?? '',
      uberKm: entry.uberKm ?? '',
      gpsKm: entry.gpsKm ?? '',
      cashCollected: entry.cashCollected ?? '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const total = entries.reduce((s, e) => s + (e.revenue || 0), 0);

  return (
    <div>
      <MonthNav month={month} setMonth={setMonth} />
      {error && (
        <p className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2 mb-4">
          {error}
        </p>
      )}

      {/* Marking days off is the one write the driver may make, so it sits
          outside the owner-only column. */}
      <DaysOff entries={entries} month={month} onChange={() => load({ silent: true })} />

      <div className={`grid gap-5 mt-5 ${isOwner ? 'lg:grid-cols-3' : 'lg:grid-cols-1'}`}>
        {/* Writing is owner-only; the API refuses the driver regardless. */}
        {isOwner && (
        <div className="lg:col-span-1 space-y-5">
          <form onSubmit={save} className="card space-y-3">
            <h2 className="label">{editing ? `Edit ${editing}` : 'Add a day'}</h2>
            <Field label="Date" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} required />
            <Field label="Revenue (LKR)" value={form.revenue} onChange={(v) => setForm({ ...form, revenue: v })} placeholder="0.00" />
            <Field label="Trips" value={form.trips} onChange={(v) => setForm({ ...form, trips: v })} />
            <Field label="Uber km" value={form.uberKm} onChange={(v) => setForm({ ...form, uberKm: v })} />
            <Field label="GPS km" value={form.gpsKm} onChange={(v) => setForm({ ...form, gpsKm: v })} />
            <Field
              label="Cash collected (LKR)"
              value={form.cashCollected}
              onChange={(v) => setForm({ ...form, cashCollected: v })}
            />
            <div className="flex gap-2 pt-1">
              <button type="submit" className="btn btn-primary flex-1">
                {editing ? 'Save changes' : 'Add entry'}
              </button>
              {editing && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => (setEditing(null), setForm({ ...EMPTY, date: todayLocal() }))}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          <CsvImport
            savedMapping={settings?.csvMapping}
            canSaveMapping={isOwner}
            onSaveMapping={(csvMapping) => api.saveSettings({ ...settings, csvMapping })}
            onImported={() => load({ silent: true })}
          />
        </div>
        )}

        <div className={`card overflow-x-auto ${isOwner ? 'lg:col-span-2' : ''}`}>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="label">Entries</h2>
            <span className="text-xs text-slate-500">
              {loading ? (
                'loading…'
              ) : (
                <>
                  <span className="num">{count(entries.length)}</span> days ·{' '}
                  <span className="num text-slate-300">{amount(total)}</span>
                </>
              )}
            </span>
          </div>

          {loading ? (
            <Spinner label="Loading entries…" />
          ) : entries.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              {isOwner
                ? 'No entries this month yet. Add one, or import a CSV.'
                : 'No entries recorded for this month.'}
            </p>
          ) : (
            <Refreshing active={busy}>
            <table className="w-full text-sm min-w-[40rem]">
              <thead>
                <tr>
                  <th className="th">Date</th>
                  <th className="th text-right">Revenue</th>
                  <th className="th text-right">Cash</th>
                  <th className="th text-right">Trips</th>
                  <th className="th text-right">Uber km</th>
                  <th className="th text-right">GPS km</th>
                  <th className="th">Src</th>
                  {isOwner && <th className="th"></th>}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={e.date}
                    className={`${editing === e.date ? 'bg-ink-800/50' : ''} ${
                      e.offDay ? 'opacity-60' : ''
                    }`}
                  >
                    <td className="td num whitespace-nowrap">
                      {dayLabel(e.date)}
                      {e.offDay && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-500 border border-ink-700 rounded px-1">
                          off
                        </span>
                      )}
                    </td>
                    <td className="td num text-right text-slate-100">{amount(e.revenue)}</td>
                    <td className="td num text-right text-warn/90">
                      {e.cashCollected == null ? '—' : amount(e.cashCollected)}
                    </td>
                    <td className="td num text-right">{e.trips ?? '—'}</td>
                    <td className="td num text-right">{e.uberKm ?? '—'}</td>
                    <td className="td num text-right">{e.gpsKm ?? '—'}</td>
                    <td className="td">
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-ink-800 text-slate-400">
                        {e.source}
                      </span>
                    </td>
                    {isOwner && (
                      <td className="td text-right whitespace-nowrap">
                        <button className="btn text-xs px-2 py-1" onClick={() => edit(e)}>
                          Edit
                        </button>
                        <button
                          className="btn btn-danger text-xs px-2 py-1 ml-1"
                          onClick={() => remove(e.date)}
                        >
                          Del
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            </Refreshing>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', ...rest }) {
  return (
    <div className="grid gap-1">
      <label className="label">{label}</label>
      <input
        type={type}
        inputMode={type === 'text' ? 'decimal' : undefined}
        className={type === 'text' ? 'num' : ''}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </div>
  );
}

function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
