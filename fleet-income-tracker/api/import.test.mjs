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

/**
 * `putEntry` replaces the whole item, so any writer that rebuilds an entry
 * deletes every column it does not name. These are the columns no CSV describes
 * and no import owns: the driver marks his own days off and logs his own
 * charging, and an import over that day used to wipe both.
 */
describe('what an import must not destroy', () => {
  it('keeps a day the driver marked off', async () => {
    await store.putEntry(DEFAULT_DRIVER, { date: '2026-07-20', revenue: 0, offDay: true });
    await importRows([{ date: '2026-07-20', revenue: '12000', trips: '9' }]);
    const day = await get('2026-07-20');
    expect(day.offDay).toBe(true);
    // and still takes the figures the CSV did describe
    expect(day.revenue).toBe(12000);
    expect(day.trips).toBe(9);
  });

  it('keeps the charging sessions logged against the day', async () => {
    await store.putEntry(DEFAULT_DRIVER, {
      date: '2026-07-20',
      revenue: 0,
      chargeSessions: [{ id: 'a', amount: 2400, station: 'Keells Kottawa', kwh: 32 }],
    });
    await importRows([{ date: '2026-07-20', revenue: '12000' }]);
    const day = await get('2026-07-20');
    expect(day.chargeSessions).toHaveLength(1);
    expect(day.chargeSessions[0].amount).toBe(2400);
  });

  it('leaves a normal day alone', async () => {
    await importRows([{ date: '2026-07-21', revenue: '9000' }]);
    const day = await get('2026-07-21');
    expect(day.offDay).toBe(false);
    expect(day.chargeSessions).toEqual([]);
  });
});

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

describe('cash reconciliation', () => {
  it('sums cash per day and stores it as a positive amount', async () => {
    // Uber books cash as a deduction from the payout, so the export is negative.
    await importRows([
      { date: '2026-07-20', revenue: '2573.21', cashCollected: '-1505.15' },
      { date: '2026-07-25', revenue: '2417.50', cashCollected: '-397.57' },
    ]);
    expect((await get('2026-07-20')).cashCollected).toBe(1505.15);
    expect((await get('2026-07-25')).cashCollected).toBe(397.57);
  });

  it('adds up several transactions on the same day', async () => {
    await importRows([
      { date: '2026-07-22', revenue: '1000', cashCollected: '-400' },
      { date: '2026-07-22', revenue: '2000', cashCollected: '-600' },
    ]);
    const day = await get('2026-07-22');
    expect(day.revenue).toBe(3000);
    expect(day.cashCollected).toBe(1000);
  });

  it('keeps cash when a later import has no cash column', async () => {
    await importRows([{ date: '2026-07-21', revenue: '10211.21', cashCollected: '-4414.75' }]);
    // trip activity export: distance only, no fare and no cash
    await importRows([{ date: '2026-07-21', uberKm: '12.5' }]);
    const day = await get('2026-07-21');
    expect(day.cashCollected).toBe(4414.75);
    expect(day.revenue).toBe(10211.21);
    expect(day.uberKm).toBe(12.5);
  });

  it('leaves cash unknown rather than zero when never supplied', async () => {
    await importRows([{ date: '2026-07-23', revenue: '500' }]);
    expect((await get('2026-07-23')).cashCollected).toBeNull();
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
