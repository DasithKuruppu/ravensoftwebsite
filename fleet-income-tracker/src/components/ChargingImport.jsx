import { useState } from 'react';
import Papa from 'papaparse';
import { api } from '../api.js';
import { money, count, dayLabel } from '../format.js';
import { parseChargeRows } from '../../shared/chargeCsv.mjs';
import { useT } from '../i18n/index.jsx';

/**
 * The charging network's session export, uploaded whole.
 *
 * Typing a month of fast charges in by hand is the reason the charging log sits
 * half empty, and a half-empty log is worse than none: the cost card falls back
 * to the configured rate for the missing days and quietly reports a budget as if
 * it were a measurement.
 *
 * Unlike the revenue import there is no column mapping to confirm. The export
 * has one shape, its columns are found by name, and the file is a WALLET
 * statement — most of its rows are top-ups and transfers, which are not costs.
 * Getting that wrong is not a mapping mistake the driver could be asked about;
 * it is arithmetic, so it is decided in `shared/chargeCsv.mjs` and shown as a
 * summary he can check against the receipt before anything is written.
 */
export default function ChargingImport({ onImported }) {
  const { t } = useT();
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setStatus('');
    setParsed(null);
    setFileName(file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const out = parseChargeRows(result.data || []);
        if (!out.sessions) {
          setError(t('chargeImport.nothingFound'));
          return;
        }
        setParsed(out);
      },
      error: (err) => setError(err.message),
    });
  }

  async function save() {
    if (!parsed) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.importCharging(parsed.days);
      setStatus(t('chargeImport.done', { days: count(res.days), sessions: count(res.sessions) }));
      setParsed(null);
      setFileName('');
      onImported?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="label">{t('chargeImport.heading')}</h2>
        <span className="text-xs text-slate-400">{t('chargeImport.note')}</span>
      </div>
      <p className="text-xs text-slate-400 mb-3">{t('chargeImport.blurb')}</p>

      <input
        type="file"
        accept=".csv,text/csv"
        onChange={handleFile}
        className="block w-full text-sm text-slate-300 file:mr-3 file:px-3 file:py-2 file:rounded-md
                   file:border file:border-ink-700 file:bg-ink-800 file:text-slate-100
                   file:text-sm file:font-medium hover:file:bg-ink-700"
      />

      {error && <p className="text-sm text-danger mt-3">{error}</p>}
      {status && <p className="text-sm text-slate-100 mt-3">{status}</p>}

      {parsed && (
        <div className="mt-4 pt-3 border-t border-ink-700">
          {/* The total leads, because it is the one figure he can check against
              the receipt before writing anything. */}
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-slate-300">
              {t('chargeImport.found', {
                sessions: count(parsed.sessions),
                days: count(parsed.days.length),
              })}
            </span>
            <span className="num text-slate-100">{money(parsed.total)}</span>
          </div>

          {/* Said out loud, because "16 rows, 3 imported" reads as a failure
              until you know the other thirteen were top-ups and transfers —
              money moving into the wallet, not electricity leaving it. */}
          {parsed.skipped.notACharge > 0 && (
            <p className="text-xs text-slate-400 mt-1">
              {t('chargeImport.skipped', { count: parsed.skipped.notACharge })}
            </p>
          )}

          <dl className="mt-3 space-y-1.5">
            {parsed.days.map((day) => (
              <div key={day.date} className="flex items-baseline justify-between gap-4">
                <dt className="text-sm text-slate-300 min-w-0">
                  {dayLabel(day.date)}
                  <span className="block text-xs text-slate-400">
                    {t('chargeImport.sessionCount', { count: day.sessions.length })}
                  </span>
                </dt>
                <dd className="num shrink-0 text-warn">
                  {money(day.sessions.reduce((s, x) => s + x.amount, 0))}
                </dd>
              </div>
            ))}
          </dl>

          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? t('chargeImport.saving') : t('chargeImport.save')}
            </button>
            <button
              className="btn"
              onClick={() => {
                setParsed(null);
                setFileName('');
              }}
              disabled={busy}
            >
              {t('chargeImport.cancel')}
            </button>
            {fileName && <span className="text-xs text-slate-400 min-w-0 break-all">{fileName}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
