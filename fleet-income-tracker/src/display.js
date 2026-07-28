/**
 * Display-layer arithmetic for the driver view.
 *
 * Nothing here changes what anybody is paid. The pay plan, the proration and
 * the projection all stay exactly where they were — in `shared/commission.mjs`
 * and the API. This module answers the two presentation questions the old
 * dashboard never answered directly:
 *
 *   1. What is the ONE number he should read first ("drive this much today")?
 *   2. What clean, quotable figure do we print for a threshold that the
 *      proration maths left at 92,903.23?
 *
 * Both are pure functions of the summary payload, so they are unit tested
 * rather than eyeballed in the browser.
 */
import { calculatePay } from '../shared/commission.mjs';
import { todayLocal } from './format.js';

/**
 * The canonical rounded figure for any threshold we SHOW.
 *
 * Prorating a plan produces figures nobody can hold in their head —
 * 92,903.23 to unlock the band, 116,129.03 for the top tier — and the old UI
 * printed them at full precision in some places and rounded to "93k" in
 * others, so the chart axis and the payroll copy disagreed. Every user-facing
 * surface now goes through here, so they cannot.
 *
 * Rounding always favours the driver:
 *   - `down` for a bar he has to clear (a threshold), so the printed number is
 *     never harder than the real one;
 *   - `up` for money paid to him (the base), so the printed number is never
 *     less than he gets.
 *
 * The step is coarse enough to read at a glance and fine enough that the
 * rounding stays under 1%: 1,000 above 50k, 500 below it. Figures that are
 * already clean — a full month's 240,000 / 300,000 — come back untouched.
 */
export function displayThreshold(value, favour = 'down') {
  if (!Number.isFinite(value)) return 0;
  if (value === 0) return 0;
  const step = Math.abs(value) >= 50000 ? 1000 : 500;
  const rounded =
    favour === 'up' ? Math.ceil(value / step) * step : Math.floor(value / step) * step;
  // Never round a small positive figure away to nothing.
  return rounded === 0 && value > 0 ? Math.round(value) : rounded;
}

/** The base is money he receives, so it rounds his way — upward. */
export function displayBase(value) {
  return displayThreshold(value, 'up');
}

/**
 * A threshold expressed as the daily run rate it implies.
 *
 * The divisor is the OPERATING days the threshold covers, not the calendar
 * month. A prorated threshold has already been scaled to the days available to
 * work; dividing it by 31 as well prorates it twice, which is how the ladder
 * came to print "116k ≈ 3,742/day" for a bar the hero was correctly asking
 * 9,850 a day to clear.
 *
 * Done right, this is the ONE figure identical in a partial month and a full
 * one — 116,000 over 12 days and 300,000 over 31 both come to about 9,667 —
 * which is exactly why driver copy leads with it. `240k this month` changes
 * every month he starts mid-month; `7,742 a day` does not.
 *
 * @param {number} value  threshold, prorated the same way as `days`
 * @param {number} days   operating days that threshold covers
 */
export function perDayThreshold(value, days) {
  if (!Number.isFinite(value) || !days) return 0;
  return Math.round(value / days);
}

/**
 * Shifts still expected to earn — including today, unless today's figures are
 * already in.
 *
 * THE denominator. The hero's pace, the goal block's gap and the stat card all
 * read this one function, so the screen cannot hold two disagreeing "per shift"
 * figures again.
 *
 * It counts shifts, not calendar days: a day already marked off is not a shift to
 * make up, and the API's `projectedDays` — which the projection itself runs on —
 * has those days removed. Sharing it means the hero and the projection can never
 * tell him two different stories.
 */
export function workingDaysLeft(summary) {
  if (!summary) return 0;
  if (Number.isFinite(summary.projectedDays)) return Math.max(0, summary.projectedDays);
  return Math.max(
    0,
    (summary.operatingDays || 0) - (summary.elapsedDays || 0) - (summary.offDaysAhead || 0),
  );
}

/**
 * Shifts in the whole month — operating days less every day off, taken and
 * planned. The denominator for "what does my target mean per day".
 */
export function workingDaysInMonth(summary) {
  if (!summary) return 0;
  const off = (summary.offDaysElapsed || 0) + (summary.offDaysAhead || 0);
  return Math.max(1, (summary.operatingDays || 0) - off);
}

/**
 * The next threshold that changes what a rupee is worth, read off revenue BANKED.
 *
 * Not off the projection: the push card targets whatever the forecast is heading
 * for, which on a good pace skips straight to the top tier and quietly implies the
 * band is already unlocked. What he wants here is the nearest line that actually
 * moves his marginal rate — the one the next rupee crosses.
 *
 * Thresholds come from `displayThreshold`, so this card, the ladder axis and the
 * hero's secondary line all name the same number.
 *
 * Returns null once he is in the top zone: there is no next line, and the card
 * says what he is on instead of inventing one.
 */
export function nextZone(summary) {
  const plan = driverPlan(summary);
  const revenue = summary?.revenue || 0;
  if (!plan.bandEnd) return null;

  // The threshold PRINTED is the rounded one, so the card names the same line as
  // the ladder axis. The amount REQUIRED is measured against the exact one and
  // rounded up, because this is a promise: earn it and the rate changes. Measured
  // against the rounded-down bar it was 903 short of the real line — he would have
  // hit the number and nothing would have happened.
  const upTo = (exact, shown, rate) => ({
    rate,
    threshold: displayThreshold(shown),
    remaining: Math.ceil((exact - revenue) / 100) * 100,
  });

  if (revenue < plan.bandStart) {
    return {
      ...upTo(plan.bandStart, plan.bandStart, plan.bandRate),
      // The band has a ceiling: past it the rate steps up again, so "30% of every
      // rupee" would be true only for the width of the band.
      until: displayThreshold(plan.bandEnd),
      // Rounded down like every other bar he reads, so "the next 23,000" is a
      // figure he can hold rather than 23,225.81.
      width: displayThreshold(plan.bandEnd - plan.bandStart),
    };
  }
  if (revenue < plan.bandEnd) {
    return { ...upTo(plan.bandEnd, plan.bandEnd, plan.topRate), until: null, width: null };
  }
  return null;
}

/** Trips per working day, beside every revenue-per-day figure. */
export function tripsPerDay(summary) {
  const days = summary?.earningDays || 0;
  if (!days || !summary.trips) return null;
  return Math.round((summary.trips / days) * 10) / 10;
}

/** The plan as the driver's own view of it: prorated edges, real rates. */
export function driverPlan(summary) {
  const plan = summary?.plan || {};
  const push = summary?.push || {};
  return {
    base: plan.base ?? 0,
    bandStart: plan.bandStart ?? 0,
    bandEnd: plan.bandEnd ?? 0,
    bandRate: push.bandRate ?? 0,
    topRate: push.topRate ?? 0,
  };
}

/**
 * Take-home at a given month revenue, from the real tier function.
 *
 * The plan handed in is already prorated by the API, so factor stays 1 — a
 * second proration here would halve the driver's pay on the screen that is
 * supposed to motivate him.
 */
export function payAt(revenue, summary) {
  const plan = driverPlan(summary);
  if (!plan.bandEnd) return 0;
  return calculatePay(revenue, plan, 1).total;
}

/**
 * The revenue needed to take home a given amount — the pay function run
 * backwards.
 *
 * The driver states what he wants to EARN, because that is the figure he
 * actually cares about; the revenue behind it is arithmetic, and it depends on
 * which plan applies this month. Inverting rather than guessing matters because
 * the plan is piecewise: the first 50,000 is free (the base pays it whatever he
 * drives), the band converts at 30%, and only above the top threshold does a
 * rupee of revenue convert at 50%.
 *
 * Returns 0 when the base already covers what he asked for, and null when the
 * plan is unreadable.
 *
 * `favour` is deliberately 'up' at the call sites that print this: rounding a
 * REQUIREMENT down would show a figure that, if he hit it exactly, paid slightly
 * less than he asked for. Thresholds round in his favour; requirements round to
 * whatever keeps the promise.
 */
export function revenueForPay(pay, summary) {
  const { base, bandStart, bandEnd, bandRate, topRate } = driverPlan(summary);
  if (!bandEnd || !bandRate || !topRate) return null;
  const wanted = Number(pay);
  if (!Number.isFinite(wanted) || wanted <= base) return 0;

  const bandPays = (bandEnd - bandStart) * bandRate;
  if (wanted <= base + bandPays) return round2(bandStart + (wanted - base) / bandRate);
  return round2(bandEnd + (wanted - base - bandPays) / topRate);
}

/**
 * This month's share of the monthly take-home goal.
 *
 * Payouts land at the end of each month, so the goal is monthly. In the month he
 * starts it is scaled by the same factor the plan is: twelve days of a
 * thirty-one-day month can only be asked for twelve days of earnings, and
 * scaling both together is what keeps the per-day figure identical between a
 * partial month and a full one.
 */
export function payTargetForMonth(summary) {
  const stated = Number(summary?.payTarget);
  if (!Number.isFinite(stated) || stated <= 0) return null;
  const factor = Number.isFinite(summary.prorationFactor) ? summary.prorationFactor : 1;
  return Math.round(stated * factor);
}

/** The revenue this month's take-home goal needs, as a clean printable figure. */
export function targetForMonth(summary) {
  const pay = payTargetForMonth(summary);
  if (pay === null) return null;
  const revenue = revenueForPay(pay, summary);
  return revenue === null ? null : displayThreshold(revenue, 'up');
}

/**
 * The most recent COMPLETE day with anything logged on it.
 *
 * Today is excluded, and that is the whole point. The card exists because
 * yesterday has nothing to show every morning until the evening's import lands —
 * but today usually does have something by then, a few hours of a shift still
 * being driven. Offering that as "last logged day" labels a half-finished day as a
 * finished one and invites comparison against complete days it cannot match: on
 * the 27th it read 4,263 against a 16,984 best day.
 *
 * `today` is injectable so the boundary is testable rather than dependent on when
 * the suite happens to run.
 */
export function lastLoggedDay(summary, today = todayLocal()) {
  const shifts = (summary?.workedShifts || []).filter((s) => s.date < today);
  if (!shifts.length) return null;
  return shifts[shifts.length - 1];
}

/**
 * The best single day recorded — this month if it has one, otherwise last month.
 *
 * The API sends both. The fallback matters on the 2nd of the month, when there is
 * nothing yet to judge a target against and the alternative is treating "no
 * history" as "any ask is credible".
 */
export function bestRecordedDay(summary) {
  const best = summary?.bestDay;
  if (best?.revenue > 0) return { ...best, source: 'thisMonth' };
  const previous = summary?.lastMonth?.bestDay;
  if (previous?.revenue > 0) return { ...previous, source: 'lastMonth' };
  return null;
}

/** Round a daily ask to something a person would say out loud. */
function tidyDaily(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n / 50) * 50;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * The two paces the month is running against, over the SAME denominator: the
 * working days that are left.
 *
 * This is the fix for a screen that gave two instructions at once. The hero used
 * to show the tier pace while the goal block demanded a much larger per-day
 * figure derived from a different denominator — the whole month — so the two
 * numbers disagreed and neither could be acted on. Both now come from here.
 *
 *   tierPace  what each remaining day needs to bring in to finish at or above
 *             the top threshold. Zero once that revenue is banked.
 *   goalPace  what each remaining day needs to bring in to earn the take-home he
 *             asked for. Zero once it is banked, null when he has set no goal.
 *
 * The binding constraint is whichever is larger: driving the smaller of the two
 * misses the other, so the larger is the only honest instruction.
 */
export function paces(summary) {
  const daysLeft = workingDaysLeft(summary);
  const revenue = summary?.revenue || 0;
  const tier3 = displayThreshold(driverPlan(summary).bandEnd, 'down');
  const goalRevenue = targetForMonth(summary);

  const perDay = (goal) => {
    if (goal === null) return null;
    if (daysLeft <= 0) return 0;
    return Math.max(0, tidyDaily((goal - revenue) / daysLeft));
  };

  const tierPace = perDay(tier3);
  const goalPace = perDay(goalRevenue);
  const binding =
    (goalPace || 0) > 0 && (goalPace || 0) >= (tierPace || 0)
      ? 'goal'
      : (tierPace || 0) > 0
        ? 'tier'
        : 'none';

  return {
    daysLeft,
    tierPace,
    goalPace,
    tier3,
    goalRevenue,
    binding,
    // What the larger of the two asks for.
    required: Math.max(tierPace || 0, goalPace || 0),
    best: bestRecordedDay(summary),
  };
}

/**
 * The hero number: what today has to bring in.
 *
 * It is the goal, divided by the days left to reach it. Nothing else — no cap, no
 * substituted figure, no cleverness. A goal is a statement of intent, and the
 * screen's job is to say what it costs per day, not to decide the driver cannot
 * have it: an ask of 152,550 says the goal needs rethinking, which is information,
 * and a capped 22,100 in its place says nothing at all and cannot be traced back
 * to anything.
 *
 * With no goal set there is nothing to divide, so it falls back to the top tier —
 * the only other target the month has.
 *
 * States:
 *   goal    what each remaining day needs to reach the month's goal
 *   tier    the same, for the top threshold, when no goal is set
 *   beyond  banked — celebrate, and show the pace he is holding
 *   done    no days left; the month is decided, so show the pay
 *
 * "Banked" reads off revenue EARNED, never the projection: a forecast that says he
 * will get there is not the same as getting there.
 */
export function dailyTarget(summary) {
  if (!summary) return null;
  const p = paces(summary);
  if (p.daysLeft <= 0) return monthOver(summary);

  // His own goal comes first when he has one: it is the target he chose.
  if (p.goalPace > 0) {
    return {
      kind: 'goal',
      amount: p.goalPace,
      goal: p.goalRevenue,
      daysLeft: p.daysLeft,
      context: 'every day, to reach your goal this month',
      // The tier line, when it asks for more than the goal does — driving only the
      // goal's pace would then miss the threshold, which is worth one quiet line.
      secondary:
        p.tierPace > p.goalPace ? { amount: p.tierPace, text: 'is what your 50% zone needs' } : null,
      celebratory: false,
    };
  }

  if (p.tierPace > 0) {
    return {
      kind: 'tier',
      amount: p.tierPace,
      goal: p.tier3,
      daysLeft: p.daysLeft,
      context:
        (summary.projectedRevenue || 0) >= p.tier3
          ? 'every day, to stay in your 50% zone'
          : 'every day, to reach your 50% zone',
      secondary: null,
      celebratory: false,
    };
  }

  return {
    kind: 'beyond',
    amount: tidyDaily(summary.dailyAverage || 0),
    goal: null,
    daysLeft: p.daysLeft,
    context: 'your pace — and you keep half of every rupee now',
    secondary: null,
    celebratory: true,
  };
}

function monthOver(summary) {
  return {
    kind: 'done',
    amount: Math.round(summary.driverPay || 0),
    goal: null,
    daysLeft: 0,
    context: 'Every day is in — this is your pay for the month',
    secondary: null,
    celebratory: (summary.driverPay || 0) > 0,
  };
}

/**
 * The goal block: what he wants, what this pace pays, and the gap — all on the
 * one denominator the hero uses.
 *
 * The old version mixed two: a target restated over the whole month's days
 * against a gap measured over the days that are left, which is how the screen
 * came to hold two different "per day" figures that could not both be right.
 * Everything here is per REMAINING day.
 *
 * The rows are the same whatever the state. A goal that needs more than he has
 * ever driven says so by the size of its own number, which is information he can
 * act on — by driving harder, or by moving the goal.
 */
export function targetProgress(summary) {
  const payWanted = payTargetForMonth(summary);
  const goalRevenue = targetForMonth(summary);
  if (payWanted === null || goalRevenue === null) return null;

  const p = paces(summary);
  const payAtPace = Math.round(payAt(summary.projectedRevenue || 0, summary));

  return {
    payWanted,
    payStated: Number(summary.payTarget) || null,
    prorated: (summary.prorationFactor ?? 1) < 1,
    goalRevenue,
    daysLeft: p.daysLeft,
    // The one per-day figure in the block, and the one the hero shows when the
    // goal is the binding constraint.
    gapPerDay: p.goalPace || 0,
    payAtPace,
    payAtGoal: Math.round(payAt(goalRevenue, summary)),
    banked: p.goalPace === 0,
    // The comparison as its own figure, in take-home, so nobody has to subtract
    // two numbers that sit rows apart.
    shortfall: Math.round(payWanted - payAtPace),
  };
}

/**
 * Suggested goals for next month, anchored on what he actually made last month.
 *
 * Anchoring matters more than the rungs. A picker that opens on a round number
 * somebody typed invites a guess; one that opens on "you made 57,000 last month"
 * turns the choice into a decision about how much harder to push. Rungs sit at
 * the same, a bit more, a stretch and a reach, and none of them can fall below
 * the base he is paid whatever he drives — a goal under the guaranteed floor is
 * not a goal.
 */
export const GOAL_RUNGS = [
  { multiple: 1, label: 'Same again' },
  { multiple: 1.15, label: 'A bit more' },
  { multiple: 1.3, label: 'A stretch' },
  { multiple: 1.5, label: 'A reach' },
];

export function goalRungs(summary) {
  const anchor = Math.round(summary?.lastMonth?.driverPay || 0);
  const floor = Math.round(displayBase(driverPlan(summary).base) || 0);
  if (anchor <= 0) return [];

  const seen = new Set();
  return GOAL_RUNGS.map(({ multiple, label }) => {
    const value = Math.max(floor, roundTo(anchor * multiple, 5000));
    return { multiple, label, value };
  }).filter((rung) => {
    if (seen.has(rung.value)) return false;
    seen.add(rung.value);
    return true;
  });
}

/** To the nearest clean step — 5,000 for a monthly goal. */
function roundTo(value, step) {
  return Math.round(value / step) * step;
}

/* ─────────────────── where the fare actually goes ─────────────────── */

/**
 * What Uber took, measured first and modelled only if it has to be.
 *
 * On Drive Pass — this fleet's arrangement — Uber charges a flat subscription
 * instead of a share of each fare. That subscription is Uber's cut, it is a real
 * line in the payments export, and the import already captures it along with the
 * Flex Pay fee and any toll reimbursed. So the honest figure is the one from the
 * data: `charges`.
 *
 * A percentage is only involved on an arrangement that genuinely takes a share of
 * the fare. Uber's driver-side export begins at what it decided to pay and states
 * neither the gross fare nor a service fee, so on that basis the fare has to be
 * reconstructed as earnings ÷ (1 − rate) — and `estimated` then travels with the
 * result so no surface can present a modelled number as a measured one.
 *
 * Nothing here touches the commission plan: the driver is paid on the revenue
 * recorded either way.
 */
export function uberCut(summary) {
  const revenue = Number(summary?.revenue) || 0;
  const rate = clampRate(summary?.uberCommissionRate ?? 0);
  const basis = summary?.revenueBasis === 'net' ? 'net' : 'gross';

  // Measured: signed as the export gives it, negative when Uber took more than
  // it gave back. Flipped here so a charge reads as a positive cost.
  const net = Number(summary?.uberFees?.toDate) || 0;
  const charges = round2(Math.max(0, -net));
  const refunded = round2(Math.max(0, net));

  // Modelled: only when a share of the fare is actually charged.
  const estimated = basis === 'net' && rate > 0;
  const gross = estimated && rate < 1 ? round2(revenue / (1 - rate)) : revenue;
  const commission = estimated ? round2(gross - revenue) : rate > 0 ? round2(revenue * rate) : 0;

  // Itemised, straight from the export: what the subscription cost, what a fee
  // cost, what a toll gave back. Charges first, largest first.
  const lines = (summary?.uberFees?.lines || []).map((line) => ({
    label: line.label,
    // Flipped to read as a cost, so a charge is positive and a refund negative.
    amount: round2(-line.amount),
    kind: line.amount < 0 ? 'charge' : 'refund',
  }));

  // Taxes Uber already took out of the earnings figure. Shown, never added: the
  // recorded revenue is net of them, so counting them again would deduct the
  // same rupees twice.
  const taxes = (summary?.uberFees?.taxes || []).map((line) => ({
    label: line.label,
    amount: round2(-line.amount),
  }));
  const taxTotal = round2(taxes.reduce((sum, t) => sum + t.amount, 0));

  return {
    basis,
    rate,
    estimated,
    // The subscription and fees Uber actually charged.
    charges,
    refunded,
    lines,
    taxes,
    taxTotal,
    // A percentage of the fare, where one exists.
    commission,
    // Everything Uber took, however it took it.
    total: round2(charges + commission),
    gross,
    net: round2(gross - commission),
  };
}

const clampRate = (n) => Math.min(0.9, Math.max(0, Number(n) || 0));

/**
 * Where every LKR 1,000 of fares went this month.
 *
 * Shares of the FARE, not of what arrived, because the fare is the thing the
 * passenger paid and the only figure all three parts can be expressed against.
 * Carries `estimated` from the commission it rests on: on the 'net' basis the
 * fare itself is inferred, so all three shares move with the configured rate.
 * Computed from the month's own ratios rather than from the headline rates: the
 * charging share depends on how far the car was actually driven.
 *
 * Rounded to the nearest 5 for readability, with the pool taking the remainder
 * so the three always add to exactly 1,000 — three independently rounded shares
 * that sum to 995 invite the reader to hunt for the missing five.
 */
export function farePer1000(summary) {
  const cut = uberCut(summary);
  if (!cut.gross) return null;
  const charging = Number(summary?.directCosts?.total) || 0;

  const uber = roundTo(Math.min(1000, (cut.total / cut.gross) * 1000), 5);
  const chargingShare = roundTo(Math.min(1000 - uber, (charging / cut.gross) * 1000), 5);
  return {
    uber,
    charging: chargingShare,
    // What is left to be split between the driver's plan and the owner's costs.
    pool: 1000 - uber - chargingShare,
    estimated: cut.estimated,
  };
}

/**
 * The per-km figure to lead with, and where it came from.
 *
 * Both the teaser on the main screen and the headline row on the costs card read
 * THIS — not their own arithmetic. Two places computing a rate from the same
 * ingredients is how a screen ends up quoting 11.33 in one card and 19.23 in
 * another; there is one figure and one day count behind it.
 *
 * The trailing week wins when it has matched days, because that is the fair unit
 * for judging charging: sessions count on the day they were paid, so a single day
 * swings on whether he happened to top up that evening. The month is the fallback
 * for a week with nothing matched in it.
 */
export function chargingHeadline(summary) {
  const week = chargingWeek(summary);
  if (week && week.perKm !== null && week.matchedDays > 0) {
    return {
      perKm: week.perKm,
      matchedDays: week.matchedDays,
      basis: '7d',
      estimated: week.estimated,
    };
  }
  const month = chargingLens(summary);
  if (month && month.perKm !== null && month.matchedDays > 0) {
    return {
      perKm: month.perKm,
      matchedDays: month.matchedDays,
      basis: 'month',
      estimated: month.estimated,
    };
  }
  return null;
}

/** A reference tariff, for saying whether a per-km rate is a good one. */
export const CHARGING_REFERENCE_PER_KM = 10;

/**
 * The charging picture, in the terms the driver can act on.
 *
 * Charging is the only cost on this card he moves: he chooses the station and
 * the hour, and Sri Lankan CCS2 tariffs run from about 54 to 150 per kWh. So the
 * card states what a rupee off the per-km rate is worth over the distance he
 * actually covered — a fact about his own month, not a bonus being offered.
 */
export function chargingLens(summary) {
  const direct = summary?.directCosts;
  const charging = summary?.charging;
  if (!direct || !direct.total) return null;
  const km = Number(direct.kmDriven) || 0;
  return {
    total: round2(direct.total),
    km: round2(km),
    // The rate over MATCHED days — days with both a cost and a distance — and the
    // count it came from, so a rate struck over three days cannot read as a
    // month's verdict.
    perKm: direct.perKm === null || direct.perKm === undefined ? null : round2(direct.perKm),
    matchedDays: direct.matchedDays ?? charging?.matchedDays ?? 0,
    matchedKm: direct.matchedKm ?? charging?.matchedKm ?? 0,
    estimated: Boolean(direct.matchedEstimated ?? charging?.matchedEstimated),
    // How much of the month is measured rather than budgeted.
    logged: charging?.logged ?? null,
    modelled: charging?.modelled ?? null,
    loggedDays: charging?.loggedDays ?? 0,
    modelledDays: charging?.modelledDays ?? 0,
    reference: CHARGING_REFERENCE_PER_KM,
    // What one rupee per km is worth across this month's distance.
    perRupeePerKm: Math.round(km),
    shareOfRevenue: direct.shareOfRevenue ?? null,
  };
}

/**
 * One day's charging, for the quiet second line on the yesterday card.
 *
 * Only ever from LOGGED sessions matched with that day's distance, and omitted
 * unless both exist. The configured rate is identical every day, so a modelled
 * "yesterday cost 2,600" would be a number the screen made up — worse than no
 * line at all in a place the driver will read as fact.
 */
export function chargingForDay(summary, date) {
  const day = (summary?.charging?.last7?.days || []).find((d) => d.date === date);
  if (!day || day.estimated) return null;
  if (!(day.cost > 0) || !(day.km > 0) || day.perKm === null) return null;
  return { cost: day.cost, km: day.km, perKm: day.perKm };
}

/**
 * The trailing seven days of charging: the rate, and the days behind it.
 *
 * This is the number to judge on, and the copy says so. A single day swings on
 * whether he happened to top up that evening — sessions count on the day they
 * were paid, so charging tonight makes tonight look dear and tomorrow look free —
 * and over a week those crossings cancel out.
 *
 * `perKm` is null when nothing in the window has both a cost and a distance,
 * which is the honest answer rather than a rate over a denominator nobody
 * recorded.
 */
export function chargingWeek(summary) {
  const week = summary?.charging?.last7;
  if (!week) return null;
  return {
    perKm: week.perKm,
    matchedDays: week.matchedDays,
    matchedKm: week.matchedKm,
    estimated: week.matchedEstimated,
    from: week.from,
    to: week.to,
    // Newest first: the most recent day is the one he remembers.
    days: [...(week.days || [])].sort((a, b) => b.date.localeCompare(a.date)),
  };
}

/** How many shifts a rolling pace looks back over. */
export const PACE_WINDOW = 7;

/**
 * Revenue per shift over the last few shifts he actually worked, and whether that
 * is rising or falling.
 *
 * A month-to-date average is the wrong number for a driver: by the 25th it is
 * dominated by days he can no longer do anything about, and it barely moves
 * however he drives today. A rolling window over WORKED shifts answers the
 * question he is actually asking — am I going better or worse than lately —
 * and it moves when he does.
 *
 * Days off are not in it, and neither are days with nothing recorded. A rest day
 * averaged in as a zero would read as a bad shift, which is both wrong and the
 * kind of wrong that makes a screen easy to dismiss.
 *
 * The comparison is the seven shifts before those seven. Early in a month there
 * are fewer of both, so the window says how many it used and the trend is
 * withheld until there is something to compare against.
 */
export function rollingPace(summary, size = PACE_WINDOW, today = todayLocal()) {
  // Complete days only. Today is a few hours of a shift, so averaging it in
  // reports a fall in form that is really just the clock: on the 27th it pulled
  // the pace from 11,431 down to 10,407 on the strength of a morning.
  const shifts = (summary?.workedShifts || [])
    .filter((s) => s.date < today)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!shifts.length) return null;

  const recent = shifts.slice(0, size);
  const previous = shifts.slice(size, size * 2);
  const mean = (list) =>
    list.length ? Math.round(list.reduce((sum, s) => sum + (s.revenue || 0), 0) / list.length) : null;

  const perShift = mean(recent);
  const previousPerShift = mean(previous);
  const delta = previousPerShift === null ? null : perShift - previousPerShift;

  return {
    perShift,
    shifts: recent.length,
    previousPerShift,
    previousShifts: previous.length,
    delta,
    // Flat inside 2%: a rolling average wobbles, and an arrow that flips on noise
    // teaches him to ignore arrows.
    direction:
      delta === null || previousPerShift === 0
        ? null
        : Math.abs(delta) / previousPerShift < 0.02
          ? 'flat'
          : delta > 0
            ? 'up'
            : 'down',
  };
}

/* ────────────────────────────── the cash pocket ────────────────────────────── */

/**
 * How much cash he is holding, what tonight should bring, and where the month
 * settles.
 *
 * The reason this card exists: cash fares never touch the bank, so by the 25th he
 * is carrying a large and un-numbered amount of somebody else's money, and the
 * handover at month end becomes a negotiation between two people's memories. A
 * running figure both of them can see turns it into a formality.
 *
 * `byTonight` leans on the hero's ask — the one instruction on the screen — times
 * the share of revenue that historically arrives as cash. It is an estimate and is
 * labelled as one everywhere it appears; the share itself falls back from the
 * trailing thirty days to this month to a flat half, and says which it used.
 */
export function cashPocket(summary, hero) {
  const cash = summary?.cash;
  if (!cash) return null;

  const target = hero && hero.kind !== 'done' ? hero.amount || 0 : 0;
  const expectedTonight = Math.round(target * cash.cashShare);

  // The month's money in, from ONE place. These figures used to live on a second
  // card of their own, so the same rupees were described twice on the same screen
  // under two different headings — and the two cards could not be reconciled
  // against each other without adding up rows across both.
  // Rounded for display only. The ledger and the store keep the exact figures —
  // this is the last step before the glass, and a settlement card full of
  // 31,938.03 is harder to read and no more actionable than 31,938.
  const collected = Math.round(cash.collected || 0);
  const total = Math.round(summary.revenue || 0);
  const bank = Math.round(
    Number.isFinite(summary.bankCredited) ? summary.bankCredited : (summary.revenue || 0) - (cash.collected || 0),
  );

  return {
    // Where the month's takings came in.
    cashIn: collected,
    bankIn: bank,
    totalIn: total,
    cashKnown: Boolean(summary.cashKnown),
    // The share of the takings that arrived as cash, as a percentage of them.
    cashPctOfTakings: total > 0 ? Math.round((collected / total) * 100) : 0,
    // What has already gone back, and what is still in his pocket.
    handedOver: Math.round(cash.confirmed),
    holding: Math.round(cash.holding),
    // True once a handover has been confirmed: only then is "holding" the result
    // of a subtraction worth showing the working for.
    hasHandedOver: cash.confirmed > 0,
    collected,
    confirmed: Math.round(cash.confirmed),
    pending: Math.round(cash.pending),
    cashShare: cash.cashShare,
    // Guarded: a missing share used to render as "NaN% cash", and a card that
    // prints NaN is worse than one that prints nothing.
    cashSharePct: Number.isFinite(cash.cashShare) ? Math.round(cash.cashShare * 100) : null,
    cashShareBasis: cash.cashShareBasis,
    // Tonight's cash, if today's driving looks like the recent past.
    expectedTonight,
    byTonight: Math.round(cash.holding + expectedTonight),
    // Where the month lands: projected cash against projected pay. Positive means
    // he hands the difference over.
    settlement: Math.abs(Math.round(cash.settlement)),
    owedToOwner: cash.settlement >= 0,
    // What is still to move, once the cash already handed over and confirmed is
    // taken off. The month total answers "how big is this settlement"; this
    // answers "how much have I still got to hand over", and a driver who has
    // already paid 18,000 of it should not read the gross figure as outstanding.
    leftToSettle: Math.round(cash.settlement - cash.confirmed),
    projectedCash: Math.round(cash.projectedCash),
    ledger: cash.handovers || [],
  };
}
