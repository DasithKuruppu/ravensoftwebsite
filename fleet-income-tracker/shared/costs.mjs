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
 *   once     a single event on a date — a service, one charging session
 *   monthly  a recurring monthly charge — a data package
 *   annual   billed yearly — insurance, revenue licence. Spread across twelve
 *            months, because charging a whole year's insurance to March would
 *            make March look catastrophic and the other eleven months rosy.
 *
 * Depreciation is usually best entered as an annual figure and left to spread.
 */

export const COST_CATEGORIES = [
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
  { key: 'monthly', label: 'Every month' },
  { key: 'annual', label: 'Every year' },
];

/** A starting set, so the editor is not an empty grid. Amounts are zero. */
export const DEFAULT_COSTS = [
  { id: 'charging', label: 'Charging', category: 'charging', frequency: 'monthly', amount: 0, date: null },
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
export function monthlyAmount(cost, month) {
  const amount = Number(cost?.amount) || 0;
  if (!amount) return 0;

  const startsAfter = cost.date && cost.date.slice(0, 7) > month;

  switch (cost.frequency) {
    case 'once':
      return cost.date && cost.date.slice(0, 7) === month ? round2(amount) : 0;
    case 'annual':
      return startsAfter ? 0 : round2(amount / 12);
    case 'monthly':
    default:
      return startsAfter ? 0 : round2(amount);
  }
}

/** Every cost's contribution to a month, plus the total. */
export function costsForMonth(costs, month) {
  const items = (costs || [])
    .map((c) => ({ ...c, monthly: monthlyAmount(c, month) }))
    .filter((c) => c.monthly > 0)
    .sort((a, b) => b.monthly - a.monthly);

  return { items, total: round2(items.reduce((sum, c) => sum + c.monthly, 0)) };
}

export function categoryLabel(key) {
  return COST_CATEGORIES.find((c) => c.key === key)?.label || 'Other';
}
