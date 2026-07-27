/**
 * Running costs — the owner's side of the ledger.
 *
 * Owner-share (revenue − driver pay) is a gross figure. For an electric fleet
 * car the real cost of running it is substantial and mostly invisible in Uber's
 * numbers: charging, maintenance, depreciation, insurance, the revenue licence,
 * the driver's data package. Subtracting them turns owner-share into profit.
 *
 * Costs arrive on three different rhythms, and mixing them would make any
 * monthly total meaningless:
 *
 *   once     a single event on a date — a service, a tyre change
 *   daily    scales with days actually driven — a flat monthly charging figure
 *            is wrong for a month with five working days and one with twenty
 *   perKm    scales with distance — the honest shape for an EV's electricity,
 *            since charging tracks kilometres rather than calendar days
 *   monthly  a recurring monthly charge — a data package, or a lease
 *            instalment, which may carry a term after which it stops
 *   annual   billed yearly — insurance, revenue licence. Spread across twelve
 *            months, because charging a whole year's insurance to March would
 *            make March look catastrophic and the other eleven months rosy.
 *
 * Depreciation is usually best entered as an annual figure and left to spread.
 */

export const COST_CATEGORIES = [
  { key: 'lease', label: 'Lease instalment' },
  { key: 'charging', label: 'Charging / electricity' },
  { key: 'maintenance', label: 'Maintenance & repairs' },
  { key: 'depreciation', label: 'Depreciation' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'licence', label: 'Revenue licence' },
  { key: 'connectivity', label: 'Mobile / data' },
  { key: 'other', label: 'Other' },
];

export const COST_FREQUENCIES = [
  { key: 'once', label: 'One-off' },
  { key: 'daily', label: 'Per day driven' },
  { key: 'perKm', label: 'Per km driven' },
  { key: 'monthly', label: 'Every month' },
  { key: 'annual', label: 'Every year' },
];

/**
 * Costs a driver may EVER see — a whitelist, not a default.
 *
 * Charging is his to influence: he chooses where and when to plug in, and the
 * difference between the cheapest and dearest CCS2 tariff is nearly threefold.
 * Everything else — the lease, depreciation, insurance, the revenue licence — is
 * the owner's commercial position and none of his business.
 *
 * This is a whitelist because the alternative failed open. Visibility used to be
 * a per-line flag, so ticking "driver sees" on the lease would have shown him the
 * lease; the category gate now means that flag can only ever HIDE something
 * inside the whitelist, never reveal something outside it. Adding a driver-facing
 * category is a deliberate edit here, which is where a decision like that belongs.
 */
export const DRIVER_VISIBLE_CATEGORIES = ['charging'];

/** Kept as the default-on list within the whitelist. */
export const DRIVER_VISIBLE_BY_DEFAULT = ['charging'];

/** Is this category one a driver is ever allowed to be shown? */
export function isDriverPermitted(cost) {
  return DRIVER_VISIBLE_CATEGORIES.includes(cost?.category);
}

export function isDriverVisible(cost) {
  // The category gate first, and it cannot be overridden by the line's own flag.
  if (!isDriverPermitted(cost)) return false;
  if (cost?.driverVisible === true) return true;
  if (cost?.driverVisible === false) return false;
  return DRIVER_VISIBLE_BY_DEFAULT.includes(cost?.category);
}

/**
 * The cost lines that may be serialised into a driver-role response.
 *
 * Every driver-facing payload goes through this, so "the UI does not render it"
 * is never what keeps a figure private — it is absent from the response.
 */
export function driverVisibleCosts(costs) {
  return (costs || []).filter(isDriverVisible);
}

/** A starting set, so the editor is not an empty grid. Amounts are zero. */
export const DEFAULT_COSTS = [
  { id: 'lease', label: 'Lease instalment', category: 'lease', frequency: 'monthly', amount: 0, date: null, termMonths: 36 },
  { id: 'charging', label: 'Charging', category: 'charging', frequency: 'perKm', amount: 0, date: null, driverVisible: true },
  { id: 'maintenance', label: 'Maintenance', category: 'maintenance', frequency: 'monthly', amount: 0, date: null },
  { id: 'depreciation', label: 'Depreciation', category: 'depreciation', frequency: 'annual', amount: 0, date: null },
  { id: 'insurance', label: 'Insurance', category: 'insurance', frequency: 'annual', amount: 0, date: null },
  { id: 'licence', label: 'Revenue licence', category: 'licence', frequency: 'annual', amount: 0, date: null },
  { id: 'data', label: 'Mobile data', category: 'connectivity', frequency: 'monthly', amount: 0, date: null },
];

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * What a cost contributes to one month (yyyy-mm).
 *
 * A recurring cost only counts from the month its start date falls in, so
 * adding an insurance policy today does not retroactively charge every past
 * month you look at.
 */
export function monthlyAmount(cost, month, usage = {}) {
  const amount = Number(cost?.amount) || 0;
  if (!amount) return 0;

  const { daysDriven = 0, kmDriven = 0 } = usage;
  const startsAfter = cost.date && cost.date.slice(0, 7) > month;

  switch (cost.frequency) {
    case 'daily':
      return startsAfter ? 0 : round2(amount * daysDriven);
    case 'perKm':
      return startsAfter ? 0 : round2(amount * kmDriven);
    case 'once':
      return cost.date && cost.date.slice(0, 7) === month ? round2(amount) : 0;
    case 'annual':
      return startsAfter ? 0 : round2(amount / 12);
    case 'monthly':
    default: {
      if (startsAfter) return 0;
      // A lease runs for a fixed term. Without one it would keep charging the
      // month after the last instalment was paid, quietly understating profit
      // for the rest of the vehicle's life.
      const term = Number(cost.termMonths) || 0;
      if (term > 0 && cost.date && monthsBetween(cost.date.slice(0, 7), month) >= term) return 0;
      return round2(amount);
    }
  }
}

/** Whole months from one yyyy-mm to another. */
export function monthsBetween(fromMonth, toMonth) {
  const [fy, fm] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** Instalments left to pay on a fixed-term cost, as of `month`. */
export function remainingTerm(cost, month) {
  const term = Number(cost?.termMonths) || 0;
  if (!term || !cost.date) return null;
  const elapsed = monthsBetween(cost.date.slice(0, 7), month);
  return Math.max(0, term - Math.max(0, elapsed));
}

/** Every cost's contribution to a month, plus the total. */
export function costsForMonth(costs, month, usage = {}) {
  const items = (costs || [])
    .map((c) => ({
      ...c,
      monthly: monthlyAmount(c, month, usage),
      remaining: remainingTerm(c, month),
      // What it was multiplied by, so the card can show the working.
      basis:
        c.frequency === 'daily'
          ? `${usage.daysDriven || 0} days`
          : c.frequency === 'perKm'
            ? `${Math.round(usage.kmDriven || 0)} km`
            : null,
    }))
    .filter((c) => c.monthly > 0)
    .sort((a, b) => b.monthly - a.monthly);

  return { items, total: round2(items.reduce((sum, c) => sum + c.monthly, 0)) };
}

/**
 * Average monthly cost across a holding period, for return-on-capital.
 *
 * A cost that expires is not a permanent drag. A 73,000 lease with 58
 * instalments left, held against a ten-year horizon, really costs
 * 73,000 × 58/120 ≈ 35,000 a month averaged over the time the car is kept.
 * Charging the full instalment for the whole horizon would understate the
 * return on a vehicle that is owned outright for half its life.
 *
 * One-off costs already incurred are excluded: they are history, not a forward
 * commitment, and future ones cannot be predicted.
 */
export function levelisedMonthly(costs, month, usage = {}, horizonMonths = 60) {
  const horizon = Math.max(1, horizonMonths);

  const items = (costs || [])
    .map((c) => {
      const amount = Number(c.amount) || 0;
      if (!amount) return null;

      switch (c.frequency) {
        case 'once':
          return null;
        case 'annual':
          return { ...c, levelised: round2(amount / 12), months: horizon };
        case 'daily':
          return { ...c, levelised: round2(amount * (usage.daysDriven || 0)), months: horizon };
        case 'perKm':
          return { ...c, levelised: round2(amount * (usage.kmDriven || 0)), months: horizon };
        case 'monthly':
        default: {
          // Only pay it for as long as it lasts, then spread across the horizon.
          const left = remainingTerm({ ...c, date: c.date }, month);
          const months = left === null ? horizon : Math.min(left, horizon);
          return { ...c, levelised: round2((amount * months) / horizon), months };
        }
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.levelised - a.levelised);

  return { items, total: round2(items.reduce((sum, c) => sum + c.levelised, 0)), horizonMonths: horizon };
}

export function categoryLabel(key) {
  return COST_CATEGORIES.find((c) => c.key === key)?.label || 'Other';
}

/* ────────────────────────── charging, as it happened ────────────────────────── */

/**
 * What a day's charging cost, preferring what was actually paid.
 *
 * A configured rate — 2,600 a day driven, or 12 a kilometre — is a budget, not a
 * cost. It is the same every day by construction, so any "what did today cost"
 * display built on it is decoration: it cannot move, cannot be wrong, and cannot
 * be improved on. Logged sessions are the real thing.
 *
 * So: a day with sessions costs what the sessions cost, and a day without falls
 * back to the configured rate and is flagged `estimated`. A month may mix the two
 * — that is the honest state of a fleet part-way through adopting the habit — and
 * every display that shows a day says which kind it is.
 */
export function daySessionTotal(entry) {
  const sessions = Array.isArray(entry?.chargeSessions) ? entry.chargeSessions : [];
  let total = 0;
  let counted = 0;
  for (const session of sessions) {
    const amount = Number(session?.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    total += amount;
    counted += 1;
  }
  return counted > 0 ? { total: round2(total), sessions: counted } : null;
}

/** kWh logged for a day, when every session recorded it. */
export function dayKwh(entry) {
  const sessions = Array.isArray(entry?.chargeSessions) ? entry.chargeSessions : [];
  const values = sessions.map((s) => Number(s?.kwh)).filter((n) => Number.isFinite(n) && n > 0);
  return values.length ? round2(values.reduce((a, b) => a + b, 0)) : null;
}

/** The distance a day is charged against: the tracker's if it has one. */
export function dayKm(entry) {
  const km = Number(entry?.gpsKm) || Number(entry?.uberKm) || 0;
  return km > 0 ? round2(km) : 0;
}

/**
 * What the configured charging lines would cost for one day.
 *
 * Only the shapes that can be attributed to a single day are used: a per-day rate
 * and a per-km rate. A monthly or annual charging line is a subscription, not the
 * cost of a shift, and spreading it across days would invent a daily figure that
 * no day incurred — so those stay in the month total and out of the daily view.
 */
export function modelledDayCharging(chargingCosts, month, entry) {
  const km = dayKm(entry);
  let total = 0;
  for (const cost of chargingCosts || []) {
    const amount = Number(cost?.amount) || 0;
    if (!amount) continue;
    if (cost.date && cost.date.slice(0, 7) > month) continue;
    if (cost.frequency === 'daily') total += amount;
    else if (cost.frequency === 'perKm') total += amount * km;
  }
  return round2(total);
}

/**
 * A month of charging, day by day, logged where it exists and modelled where it
 * does not.
 *
 * `perKm` is the number to judge on, and it is computed over MATCHED days only:
 * days that have both a cost and a distance. Dividing a month's cost by a month's
 * distance mixes day sets — a day whose GPS sync failed contributes cost but no
 * kilometres — and the rate then jumps for a reason that has nothing to do with
 * where anybody charged. Every per-km figure carries the day count it came from,
 * so a rate computed over three days cannot pass for a month's verdict.
 */
export function chargingForMonth(entries, chargingCosts, month) {
  const days = [];
  for (const entry of entries || []) {
    if (entry.offDay) continue;
    const km = dayKm(entry);
    const logged = daySessionTotal(entry);
    const drove = km > 0 || (entry.revenue || 0) > 0 || (entry.trips || 0) > 0;
    if (!logged && !drove) continue;

    const cost = logged ? logged.total : modelledDayCharging(chargingCosts, month, entry);
    if (cost <= 0 && !logged) continue;

    days.push({
      date: entry.date,
      cost,
      km,
      kwh: logged ? dayKwh(entry) : null,
      sessions: logged ? logged.sessions : 0,
      estimated: !logged,
      // Only a day with both halves can carry a rate.
      perKm: cost > 0 && km > 0 ? round2(cost / km) : null,
    });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  const logged = round2(days.filter((d) => !d.estimated).reduce((s, d) => s + d.cost, 0));
  const modelled = round2(days.filter((d) => d.estimated).reduce((s, d) => s + d.cost, 0));

  return {
    days,
    total: round2(logged + modelled),
    logged,
    modelled,
    loggedDays: days.filter((d) => !d.estimated).length,
    modelledDays: days.filter((d) => d.estimated).length,
    ...matchedRate(days),
  };
}

/**
 * Cost per km over days that have both halves.
 *
 * Returns nulls rather than a rate when nothing matches: no figure is better than
 * a rate divided by a distance nobody recorded.
 */
export function matchedRate(days) {
  const matched = (days || []).filter((d) => d.cost > 0 && d.km > 0);
  const cost = round2(matched.reduce((s, d) => s + d.cost, 0));
  const km = round2(matched.reduce((s, d) => s + d.km, 0));
  return {
    perKm: km > 0 ? round2(cost / km) : null,
    matchedDays: matched.length,
    matchedCost: cost,
    matchedKm: km,
    // True when any matched day was modelled, so the rate is part budget.
    matchedEstimated: matched.some((d) => d.estimated),
  };
}

/**
 * The trailing window, ending on `today`.
 *
 * Seven days is the fair unit for judging charging. A single day's rate swings on
 * whether he happened to top up that evening — charge tonight, drive tomorrow, and
 * the day looks expensive and the next looks free — and sessions are counted on
 * the day they were paid rather than guessed at. Over a week those crossings even
 * out, which is why this is the number the UI treats as the verdict.
 */
export function chargingWindow(charging, today, days = 7) {
  const from = shiftDate(today, -(days - 1));
  const window = (charging?.days || []).filter((d) => d.date >= from && d.date <= today);
  return { days: window, from, to: today, ...matchedRate(window) };
}

function shiftDate(date, delta) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
