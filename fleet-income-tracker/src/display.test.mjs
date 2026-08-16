import { describe, it, expect } from 'vitest';
import {
  displayThreshold,
  displayBase,
  perDayThreshold,
  workingDaysLeft,
  workingDaysInMonth,
  tripsPerDay,
  averageDays,
  offDaysCost,
  driverNameIn,
  payAt,
  targetForMonth,
  dailyTarget,
  targetProgress,
  bestRecordedDay,
  revenueForPay,
  revenueTargetForMonth,
  payAtTargetForMonth,
  paces,
  goalRungs,
  uberCut,
  farePer1000,
  chargingLens,
  chargingWeek,
  chargingForDay,
  rollingPace,
  cashPocket,
  lastLoggedDay,
  chargingHeadline,
  nextZone,
} from './display.js';
import { prorate, monthFactor, DEFAULT_SETTINGS } from '../shared/commission.mjs';
import { generatedAt } from './format.js';
import { setLocale, resetLocale } from './i18n/i18n.js';

/** A full-month summary on the default plan, with the bits the display uses. */
function summary(over = {}) {
  const factor = over.prorationFactor ?? 1;
  const plan = prorate(DEFAULT_SETTINGS, factor);
  return {
    revenue: 0,
    projectedRevenue: 0,
    driverPay: 0,
    dailyAverage: 0,
    trips: 0,
    earningDays: 0,
    daysInMonth: 31,
    operatingDays: 31,
    elapsedDays: 10,
    projectedDays: 21,
    offDaysElapsed: 0,
    offDaysAhead: 0,
    prorationFactor: factor,
    // 350,000 of revenue is what a 93,000 take-home used to be asked for.
    revenueTarget: 350000,
    payTarget: null,
    revenueBasis: 'net',
    uberCommissionRate: 0.25,
    bestDay: null,
    lastMonth: null,
    plan: { base: plan.base, bandStart: plan.bandStart, bandEnd: plan.bandEnd },
    push: { bandRate: DEFAULT_SETTINGS.bandRate, topRate: DEFAULT_SETTINGS.topRate },
    ...over,
  };
}

/** Daily revenues as the cumulative series the API sends for the chart. */
function series(daily) {
  let cumulative = 0;
  return {
    actual: daily.map((r, i) => {
      cumulative += r;
      return { day: i + 1, revenue: cumulative, pay: 0 };
    }),
  };
}

/** July started on the 20th: 12 of 31 days. The partial month in production. */
const JULY_FACTOR = monthFactor('2026-07', '2026-07-20', 31);

describe('displayThreshold', () => {
  it('rounds a prorated threshold down to a clean number', () => {
    // The three figures the partial month actually produces.
    expect(displayThreshold(92903.23)).toBe(92000);
    expect(displayThreshold(116129.03)).toBe(116000);
  });

  it('rounds money paid to the driver up, not down', () => {
    expect(displayBase(19354.84)).toBe(19500);
  });

  it('leaves an already-clean full-month plan untouched', () => {
    expect(displayThreshold(240000)).toBe(240000);
    expect(displayThreshold(300000)).toBe(300000);
    expect(displayBase(50000)).toBe(50000);
  });

  it('is the same value for the chart axis and the copy', () => {
    const plan = prorate(DEFAULT_SETTINGS, JULY_FACTOR);
    // Whatever surface asks, the answer is one number.
    expect(displayThreshold(plan.bandEnd)).toBe(displayThreshold(plan.bandEnd, 'down'));
    expect(displayThreshold(plan.bandStart)).toBe(92000);
  });

  it('never rounds a small figure away to zero', () => {
    expect(displayThreshold(120)).toBe(120);
    expect(displayThreshold(0)).toBe(0);
    expect(displayThreshold(undefined)).toBe(0);
  });
});

describe('perDayThreshold', () => {
  it('divides a prorated threshold by the days it covers, not the calendar', () => {
    const partial = prorate(DEFAULT_SETTINGS, JULY_FACTOR);
    const shown = displayThreshold(partial.bandEnd);
    expect(shown).toBe(116000);
    // 12 operating days, not 31: dividing by the month would prorate a figure
    // that is already prorated, which is how the ladder printed 3,742.
    expect(perDayThreshold(shown, 12)).toBe(9667);
    expect(perDayThreshold(shown, 31)).toBe(3742);
  });

  it('multiplies back to the threshold it came from', () => {
    for (const [threshold, days] of [
      [116000, 12],
      [92000, 12],
      [300000, 31],
      [240000, 31],
    ]) {
      const perDay = perDayThreshold(threshold, days);
      expect(Math.abs(perDay * days - threshold)).toBeLessThanOrEqual(days);
    }
  });

  it('is the same figure in a partial month as in a full one', () => {
    const full = prorate(DEFAULT_SETTINGS, 1);
    const partial = prorate(DEFAULT_SETTINGS, JULY_FACTOR);
    // 300,000 over 31 days, and 116,129 over the 12 days it was scaled to.
    expect(perDayThreshold(full.bandEnd, 31)).toBe(9677);
    expect(perDayThreshold(partial.bandEnd, 12)).toBe(9677);
  });

  it('agrees with the hero tier pace on a month running exactly to the line', () => {
    // Seven of twelve operating days gone, revenue exactly on the tier pace: the
    // ladder's per-day figure and the hero's catch-up rate must be the same
    // number, give or take the rounding each applies.
    const days = 12;
    const elapsed = 7;
    const plan = prorate(DEFAULT_SETTINGS, JULY_FACTOR);
    const tier3 = displayThreshold(plan.bandEnd);
    const onPace = perDayThreshold(tier3, days);
    const s = summary({
      prorationFactor: JULY_FACTOR,
      operatingDays: days,
      elapsedDays: elapsed,
      projectedDays: days - elapsed,
      revenue: onPace * elapsed,
        bestDay: { date: '2026-07-25', revenue: 16000 },
      revenueTarget: null,
    });
    const hero = dailyTarget(s);
    expect(hero.kind).toBe('tier');
    expect(Math.abs(hero.amount - onPace)).toBeLessThanOrEqual(50);
  });
});

describe('days', () => {
  it('counts the days the projection counts', () => {
    expect(workingDaysLeft(summary({ projectedDays: 7 }))).toBe(7);
  });

  it('falls back to operating days less elapsed and planned days off', () => {
    const s = summary({ operatingDays: 31, elapsedDays: 24, offDaysAhead: 2 });
    delete s.projectedDays;
    expect(workingDaysLeft(s)).toBe(5);
  });

  it('never goes negative', () => {
    expect(workingDaysLeft(summary({ projectedDays: -3 }))).toBe(0);
  });

  it('takes days off out of the month, taken and planned alike', () => {
    expect(workingDaysInMonth(summary({ operatingDays: 31, offDaysElapsed: 2, offDaysAhead: 3 }))).toBe(26);
  });

  it('reads trips per earning day', () => {
    expect(tripsPerDay(summary({ trips: 84, earningDays: 9 }))).toBe(9.3);
    expect(tripsPerDay(summary())).toBe(null);
  });

  /**
   * The stat tile prints the average and its denominator on one card, and they
   * have to be the same denominator. The server strikes `dailyAverage` over
   * `paceDays` — complete shifts, days off out — while `earningDays` also counts
   * a shift still being driven. Reading the money off one and the trips off the
   * other put two different averages under one label.
   */
  it('divides trips by the days the average was struck over', () => {
    const s = summary({
      trips: 84,
      earningDays: 10,
      paceDays: 9,
      today: { date: '2026-07-27', revenue: 4200, trips: 6, offDay: false },
    });
    expect(averageDays(s)).toBe(9);
    // Today's 6 trips leave with today's day: 78 over 9 complete shifts.
    expect(tripsPerDay(s)).toBe(8.7);
  });

  it('falls back to earning days when the server sends no pace days', () => {
    const s = summary({ trips: 84, earningDays: 9 });
    expect(averageDays(s)).toBe(9);
    // Nothing to subtract: the fallback denominator counts today itself.
    expect(tripsPerDay(s)).toBe(9.3);
  });

  it('prices the days off still booked at his own daily average', () => {
    // Two days booked ahead, 18,360 on an average day.
    expect(offDaysCost(summary({ offDaysAhead: 2, dailyAverage: 18359.7 }))).toBe(36719);
    // Days already taken are sunk and already out of the average — pricing them
    // again would bill him twice for the same time off.
    expect(offDaysCost(summary({ offDaysElapsed: 3, offDaysAhead: 0, dailyAverage: 18359.7 }))).toBe(null);
  });

  it('prices nothing when there is no average to price it at', () => {
    // A first month with no complete day yet: "−0 not earned" would be a claim,
    // and it would say a day off is free.
    expect(offDaysCost(summary({ offDaysAhead: 2, dailyAverage: 0 }))).toBe(null);
  });

  it('keeps a day off out of the trip count it subtracts', () => {
    const s = summary({
      trips: 84,
      earningDays: 10,
      paceDays: 9,
      today: { date: '2026-07-27', revenue: 0, trips: null, offDay: true },
    });
    expect(tripsPerDay(s)).toBe(9.3);
  });
});

describe('the driver\'s name', () => {
  it('uses the Sinhala spelling only when reading Sinhala', () => {
    const s = summary({ driverName: 'Chandima', driverNameSi: 'චන්දිම' });
    expect(driverNameIn(s, 'en')).toBe('Chandima');
    expect(driverNameIn(s, 'si')).toBe('චන්දිම');
  });

  /**
   * A name is not a string to be translated. With no Sinhala spelling given, the
   * Latin one is shown in both languages rather than transliterated — a guessed
   * spelling of somebody's name is worse than none.
   */
  it('falls back to the Latin name when no Sinhala one is set', () => {
    const s = summary({ driverName: 'Chandima', driverNameSi: '' });
    expect(driverNameIn(s, 'si')).toBe('Chandima');
    const absent = summary({ driverName: 'Chandima' });
    delete absent.driverNameSi;
    expect(driverNameIn(absent, 'si')).toBe('Chandima');
  });

  it('ignores a Sinhala field that is only whitespace', () => {
    expect(driverNameIn(summary({ driverName: 'Chandima', driverNameSi: '   ' }), 'si')).toBe('Chandima');
  });
});

/**
 * The percentages the copy prints are the plan's, not three literals repeated in
 * two dictionaries and a chart. A fleet on different terms must not read a
 * screen that quietly says 50% while paying 40%.
 */
describe('rates in the copy follow the plan', () => {
  const onRates = (bandRate, topRate) => {
    const s = summary({ revenueTarget: null, revenue: 200000, projectedDays: 8 });
    s.push = { ...s.push, bandRate, topRate };
    return s;
  };

  it('names the top rate the plan actually pays', () => {
    expect(dailyTarget(onRates(0.3, 0.5)).pct).toBe(50);
    expect(dailyTarget(onRates(0.25, 0.4)).pct).toBe(40);
  });

  it('carries the same rate onto the hero\'s secondary line', () => {
    const s = summary({ revenueTarget: 274000, revenue: 200000, projectedDays: 8 });
    s.push = { ...s.push, bandRate: 0.25, topRate: 0.4 };
    expect(dailyTarget(s).secondary.pct).toBe(40);
  });
});

describe('payAt', () => {
  it('matches the tier function without re-prorating an already-prorated plan', () => {
    expect(payAt(350000, summary())).toBe(93000);
    expect(payAt(283333, summary())).toBe(62999.9);
    expect(payAt(0, summary())).toBe(50000);
  });

  it('uses the prorated edges in a partial month', () => {
    const s = summary({ prorationFactor: JULY_FACTOR });
    // 150,000 is short of a full month's band but clears both prorated edges,
    // so the partial month is paying band and top rates where the full month is
    // still paying only its (larger) flat base.
    expect(payAt(150000, summary())).toBe(50000);
    expect(payAt(150000, s)).toBe(43258.07);
  });
});

describe('dailyTarget', () => {
  it('is the goal divided by the days left to reach it', () => {
    // 93,000 take-home needs 350,000 of revenue. From 50,000 with twenty days
    // left: 15,000 a day, and that is the whole derivation.
    const t = dailyTarget(summary({ revenue: 50000, projectedDays: 20 }));
    expect(t.kind).toBe('goal');
    expect(t.goal).toBe(350000);
    expect(t.amount).toBe(15000);
    expect(t.contextKey).toBe('hero.context.goal');
  });

  it('mentions the tier only when it asks for more than the goal does', () => {
    // A modest goal — 274,000 of revenue — sits below the top threshold, so
    // driving only the goal's pace would miss the 50% zone.
    const s = summary({ revenueTarget: 274000, revenue: 200000, projectedDays: 8 });
    const t = dailyTarget(s);
    expect(t.kind).toBe('goal');
    expect(t.amount).toBe(9250);   // (274,000 − 200,000) / 8
    expect(t.secondary).toEqual({ amount: 12500, textKey: 'hero.secondary.tier', pct: 50 });

    // And stays quiet when the goal already covers it.
    expect(dailyTarget(summary({ revenue: 200000, projectedDays: 8 })).secondary).toBe(null);
  });

  it('falls back to the top tier when no goal is set', () => {
    const t = dailyTarget(summary({ revenueTarget: null, revenue: 260000, projectedDays: 8 }));
    expect(t.kind).toBe('tier');
    expect(t.amount).toBe(5000);   // (300,000 − 260,000) / 8
    expect(t.contextKey).toBe('hero.context.tierReach');
  });

  it('says "stay in" when the projection already clears the tier', () => {
    const t = dailyTarget(
      summary({ revenueTarget: null, revenue: 260000, projectedRevenue: 320000, projectedDays: 8 }),
    );
    expect(t.contextKey).toBe('hero.context.tierStay');
  });

  it('celebrates once the goal is banked', () => {
    const t = dailyTarget(summary({ revenue: 400000, dailyAverage: 15000, projectedDays: 4 }));
    expect(t.kind).toBe('beyond');
    expect(t.celebratory).toBe(true);
    expect(t.amount).toBe(15000);
  });

  it('states what the goal needs, however large that is', () => {
    // Best day 5,000 and a goal needing 59,800 a day. The screen says 59,800: a
    // number that size is the useful signal — either the driving changes or the
    // goal does — and a figure invented to stand in for it could be traced to
    // nothing that ever happened.
    const s = summary({
      revenue: 110840,
      projectedDays: 4,
      dailyAverage: 4434,
      bestDay: { date: '2026-07-21', revenue: 5000 },
    });
    const hero = dailyTarget(s);
    expect(hero.kind).toBe('goal');
    expect(hero.amount).toBe(59800);
    expect(hero.amount).toBe(paces(s).goalPace);
  });

  it('reports the month as settled rather than dividing by no days', () => {
    const t = dailyTarget(summary({ revenue: 120000, driverPay: 50000, projectedDays: 0 }));
    expect(t.kind).toBe('done');
    expect(t.amount).toBe(50000);
  });

  it('uses the prorated, rounded thresholds in a partial month', () => {
    const s = summary({ prorationFactor: JULY_FACTOR, revenue: 50000, projectedDays: 6 });
    expect(paces(s).tier3).toBe(116000);
    expect(dailyTarget(s).goal).toBe(136000);
    // (136,000 − 50,000) / 6 = 14,333 → 14,350
    expect(dailyTarget(s).amount).toBe(14350);
  });

  it('scales the revenue goal to a partial month', () => {
    const s = summary({
      revenueTarget: 350000,
      prorationFactor: JULY_FACTOR,
      revenue: 100000,
      projectedDays: 4,
    });
    // 350,000 x 12/31 = 135,484, rounded up to a figure worth printing.
    expect(revenueTargetForMonth(s)).toBe(135484);
    expect(targetForMonth(s)).toBe(136000);
    expect(dailyTarget(s).kind).toBe('goal');
  });

  /**
   * A record written before the goal became revenue holds only a take-home
   * figure. Reading it as revenue would cut the goal to roughly a quarter, so it
   * is converted through the plan instead — landing on the revenue that pays
   * what he originally asked for.
   */
  it('converts a take-home goal saved before the change', () => {
    const s = summary({ payTarget: 93000, revenue: 100000 });
    delete s.revenueTarget;
    expect(targetForMonth(s)).toBe(350000);
    expect(payAtTargetForMonth(s)).toBeGreaterThanOrEqual(93000);
  });

  it('prefers the revenue goal once one is set', () => {
    const s = summary({ payTarget: 93000, revenueTarget: 420000, revenue: 100000 });
    expect(targetForMonth(s)).toBe(420000);
  });
});

describe('revenueForPay', () => {
  it('is the tier function run backwards', () => {
    const s = summary();
    for (const pay of [50000, 60000, 68000, 93000, 150000]) {
      const revenue = revenueForPay(pay, s);
      expect(payAt(revenue, s)).toBeCloseTo(pay, 2);
    }
  });

  it('needs no revenue at all for what the base already pays', () => {
    expect(revenueForPay(50000, summary())).toBe(0);
    expect(revenueForPay(10000, summary())).toBe(0);
  });

  it('converts inside the band at the band rate', () => {
    // 68,000 = base 50,000 + 30% of 60,000 of band → the whole band.
    expect(revenueForPay(68000, summary())).toBe(300000);
    // Half the band.
    expect(revenueForPay(59000, summary())).toBe(270000);
  });

  it('converts above the top threshold at the top rate', () => {
    expect(revenueForPay(93000, summary())).toBe(350000);
  });

  it('works off the prorated plan in a partial month', () => {
    const s = summary({ prorationFactor: JULY_FACTOR });
    const revenue = revenueForPay(36000, s);
    expect(payAt(revenue, s)).toBeCloseTo(36000, 2);
    // Far less revenue than a full month needs for the same money, because the
    // bands moved down with the days.
    expect(revenue).toBeLessThan(revenueForPay(36000, summary()) || Infinity);
  });
});

describe('targetProgress', () => {
  it('states the shortfall in take-home, so nobody has to subtract two rows', () => {
    const p = targetProgress(summary({ revenue: 100000, projectedRevenue: 283333, projectedDays: 20 }));
    // 93,000 wanted, 63,000 on this pace.
    expect(p.payWanted).toBe(93000);
    expect(p.payAtPace).toBe(63000);
    expect(p.shortfall).toBe(30000);
  });

  /**
   * The absolute ask does not say how hard it is. "12,500 a day" against an
   * average of 10,000 is one more fare; against 4,000 it is a different month.
   * The lift is that difference, off the same average the stat row prints.
   */
  it('names the lift over the pace he is already holding', () => {
    const p = targetProgress(
      summary({ revenue: 100000, projectedRevenue: 283333, projectedDays: 20, dailyAverage: 10000 }),
    );
    expect(p.gapPerDay).toBe(12500);
    expect(p.liftPerDay).toBe(2500);
  });

  it('asks for no lift when the pace already covers the goal', () => {
    const p = targetProgress(
      summary({ revenue: 100000, projectedRevenue: 283333, projectedDays: 20, dailyAverage: 20000 }),
    );
    // The pace is ahead of the ask, so there is no increase to name — and a
    // negative one would read as permission to slow down.
    expect(p.liftPerDay).toBe(0);
  });

  it('reports being past the goal as a negative shortfall', () => {
    const p = targetProgress(summary({ revenue: 300000, projectedRevenue: 400000, projectedDays: 4 }));
    expect(p.shortfall).toBeLessThan(0);
  });

  it('states the goal in earnings and the gap per remaining day', () => {
    const p = targetProgress(summary({ revenue: 100000, projectedRevenue: 283333, projectedDays: 20 }));
    expect(p.payWanted).toBe(93000);
    expect(p.goalRevenue).toBe(350000);
    expect(p.daysLeft).toBe(20);
    // (350,000 − 100,000) / 20 = 12,500 — the same figure the hero shows.
    expect(p.gapPerDay).toBe(12500);
    expect(p.gapPerDay).toBe(paces(summary({ revenue: 100000, projectedDays: 20 })).goalPace);
    expect(p.payAtGoal).toBe(93000);
    expect(p.payAtPace).toBe(63000);
    expect(p.banked).toBe(false);
  });

  it('reports the goal banked rather than a gap of zero', () => {
    const p = targetProgress(summary({ revenue: 350000, projectedRevenue: 360000, projectedDays: 4 }));
    expect(p.banked).toBe(true);
    expect(p.gapPerDay).toBe(0);
  });

  it('scales the goal, not the ambition, in the month he starts', () => {
    const p = targetProgress(summary({ prorationFactor: JULY_FACTOR, operatingDays: 12 }));
    expect(p.revenueStated).toBe(350000);
    // 350,000 scaled to twelve of thirty-one days, and what the plan pays on it.
    expect(p.goalRevenue).toBe(136000);
    expect(p.payWanted).toBe(payAtTargetForMonth(summary({ prorationFactor: JULY_FACTOR, operatingDays: 12 })));
    expect(p.prorated).toBe(true);
  });

  it('is absent when no goal is set', () => {
    expect(targetProgress(summary({ revenueTarget: null }))).toBe(null);
  });
});

describe('paces', () => {
  /** Both paces over the same four remaining days. */
  const base = (over) => summary({ projectedDays: 4, ...over });

  it('measures both against the same days left', () => {
    const p = paces(base({ revenue: 200000 }));
    // Tier 3 at 300,000 and the goal's 350,000, each over four days.
    expect(p.tierPace).toBe(25000);
    expect(p.goalPace).toBe(37500);
    expect(p.daysLeft).toBe(4);
  });

  it('reports a banked target as needing nothing', () => {
    const p = paces(base({ revenue: 300000 }));
    expect(p.tierPace).toBe(0);
    expect(p.goalPace).toBe(12500);
  });

  it('has no goal pace when no goal is set', () => {
    expect(paces(base({ revenueTarget: null })).goalPace).toBe(null);
  });

  it('never asks for a negative amount', () => {
    const p = paces(base({ revenue: 500000 }));
    expect(p.tierPace).toBe(0);
    expect(p.goalPace).toBe(0);
  });
});

describe('goalRungs', () => {
  it("anchors on last month's actual revenue", () => {
    const rungs = goalRungs(summary({ lastMonth: { month: '2026-06', revenue: 300000 } }));
    expect(rungs.map((r) => r.value)).toEqual([300000, 345000, 390000, 450000]);
    expect(rungs[0].labelKey).toBe('rung.same');
  });

  it('rounds to clean numbers', () => {
    const rungs = goalRungs(summary({ lastMonth: { month: '2026-06', revenue: 257036 } }));
    // 257,036 / 295,591 / 334,147 / 385,554 → nearest 5,000
    expect(rungs.map((r) => r.value)).toEqual([255000, 295000, 335000, 385000]);
  });

  it('never suggests a goal the plan does not reward', () => {
    const rungs = goalRungs(summary({ lastMonth: { month: '2026-06', revenue: 90000 } }));
    // Below the band start every rupee pays the same base, so nothing under it
    // is a goal.
    expect(Math.min(...rungs.map((r) => r.value))).toBe(240000);
  });

  it('drops duplicates the flooring creates', () => {
    const rungs = goalRungs(summary({ lastMonth: { month: '2026-06', revenue: 1000 } }));
    expect(rungs).toHaveLength(1);
    expect(rungs[0].value).toBe(240000);
  });

  it('has nothing to suggest without a previous month', () => {
    expect(goalRungs(summary())).toEqual([]);
  });
});

describe("Uber's cut and where the fare goes", () => {
  /** A month with the Drive Pass subscription and fees the export actually gives. */
  const drivePass = (over = {}) =>
    summary({
      revenue: 57036,
      revenueBasis: 'gross',
      uberCommissionRate: 0,
      // Signed as Uber's export gives it: negative when it took more than it
      // gave back. 3,612 subscription + 5.92 Flex Pay − 600 toll refunded.
      uberFees: { toDate: -3017.92, projected: -6000, perDay: -500 },
      directCosts: { total: 13000, kmDriven: 676, perKm: 19.23, shareOfRevenue: 23 },
      ...over,
    });

  it('takes the subscription from the data rather than modelling a percentage', () => {
    const cut = uberCut(drivePass());
    expect(cut.charges).toBe(3017.92);
    expect(cut.commission).toBe(0);
    expect(cut.total).toBe(3017.92);
    // Nothing was inferred, so nothing may be labelled an estimate.
    expect(cut.estimated).toBe(false);
    // The fare is the recorded revenue: no reconstruction on this basis.
    expect(cut.gross).toBe(57036);
  });

  it('itemises the charges, flipped so a charge reads as a cost', () => {
    const cut = uberCut(
      drivePass({
        uberFees: {
          toDate: -3017.92,
          // As the API aggregates them: the export's own signs.
          lines: [
            { label: 'Driver subscription charge', amount: -3612, kind: 'charge' },
            { label: 'Flex Pay fee', amount: -5.92, kind: 'charge' },
            { label: 'Toll', amount: 600, kind: 'refund' },
          ],
          taxes: [
            { label: 'SSCL', amount: -3.15 },
            { label: 'Tax on Service Fee', amount: -22.67 },
          ],
        },
      }),
    );
    expect(cut.lines).toEqual([
      { label: 'Driver subscription charge', amount: 3612, kind: 'charge' },
      { label: 'Flex Pay fee', amount: 5.92, kind: 'charge' },
      { label: 'Toll', amount: -600, kind: 'refund' },
    ]);
    // The taxes are carried for display and never folded into the charges.
    expect(cut.taxTotal).toBe(25.82);
    expect(cut.charges).toBe(3017.92);
    expect(cut.total).toBe(3017.92);
  });

  it('reports what Uber refunded when refunds outweigh charges', () => {
    const cut = uberCut(drivePass({ uberFees: { toDate: 450 } }));
    expect(cut.charges).toBe(0);
    expect(cut.refunded).toBe(450);
    expect(cut.total).toBe(0);
  });

  it('adds nothing when the export carries no fees at all', () => {
    const cut = uberCut(drivePass({ uberFees: null }));
    expect(cut.total).toBe(0);
    expect(cut.estimated).toBe(false);
  });

  it('grosses the fare up only where a percentage really is charged', () => {
    const cut = uberCut(
      summary({ revenue: 75000, revenueBasis: 'net', uberCommissionRate: 0.25, uberFees: null }),
    );
    expect(cut.gross).toBe(100000);
    expect(cut.commission).toBe(25000);
    expect(cut.net).toBe(75000);
    // Reconstructed, so it is an estimate and says so.
    expect(cut.estimated).toBe(true);
  });

  it('takes a percentage off the top when the fare itself is recorded', () => {
    const cut = uberCut(
      summary({ revenue: 100000, revenueBasis: 'gross', uberCommissionRate: 0.25, uberFees: null }),
    );
    expect(cut.gross).toBe(100000);
    expect(cut.commission).toBe(25000);
    expect(cut.net).toBe(75000);
    // Nothing was inferred: the fare came from the data.
    expect(cut.estimated).toBe(false);
  });

  it('round-trips both directions at an awkward rate', () => {
    const net = uberCut(summary({ revenue: 57036, revenueBasis: 'net', uberCommissionRate: 0.185 }));
    const gross = uberCut(
      summary({ revenue: net.gross, revenueBasis: 'gross', uberCommissionRate: 0.185 }),
    );
    expect(gross.net).toBeCloseTo(57036, 1);
    expect(gross.commission).toBeCloseTo(net.commission, 1);
  });

  it('counts both a subscription and a percentage when an arrangement has both', () => {
    const cut = uberCut(drivePass({ revenueBasis: 'net', uberCommissionRate: 0.1 }));
    expect(cut.charges).toBe(3017.92);
    expect(cut.commission).toBeGreaterThan(0);
    expect(cut.total).toBe(round2(cut.charges + cut.commission));
    expect(cut.estimated).toBe(true);
  });

  it('never divides by zero on an absurd rate', () => {
    const cut = uberCut(summary({ revenue: 1000, revenueBasis: 'net', uberCommissionRate: 5 }));
    expect(Number.isFinite(cut.gross)).toBe(true);
    expect(cut.rate).toBe(0.9);
  });

  it('splits every 1,000 of fares to exactly 1,000, from measured figures', () => {
    const split = farePer1000(drivePass());
    // 3,017.92 of 57,036 in fares ≈ 53 → 55 at the nearest 5.
    expect(split.uber).toBe(55);
    // 13,000 of 57,036 ≈ 228 → 230.
    expect(split.charging).toBe(230);
    expect(split.pool).toBe(715);
    expect(split.uber + split.charging + split.pool).toBe(1000);
    expect(split.estimated).toBe(false);
  });

  it('rounds each share to the nearest 5 and still sums to 1,000', () => {
    const split = farePer1000(
      drivePass({ uberFees: { toDate: -4321.67 }, directCosts: { total: 8123, kmDriven: 676, perKm: 12.02 } }),
    );
    for (const share of [split.uber, split.charging, split.pool]) {
      expect(share % 5).toBe(0);
    }
    expect(split.uber + split.charging + split.pool).toBe(1000);
  });

  it('flags the split as an estimate when the fare behind it was modelled', () => {
    const split = farePer1000(
      summary({
        revenue: 57036,
        revenueBasis: 'net',
        uberCommissionRate: 0.25,
        directCosts: { total: 8000, kmDriven: 676, perKm: 11.8 },
      }),
    );
    expect(split.estimated).toBe(true);
    expect(split.uber).toBe(250);
  });

  it('says what a rupee off the per-km rate is worth this month', () => {
    const lens = chargingLens(
      summary({ directCosts: { total: 8000, kmDriven: 676, perKm: 11.83, shareOfRevenue: 14 } }),
    );
    expect(lens.perRupeePerKm).toBe(676);
    expect(lens.reference).toBe(10);
  });

  it('is absent when nothing has been spent on charging', () => {
    expect(chargingLens(summary())).toBe(null);
    expect(farePer1000(summary({ revenue: 0 }))).toBe(null);
  });
});

const round2 = (n) => Math.round(n * 100) / 100;

describe('one denominator across the screen', () => {
  /** The same month, with and without a booked day off. */
  const base = {
    revenue: 200000,
    projectedRevenue: 260000,
    operatingDays: 31,
    elapsedDays: 25,
    dailyAverage: 8000,
    bestDay: { date: '2026-07-22', revenue: 30000 },
  };

  it('moves the stat card, the goal gap and the hero together', () => {
    // Six shifts left, then one of them is booked off.
    const before = summary({ ...base, projectedDays: 6, offDaysAhead: 0 });
    const after = summary({ ...base, projectedDays: 5, offDaysAhead: 1 });

    expect(workingDaysLeft(before)).toBe(6);
    expect(workingDaysLeft(after)).toBe(5);

    // The stat card, the goal block and the hero all read the same count, so a
    // day off makes every one of them harder by the same arithmetic.
    expect(targetProgress(before).daysLeft).toBe(6);
    expect(targetProgress(after).daysLeft).toBe(5);
    expect(dailyTarget(before).daysLeft).toBe(6);
    expect(dailyTarget(after).daysLeft).toBe(5);

    // 350,000 − 200,000 over six shifts, then over five.
    expect(targetProgress(before).gapPerDay).toBe(25000);
    expect(targetProgress(after).gapPerDay).toBe(30000);
    // And the hero shows that same gap, because the goal binds here.
    expect(dailyTarget(before).amount).toBe(targetProgress(before).gapPerDay);
    expect(dailyTarget(after).amount).toBe(targetProgress(after).gapPerDay);
  });

  it('never counts a booked day off as a shift, even without the API count', () => {
    const s = summary({ ...base, offDaysAhead: 2 });
    delete s.projectedDays;
    // 31 operating − 25 elapsed − 2 booked off.
    expect(workingDaysLeft(s)).toBe(4);
  });
});

describe('daily charging displays', () => {
  const withWeek = (days, over = {}) =>
    summary({
      directCosts: { total: 9000, kmDriven: 700, perKm: 13.5, matchedDays: 4, matchedKm: 666 },
      charging: {
        total: 9000,
        logged: 6400,
        modelled: 2600,
        loggedDays: 3,
        modelledDays: 1,
        perKm: 13.5,
        matchedDays: 4,
        matchedKm: 666,
        matchedEstimated: true,
        last7: {
          from: '2026-07-19',
          to: '2026-07-25',
          perKm: 12.44,
          matchedDays: 3,
          matchedKm: 450,
          matchedEstimated: true,
          days,
        },
      },
      ...over,
    });

  const logged = { date: '2026-07-25', cost: 2400, km: 170, perKm: 14.12, estimated: false, sessions: 1 };
  const modelled = { date: '2026-07-24', cost: 2600, km: 200, perKm: 13, estimated: true, sessions: 0 };
  const noKm = { date: '2026-07-23', cost: 3000, km: 0, perKm: null, estimated: false, sessions: 1 };

  it('shows a day only when it was logged AND has a distance', () => {
    const s = withWeek([logged, modelled, noKm]);
    expect(chargingForDay(s, '2026-07-25')).toEqual({ cost: 2400, km: 170, perKm: 14.12 });
    // A modelled day is the configured rate — the same every day, so printing it
    // as "yesterday cost 2,600" would be the screen inventing a fact.
    expect(chargingForDay(s, '2026-07-24')).toBe(null);
    // Cost but no distance: no rate, so no line.
    expect(chargingForDay(s, '2026-07-23')).toBe(null);
    expect(chargingForDay(s, '2026-07-01')).toBe(null);
  });

  it('reads the week newest first, carrying the estimated flag', () => {
    const week = chargingWeek(withWeek([modelled, logged]));
    expect(week.days.map((d) => d.date)).toEqual(['2026-07-25', '2026-07-24']);
    expect(week.perKm).toBe(12.44);
    expect(week.matchedDays).toBe(3);
    expect(week.estimated).toBe(true);
  });

  it('carries the logged/estimated split into the month lens', () => {
    const lens = chargingLens(withWeek([logged]));
    expect(lens.loggedDays).toBe(3);
    expect(lens.modelledDays).toBe(1);
    expect(lens.logged).toBe(6400);
    expect(lens.matchedDays).toBe(4);
    expect(lens.estimated).toBe(true);
  });

  it('has nothing to show before anything is charged', () => {
    expect(chargingWeek(summary())).toBe(null);
    expect(chargingForDay(summary(), '2026-07-25')).toBe(null);
  });
});

describe('rollingPace', () => {
  /** Worked shifts, oldest first, as the API sends them. */
  const shifts = (revenues, start = 1) =>
    revenues.map((revenue, i) => ({
      date: `2026-07-${String(start + i).padStart(2, '0')}`,
      revenue,
      trips: 10,
    }));

  it('averages the last seven worked shifts', () => {
    // Fourteen shifts: the last seven average 12,000, the seven before 8,000.
    const s = summary({
      workedShifts: shifts([...Array(7).fill(8000), ...Array(7).fill(12000)]),
    });
    const pace = rollingPace(s);
    expect(pace.perShift).toBe(12000);
    expect(pace.shifts).toBe(7);
    expect(pace.previousPerShift).toBe(8000);
    expect(pace.previousShifts).toBe(7);
    expect(pace.delta).toBe(4000);
    expect(pace.direction).toBe('up');
  });

  it('flips the marker when the pace falls', () => {
    const s = summary({
      workedShifts: shifts([...Array(7).fill(12000), ...Array(7).fill(9000)]),
    });
    const pace = rollingPace(s);
    expect(pace.delta).toBe(-3000);
    expect(pace.direction).toBe('down');
  });

  it('calls a small change flat rather than flipping on noise', () => {
    const s = summary({
      workedShifts: shifts([...Array(7).fill(10000), ...Array(7).fill(10100)]),
    });
    // 1% up: real, but not worth an arrow that would swing on any given day.
    expect(rollingPace(s).direction).toBe('flat');
  });

  it('uses what it has in a young month, and withholds the trend', () => {
    const pace = rollingPace(summary({ workedShifts: shifts([6000, 10000, 14000]) }));
    expect(pace.perShift).toBe(10000);
    expect(pace.shifts).toBe(3);
    expect(pace.previousShifts).toBe(0);
    expect(pace.previousPerShift).toBe(null);
    expect(pace.delta).toBe(null);
    expect(pace.direction).toBe(null);
  });

  it('compares against however many earlier shifts exist', () => {
    // Nine shifts: seven recent, two before them.
    const s = summary({ workedShifts: shifts([4000, 4000, ...Array(7).fill(11000)]) });
    const pace = rollingPace(s);
    expect(pace.shifts).toBe(7);
    expect(pace.previousShifts).toBe(2);
    expect(pace.previousPerShift).toBe(4000);
    expect(pace.direction).toBe('up');
  });

  it('never averages in a day off or a day with nothing recorded', () => {
    // The API sends worked shifts only, so a rest day cannot arrive as a zero —
    // and if one did, it would drag the pace down for a day he was resting.
    const worked = shifts([12000, 12000, 12000]);
    const withZero = [...worked, { date: '2026-07-04', revenue: 0, trips: null }];
    expect(rollingPace(summary({ workedShifts: worked })).perShift).toBe(12000);
    expect(rollingPace(summary({ workedShifts: withZero })).perShift).toBe(9000);
  });

  it('has nothing to say before the first shift', () => {
    expect(rollingPace(summary())).toBe(null);
    expect(rollingPace(summary({ workedShifts: [] }))).toBe(null);
  });
});

describe('the days-left label is a label', () => {
  it('changes no computed figure, and still excludes booked days off', () => {
    // The card is called "Days left" and counts shifts: the same function the
    // goal gap and the hero pace read, with booked days off already out of it.
    const s = summary({
      revenue: 200000,
      projectedRevenue: 260000,
      projectedDays: 5,
      offDaysAhead: 1,
      operatingDays: 31,
      elapsedDays: 25,
      bestDay: { date: '2026-07-22', revenue: 30000 },
    });
    const shown = workingDaysLeft(s);
    expect(shown).toBe(5);
    // One count, three surfaces.
    expect(targetProgress(s).daysLeft).toBe(shown);
    expect(dailyTarget(s).daysLeft).toBe(shown);
    expect(paces(s).daysLeft).toBe(shown);
    // And the arithmetic is the arithmetic: 150,000 over five days.
    expect(targetProgress(s).gapPerDay).toBe(30000);
    expect(dailyTarget(s).amount).toBe(30000);
  });
});

describe('best day', () => {
  it('is the figure the best-day card shows', () => {
    const s = summary({ bestDay: { date: '2026-07-24', revenue: 16984, trips: 23 } });
    const best = bestRecordedDay(s);
    expect(best.revenue).toBe(16984);
    expect(best.trips).toBe(23);
    expect(paces(s).best.revenue).toBe(best.revenue);
  });

  it('follows a new maximum', () => {
    const before = bestRecordedDay(summary({ bestDay: { date: '2026-07-22', revenue: 13708 } }));
    const after = bestRecordedDay(summary({ bestDay: { date: '2026-07-26', revenue: 18400 } }));
    expect(before.revenue).toBe(13708);
    expect(after.revenue).toBe(18400);
    expect(after.date).toBe('2026-07-26');
  });

  it('falls back to last month, flagged as such, before falling silent', () => {
    const s = summary({ bestDay: null, lastMonth: { bestDay: { date: '2026-06-28', revenue: 15000 } } });
    expect(bestRecordedDay(s)).toMatchObject({ revenue: 15000, source: 'lastMonth' });
    expect(bestRecordedDay(summary())).toBe(null);
  });
});

describe('cashPocket', () => {
  /** A month's cash position as the API assembles it. */
  const withCash = (over = {}, top = {}) =>
    summary({
      revenue: 100000,
      projectedRevenue: 150000,
      ...top,
      cash: {
        collected: 40000,
        confirmed: 15000,
        pending: 5000,
        holding: 25000,
        cashShare: 0.4,
        cashShareBasis: '30d',
        cashShareDays: 12,
        projectedCash: 60000,
        settlement: 10000,
        handovers: [],
        ...over,
      },
    });

  const hero = { kind: 'goal', amount: 12000 };

  it('is the single home for the month\'s money in', () => {
    const pocket = cashPocket(
      withCash({}, { revenue: 57036, bankCredited: 25098, cashKnown: true }),
      hero,
    );
    // Cash, bank and the total that has to reconcile to them — all from one
    // place, so the two halves cannot be quoted from cards that disagree.
    expect(pocket.cashIn).toBe(40000);
    expect(pocket.bankIn).toBe(25098);
    expect(pocket.totalIn).toBe(57036);
    expect(pocket.cashPctOfTakings).toBe(70);
    expect(pocket.handedOver).toBe(15000);
  });

  it('derives the bank half when the API has not stated it', () => {
    const pocket = cashPocket(withCash({ collected: 30000 }, { revenue: 100000 }), hero);
    expect(pocket.bankIn).toBe(70000);
    expect(pocket.cashIn + pocket.bankIn).toBe(pocket.totalIn);
  });

  it('says so rather than showing zeros when no cash has been recorded', () => {
    const pocket = cashPocket(withCash({}, { cashKnown: false }), hero);
    expect(pocket.cashKnown).toBe(false);
  });

  it('holds cash net of CONFIRMED handovers only', () => {
    const pocket = cashPocket(withCash(), hero);
    // 40,000 collected − 15,000 confirmed. The 5,000 pending is money he says he
    // handed over and nobody has acknowledged; taking it off would let the ledger
    // disagree with the cash box.
    expect(pocket.holding).toBe(25000);
    expect(pocket.pending).toBe(5000);
    expect(pocket.confirmed).toBe(15000);
  });

  it('estimates tonight from the hero target and the cash share', () => {
    const pocket = cashPocket(withCash(), hero);
    // 12,000 asked for tonight, 40% of it historically cash.
    expect(pocket.expectedTonight).toBe(4800);
    expect(pocket.byTonight).toBe(29800);
    expect(pocket.cashSharePct).toBe(40);
  });

  it('adds nothing for tonight once the month is settled', () => {
    const pocket = cashPocket(withCash(), { kind: 'done', amount: 19355 });
    expect(pocket.expectedTonight).toBe(0);
    expect(pocket.byTonight).toBe(pocket.holding);
  });

  it('says he hands over when the cash outruns the pay', () => {
    const pocket = cashPocket(withCash({ projectedCash: 60000, settlement: 10000 }), hero);
    expect(pocket.owedToOwner).toBe(true);
    expect(pocket.settlement).toBe(10000);
  });

  it('flips when the pay outruns the cash', () => {
    // A slow month on a good tier: he is owed more than he is holding.
    const pocket = cashPocket(withCash({ projectedCash: 30000, settlement: -18000 }), hero);
    expect(pocket.owedToOwner).toBe(false);
    // Shown as a positive figure under a label that names the direction, rather
    // than a minus sign the reader has to interpret.
    expect(pocket.settlement).toBe(18000);
  });

  /**
   * Measured against the month's CASH, not the settlement. He hands back every
   * rupee he collects and is paid separately, so netting his pay off this figure
   * understated the money he is carrying for somebody else.
   */
  it('nets what is left to hand over against what has already gone back', () => {
    // 60,000 of cash across the month, 65,000 already handed over and confirmed:
    // he is ahead, and "you hand over 60,000" would be stale.
    const pocket = cashPocket(withCash({ projectedCash: 60000, confirmed: 65000 }), hero);
    expect(pocket.projectedCash).toBe(60000);
    expect(pocket.leftToHandOver).toBe(-5000);

    const midway = cashPocket(withCash({ projectedCash: 60000, confirmed: 18000 }), hero);
    expect(midway.leftToHandOver).toBe(42000);
  });

  it('hands back the whole month of cash, whichever way the settlement goes', () => {
    // A slow month on a good tier can leave the owner owing HIM — and he still
    // hands over all the cash he collected. The two facts are separate.
    const owedHim = cashPocket(withCash({ projectedCash: 30000, settlement: -18000 }), hero);
    expect(owedHim.projectedCash).toBe(30000);
    expect(owedHim.leftToHandOver).toBe(15000);
  });

  it('carries the ledger through for both roles', () => {
    const ledger = [
      { id: 'a', date: '2026-07-24', amount: 15000, confirmed: true, loggedBy: 'driver' },
      { id: 'b', date: '2026-07-26', amount: 5000, confirmed: false, loggedBy: 'driver' },
    ];
    expect(cashPocket(withCash({ handovers: ledger }), hero).ledger).toEqual(ledger);
  });

  it('is absent before any cash figure exists', () => {
    expect(cashPocket(summary(), hero)).toBe(null);
  });
});

describe('the morning state', () => {
  const shifts = [
    { date: '2026-07-24', revenue: 13560, trips: 11 },
    { date: '2026-07-25', revenue: 16984, trips: 13 },
  ];

  it('falls back to the last day actually logged', () => {
    // Yesterday was the 26th and nothing has been imported for it yet — the
    // normal state of every morning until the evening's import lands.
    const s = summary({ workedShifts: shifts, yesterday: null });
    expect(lastLoggedDay(s)).toEqual({ date: '2026-07-25', revenue: 16984, trips: 13 });
  });

  it('takes the most recent, not the best', () => {
    const s = summary({
      workedShifts: [
        { date: '2026-07-22', revenue: 30000, trips: 20 },
        { date: '2026-07-25', revenue: 9000, trips: 7 },
      ],
    });
    expect(lastLoggedDay(s).date).toBe('2026-07-25');
    // The best day is a different card, and a different question.
    expect(bestRecordedDay(summary({ bestDay: { date: '2026-07-22', revenue: 30000 } })).revenue).toBe(30000);
  });

  it('has nothing to fall back to before the first day', () => {
    expect(lastLoggedDay(summary())).toBe(null);
    expect(lastLoggedDay(summary({ workedShifts: [] }))).toBe(null);
  });
});

describe('one per-km headline', () => {
  const s = (over) =>
    summary({
      directCosts: { total: 12600, kmDriven: 675.9, perKm: 18.64, matchedDays: 5, matchedKm: 675.9, matchedEstimated: true },
      charging: {
        total: 12600,
        logged: 4800,
        modelled: 7800,
        loggedDays: 2,
        modelledDays: 3,
        perKm: 18.64,
        matchedDays: 5,
        matchedKm: 675.9,
        matchedEstimated: true,
        last7: { from: '2026-07-20', to: '2026-07-26', perKm: 14.72, matchedDays: 3, matchedKm: 450, matchedEstimated: false, days: [] },
        ...over,
      },
    });

  it('prefers the week, and is the figure the week helper gives', () => {
    const headline = chargingHeadline(s());
    expect(headline.basis).toBe('7d');
    expect(headline.perKm).toBe(chargingWeek(s()).perKm);
    expect(headline.matchedDays).toBe(3);
  });

  it('falls back to the month figure, and to the month day count with it', () => {
    const headline = chargingHeadline(s({ last7: { perKm: null, matchedDays: 0, days: [] } }));
    expect(headline.basis).toBe('month');
    expect(headline.perKm).toBe(chargingLens(s()).perKm);
    expect(headline.matchedDays).toBe(5);
    expect(headline.estimated).toBe(true);
  });

  it('is absent rather than a rate with no days behind it', () => {
    expect(chargingHeadline(summary())).toBe(null);
  });
});

describe('the month average and the rolling pace are different questions', () => {
  it('does not conflate the month to date with recent form', () => {
    // A month that started slowly and picked up: the month average and the last
    // few days say different things, and both are true. The stat card shows the
    // first, the goal block the second, and each names its denominator.
    const s = summary({
      revenue: 100000,
      earningDays: 10,
      dailyAverage: 10000,
      workedShifts: [
        ...Array.from({ length: 5 }, (_, i) => ({ date: `2026-07-1${i}`, revenue: 6000, trips: 5 })),
        ...Array.from({ length: 5 }, (_, i) => ({ date: `2026-07-2${i}`, revenue: 14000, trips: 12 })),
      ],
    });
    // The month's record.
    expect(s.dailyAverage).toBe(10000);
    // Current form, over the last seven worked days: two slow days and five good.
    expect(rollingPace(s).perShift).toBe(11714);
    expect(rollingPace(s).shifts).toBe(7);
    expect(rollingPace(s).perShift).not.toBe(s.dailyAverage);
  });

  it('agrees with the month average when every day is the same', () => {
    const flat = Array.from({ length: 7 }, (_, i) => ({ date: `2026-07-1${i}`, revenue: 12000, trips: 10 }));
    const s = summary({ dailyAverage: 12000, earningDays: 7, workedShifts: flat });
    expect(rollingPace(s).perShift).toBe(s.dailyAverage);
  });
});

describe('nextZone', () => {
  it('names the band while he is below it', () => {
    const zone = nextZone(summary({ revenue: 57036 }));
    expect(zone).toMatchObject({ rate: 0.3, threshold: 240000, remaining: 183000 });
    // And says what the 30% applies to: the band has a ceiling.
    expect(zone.width).toBe(60000);
    expect(zone.until).toBe(300000);
  });

  it('names the top tier once the band is banked', () => {
    const zone = nextZone(summary({ revenue: 260000 }));
    expect(zone).toMatchObject({ rate: 0.5, threshold: 300000, remaining: 40000 });
    // Nothing above the top tier, so no ceiling to state.
    expect(zone.width).toBe(null);
  });

  it('asks for enough to actually cross the line, not to reach the rounded one', () => {
    // Prorated: the band really starts at 92,903.23 and the ladder prints 92,000.
    // Measured to the printed bar the ask was 34,964, which lands 903 short and
    // unlocks nothing — the driver hits the figure and his rate does not change.
    const s = summary({ prorationFactor: JULY_FACTOR, revenue: 57035.8 });
    const zone = nextZone(s);
    expect(zone.threshold).toBe(92000);
    expect(zone.remaining).toBe(35900);
    expect(57035.8 + zone.remaining).toBeGreaterThanOrEqual(s.plan.bandStart);
    // The old figure would not have.
    expect(57035.8 + 34964).toBeLessThan(s.plan.bandStart);
  });

  it('has nothing left to name in the top zone', () => {
    expect(nextZone(summary({ revenue: 300000 }))).toBe(null);
    expect(nextZone(summary({ revenue: 420000 }))).toBe(null);
  });

  it('quotes the same rounded thresholds as the ladder and the hero', () => {
    const s = summary({ prorationFactor: JULY_FACTOR, revenue: 57036 });
    const zone = nextZone(s);
    // The prorated band start, rounded once and shared.
    expect(zone.threshold).toBe(displayThreshold(s.plan.bandStart));
    expect(zone.threshold).toBe(92000);

    // And past it, the same tier-3 figure the hero's small print is struck from.
    const later = nextZone(summary({ prorationFactor: JULY_FACTOR, revenue: 100000 }));
    expect(later.threshold).toBe(paces(summary({ prorationFactor: JULY_FACTOR })).tier3);
    expect(later.threshold).toBe(116000);
  });

  it('reads off revenue banked, not the forecast', () => {
    // The push card would target the top tier here, because the projection clears
    // the band. The next rupee still crosses the band, and that is the line worth
    // naming.
    const s = summary({ revenue: 57036, projectedRevenue: 400000 });
    expect(nextZone(s).rate).toBe(0.3);
  });
});

describe("today is not a finished day", () => {
  /** The production month as it stood on the 27th, a shift still in progress. */
  const july = summary({
    revenue: 72852.02,
    earningDays: 7,
    dailyAverage: 10407.43,
    workedShifts: [
      { date: '2026-07-20', revenue: 2573.21, trips: 3 },
      { date: '2026-07-21', revenue: 10211.21, trips: 10 },
      { date: '2026-07-22', revenue: 13708.21, trips: 16 },
      { date: '2026-07-24', revenue: 13559.64, trips: 11 },
      { date: '2026-07-25', revenue: 16983.53, trips: 13 },
      { date: '2026-07-26', revenue: 11553.23, trips: 6 },
      // Today: three trips by lunchtime.
      { date: '2026-07-27', revenue: 4262.99, trips: 3 },
    ],
  });

  it('never offers today as the last logged day', () => {
    const last = lastLoggedDay(july, '2026-07-27');
    expect(last.date).toBe('2026-07-26');
    expect(last.revenue).toBe(11553.23);
    // It used to hand back today's 4,262.99 — a morning, labelled as a day.
    expect(last.date).not.toBe('2026-07-27');
  });

  it('keeps yesterday once the day has turned', () => {
    // On the 28th, the 27th is complete and becomes the answer.
    expect(lastLoggedDay(july, '2026-07-28').date).toBe('2026-07-27');
  });

  it('has nothing to offer when only today has been logged', () => {
    const s = summary({ workedShifts: [{ date: '2026-07-27', revenue: 4262.99, trips: 3 }] });
    expect(lastLoggedDay(s, '2026-07-27')).toBe(null);
  });

  it('leaves today out of recent form', () => {
    const pace = rollingPace(july, 7, '2026-07-27');
    // The six complete days: 68,589.03 / 6.
    expect(pace.perShift).toBe(11432);
    expect(pace.shifts).toBe(6);
    // With today averaged in it read 10,407 — a fall in form that was really the
    // clock, and the same figure as the month average by coincidence.
    expect(pace.perShift).not.toBe(10407);
  });

  it('says nothing about form when today is all there is', () => {
    const s = summary({ workedShifts: [{ date: '2026-07-27', revenue: 4262.99, trips: 3 }] });
    expect(rollingPace(s, 7, '2026-07-27')).toBe(null);
  });
});

describe('a goal far out of reach', () => {
  it('states the requirement rather than substituting for it', () => {
    // 800,000 a month against a best day of 16,984: the goal needs nine times his
    // best day, so the hero shows the most he could credibly do and names the real
    // requirement beside it.
    const s = summary({
      revenueTarget: 1_764_000,
      revenue: 72852.02,
      projectedDays: 4,
      bestDay: { date: '2026-07-25', revenue: 16983.53, trips: 13 },
    });
    const hero = dailyTarget(s);
    expect(hero.kind).toBe('goal');
    // What the goal actually needs — not a figure invented to stand in for it.
    // From 72,852 over four days that is 422,800 a day, and saying so is the
    // only useful thing the screen can do with a goal of this size.
    expect(hero.amount).toBe(paces(s).goalPace);
    expect(hero.amount).toBeGreaterThan(400000);
    // And the goal block says the same, in the same rows it always uses.
    expect(targetProgress(s).gapPerDay).toBe(hero.amount);
  });

  it('scales the goal to the month before deciding any of that', () => {
    const s = summary({ revenueTarget: 1_764_000, prorationFactor: JULY_FACTOR });
    // 1,764,000 × 12/31, then rounded up to a figure worth printing.
    expect(revenueTargetForMonth(s)).toBe(682839);
    expect(targetForMonth(s)).toBe(683000);
    // And the take-home it earns, derived from the prorated plan rather than
    // asked for — the direction this used to run in.
    expect(payAtTargetForMonth(s)).toBe(Math.round(payAt(683000, s)));
  });
});

describe('the document stamp', () => {
  /**
   * Colombo time, not the machine's. A statement produced at 00:30 local is
   * 19:00 the previous day in UTC — stamped from the wrong clock it would carry
   * yesterday's date on a document whose whole point is when it was made.
   */
  it('stamps in Colombo time, not UTC', () => {
    // 2026-07-31T19:00Z is already 2026-08-01 in Colombo (+5:30).
    expect(generatedAt(new Date('2026-07-31T19:00:00Z'))).toBe('01 Aug 2026, 00:30');
    expect(generatedAt(new Date('2026-07-31T18:29:00Z'))).toBe('31 Jul 2026, 23:59');
  });

  it('uses a 24-hour clock, zero padded', () => {
    expect(generatedAt(new Date('2026-07-31T02:05:00Z'))).toBe('31 Jul 2026, 07:35');
  });

  it('spells the month the way the rest of the app does', () => {
    setLocale('si');
    // The dictionary's transliteration, not CLDR's — the same rule `monthLabel`
    // follows, and the reason this is not `toLocaleString`.
    expect(generatedAt(new Date('2026-07-31T06:00:00Z'))).toContain('ජූලි');
    resetLocale('en');
  });
});
