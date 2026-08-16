import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RATES,
  DURATION_CHOICES,
  withDefaults,
  chargeTime,
  nightsAway,
  hireHours,
  hoursForDays,
  daysForHours,
  suggestedChoice,
  dailyBasis,
  quote,
} from './pricing.mjs';
import { MAX_HOURS } from './trip.mjs';

const R = DEFAULT_RATES;

describe('withDefaults', () => {
  it('fills gaps left by a partially saved rate card', () => {
    const r = withDefaults({ dayRate: 20000 });
    expect(r.dayRate).toBe(20000);
    expect(r.includedKmPerDay).toBe(R.includedKmPerDay);
  });

  it('never leaves the vehicle list empty, or every quote would fail', () => {
    const restored = withDefaults({ vehicleClasses: [] }).vehicleClasses;
    expect(restored).toEqual(DEFAULT_RATES.vehicleClasses);
    expect(restored.length).toBeGreaterThan(0);
  });
});

describe('chargeTime', () => {
  it('charges the minimum day for anything shorter', () => {
    expect(chargeTime(3, R)).toEqual({ days: 1, overtimeHours: 0, roundedUpToDay: false });
  });

  it('charges leftover hours hourly inside a single day', () => {
    // A day is 10 hours, so 16 is a day plus six.
    expect(chargeTime(16, R)).toEqual({ days: 1, overtimeHours: 6, roundedUpToDay: false });
  });

  it('rounds up rather than charging more overtime than a whole day costs', () => {
    // 20h = 1 day + 10h. 10 × 2,200 = 22,000 > the 20,000 day rate.
    expect(chargeTime(20, R)).toEqual({ days: 2, overtimeHours: 0, roundedUpToDay: true });
    // 18h = 1 day + 8h, and 8 × 2,200 = 17,600 is still under a day, so it stays
    // hourly. The boundary moves with the rates rather than sitting on a literal.
    expect(chargeTime(18, R)).toEqual({ days: 1, overtimeHours: 8, roundedUpToDay: false });
  });

  it('counts whole days once the hire runs past 24 hours', () => {
    // A driver on a touring day is not on duty for all of it. Charging a 24-hour
    // hire as three eight-hour days would bill his night as work.
    expect(chargeTime(24, R)).toEqual({ days: 2, overtimeHours: 0, roundedUpToDay: true });
    expect(chargeTime(30, R).days).toBe(2);
    expect(chargeTime(120, R).days).toBe(5);
  });

  it('prices a five-day tour as five days, not fifteen', () => {
    const q = quote({ startAt: '2026-09-01T02:00:00Z', requestedHours: 120, distanceKm: 500 }, R);
    expect(q.basis.days).toBe(5);
    // Out at 07:30 Colombo and back five days later, so five nights away — the
    // driver sleeps out on the last night too and comes home on the morning of
    // the sixth day. 5 × 14,000, 500 km exactly inside the allowance, 5 nights.
    expect(q.basis.nights).toBe(5);
    expect(q.total).toBe(5 * 20000 + 5 * R.overnightStay);
  });

  it('has no price spike just before a day boundary', () => {
    const at = (h) => quote({ startAt: '2026-09-01T02:00:00Z', requestedHours: h, distanceKm: 0 }, R).total;
    // Walking across every boundary out to a week, the price must never fall.
    for (let h = 8; h <= 168; h += 0.5) {
      expect(at(h + 0.5)).toBeGreaterThanOrEqual(at(h));
    }
  });
});

describe('nightsAway', () => {
  // 02:00Z is 07:30 in Colombo.
  it('counts no night for a day trip', () => {
    expect(nightsAway('2026-09-01T02:00:00Z', 8)).toBe(0);
  });

  it('counts one night when the trip runs past local midnight', () => {
    expect(nightsAway('2026-09-01T02:00:00Z', 20)).toBe(1);
  });

  it('counts by Colombo midnights, not the booker’s', () => {
    // 21:00 Colombo start, 4 hours: crosses Colombo midnight but not UTC's.
    expect(nightsAway('2026-09-01T15:30:00Z', 4)).toBe(1);
  });

  it('is zero for an unparseable date rather than NaN nights', () => {
    expect(nightsAway('not a date', 30)).toBe(0);
  });
});

describe('hireHours', () => {
  it('honours the request when the route fits inside it', () => {
    const h = hireHours({ requestedHours: 10, drivingHours: 4 }, R);
    expect(h).toMatchObject({ hours: 10, drivenBy: 'request' });
  });

  it('stretches to the route when the ask cannot fit the driving', () => {
    const h = hireHours({ requestedHours: 8, drivingHours: 11, dwellHours: 1 }, R);
    expect(h.hours).toBe(13); // 11 + 1 dwell + 1 buffer
    expect(h.drivenBy).toBe('route');
  });

  it('never returns less than the minimum hire', () => {
    expect(hireHours({ requestedHours: 2, drivingHours: 1 }, R).hours).toBe(R.hoursPerDay);
  });
});

describe('quote', () => {
  const base = {
    startAt: '2026-09-01T02:00:00Z',
    requestedHours: 8,
    distanceKm: 80,
    drivingHours: 2,
    vehicleClass: 'baw-e7-pro',
  };

  it('prices a short day inside the allowance as one day flat', () => {
    const q = quote(base, R);
    expect(q.total).toBe(20000);
    expect(q.lines.map((l) => l.key)).toEqual(['days']);
  });

  it('charges distance only past the daily allowance', () => {
    const q = quote({ ...base, distanceKm: 260, requestedHours: 12, drivingHours: 5 }, R);
    // 12h → 1 day + 2h overtime; allowance 150 km; 110 km over.
    expect(q.basis).toMatchObject({ days: 1, overtimeHours: 2, excessKm: 110 });
    expect(q.total).toBe(20000 + 2 * 2200 + 110 * 90);
  });

  // The fleet is one hatchback today, so a second vehicle is supplied here
  // rather than assumed. This is the machinery the admin page drives when one
  // is bought, and it must keep working while nothing uses it.
  it('scales time and distance by vehicle class but not the night allowance', () => {
    const twoCars = {
      ...R,
      vehicleClasses: [
        ...R.vehicleClasses,
        { key: 'van', label: 'Van · up to 9 passengers', seats: 9, multiplier: 1.6 },
      ],
    };
    const trip = { ...base, requestedHours: 24, distanceKm: 400, drivingHours: 9 };
    const small = quote({ ...trip, vehicleClass: 'baw-e7-pro' }, twoCars);
    const van = quote({ ...trip, vehicleClass: 'van' }, twoCars);
    // The overnight stay does not scale with the car — it is a cost of the
    // driver — so it comes off before the comparison.
    const flat = small.basis.overnightStay;
    expect(flat).toBeGreaterThan(0);
    expect(van.total - flat).toBeCloseTo((small.total - flat) * 1.6, -2);
  });

  it('ships a fleet of exactly the one vehicle that exists, seating three', () => {
    expect(R.vehicleClasses).toHaveLength(1);
    expect(R.vehicleClasses[0]).toMatchObject({ key: 'baw-e7-pro', seats: 3, multiplier: 1 });
  });

  it('rounds the total up to the nearest hundred', () => {
    const q = quote({ ...base, distanceKm: 143 }, R);
    expect(q.total % 100).toBe(0);
  });

  it('falls back to the first class when an unknown one is asked for', () => {
    expect(quote({ ...base, vehicleClass: 'limousine' }, R).basis.vehicleClass).toBe('baw-e7-pro');
  });

  it('records what the price rested on, so it can be re-checked later', () => {
    const q = quote({ ...base, requestedHours: 30, distanceKm: 500, drivingHours: 12 }, R);
    expect(q.basis).toMatchObject({
      hours: 30,
      hoursDrivenBy: 'request',
      vehicleClass: 'baw-e7-pro',
      multiplier: 1,
    });
    expect(q.basis.nights).toBe(1);
  });

  it('is monotonic in distance and in hours', () => {
    const km = (d) => quote({ ...base, distanceKm: d }, R).total;
    expect(km(500)).toBeGreaterThan(km(300));
    const hrs = (h) => quote({ ...base, requestedHours: h }, R).total;
    expect(hrs(48)).toBeGreaterThan(hrs(24));
  });

  it('follows an edited rate card without a code change', () => {
    const cheap = quote(base, { ...R, dayRate: 9000 });
    expect(cheap.total).toBe(9000);
  });

  it('ships a 20,000 day covering 150 km', () => {
    expect(R.dayRate).toBe(20000);
    expect(R.includedKmPerDay).toBe(150);
    // The floor: no hire is quoted below one day at the day rate.
    expect(quote({ ...base, distanceKm: 0, requestedHours: 1 }, R).total).toBe(20000);
  });
});

describe('DURATION_CHOICES / hoursForDays', () => {
  it('bills exactly the number of days the customer picked', () => {
    for (const c of DURATION_CHOICES) {
      const hours = hoursForDays(c.days, R);
      expect(chargeTime(hours, R).days).toBe(c.days);
    }
  });

  it('counts one night fewer than days — out in the morning, back in the evening', () => {
    for (const c of DURATION_CHOICES) {
      const q = quote(
        { startAt: '2026-09-01T02:00:00Z', requestedHours: hoursForDays(c.days, R), distanceKm: 0 },
        R,
      );
      expect(q.basis.nights).toBe(c.days - 1);
    }
  });

  it('treats a single day as a working day, not a revolution of the clock', () => {
    // 24 hours would be billed as two days and carry a night's allowance for a
    // trip that never stopped anywhere.
    expect(hoursForDays(1, R)).toBe(R.hoursPerDay);
    expect(quote({ startAt: '2026-09-01T02:00:00Z', requestedHours: hoursForDays(1, R), distanceKm: 0 }, R).total)
      .toBe(R.dayRate);
  });

  it('prices a week and a month without tripping the form’s ceiling', () => {
    expect(hoursForDays(7, R)).toBe(154);
    expect(hoursForDays(30, R)).toBe(706);
    expect(hoursForDays(30, R)).toBeLessThanOrEqual(MAX_HOURS);
  });

  it('round-trips back to the choice that made it', () => {
    for (const c of DURATION_CHOICES) {
      expect(daysForHours(hoursForDays(c.days, R), R)).toBe(c.days);
    }
  });

  it('never offers less than a day', () => {
    expect(Math.min(...DURATION_CHOICES.map((c) => c.days))).toBe(1);
    expect(hoursForDays(0, R)).toBe(R.hoursPerDay);
    expect(hoursForDays(-5, R)).toBe(R.hoursPerDay);
  });
});

describe('suggestedChoice', () => {
  it('leaves a day trip alone', () => {
    expect(suggestedChoice(5, R).days).toBe(1);
    expect(suggestedChoice(8, R).days).toBe(1);
  });

  it('suggests two days once the driving alone passes a working day', () => {
    expect(suggestedChoice(10.5, R).days).toBe(2);
    // Colombo to Ella and back is a little over ten hours at the wheel — just
    // past what one day now holds.
    expect(suggestedChoice(10.17, R).days).toBe(2);
    expect(suggestedChoice(20, R).days).toBe(2);
  });

  it('leaves a long but single day alone now that a day is ten hours', () => {
    expect(suggestedChoice(9.5, R).days).toBe(1);
    expect(suggestedChoice(10, R).days).toBe(1);
  });

  it('keeps scaling for genuinely long itineraries', () => {
    expect(suggestedChoice(25, R).days).toBe(3);
    expect(suggestedChoice(35, R).days).toBe(4);
  });

  it('only ever suggests a length actually on offer', () => {
    const offered = DURATION_CHOICES.map((c) => c.days);
    for (let h = 0; h <= 300; h += 1.5) {
      expect(offered).toContain(suggestedChoice(h, R).days);
    }
  });

  it('follows an edited working day', () => {
    // A fleet that calls fourteen hours a day should not be told thirteen is
    // too many.
    expect(suggestedChoice(13, { ...R, hoursPerDay: 14 }).days).toBe(1);
  });

  it('is not thrown by junk', () => {
    expect(suggestedChoice(NaN, R).days).toBe(1);
    expect(suggestedChoice(-5, R).days).toBe(1);
  });
});

describe('dailyBasis — hiring by the day rather than the journey', () => {
  const at = '2026-09-01T02:00:00Z';

  it('defaults the allowance to the days’ own included distance', () => {
    const b = dailyBasis({ days: 4, startAt: at }, R);
    expect(b.distanceKm).toBe(4 * R.includedKmPerDay);
    expect(b.requestedHours).toBe(hoursForDays(4, R));
  });

  it('prices a plain multi-day hire as days plus overnight stays, nothing else', () => {
    const q = quote(dailyBasis({ days: 4, startAt: at }, R), R);
    expect(q.basis).toMatchObject({ days: 4, nights: 3, excessKm: 0 });
    expect(q.total).toBe(4 * R.dayRate + 3 * R.overnightStay);
  });

  it('charges only the kilometres asked for beyond the allowance', () => {
    const q = quote(dailyBasis({ days: 2, allowanceKm: 600, startAt: at }, R), R);
    // 2 days include 300 km; 300 km beyond.
    expect(q.basis.excessKm).toBe(300);
    expect(q.total).toBe(2 * R.dayRate + 300 * R.perKmOver + 1 * R.overnightStay);
  });

  it('never lets an allowance fall below what the days already include', () => {
    expect(dailyBasis({ days: 3, allowanceKm: 10, startAt: at }, R).distanceKm).toBe(450);
    expect(dailyBasis({ days: 3, allowanceKm: 0, startAt: at }, R).distanceKm).toBe(450);
  });

  it('agrees with a routed trip of the same days and kilometres', () => {
    // The two ways of buying must never quote differently for the same thing.
    const daily = quote(dailyBasis({ days: 3, allowanceKm: 900, startAt: at }, R), R);
    const routed = quote(
      { startAt: at, requestedHours: hoursForDays(3, R), distanceKm: 900, drivingHours: 0 },
      R,
    );
    expect(daily.total).toBe(routed.total);
  });

  it('is monotonic in both days and kilometres', () => {
    const t = (d, km) => quote(dailyBasis({ days: d, allowanceKm: km, startAt: at }, R), R).total;
    expect(t(5, 1000)).toBeGreaterThan(t(4, 1000));
    expect(t(4, 1600)).toBeGreaterThan(t(4, 800));
  });

  it('survives junk without producing NaN', () => {
    const q = quote(dailyBasis({ days: 'x', allowanceKm: 'y', startAt: at }, R), R);
    expect(Number.isFinite(q.total)).toBe(true);
    expect(q.basis.days).toBe(1);
  });
});

describe("the driver's overnight stay", () => {
  const at = '2026-09-01T02:00:00Z';
  const day = { startAt: at, requestedHours: 8, distanceKm: 50, drivingHours: 2 };

  it('is not charged on a trip that is back the same evening', () => {
    const q = quote(day, R);
    expect(q.basis.overnightStay).toBe(0);
    expect(q.lines.map((l) => l.key)).not.toContain('overnightStay');
    expect(q.total).toBe(R.dayRate);
  });

  it('is charged as soon as a routed trip runs into a second day', () => {
    const q = quote({ ...day, requestedHours: hoursForDays(2, R) }, R);
    expect(q.basis.nights).toBe(1);
    expect(q.basis.overnightStay).toBe(5000);
    expect(q.lines.find((l) => l.key === 'overnightStay').amount).toBe(5000);
  });

  it('is charged for every night away, not once per hire', () => {
    for (const days of [2, 4, 7, 30]) {
      const q = quote({ ...day, requestedHours: hoursForDays(days, R) }, R);
      expect(q.basis.nights).toBe(days - 1);
      expect(q.basis.overnightStay).toBe((days - 1) * 5000);
    }
  });

  it('is not charged on a one-day hire taken by the day — there is no night', () => {
    const q = quote(dailyBasis({ days: 1, startAt: at }, R), R);
    expect(q.basis.nights).toBe(0);
    expect(q.basis.overnightStay).toBe(0);
    expect(q.total).toBe(R.dayRate);
  });

  it('is the only per-night driver charge — the old allowance is folded in', () => {
    const q = quote({ ...day, requestedHours: hoursForDays(3, R) }, R);
    expect(q.lines.filter((l) => l.key === 'nights')).toHaveLength(0);
    expect(q.lines.filter((l) => l.key === 'overnightStay')).toHaveLength(1);
  });

  it('is a cost of the driver, so no vehicle multiplier touches it', () => {
    const twoCars = {
      ...R,
      vehicleClasses: [...R.vehicleClasses, { key: 'van', label: 'Van · 9', seats: 9, multiplier: 2 }],
    };
    const trip = { ...day, requestedHours: hoursForDays(3, R) };
    const small = quote({ ...trip, vehicleClass: 'baw-e7-pro' }, twoCars);
    const van = quote({ ...trip, vehicleClass: 'van' }, twoCars);
    expect(small.basis.overnightStay).toBe(van.basis.overnightStay);
  });

  it('follows the rate card, including being switched off', () => {
    const none = quote({ ...day, requestedHours: hoursForDays(3, R) }, { ...R, overnightStay: 0 });
    expect(none.basis.overnightStay).toBe(0);
    expect(none.lines.map((l) => l.key)).not.toContain('overnightStay');
  });

  it('keeps the two ways of buying in agreement on a multi-day hire', () => {
    const daily = quote(dailyBasis({ days: 3, allowanceKm: 900, startAt: at }, R), R);
    const routed = quote(
      { startAt: at, requestedHours: hoursForDays(3, R), distanceKm: 900, drivingHours: 0 },
      R,
    );
    expect(daily.total).toBe(routed.total);
  });
});

describe('the customer providing food and lodging', () => {
  const at = '2026-09-01T02:00:00Z';
  const threeDays = { startAt: at, requestedHours: hoursForDays(3, R), distanceKm: 50 };

  it('drops the nightly rate to the hosted one', () => {
    const full = quote(threeDays, R);
    const hosted = quote({ ...threeDays, driverHosted: true }, R);
    expect(full.basis.overnightStay).toBe(2 * R.overnightStay);
    expect(hosted.basis.overnightStay).toBe(2 * R.overnightStayHosted);
    // The whole charge comes off: 5,000 a night saved.
    expect(full.total - hosted.total).toBe(2 * R.overnightStay);
    expect(hosted.total).toBeLessThan(full.total);
  });

  it('saves the difference on every night, not just the first', () => {
    const saving = (days) => {
      const t = { ...threeDays, requestedHours: hoursForDays(days, R) };
      return quote(t, R).total - quote({ ...t, driverHosted: true }, R).total;
    };
    expect(saving(2)).toBe(1 * (R.overnightStay - R.overnightStayHosted));
    expect(saving(5)).toBe(4 * (R.overnightStay - R.overnightStayHosted));
  });

  it('changes nothing on a hire with no nights in it', () => {
    const day = { startAt: at, requestedHours: 8, distanceKm: 50 };
    expect(quote({ ...day, driverHosted: true }, R).total).toBe(quote(day, R).total);
  });

  it('applies to a hire taken by the day as well', () => {
    const full = quote(dailyBasis({ days: 4, startAt: at }, R), R);
    const hosted = quote(dailyBasis({ days: 4, startAt: at, driverHosted: true }, R), R);
    expect(full.total - hosted.total).toBe(3 * (R.overnightStay - R.overnightStayHosted));
  });

  it('drops the line entirely rather than showing a nought', () => {
    const q = quote({ ...threeDays, driverHosted: true }, R);
    expect(q.basis.driverHosted).toBe(true);
    expect(q.basis.overnightStay).toBe(0);
    expect(q.lines.map((l) => l.key)).not.toContain('overnightStay');
  });

  it('still explains itself when the hosted rate is not free', () => {
    const partial = { ...R, overnightStayHosted: 2000 };
    const q = quote({ ...threeDays, driverHosted: true }, partial);
    expect(q.lines.find((l) => l.key === 'overnightStay').detail).toContain('you are providing');
  });

  it('can never cost more than not hosting, however the card is edited', () => {
    // A mis-edited card must not make offering to help the dearer option.
    const daft = { ...R, overnightStayHosted: 99000 };
    const full = quote(threeDays, daft);
    const hosted = quote({ ...threeDays, driverHosted: true }, daft);
    expect(hosted.total).toBeLessThanOrEqual(full.total);
  });
});
