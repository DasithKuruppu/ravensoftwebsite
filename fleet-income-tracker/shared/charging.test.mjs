/**
 * Charging as it happened, not as it was budgeted.
 *
 * The rules being pinned here are the ones that were getting these figures
 * wrong: prefer logged sessions, mark modelled days as estimates, and never
 * divide a cost by a distance that came from a different set of days.
 */
import { describe, it, expect } from 'vitest';
import { chargingForMonth, chargingWindow, daySessionTotal, dayKwh, dayKm, matchedRate, isDriverPermitted, isDriverVisible, driverVisibleCosts, chargeType, dayChargingByType } from './costs.mjs';

/** The configured fallback: a flat rate per day driven. */
const PER_DAY = [{ category: 'charging', frequency: 'daily', amount: 2600 }];
const PER_KM = [{ category: 'charging', frequency: 'perKm', amount: 12 }];

const day = (date, over = {}) => ({ date, revenue: 10000, trips: 10, gpsKm: 150, ...over });
const session = (amount, over = {}) => ({ id: `s-${amount}`, amount, station: '', kwh: null, ...over });

describe('a day of sessions', () => {
  it('sums several sessions in a day', () => {
    const entry = day('2026-07-20', { chargeSessions: [session(1200), session(800), session(450)] });
    expect(daySessionTotal(entry)).toEqual({ total: 2450, sessions: 3 });
  });

  it('ignores sessions with no usable amount', () => {
    const entry = day('2026-07-20', {
      chargeSessions: [session(1200), session(0), { amount: 'free' }, session(-50)],
    });
    expect(daySessionTotal(entry)).toEqual({ total: 1200, sessions: 1 });
  });

  it('has nothing to report on a day with no sessions', () => {
    expect(daySessionTotal(day('2026-07-20'))).toBe(null);
    expect(daySessionTotal(day('2026-07-20', { chargeSessions: [] }))).toBe(null);
  });

  it('totals kWh only from the sessions that recorded it', () => {
    const entry = day('2026-07-20', {
      chargeSessions: [session(1200, { kwh: 18.5 }), session(800, { kwh: 12 }), session(400)],
    });
    expect(dayKwh(entry)).toBe(30.5);
    expect(dayKwh(day('2026-07-20', { chargeSessions: [session(400)] }))).toBe(null);
  });

  it('charges the distance the tracker saw, falling back to Uber’s', () => {
    expect(dayKm(day('2026-07-20', { gpsKm: 210, uberKm: 120 }))).toBe(210);
    expect(dayKm(day('2026-07-20', { gpsKm: null, uberKm: 120 }))).toBe(120);
    expect(dayKm(day('2026-07-20', { gpsKm: null, uberKm: null }))).toBe(0);
  });
});

describe('chargingForMonth', () => {
  it('prefers what was paid and models only the rest', () => {
    const month = chargingForMonth(
      [
        day('2026-07-20', { chargeSessions: [session(2000)] }),
        day('2026-07-21'),
        day('2026-07-22', { chargeSessions: [session(1500), session(900)] }),
      ],
      PER_DAY,
      '2026-07',
    );

    expect(month.logged).toBe(4400);
    expect(month.modelled).toBe(2600);
    expect(month.total).toBe(7000);
    expect(month.loggedDays).toBe(2);
    expect(month.modelledDays).toBe(1);
    // Every day says which kind it is.
    expect(month.days.map((d) => d.estimated)).toEqual([false, true, false]);
    expect(month.days.find((d) => d.date === '2026-07-22').sessions).toBe(2);
  });

  it('models a per-km rate against that day’s own distance', () => {
    const month = chargingForMonth([day('2026-07-20', { gpsKm: 200 })], PER_KM, '2026-07');
    expect(month.total).toBe(2400);
    expect(month.days[0].estimated).toBe(true);
  });

  it('leaves days off out entirely', () => {
    const month = chargingForMonth(
      [day('2026-07-20', { offDay: true, revenue: 0, trips: 0, gpsKm: 0 }), day('2026-07-21')],
      PER_DAY,
      '2026-07',
    );
    expect(month.days).toHaveLength(1);
    expect(month.total).toBe(2600);
  });

  it('still counts a logged session on a day with no driving recorded', () => {
    // He plugged in; the day's figures have not been imported yet. The money left
    // his pocket either way.
    const month = chargingForMonth(
      [{ date: '2026-07-20', revenue: 0, trips: 0, gpsKm: 0, chargeSessions: [session(3000)] }],
      PER_DAY,
      '2026-07',
    );
    expect(month.total).toBe(3000);
    expect(month.days[0].km).toBe(0);
    expect(month.days[0].perKm).toBe(null);
  });

  it('ignores a charging line that had not started yet', () => {
    const month = chargingForMonth(
      [day('2026-07-20')],
      [{ category: 'charging', frequency: 'daily', amount: 2600, date: '2026-09-01' }],
      '2026-07',
    );
    expect(month.total).toBe(0);
  });
});

describe('per-km over matched days only', () => {
  it('excludes a day with cost but no distance from BOTH sides', () => {
    const month = chargingForMonth(
      [
        day('2026-07-20', { gpsKm: 100, chargeSessions: [session(2000)] }),
        // GPS sync failed: cost, no distance. Counting the cost against the
        // month's other kilometres is what made the rate jump for no reason.
        day('2026-07-21', { gpsKm: 0, uberKm: null, chargeSessions: [session(3000)] }),
        day('2026-07-22', { gpsKm: 200, chargeSessions: [session(2600)] }),
      ],
      PER_DAY,
      '2026-07',
    );

    expect(month.total).toBe(7600);
    // Matched: 2,000 + 2,600 over 100 + 200 km.
    expect(month.matchedDays).toBe(2);
    expect(month.matchedKm).toBe(300);
    expect(month.perKm).toBe(15.33);
    // Not the unmatched figure, which would have been 7,600 / 300 = 25.33.
    expect(month.perKm).not.toBe(25.33);
  });

  it('excludes a day with distance but no cost', () => {
    const rate = matchedRate([
      { cost: 2000, km: 100, estimated: false },
      { cost: 0, km: 400, estimated: false },
    ]);
    expect(rate.matchedDays).toBe(1);
    expect(rate.perKm).toBe(20);
  });

  it('reports no rate rather than a meaningless one', () => {
    const rate = matchedRate([{ cost: 3000, km: 0, estimated: false }]);
    expect(rate.perKm).toBe(null);
    expect(rate.matchedDays).toBe(0);
  });

  it('flags a rate that leans on a modelled day', () => {
    expect(matchedRate([{ cost: 2600, km: 200, estimated: true }]).matchedEstimated).toBe(true);
    expect(matchedRate([{ cost: 2600, km: 200, estimated: false }]).matchedEstimated).toBe(false);
  });
});

describe('the trailing week', () => {
  const month = chargingForMonth(
    [
      day('2026-07-18', { gpsKm: 100, chargeSessions: [session(3000)] }),
      day('2026-07-20', { gpsKm: 100, chargeSessions: [session(1000)] }),
      day('2026-07-24', { gpsKm: 200, chargeSessions: [session(2000)] }),
      day('2026-07-25', { gpsKm: 150 }),
    ],
    PER_DAY,
    '2026-07',
  );

  it('covers seven days ending today, inclusive', () => {
    const week = chargingWindow(month, '2026-07-25');
    expect(week.from).toBe('2026-07-19');
    expect(week.to).toBe('2026-07-25');
    // The 18th is outside it; the dear day does not follow him around forever.
    expect(week.days.map((d) => d.date)).toEqual(['2026-07-20', '2026-07-24', '2026-07-25']);
  });

  it('rates the window over its own matched days', () => {
    const week = chargingWindow(month, '2026-07-25');
    // (1,000 + 2,000 + 2,600) / (100 + 200 + 150)
    expect(week.matchedDays).toBe(3);
    expect(week.perKm).toBe(12.44);
    expect(week.matchedEstimated).toBe(true);
  });

  it('smooths a charge-tonight-drive-tomorrow day, which one day cannot', () => {
    const week = chargingWindow(month, '2026-07-20');
    // On its own the 20th reads 10.00 a km; the 18th read 30.00. Neither is the
    // truth about where he charges, which is the argument for the window.
    expect(month.days.find((d) => d.date === '2026-07-18').perKm).toBe(30);
    expect(month.days.find((d) => d.date === '2026-07-20').perKm).toBe(10);
    expect(week.perKm).toBe(20);
  });

  it('has no rate when the window has nothing matched in it', () => {
    expect(chargingWindow(month, '2026-08-30').perKm).toBe(null);
  });
});

/**
 * Which cost lines a driver may be shown.
 *
 * The gate is a category whitelist rather than a per-line flag, so a tick can
 * only ever hide something already inside it — never reveal something outside.
 */
describe('what the driver is allowed to see', () => {
  it('permits charging and the catch-all, and nothing else', () => {
    expect(isDriverPermitted({ category: 'charging' })).toBe(true);
    expect(isDriverPermitted({ category: 'other' })).toBe(true);
    for (const category of ['lease', 'depreciation', 'insurance', 'licence', 'maintenance', 'connectivity']) {
      expect(isDriverPermitted({ category })).toBe(false);
    }
  });

  /**
   * `other` is the catch-all — the likeliest place for an owner-only figure to
   * be filed by mistake — so it is off until the owner ticks that line.
   */
  it('shows an "other" line only once it is ticked', () => {
    expect(isDriverVisible({ category: 'other', amount: 800 })).toBe(false);
    expect(isDriverVisible({ category: 'other', amount: 800, driverVisible: true })).toBe(true);
    expect(isDriverVisible({ category: 'other', amount: 800, driverVisible: false })).toBe(false);
  });

  it('still shows charging without anyone ticking anything', () => {
    expect(isDriverVisible({ category: 'charging' })).toBe(true);
  });

  it('cannot be talked into revealing the lease by a tick', () => {
    expect(isDriverVisible({ category: 'lease', driverVisible: true })).toBe(false);
    expect(driverVisibleCosts([
      { id: 'lease', category: 'lease', driverVisible: true, amount: 52000 },
      { id: 'wash', category: 'other', driverVisible: true, amount: 800 },
    ]).map((c) => c.id)).toEqual(['wash']);
  });
});

/**
 * Fast against home.
 *
 * Worth telling apart because they are different costs with different levers:
 * fast is bought at a station with a receipt, home is metered on the house bill
 * at roughly a third off-peak. "Charge at home more" is only actionable advice
 * if the screen can show how much of the month was not.
 */
describe('charging split by where it was bought', () => {
  const day = (date, sessions, km = 100) => ({ date, gpsKm: km, revenue: 5000, chargeSessions: sessions });

  it('adds each kind up separately across the month', () => {
    const out = chargingForMonth(
      [
        day('2026-07-01', [{ id: 'a', amount: 900, type: 'fast' }, { id: 'b', amount: 300, type: 'home' }]),
        day('2026-07-02', [{ id: 'c', amount: 600, type: 'fast' }]),
      ],
      [],
      '2026-07',
    );
    expect(out.byType).toEqual({ fast: 1500, home: 300, unknown: 0 });
    expect(out.logged).toBe(1800);
  });

  /**
   * A session written before the field existed is not assumed to be either.
   * Guessing would file home charging in the expensive column, or the reverse,
   * and move the very figure the driver is being asked to act on.
   */
  it('keeps an untyped session out of both columns', () => {
    const out = chargingForMonth([day('2026-07-01', [{ id: 'a', amount: 900 }])], [], '2026-07');
    expect(out.byType).toEqual({ fast: 0, home: 0, unknown: 900 });
    expect(out.logged).toBe(900);
  });

  it('attributes nothing to a kind on a modelled day', () => {
    // No sessions, so the cost is the configured rate — a budget figure, and the
    // car was never plugged in anywhere it could be attributed to.
    const out = chargingForMonth(
      [{ date: '2026-07-01', gpsKm: 100, revenue: 5000, chargeSessions: [] }],
      [{ id: 'charging', category: 'charging', frequency: 'perKm', amount: 12 }],
      '2026-07',
    );
    expect(out.modelled).toBe(1200);
    expect(out.byType).toEqual({ fast: 0, home: 0, unknown: 0 });
  });

  it('reads the kind off a session, defaulting to unknown', () => {
    expect(chargeType({ type: 'fast' })).toBe('fast');
    expect(chargeType({ type: 'home' })).toBe('home');
    expect(chargeType({ type: 'petrol' })).toBe('unknown');
    expect(chargeType({})).toBe('unknown');
  });
});
