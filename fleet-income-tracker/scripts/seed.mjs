#!/usr/bin/env node
/**
 * Seed ~10 sample days so the dashboard has something to render on first run.
 * Works against whichever store is configured (DynamoDB Local or the local
 * JSON store) — set DDB_ENDPOINT to target DynamoDB Local.
 *
 *   npm run seed
 */
import 'dotenv/config';
import { store, storeMode, DEFAULT_DRIVER } from '../api/store.mjs';
import { DEFAULT_SETTINGS } from '../shared/commission.mjs';

// Default: the 10 most recent days, per spec.
// `npm run seed -- --full` fills every elapsed day of the current month instead,
// which pushes revenue into the upper tiers so the ladder and the per-tier
// breakdown have something to show.
const FULL = process.argv.includes('--full');
const today = new Date();
const DAYS = FULL ? today.getUTCDate() : 10;

// Plausible daily numbers for a Colombo Uber driver: revenue, trips, uber km.
const SAMPLE = [
  [14250.0, 21, 168.4],
  [11890.5, 17, 141.2],
  [16420.75, 24, 195.8],
  [9310.0, 14, 112.6],
  [15075.25, 22, 181.3],
  [17840.0, 26, 211.9],
  [12600.5, 19, 155.0],
  [13980.0, 20, 172.5],
  [18220.4, 27, 224.7],
  [10450.0, 16, 128.9],
];

function isoDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const settings = await store.getSettings(DEFAULT_DRIVER);
if (!settings.base) await store.putSettings(DEFAULT_DRIVER, { ...DEFAULT_SETTINGS, csvMapping: null });

let total = 0;
for (let i = 0; i < DAYS; i++) {
  const [revenue, trips, uberKm] = SAMPLE[i % SAMPLE.length];
  const date = isoDaysAgo(DAYS - 1 - i);
  // gpsKm is deliberately NOT seeded. Fabricated mileage would show up on the
  // GPS check page as real off-app driving. Run `npm run dagps:sync` to pull
  // the genuine figures from the tracker portal.
  const existing = await store.getEntry(DEFAULT_DRIVER, date);
  await store.putEntry(DEFAULT_DRIVER, {
    date, revenue, trips, uberKm,
    gpsKm: existing?.gpsKm ?? null,
    source: 'manual',
  });
  total += revenue;
  console.log(`  ${date}  revenue ${revenue.toFixed(2).padStart(10)}  trips ${String(trips).padStart(3)}  uber ${uberKm} km`);
}

console.log(`\n✓ Seeded ${DAYS} days (store: ${storeMode}), total revenue ${total.toFixed(2)} LKR`);
console.log('  GPS mileage is not seeded — run `npm run dagps:sync` for real figures.');
if (!FULL) {
  console.log('  Tip: `npm run seed -- --full` fills every elapsed day of this month,');
  console.log('       which pushes revenue into the upper commission tiers.');
}
