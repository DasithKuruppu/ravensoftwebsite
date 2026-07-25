/**
 * Import merge semantics.
 *
 * Uber splits the data across two reports: the earnings summary has fares but
 * no distance and no date, the trip activity export has dates and distance but
 * no fare. Both must be importable into the same day without either wiping the
 * other's columns.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the file store at a scratch file before the module is loaded.
process.env.LOCAL_STORE_FILE = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-test-')),
  'store.json',
);
process.env.JWT_SECRET = 'test-secret';

const { importRows } = await import('./handler.mjs');
const { store, DEFAULT_DRIVER } = await import('./store.mjs');

beforeEach(() => {
  fs.rmSync(process.env.LOCAL_STORE_FILE, { force: true });
});

const get = (date) => store.getEntry(DEFAULT_DRIVER, date);

describe('importRows', () => {
  it('sums per-trip rows into one entry per date', async () => {
    await importRows([
      { date: '2026-07-20', uberKm: '1.56' },
      { date: '2026-07-20', uberKm: '23.92' },
      { date: '2026-07-21', uberKm: '14.91' },
    ]);
    const day = await get('2026-07-20');
    expect(day.uberKm).toBe(25.48);
    expect(day.trips).toBe(2); // each per-trip row counts as one trip
    expect((await get('2026-07-21')).trips).toBe(1);
  });

  it('keeps existing revenue when the import has no fare column', async () => {
    // earnings summary first
    await importRows([{ date: '2026-07-25', revenue: '2451.18', trips: '2' }]);
    // then the trip activity export, which carries no fare at all
    await importRows([
      { date: '2026-07-25', uberKm: '1.56' },
      { date: '2026-07-25', uberKm: '23.92' },
    ]);

    const day = await get('2026-07-25');
    expect(day.revenue).toBe(2451.18); // preserved, not zeroed
    expect(day.uberKm).toBe(25.48); // added by the second import
  });

  it('keeps existing distance when the import has no distance column', async () => {
    await importRows([{ date: '2026-07-25', uberKm: '25.48' }]);
    await importRows([{ date: '2026-07-25', revenue: '2451.18', trips: '2' }]);

    const day = await get('2026-07-25');
    expect(day.uberKm).toBe(25.48);
    expect(day.revenue).toBe(2451.18);
    expect(day.trips).toBe(2);
  });

  it('never overwrites GPS mileage, which comes from the tracker sync', async () => {
    await store.putEntry(DEFAULT_DRIVER, {
      date: '2026-07-25', revenue: 0, trips: null, uberKm: null, gpsKm: 34.59, source: 'api',
    });
    await importRows([{ date: '2026-07-25', revenue: '2451.18' }]);
    expect((await get('2026-07-25')).gpsKm).toBe(34.59);
  });

  it('does not invent a trip count for a revenue-only import', async () => {
    await importRows([{ date: '2026-07-25', revenue: '2451.18' }]);
    expect((await get('2026-07-25')).trips).toBeNull();
  });

  it('parses Uber datetimes, currency strings and US-style dates', async () => {
    const res = await importRows([
      { date: '2026-07-25 09:32:39', revenue: 'LKR 1,250.50' },
      { date: '07/24/2026', revenue: '900.25' },
      { date: '', revenue: '50' },
      { date: 'not a date', revenue: '10' },
    ]);
    expect(res.skipped).toBe(2);
    expect((await get('2026-07-25')).revenue).toBe(1250.5);
    expect((await get('2026-07-24')).revenue).toBe(900.25);
  });
});

const { gpsDelta, GPS_DELTA_THRESHOLD_PCT } = await import('./handler.mjs');

describe('gpsDelta', () => {
  it('uses a threshold calibrated to real on-trip vs odometer distance', () => {
    expect(GPS_DELTA_THRESHOLD_PCT).toBe(150);
  });

  it('leaves a normal ride-hailing day unflagged', () => {
    // Real days from the fleet: GPS runs 1.6-2.8x Uber's on-trip distance,
    // because Uber does not count driving to pickups or between fares.
    for (const [uberKm, gpsKm] of [
      [121.07, 191.46],
      [153.16, 297.36],
      [163.05, 267.35],
      [25.48, 42.53],
    ]) {
      expect(gpsDelta(uberKm, gpsKm).flagged).toBe(false);
    }
  });

  it('flags a day whose driving far outruns its fares', () => {
    const { deltaPct, flagged } = gpsDelta(35.5, 97.74);
    expect(deltaPct).toBe(175.32);
    expect(flagged).toBe(true);
  });

  it('reports the delta in kilometres too', () => {
    expect(gpsDelta(100, 260).deltaKm).toBe(160);
  });

  it('does not flag when GPS is lower than Uber', () => {
    expect(gpsDelta(100, 80).flagged).toBe(false);
    expect(gpsDelta(100, 80).deltaPct).toBe(-20);
  });
});
