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

/** A starting set, so the editor is not an empty grid. Amounts are zero. */
export const DEFAULT_COSTS = [
  { id: 'lease', label: 'Lease instalment', category: 'lease', frequency: 'monthly', amount: 0, date: null, termMonths: 36 },
  { id: 'charging', label: 'Charging', category: 'charging', frequency: 'perKm', amount: 0, date: null },
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

export function categoryLabel(key) {
  return COST_CATEGORIES.find((c) => c.key === key)?.label || 'Other';
}
