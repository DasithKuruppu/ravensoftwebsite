import { useState } from 'react';
import { api } from '../api.js';
import { dayLabel, todayLocal } from '../format.js';
import { useT } from '../i18n/index.jsx';

/**
 * Days the driver was not working.
 *
 * He marks these himself — it is the one write he is allowed, because he is the
 * one who knows he was not driving, and it records his availability rather than
 * touching the revenue record. Revenue on the day is left exactly as it was, so
 * this cannot be used to hide earnings.
 *
 * A day off is excluded from the daily average and the projection, so time off
 * does not read as a day of bad earnings. It deliberately does NOT shrink the
 * commission bands: those are a commercial term tied to the start date, and
 * letting time off shrink them would mean the less he worked, the easier his
 * bonus became.
 */
export default function DaysOff({ entries, month, onChange }) {
  const { t } = useT();
  const [date, setDate] = useState(todayLocal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const off = entries.filter((e) => e.offDay);
  const inMonth = date.slice(0, 7) === month;

  async function set(d, value) {
    setBusy(true);
    setError('');
    try {
      await api.setOffDay(d, value);
      await onChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="label">{t('off.heading')}</h2>
        <span className="text-xs text-slate-400">{t('off.note')}</span>
      </div>
      <p className="text-xs text-slate-400 mb-3">{t('off.blurb')}</p>

      {error && (
        <p className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2 mb-3">
          {error}
        </p>
      )}

      <div className="flex items-end gap-2 flex-wrap">
        <div className="grid gap-1">
          <label className="label" htmlFor="offDate">
            {t('off.date')}
          </label>
          <input id="offDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <button
          className="btn btn-primary"
          disabled={busy || !date || !inMonth}
          onClick={() => set(date, true)}
          title={inMonth ? '' : t('off.pickInMonth')}
        >
          {t('off.mark')}
        </button>
        {!inMonth && date && <span className="text-xs text-warn">{t('off.outsideMonth')}</span>}
      </div>

      {off.length > 0 && (
        <div className="mt-4">
          <div className="label mb-2">
            {t('off.thisMonth')} · <span className="num">{off.length}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {off.map((e) => (
              <button
                key={e.date}
                className="btn text-xs px-2 py-1"
                disabled={busy}
                onClick={() => set(e.date, false)}
                title={t('off.undo')}
              >
                {dayLabel(e.date)} <span className="text-slate-400 ml-1">×</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
