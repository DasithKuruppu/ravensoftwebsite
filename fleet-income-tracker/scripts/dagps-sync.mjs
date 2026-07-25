#!/usr/bin/env node
/**
 * Pull daily GPS mileage from the DAGPS tracker portal into entries.gpsKm.
 *
 *   npm run dagps:sync                       last 7 days
 *   npm run dagps:sync -- 2026-07-01 2026-07-25    explicit range
 *   npm run dagps:sync -- --dry-run          fetch and print, write nothing
 *
 * This is the same code the nightly Lambda runs — jobs/sync.mjs and
 * jobs/dagps-client.mjs. Credentials come from .env locally (DAGPS_USER is the
 * plate number / IMEI, DAGPS_PASS the portal password) and from SSM in AWS.
 */
import 'dotenv/config';
import {
  login,
  fetchDailyMileage,
  daysAgoInColombo,
  todayInColombo,
} from '../jobs/dagps-client.mjs';
import { runDagps } from '../jobs/sync.mjs';
import { storeMode } from '../api/store.mjs';

const args = process.argv.slice(2).filter((a) => a !== '--');
const dryRun = args.includes('--dry-run');
const dates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

const from = dates[0] || daysAgoInColombo(6);
const to = dates[1] || todayInColombo();

console.log(`DAGPS sync — ${from} .. ${to}${dryRun ? '  (dry run)' : ''}`);
console.log(`  plate/IMEI : ${process.env.DAGPS_USER || '(DAGPS_USER not set)'}`);
console.log(`  store      : ${storeMode}\n`);

if (dryRun) {
  const session = await login({ user: process.env.DAGPS_USER, pass: process.env.DAGPS_PASS });
  const rows = await fetchDailyMileage(session, from, to);
  for (const r of rows) {
    console.log(`  ${r.date}  ${String(r.gpsKm).padStart(9)} km${r.gpsKm < 1 ? '   (skipped — vehicle idle)' : ''}`);
  }
  const total = rows.reduce((a, b) => a + b.gpsKm, 0);
  console.log(`\n  total ${total.toFixed(2)} km across ${rows.length} day(s) — nothing written`);
} else {
  const result = await runDagps({ from, to });
  console.log(`\n✓ wrote ${result.written} of ${result.days} day(s) into entries.gpsKm`);
  console.log('  Open the GPS check page to compare against Uber kilometres.');
}
