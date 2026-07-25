/**
 * Scheduled sync Lambda — one function, two EventBridge rules.
 *
 * The rule passes { job: 'dagps' } or { job: 'uber' } as the event detail:
 *   dagps  nightly 23:30 Asia/Colombo (18:00 UTC) — daily GPS mileage
 *   uber   daily placeholder — daily earnings, once Supplier API access lands
 *
 * Both write entries with source='api'.
 *
 * dagps is implemented and pulls real mileage from the tracker portal (see
 * jobs/dagps-client.mjs). uber is still a placeholder: the app's credentials
 * are valid but Uber has not granted Supplier API access, so the token request
 * returns invalid_scope (see scripts/uber-check.mjs).
 */
import { store, DEFAULT_DRIVER } from '../api/store.mjs';
import {
  login as dagpsLogin,
  credentials as dagpsCredentials,
  fetchDailyMileage,
  daysAgoInColombo,
  todayInColombo,
} from './dagps-client.mjs';

const DRIVER_ID = process.env.DRIVER_ID || DEFAULT_DRIVER;

/** How many days back to re-pull each night, so a failed run self-heals. */
const LOOKBACK_DAYS = Number(process.env.DAGPS_LOOKBACK_DAYS || 7);

export async function handler(event = {}) {
  const job = event.job || event.detail?.job || 'dagps';
  console.log(`sync: starting job=${job}`);

  switch (job) {
    case 'dagps':
      return runDagps();
    case 'uber':
      return runUber();
    default:
      console.warn(`sync: unknown job "${job}" — nothing to do`);
      return { job, status: 'skipped' };
  }
}

export async function runDagps({ from, to } = {}) {
  const creds = await dagpsCredentials();
  const session = await dagpsLogin(creds);

  const fromDate = from || daysAgoInColombo(LOOKBACK_DAYS - 1);
  const toDate = to || todayInColombo();
  console.log(`sync: dagps pulling ${fromDate} .. ${toDate}`);

  const rows = await fetchDailyMileage(session, fromDate, toDate);

  let written = 0;
  for (const row of rows) {
    // A day the vehicle never moved reports ~0 km. Writing that would create
    // empty entries for days with no work, so skip anything under 1 km.
    if (row.gpsKm < 1) continue;
    await writeGpsKm(row.date, row.gpsKm);
    written++;
  }

  console.log(`sync: dagps wrote ${written} of ${rows.length} day(s)`);
  return { job: 'dagps', status: 'ok', from: fromDate, to: toDate, days: rows.length, written };
}

async function runUber() {
  // TODO: blocked on Uber Supplier API access — the client_credentials request
  // currently returns invalid_scope. Once granted: pull yesterday's earnings
  // for the org and call writeRevenue() per day.
  console.log('sync: uber not implemented yet (Supplier API access not granted) — no writes performed');
  return { job: 'uber', status: 'not_implemented', written: 0 };
}


/**
 * Merge GPS mileage into a day without disturbing revenue or trips.
 * Creates the entry if the day has no revenue logged yet.
 */
export async function writeGpsKm(date, gpsKm) {
  const existing = await store.getEntry(DRIVER_ID, date);
  return store.putEntry(DRIVER_ID, {
    date,
    revenue: existing?.revenue ?? 0,
    trips: existing?.trips ?? null,
    uberKm: existing?.uberKm ?? null,
    gpsKm,
    // Preserve how the revenue arrived; only mark the row as api-sourced when
    // this job is what created it.
    source: existing?.source ?? 'api',
  });
}

/** Merge Uber-sourced revenue/trips/km into a day, preserving gpsKm. */
export async function writeRevenue(date, { revenue, trips, uberKm }) {
  const existing = await store.getEntry(DRIVER_ID, date);
  return store.putEntry(DRIVER_ID, {
    date,
    revenue,
    trips: trips ?? existing?.trips ?? null,
    uberKm: uberKm ?? existing?.uberKm ?? null,
    gpsKm: existing?.gpsKm ?? null,
    source: 'api',
  });
}
