import { useState } from 'react';
import Papa from 'papaparse';
import { api } from '../api.js';
import { count, todayLocal } from '../format.js';

const FIELDS = [
  { key: 'date', label: 'Date', required: false, hints: ['trip date', 'request time', 'local date', 'date', 'day', 'reporting'] },
  { key: 'revenue', label: 'Revenue / driver earnings', required: false, hints: ['total earnings', 'earning', 'fare', 'revenue', 'payout', 'amount'], numeric: true },
  { key: 'trips', label: 'Trips (optional)', required: false, hints: ['trips taken', 'trip count', 'trips', 'rides', 'count'], numeric: true },
  { key: 'uberKm', label: 'Distance km (optional)', required: false, hints: ['trip distance', 'distance', 'km', 'mileage'], numeric: true },
  { key: 'status', label: 'Trip status (optional)', required: false, hints: ['trip status', 'status'] },
];

/**
 * Uber's exports include derived rate columns ("Earnings / hr", "Trips / hr")
 * whose names collide with the totals we actually want. Skip them when
 * guessing, or "Trips / hr" gets picked ahead of "Trips Taken".
 */
const RATE_COLUMN = /(\/|\bper\b|\brate\b)/i;

/**
 * Uber's trip activity export lists cancelled trips alongside completed ones.
 * Counting them would inflate both the trip count and the distance, so when a
 * status column is mapped only completed rows are imported.
 */
const COMPLETED = /^\s*completed\s*$/i;

/**
 * A numeric field must never auto-map to a column of identifiers. "Trip UUID"
 * matches a naive "trip" hint and would be parsed into a nonsense trip count,
 * so candidates are checked against a real value from the file first.
 */
function looksNumeric(sample) {
  if (sample === undefined || sample === null) return false;
  const raw = String(sample).trim();
  if (!raw) return false;
  // Tolerate a currency prefix, but any other letter means this is an
  // identifier, a plate, a status or a timestamp — never a measure.
  const withoutCurrency = raw.replace(/^(lkr|rs\.?|usd|\$|₨)\s*/i, '');
  if (/[a-z]/i.test(withoutCurrency)) return false;
  const cleaned = withoutCurrency.replace(/[,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(cleaned);
}

/**
 * Report exports do not agree on what the date column is called — "Trip request
 * time" in trip activity, "vs reporting" in the payments export. When no hint
 * matches, fall back to any column whose sample value actually parses as a date.
 */
function looksDateLike(sample) {
  if (sample === undefined || sample === null) return false;
  const raw = String(sample).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(raw) || /^\d{1,2}[/-]\d{1,2}[/-]\d{4}/.test(raw);
}

const BATCH_SIZE = 200;

/**
 * Two-step CSV import for Uber Fleet Portal exports:
 *   1. parse headers client-side (papaparse), map columns via dropdowns
 *   2. POST normalised rows to the API in batches
 * The mapping is remembered in settings so step 1 is pre-filled next time.
 */
export default function CsvImport({ savedMapping, onSaveMapping, onImported, canSaveMapping }) {
  const [rows, setRows] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [fileName, setFileName] = useState('');
  const [fallbackDate, setFallbackDate] = useState(todayLocal);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setStatus(null);
    setFileName(file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const cols = (result.meta.fields || []).filter(Boolean);
        if (!cols.length) {
          setError('No column headers found in that file.');
          return;
        }
        setHeaders(cols);
        setRows(result.data);
        setMapping(initialMapping(cols, savedMapping, result.data[0] || {}));
      },
      error: (err) => setError(err.message),
    });
  }

  /** Pre-fill from the saved mapping, else guess from header names. */
  function initialMapping(cols, saved, sampleRow) {
    const next = {};
    for (const field of FIELDS) {
      if (saved?.[field.key] && cols.includes(saved[field.key])) {
        next[field.key] = saved[field.key];
        continue;
      }
      const eligible = cols.filter(
        (c) => !RATE_COLUMN.test(c) && (!field.numeric || looksNumeric(sampleRow[c])),
      );
      // Hints are ordered most- to least-specific; take the first that hits.
      // Matching starts at a word boundary so "count" cannot match inside
      // "Bank Account", while still allowing "earning" to hit "Your earnings".
      let guess = '';
      for (const hint of field.hints) {
        const re = new RegExp(`\\b${hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
        guess = eligible.find((c) => re.test(c));
        if (guess) break;
      }
      // The date column is named differently in every export, so recognise it
      // by its contents when the name gives nothing away.
      if (!guess && field.key === 'date') {
        guess = cols.find((c) => looksDateLike(sampleRow[c])) || '';
      }
      next[field.key] = guess || '';
    }
    return next;
  }

  async function runImport() {
    setBusy(true);
    setError('');
    setStatus(null);
    try {
      const usable = mapping.status ? rows.filter((r) => COMPLETED.test(r[mapping.status] || '')) : rows;
      const excluded = rows.length - usable.length;

      const normalised = usable
        .map((r) => ({
          // Uber's fleet summary export has no date column — every row belongs
          // to the reporting period chosen in the portal, so the date is
          // supplied here instead.
          date: mapping.date ? r[mapping.date] : fallbackDate,
          revenue: r[mapping.revenue],
          trips: mapping.trips ? r[mapping.trips] : undefined,
          uberKm: mapping.uberKm ? r[mapping.uberKm] : undefined,
        }))
        .filter((r) => r.date);

      let imported = 0;
      let skipped = 0;
      for (let i = 0; i < normalised.length; i += BATCH_SIZE) {
        const res = await api.importRows(normalised.slice(i, i + BATCH_SIZE));
        imported += res.imported;
        skipped += res.skipped;
      }

      if (canSaveMapping) await onSaveMapping(mapping);
      setStatus({ imported, skipped, total: normalised.length, excluded });
      setRows(null);
      setHeaders([]);
      onImported?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Each Uber report carries only part of the picture, so an import needs at
  // least one measure — earnings or distance — but not necessarily both.
  const hasMeasure = Boolean(mapping.revenue || mapping.uberKm);
  const needsFallbackDate = !mapping.date;
  const blocked = !hasMeasure || (needsFallbackDate && !fallbackDate);

  return (
    <div className="card">
      <h2 className="label mb-3">Import Uber CSV</h2>

      <input type="file" accept=".csv,text/csv" onChange={handleFile} />

      {fileName && rows && (
        <p className="text-xs text-slate-500 mt-2">
          {fileName} · <span className="num">{count(rows.length)}</span> rows ·{' '}
          <span className="num">{headers.length}</span> columns
        </p>
      )}

      {error && (
        <p className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2 mt-3">
          {error}
        </p>
      )}

      {status && (
        <p className="text-sm text-accent bg-accent/10 border border-accent/20 rounded-md px-3 py-2 mt-3">
          Imported <span className="num">{count(status.imported)}</span> day(s) from{' '}
          <span className="num">{count(status.total)}</span> rows
          {status.excluded > 0 && ` · ${status.excluded} cancelled trip(s) excluded`}
          {status.skipped > 0 && ` · ${status.skipped} row(s) skipped (unreadable date)`}.
        </p>
      )}

      {rows && headers.length > 0 && (
        <>
          <p className="text-sm text-slate-400 mt-4 mb-2">
            Map the CSV columns. Per-trip rows are summed into one entry per date.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <div key={f.key} className="grid gap-1">
                <label className="label" htmlFor={`map-${f.key}`}>
                  {f.label}
                </label>
                <select
                  id={`map-${f.key}`}
                  value={mapping[f.key] || ''}
                  onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}
                >
                  <option value="">— none —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {needsFallbackDate && (
            <div className="mt-4 rounded-md border border-warn/30 bg-warn/5 px-3 py-3">
              <p className="text-sm text-slate-300">
                This file has no date column — Uber's fleet summary export covers whichever
                period you selected in the portal.
              </p>
              <div className="grid gap-1 mt-2 max-w-xs">
                <label className="label" htmlFor="fallback-date">
                  Date these rows belong to
                </label>
                <input
                  id="fallback-date"
                  type="date"
                  value={fallbackDate}
                  onChange={(e) => setFallbackDate(e.target.value)}
                />
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Export one day at a time so each file lands on its own date. A multi-day
                export would be written as a single lump sum on this date.
              </p>
            </div>
          )}

          <div className="flex items-center gap-3 mt-4">
            <button className="btn btn-primary" onClick={runImport} disabled={busy || blocked}>
              {busy ? 'Importing…' : `Import ${count(rows.length)} rows`}
            </button>
            <button className="btn" onClick={() => (setRows(null), setHeaders([]))} disabled={busy}>
              Cancel
            </button>
            {!hasMeasure && (
              <span className="text-xs text-warn">
                Map revenue or distance first.
              </span>
            )}
            {hasMeasure && needsFallbackDate && !fallbackDate && (
              <span className="text-xs text-warn">Pick the date these rows belong to.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
