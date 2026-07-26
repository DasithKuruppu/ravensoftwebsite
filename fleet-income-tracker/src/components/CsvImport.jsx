import { useState } from 'react';
import Papa from 'papaparse';
import { api } from '../api.js';
import { amount, count, todayLocal } from '../format.js';
import {
  END_TIME_COLUMN,
  START_TIME_COLUMN,
  TRIP_ID_HINTS,
  guessColumn,
  looksDateLike,
  feeColumns,
  rememberTripStarts,
  resolveRowDate,
  rowFees,
} from '../csvMapping.mjs';

const TRIP_STARTS_KEY = 'fleet.tripStarts';

const FIELDS = [
  {
    key: 'date',
    label: 'Date / trip start time',
    required: false,
    // Start times first, and end times excluded outright: a day's income is the
    // income from the trips that STARTED that day, so a trip running 23:40 to
    // 00:20 belongs to the day it began. Without the exclusion the generic
    // "date" hint settles on "Trip drop-off time" in any file without a request
    // time, moving that fare to the next day — and, at a month boundary, into
    // the next commission month.
    hints: ['trip request time', 'request time', 'pick-up time', 'trip date', 'local date', 'date', 'day', 'reporting'],
    exclude: END_TIME_COLUMN,
  },
  {
    key: 'tripId',
    label: 'Trip ID (dates payments by trip start)',
    required: false,
    hints: TRIP_ID_HINTS,
  },
  { key: 'revenue', label: 'Revenue / driver earnings', required: false, hints: ['total earnings', 'earning', 'fare', 'revenue', 'payout', 'amount'], numeric: true },
  { key: 'trips', label: 'Trips (optional)', required: false, hints: ['trips taken', 'trip count', 'trips', 'rides', 'count'], numeric: true },
  { key: 'uberKm', label: 'Distance km (optional)', required: false, hints: ['trip distance', 'distance', 'km', 'mileage'], numeric: true },
  {
    key: 'cashCollected',
    label: 'Cash collected (optional)',
    required: false,
    hints: ['cash collected', 'cash'],
    numeric: true,
  },
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

const BATCH_SIZE = 200;

/** The remembered trip-start lookup survives reloads and separate imports. */
function loadTripStarts() {
  try {
    const raw = localStorage.getItem(TRIP_STARTS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveTripStarts(map) {
  try {
    localStorage.setItem(TRIP_STARTS_KEY, JSON.stringify(map));
  } catch {
    // A full quota is not worth failing an import over; attribution simply
    // falls back to the row's own timestamp next time.
  }
}

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
  const [savedTripStarts, setSavedTripStarts] = useState(loadTripStarts);
  const [datingAcknowledged, setDatingAcknowledged] = useState(false);

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
        setDatingAcknowledged(false);
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
      let guess = guessColumn(field, cols, sampleRow, { skip: RATE_COLUMN });
      // The date column is named differently in every export, so recognise it
      // by its contents when the name gives nothing away — still refusing any
      // column that describes when a trip ended.
      if (!guess && field.key === 'date') {
        guess = cols.find((c) => !END_TIME_COLUMN.test(c) && looksDateLike(sampleRow[c])) || '';
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

      // Learn this file's trip start times before dating its rows, so a file
      // carrying both — the trip activity export — teaches the lookup that a
      // later payments import will read. Only a genuine start-time column is
      // accepted, so the payments export's settlement timestamp cannot be
      // recorded as a start time.
      //
      // Learned from every row, not just the completed ones: the status filter
      // exists to keep cancelled trips out of the trip count and distance, but
      // a cancelled trip still has a start time, and the payments export bills
      // cancellation fees and adjustments against those same trip ids. Learning
      // only from completed trips left five money-carrying rows with no start
      // time to match against.
      const tripStarts = rememberTripStarts(loadTripStarts(), rows, {
        tripIdColumn: mapping.tripId,
        dateColumn: mapping.date,
      });
      saveTripStarts(tripStarts);
      setSavedTripStarts(tripStarts);

      // Uber's own charges and refunds, spread across a column per type. Summed
      // rather than mapped, because there is no single column to point at.
      const feeCols = feeColumns(headers);
      let feeTotal = 0;
      let feeRows = 0;

      const basisCount = { tripStart: 0, timestamp: 0, timestampUnmatched: 0, fallback: 0, unreadable: 0 };
      const normalised = usable
        .map((r) => {
          // Uber's fleet summary export has no date column — every row belongs
          // to the reporting period chosen in the portal, so the date falls
          // back to the one picked below.
          const { date, basis } = resolveRowDate(r, { mapping, tripStarts, fallbackDate });
          if (basis in basisCount) basisCount[basis] += 1;
          const fees = feeCols.length ? rowFees(r, feeCols) : undefined;
          if (fees) {
            feeTotal += fees;
            feeRows += 1;
          }
          return {
            date,
            revenue: r[mapping.revenue],
            trips: mapping.trips ? r[mapping.trips] : undefined,
            uberKm: mapping.uberKm ? r[mapping.uberKm] : undefined,
            cashCollected: mapping.cashCollected ? r[mapping.cashCollected] : undefined,
            uberFees: fees,
          };
        })
        .filter((r) => r.date);

      let imported = 0;
      let skipped = 0;
      for (let i = 0; i < normalised.length; i += BATCH_SIZE) {
        const res = await api.importRows(normalised.slice(i, i + BATCH_SIZE));
        imported += res.imported;
        skipped += res.skipped;
      }

      if (canSaveMapping) await onSaveMapping(mapping);
      setStatus({
        imported,
        skipped,
        total: normalised.length,
        excluded,
        basis: basisCount,
        fees: feeRows > 0 ? { total: feeTotal, rows: feeRows, columns: feeCols.length } : null,
      });
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
  // How many of this file's rows we already know the start time for.
  const knownTripIds =
    rows && mapping.tripId
      ? rows.filter((r) => savedTripStarts[String(r[mapping.tripId] ?? '').trim()]).length
      : 0;
  // Rows whose money would land on the wrong day: a trip we have no start time
  // for, in a file whose only timestamp is when Uber posted the payment.
  //
  // Only rows carrying a real amount count. The payments export also lists
  // zero-value administrative entries — Drive Pass activations, disbursements —
  // some without a trip id at all, and they are always unmatched. Counting
  // those would leave the warning permanently on and train it to be ignored.
  const misdatedRows =
    rows && mapping.tripId && mapping.date && !START_TIME_COLUMN.test(mapping.date)
      ? rows.filter((r) => {
          const id = String(r[mapping.tripId] ?? '').trim();
          if (!id || savedTripStarts[id]) return false;
          return Math.abs(Number(String(r[mapping.revenue] ?? '').replace(/[^\d.-]/g, '')) || 0) > 0;
        }).length
      : 0;
  // Importing the payments report before the trip activity report is what put
  // an overnight fare on the wrong day. The order is not obvious, so it is
  // caught here rather than left to be noticed in the numbers weeks later.
  const misdatingRisk = misdatedRows > 0;
  const blocked =
    !hasMeasure || (needsFallbackDate && !fallbackDate) || (misdatingRisk && !datingAcknowledged);

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
          {(status.skipped > 0 || status.basis?.unreadable > 0) &&
            ` · ${status.skipped + (status.basis?.unreadable || 0)} row(s) skipped (unreadable date)`}
          .
          {/* Which day each row was filed under, and on what evidence — the one
              thing that decides whether a late-night fare lands on the right
              day. */}
          {status.fees && (
            <span className="block text-xs text-slate-400 mt-1">
              Uber charges and refunds:{' '}
              <span className="num">{amount(status.fees.total)}</span> net across{' '}
              <span className="num">{count(status.fees.rows)}</span> row(s) — kept out of revenue,
              counted against the owner's profit.
            </span>
          )}
          {status.basis?.tripStart > 0 && (
            <span className="block text-xs text-slate-400 mt-1">
              <span className="num">{count(status.basis.tripStart)}</span> row(s) dated by trip
              start time
              {status.basis.timestampUnmatched > 0 && (
                <>
                  {' · '}
                  <span className="num">{count(status.basis.timestampUnmatched)}</span> by the
                  file's own timestamp (no matching trip)
                </>
              )}
              .
            </span>
          )}
        </p>
      )}

      {rows && headers.length > 0 && (
        <>
          <p className="text-sm text-slate-400 mt-4 mb-2">
            Map the CSV columns. Per-trip rows are summed into one entry per date.
          </p>
          {/* The payments export's only timestamp is when Uber posted the
              money, which is after the trip ended — so for a trip finishing
              after midnight it names the wrong day. Its Trip UUID does not have
              that problem, provided the trip activity export has been imported
              to teach us when the trip began. */}
          {mapping.tripId && !misdatingRisk && knownTripIds > 0 && (
            <p className="text-xs text-slate-500 mb-3">
              <span className="num">{count(knownTripIds)}</span> of{' '}
              <span className="num">{count(rows.length)}</span> rows match a known trip and will be
              dated by when that trip started, not by this file's timestamp.
            </p>
          )}

          {misdatingRisk && (
            <div className="mt-1 mb-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-3">
              <p className="text-sm text-slate-300">
                <span className="text-warn font-medium">Import the trip activity report first.</span>{' '}
                This file dates each row by{' '}
                <span className="num text-slate-400">{mapping.date}</span>, which is when Uber
                posted the money — after the trip ended. A trip running past midnight would have
                its fare filed under the following day.
              </p>
              <p className="text-xs text-slate-500 mt-2">
                <span className="num">{count(misdatedRows)}</span> of{' '}
                <span className="num">{count(rows.length)}</span> rows carry money for a trip with
                no known start time. Import the trip activity report covering these dates, then
                load this file again.
              </p>
              <label className="flex items-center gap-2 mt-3 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={datingAcknowledged}
                  onChange={(e) => setDatingAcknowledged(e.target.checked)}
                />
                Import anyway, dating those rows by payment time
              </label>
            </div>
          )}
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
