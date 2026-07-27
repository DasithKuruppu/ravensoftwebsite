import { describe, it, expect } from 'vitest';
import {
  displayThreshold,
  displayBase,
  perDayThreshold,
  workingDaysLeft,
  workingDaysInMonth,
  tripsPerDay,
  payAt,
  targetForMonth,
  dailyTarget,
  targetProgress,
  bestRecordedDay,
  revenueForPay,
  payTargetForMonth,
  paces,
  goalReachable,
  goalRungs,
  stretchCeiling,
  uberCut,
  farePer1000,
  chargingLens,
  chargingWeek,
  chargingForDay,
  rollingPace,
  cashPocket,
  lastLoggedDay,
  chargingHeadline,
} from './display.js';
import { prorate, monthFactor, DEFAULT_SETTINGS } from '../shared/commission.mjs';

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
    payTarget: 93000,
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
      // A believable best day, so no reachability cap interferes.
      bestDay: { date: '2026-07-25', revenue: 16000 },
      payTarget: null,
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
  /** A modest goal — 60,000 take-home — so the top threshold is the harder ask. */
  const modestGoal = { payTarget: 60000 };

  it('below the band, leads with whichever ask is larger', () => {
    // Default goal is 93,000 take-home = 350,000 revenue, past the 300,000
    // threshold, so from 50,000 with twenty days left the goal is the binding
    // constraint and the tier pace becomes the small print.
    const t = dailyTarget(summary({ revenue: 50000, projectedDays: 20 }));
    expect(t.kind).toBe('goal');
    expect(t.goal).toBe(350000);
    expect(t.amount).toBe(15000);
    expect(t.secondary).toEqual({ amount: 12500, text: 'keeps your 50% zone safe' });
  });

  it('leads with the tier when the goal is the easier of the two', () => {
    // 60,000 take-home needs 274,000 of revenue — inside the band, so tier 3 at
    // 300,000 is the harder ask and the one to act on.
    const s = summary({ ...modestGoal, revenue: 260000, projectedDays: 8 });
    const t = dailyTarget(s);
    expect(t.kind).toBe('tier');
    // (300,000 − 260,000) / 8 = 5,000
    expect(t.amount).toBe(5000);
    expect(t.context).toMatch(/Closes the gap to your 50% zone/);
    // Driving the harder ask carries the easier one with it — said, not implied.
    expect(t.secondary.text).toMatch(/also closes your goal/);
  });

  it('says the pace is being held when the projection already clears tier 3', () => {
    const t = dailyTarget(
      summary({ ...modestGoal, revenue: 260000, projectedRevenue: 320000, projectedDays: 8 }),
    );
    expect(t.kind).toBe('tier');
    expect(t.context).toMatch(/Keeps your 50% zone/);
  });

  it('once tier 3 is banked, switches to what he wants to earn', () => {
    const t = dailyTarget(summary({ revenue: 300000, projectedDays: 5 }));
    expect(t.kind).toBe('goal');
    expect(t.goal).toBe(350000);
    // (350,000 − 300,000) / 5
    expect(t.amount).toBe(10000);
    expect(t.context).toMatch(/Closes your goal/);
  });

  it('caps an impossible ask at a stretch on his best day', () => {
    const t = dailyTarget(
      summary({
        revenue: 110840,
        dailyAverage: 4434,
        projectedDays: 4,
        bestDay: { date: '2026-07-21', revenue: 5100 },
      }),
    );
    expect(t.kind).toBe('strongest');
    // 5,100 × 1.3 = 6,630 → tidied up to the next 50.
    expect(t.amount).toBe(6650);
    expect(t.context).toMatch(/strongest finish/);
  });

  it('asks for the tier pace on a month with no history yet', () => {
    const t = dailyTarget(summary({ ...modestGoal, revenue: 0, dailyAverage: 0, projectedDays: 31 }));
    expect(t.kind).toBe('tier');
    expect(t.amount).toBe(9700);
  });

  it('reports the month as settled rather than dividing by no days', () => {
    const t = dailyTarget(summary({ revenue: 120000, driverPay: 50000, projectedDays: 0 }));
    expect(t.kind).toBe('done');
    expect(t.amount).toBe(50000);
  });

  it('uses the rounded partial-month thresholds, so hero and ladder agree', () => {
    // Prorated: tier 3 shows as 116,000 and the scaled goal needs 136,000.
    const s = summary({ prorationFactor: JULY_FACTOR, revenue: 50000, projectedDays: 6 });
    const t = dailyTarget(s);
    expect(paces(s).tier3).toBe(116000);
    expect(t.goal).toBe(136000);
    // (136,000 − 50,000) / 6 = 14,333 → 14,350
    expect(t.amount).toBe(14350);
    // (116,000 − 50,000) / 6 = 11,000
    expect(t.secondary).toEqual({ amount: 11000, text: 'keeps your 50% zone safe' });
  });

  it('scales the earnings goal to a partial month, and the plan with it', () => {
    const s = summary({ prorationFactor: JULY_FACTOR, revenue: 130000, projectedDays: 4 });
    expect(payTargetForMonth(s)).toBe(36000);
    expect(targetForMonth(s)).toBe(136000);
    expect(dailyTarget(s).kind).toBe('goal');
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
    expect(p.payStated).toBe(93000);
    expect(p.payWanted).toBe(36000);
    expect(p.prorated).toBe(true);
  });

  it('is absent when no goal is set', () => {
    expect(targetProgress(summary({ payTarget: null }))).toBe(null);
  });
});

describe('paces — the binding constraint', () => {
  /** Both paces over the same four remaining days, with a believable best day. */
  const base = (over) =>
    summary({ projectedDays: 4, bestDay: { date: '2026-07-22', revenue: 20000 }, ...over });

  it('picks the goal when the goal needs more per day', () => {
    // 93,000 take-home needs 350,000 revenue. From 300,000 with four days left
    // the goal needs 12,500 a day; tier 3 is already banked, so it needs nothing.
    const p = paces(base({ revenue: 300000 }));
    expect(p.tierPace).toBe(0);
    expect(p.goalPace).toBe(12500);
    expect(p.binding).toBe('goal');
    expect(p.required).toBe(12500);

    const hero = dailyTarget(base({ revenue: 300000 }));
    expect(hero.kind).toBe('goal');
    expect(hero.amount).toBe(12500);
    expect(hero.context).toMatch(/Closes your goal/);
  });

  it('picks the tier when the tier needs more per day', () => {
    // Below tier 3, and the goal is only a little further on: tier 3 needs
    // (300,000 − 240,000) / 4 = 15,000, the goal (350,000 − 240,000) / 4 =
    // 27,500 — so raise the goal's reach by lowering it instead.
    const s = base({ revenue: 280000, payTarget: 55000 });
    const p = paces(s);
    // 55,000 take-home needs 256,667 → already banked.
    expect(p.goalPace).toBe(0);
    expect(p.tierPace).toBe(5000);
    expect(p.binding).toBe('tier');

    const hero = dailyTarget(s);
    expect(hero.kind).toBe('tier');
    expect(hero.amount).toBe(5000);
    // The secondary line says the goal is already in the bank rather than
    // printing a second, smaller instruction.
    expect(hero.secondary.text).toMatch(/already banked/);
  });

  it('shows the tier pace as the secondary line when the goal is binding', () => {
    // 200,000 banked: tier 3 needs 25,000 a day, the goal 37,500 — the goal wins
    // and the tier pace becomes the small print.
    const s = base({ revenue: 200000, bestDay: { date: '2026-07-22', revenue: 40000 } });
    const p = paces(s);
    expect(p.tierPace).toBe(25000);
    expect(p.goalPace).toBe(37500);
    expect(p.binding).toBe('goal');

    const hero = dailyTarget(s);
    expect(hero.amount).toBe(37500);
    expect(hero.secondary).toEqual({ amount: 25000, text: 'keeps your 50% zone safe' });
  });

  it('resolves a tie to the goal, so the harder promise is the one shown', () => {
    // Contrive equal paces: goal revenue == tier 3 threshold.
    const s = base({ revenue: 200000, payTarget: 68000 });
    const p = paces(s);
    expect(p.goalRevenue).toBe(300000);
    expect(p.goalPace).toBe(p.tierPace);
    expect(p.binding).toBe('goal');
  });

  it('celebrates when both are banked instead of inventing an instruction', () => {
    const hero = dailyTarget(base({ revenue: 400000, dailyAverage: 15000 }));
    expect(hero.kind).toBe('beyond');
    expect(hero.celebratory).toBe(true);
  });

  it('never issues an instruction above a stretch on his best day', () => {
    // Best day 5,000 → ceiling 6,500. Tier 3 alone would need 47,300 a day.
    const s = summary({
      revenue: 110840,
      projectedDays: 4,
      dailyAverage: 4434,
      bestDay: { date: '2026-07-21', revenue: 5000 },
    });
    const hero = dailyTarget(s);
    expect(hero.kind).toBe('strongest');
    expect(hero.amount).toBe(6500);
    expect(hero.amount).toBeLessThanOrEqual(stretchCeiling(s));
  });
});

describe('goal reachability at the 1.3x boundary', () => {
  /** A month where the goal needs exactly `perDay` from the remaining days. */
  const needing = (perDay, bestDayRevenue) => {
    const daysLeft = 4;
    const goalRevenue = 350000; // 93,000 take-home on the default plan
    return summary({
      revenue: goalRevenue - perDay * daysLeft,
      projectedDays: daysLeft,
      bestDay: { date: '2026-07-22', revenue: bestDayRevenue },
    });
  };

  it('is reachable exactly at 1.3x the best day', () => {
    // best 10,000 → ceiling 13,000, and a goal needing exactly 13,000 stands.
    const s = needing(13000, 10000);
    expect(paces(s).goalPace).toBe(13000);
    expect(goalReachable(s)).toBe(true);
    expect(dailyTarget(s).kind).toBe('goal');
    expect(targetProgress(s).reachable).toBe(true);
  });

  it('is out of reach just past it', () => {
    // 13,050 needed against the same 13,000 ceiling.
    const s = needing(13050, 10000);
    expect(paces(s).goalPace).toBe(13050);
    expect(goalReachable(s)).toBe(false);
    expect(dailyTarget(s).kind).toBe('strongest');
  });

  it('reframes the goal block as a best case rather than an instruction', () => {
    const s = needing(20000, 10000);
    const p = targetProgress(s);
    expect(p.reachable).toBe(false);
    // Four best days from here, priced through the real tier function.
    expect(p.bestCasePay).toBe(Math.round(payAt(s.revenue + 10000 * 4, s)));
    expect(p.bestCaseGain).toBeGreaterThanOrEqual(0);
  });

  it('treats a month with no history as reachable', () => {
    expect(goalReachable(summary({ revenue: 0, projectedDays: 31 }))).toBe(true);
  });
});

describe('goalRungs', () => {
  it('anchors on last month\'s actual take-home', () => {
    const rungs = goalRungs(summary({ lastMonth: { month: '2026-06', driverPay: 100000 } }));
    expect(rungs.map((r) => r.value)).toEqual([100000, 115000, 130000, 150000]);
    expect(rungs[0].label).toBe('Same again');
  });

  it('rounds to clean numbers', () => {
    const rungs = goalRungs(summary({ lastMonth: { month: '2026-06', driverPay: 57036 } }));
    // 57,036 / 65,591 / 74,147 / 85,554 → nearest 5,000
    expect(rungs.map((r) => r.value)).toEqual([55000, 65000, 75000, 85000]);
  });

  it('never suggests less than the base he is paid regardless', () => {
    const rungs = goalRungs(summary({ lastMonth: { month: '2026-06', driverPay: 20000 } }));
    // The base is 50,000, so nothing below it is a goal.
    expect(Math.min(...rungs.map((r) => r.value))).toBe(50000);
  });

  it('drops duplicates the flooring creates', () => {
    const rungs = goalRungs(summary({ lastMonth: { month: '2026-06', driverPay: 1000 } }));
    expect(rungs).toHaveLength(1);
    expect(rungs[0].value).toBe(50000);
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
    // Big enough that the reachability cap does not bite: this test is about the
    // denominator, and the cap has its own suite.
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
  it('is the same figure the reachability cap is struck against', () => {
    const s = summary({ bestDay: { date: '2026-07-24', revenue: 16984, trips: 23 } });
    const best = bestRecordedDay(s);
    expect(best.revenue).toBe(16984);
    expect(best.trips).toBe(23);
    // The stat card and the cap read one helper, so the ceiling shown and the
    // ceiling enforced cannot drift apart.
    expect(stretchCeiling(s)).toBeCloseTo(16984 * 1.3, 6);
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

  it('nets what is left to settle against what has already been handed over', () => {
    // 10,000 to settle across the month, 15,000 of it already handed over and
    // confirmed: he is ahead, and "you hand over 10,000" would be stale.
    const pocket = cashPocket(withCash({ settlement: 10000, confirmed: 15000 }), hero);
    expect(pocket.settlement).toBe(10000);
    expect(pocket.leftToSettle).toBe(-5000);

    const midway = cashPocket(withCash({ settlement: 39271, confirmed: 18000 }), hero);
    expect(midway.leftToSettle).toBe(21271);
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
