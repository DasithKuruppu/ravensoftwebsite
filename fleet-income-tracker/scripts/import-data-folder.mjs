#!/usr/bin/env node
/**
 * Load the CSV exports sitting in data/ straight into the local store.
 *
 *   node scripts/import-data-folder.mjs --dry     # show the mapping, write nothing
 *   node scripts/import-data-folder.mjs           # import
 *
 * The browser does this through the Import screen; this is the same thing from a
 * terminal, for rebuilding a local store after a reset without clicking through
 * two file pickers. It deliberately reuses the app's own pieces rather than
 * parsing afresh — papaparse, the column guessing in src/csvMapping.mjs, the
 * completed-only filter, the fee summing, and the API's own `importRows` — so
 * what lands here is what would land from the UI.
 *
 * It calls `importRows` directly rather than over HTTP: this is a local
 * maintenance job, and going through the route would mean holding the owner's
 * password to do something the store already permits.
 *
 * Order matters. The trip activity export goes first because it is the only file
 * that knows when a trip STARTED; the payments export carries the money but only
 * a settlement timestamp, so it is dated by trip id against what the first file
 * taught. That lookup lives in localStorage in the browser; here it is just an
 * object passed between the two passes.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import {
  END_TIME_COLUMN,
  TRIP_ID_HINTS,
  guessColumn,
  looksDateLike,
  feeColumns,
  taxColumns,
  feeLineItems,
  rememberTripStarts,
  resolveRowDate,
  rowFees,
} from '../src/csvMapping.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DRY = process.argv.includes('--dry');

const { importRows } = await import('../api/handler.mjs');
const { store, storeMode, DEFAULT_DRIVER } = await import('../api/store.mjs');
console.log(`store: ${storeMode}`);

// Same field definitions as the import UI.
const RATE_COLUMN = /(\/|\bper\b|\brate\b)/i;
const COMPLETED = /^\s*completed\s*$/i;
const FIELDS = [
  {
    key: 'date',
    hints: ['trip request time', 'request time', 'pick-up time', 'trip date', 'local date', 'date', 'day', 'reporting'],
    exclude: END_TIME_COLUMN,
  },
  { key: 'tripId', hints: TRIP_ID_HINTS },
  { key: 'revenue', hints: ['total earnings', 'earning', 'fare', 'revenue', 'payout', 'amount'], numeric: true },
  { key: 'trips', hints: ['trips taken', 'trip count', 'trips', 'rides', 'count'], numeric: true },
  { key: 'uberKm', hints: ['trip distance', 'distance', 'km', 'mileage'], numeric: true },
  { key: 'cashCollected', hints: ['cash collected', 'cash'], numeric: true },
  { key: 'status', hints: ['trip status', 'status'] },
];

function parse(file) {
  const text = fs.readFileSync(path.join(ROOT, 'data', file), 'utf8').replace(/^﻿/, '');
  const out = Papa.parse(text, { header: true, skipEmptyLines: true });
  return { rows: out.data, headers: (out.meta.fields || []).filter(Boolean) };
}

function mapColumns(headers, sampleRow) {
  const mapping = {};
  for (const field of FIELDS) {
    let guess = guessColumn(field, headers, sampleRow, { skip: RATE_COLUMN });
    if (!guess && field.key === 'date') {
      guess = headers.find((c) => !END_TIME_COLUMN.test(c) && looksDateLike(sampleRow[c])) || '';
    }
    mapping[field.key] = guess || '';
  }
  return mapping;
}

let tripStarts = {};

async function importFile(file) {
  const { rows, headers } = parse(file);
  const mapping = mapColumns(headers, rows[0] || {});
  const usable = mapping.status ? rows.filter((r) => COMPLETED.test(r[mapping.status] || '')) : rows;

  tripStarts = rememberTripStarts(tripStarts, rows, {
    tripIdColumn: mapping.tripId,
    dateColumn: mapping.date,
  });

  const feeCols = feeColumns(headers);
  const taxCols = taxColumns(headers);
  const basis = {};
  const normalised = usable
    .map((r) => {
      const { date, basis: how } = resolveRowDate(r, { mapping, tripStarts, fallbackDate: '' });
      basis[how] = (basis[how] || 0) + 1;
      const fees = feeCols.length ? rowFees(r, feeCols) : undefined;
      return {
        date,
        revenue: mapping.revenue ? r[mapping.revenue] : undefined,
        trips: mapping.trips ? r[mapping.trips] : undefined,
        uberKm: mapping.uberKm ? r[mapping.uberKm] : undefined,
        cashCollected: mapping.cashCollected ? r[mapping.cashCollected] : undefined,
        uberFees: fees,
        uberFeeLines: feeCols.length ? feeLineItems(r, feeCols) : undefined,
        uberTaxLines: taxCols.length ? feeLineItems(r, taxCols) : undefined,
      };
    })
    .filter((r) => r.date);

  console.log(`\n── ${file}`);
  console.log('   mapping:', Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)));
  console.log(`   rows ${rows.length}, completed ${usable.length}, dated ${normalised.length}, basis`, basis);
  console.log(`   fee columns ${feeCols.length}`);

  if (DRY) return;
  const res = await importRows(normalised);
  console.log('   imported', res.imported, 'skipped', res.skipped);
  console.log('   dates', res.dates.join(' '));
}

/*
 * Days to clear before importing, passed as --clear=yyyy-mm-dd,yyyy-mm-dd.
 *
 * An import only ever adds to a day, so a day holding figures from somewhere
 * else — a hand entry, or a test seed — has to be removed rather than imported
 * over. Nothing is cleared unless it is named.
 */
const clearArg = process.argv.find((a) => a.startsWith('--clear='));
const toClear = clearArg ? clearArg.slice('--clear='.length).split(',').filter(Boolean) : [];
if (!DRY) {
  for (const date of toClear) {
    await store.deleteEntry(DEFAULT_DRIVER, date);
    console.log('cleared', date);
  }
}

/* ── 2. trip activity first: it teaches the trip-start lookup ── */
await importFile('20260719-20260726-trip_activity-Ravensoft_Karunarathne.csv');
/* ── 3. payments second: money, dated by the trip it paid for ── */
await importFile('20260720-20260726-payments_order-Ravensoft_Karunarathne.csv');

/* ── 4. what the store now holds ── */
const entries = { entries: await store.queryMonth(DEFAULT_DRIVER, '2026-07') };
console.log('\n── stored days');
let revenue = 0;
let trips = 0;
for (const e of entries.entries) {
  revenue += e.revenue || 0;
  trips += e.trips || 0;
  console.log(
    `   ${e.date}  rev ${String(Math.round(e.revenue || 0)).padStart(7)}  trips ${String(e.trips ?? '-').padStart(3)}` +
      `  km ${String(Math.round(e.uberKm || 0)).padStart(4)}  cash ${String(Math.round(e.cashCollected || 0)).padStart(6)}` +
      `  fees ${String(Math.round(e.uberFees || 0)).padStart(6)}  ${e.offDay ? 'OFF' : ''}${e.source ? ` (${e.source})` : ''}`,
  );
}
console.log(`   total revenue ${Math.round(revenue)}, trips ${trips}`);
