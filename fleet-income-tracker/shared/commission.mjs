/**
 * Commission plan calculation.
 *
 * Shared by the frontend, the API Lambda and the tests — this is the single
 * source of truth. No tier parameter is hardcoded here: they all arrive via
 * the `settings` argument (persisted in the settings table, editable in the UI).
 *
 * @typedef {Object} TierSettings
 * @property {number} base       Flat tier-1 payment, paid regardless of revenue.
 * @property {number} bandStart  Revenue at which tier 2 starts.
 * @property {number} bandEnd    Revenue at which tier 2 ends / tier 3 starts.
 * @property {number} bandRate   Fraction (0..1) paid on the tier-2 band.
 * @property {number} topRate    Fraction (0..1) paid on revenue above bandEnd.
 */

/** Default plan, used to seed the settings row on first run. */
export const DEFAULT_SETTINGS = {
  base: 50000,
  bandStart: 240000,
  bandEnd: 300000,
  bandRate: 0.3,
  topRate: 0.5,
  /** Date the driver started, yyyy-mm-dd. null means "has always been running". */
  startDate: null,
  /**
   * What to call the driver in the UI. Deliberately generic here — this repo is
   * public, so the real name is set once in the app and lives in the database,
   * not in source control.
   */
  driverName: 'Driver',
  /** What the vehicle cost, for return-on-capital. null = not recorded. */
  capitalInvested: null,
  /** The alternative the capital could have earned, annual %. */
  alternativeRatePct: 9,
  /** Share of the vehicle financed by lease, %. The rest is own equity. */
  leasedPercent: 0,
};

/**
 * Scale a plan to a partial month.
 *
 * The plan is written for a full month, so a month the driver only works part
 * of is judged on the same daily run-rate: the flat base and both band edges
 * shrink in proportion to the days available to work. The percentages
 * themselves do not change — 30% of the band is still 30% of the band.
 *
 * factor 1 returns the plan untouched, so a full month is unaffected.
 */
export function prorate(settings, factor) {
  const f = Number.isFinite(factor) ? Math.min(1, Math.max(0, factor)) : 1;
  if (f === 1) return settings;
  return {
    ...settings,
    base: round2(settings.base * f),
    bandStart: round2(settings.bandStart * f),
    bandEnd: round2(settings.bandEnd * f),
  };
}

/** Round to cents, avoiding binary float dust (e.g. 53394.599999999 -> 53394.6). */
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Driver pay for a gross monthly revenue.
 *
 * @param {number} revenue Gross monthly revenue R (LKR).
 * @param {TierSettings} settings
 * @returns {{ total: number, tiers: Array<{ key: string, label: string, amount: number, basis: number }> }}
 */
export function calculatePay(revenue, settings = DEFAULT_SETTINGS, factor = 1) {
  const { base, bandStart, bandEnd, bandRate, topRate } = prorate(settings, factor);
  const r = Number.isFinite(revenue) && revenue > 0 ? revenue : 0;

  // Tier 2 pays on the portion of R that falls inside [bandStart, bandEnd].
  const bandPortion = Math.max(0, Math.min(r, bandEnd) - bandStart);
  // Tier 3 pays on everything above bandEnd.
  const topPortion = Math.max(0, r - bandEnd);

  const tier1 = round2(base);
  const tier2 = round2(bandPortion * bandRate);
  const tier3 = round2(topPortion * topRate);

  return {
    total: round2(tier1 + tier2 + tier3),
    tiers: [
      { key: 'base', label: 'Base', amount: tier1, basis: 0 },
      {
        key: 'band',
        label: `${pct(bandRate)} of ${fmtRange(bandStart, bandEnd)}`,
        amount: tier2,
        basis: round2(bandPortion),
      },
      {
        key: 'top',
        label: `${pct(topRate)} above ${compact(bandEnd)}`,
        amount: tier3,
        basis: round2(topPortion),
      },
    ],
  };
}

/** Owner keeps whatever the driver's plan does not pay out. */
export function ownerShare(revenue, settings = DEFAULT_SETTINGS, factor = 1) {
  return round2((revenue || 0) - calculatePay(revenue, settings, factor).total);
}

/**
 * How much of a month the driver is available to work, as a fraction.
 *
 * Only the month containing the start date is partial — every later month
 * returns 1 and the plan runs at its normal levels. Returns 0 for a month
 * entirely before the driver started.
 */
export function monthFactor(month, startDate, daysInMonth) {
  if (!startDate) return 1;
  const startMonth = startDate.slice(0, 7);
  if (month > startMonth) return 1;
  if (month < startMonth) return 0;
  const startDay = Number(startDate.slice(8, 10));
  return (daysInMonth - startDay + 1) / daysInMonth;
}

/**
 * Days in `month` the driver was available to work, up to and including today.
 * Used as the denominator of the month-end projection so days before the driver
 * started never dilute the daily average.
 */
export function operatingDays(month, startDate, daysInMonth, today) {
  const first = startDate && startDate.slice(0, 7) === month ? Number(startDate.slice(8, 10)) : 1;
  if (startDate && month < startDate.slice(0, 7)) return { elapsed: 0, total: 0 };

  const isCurrentMonth = today.slice(0, 7) === month;
  const lastElapsed = isCurrentMonth ? Number(today.slice(8, 10)) : month > today.slice(0, 7) ? 0 : daysInMonth;

  return {
    elapsed: Math.max(0, lastElapsed - first + 1),
    total: Math.max(0, daysInMonth - first + 1),
  };
}

/**
 * Straight-line month-end projection: MTD / elapsed days * days in month.
 * `elapsedDays` is calendar days elapsed, not days logged — a skipped day is
 * a zero-revenue day, not a missing sample.
 */
export function projectRevenue(mtdRevenue, elapsedDays, daysInMonth) {
  if (!elapsedDays || elapsedDays <= 0) return 0;
  return round2((mtdRevenue / elapsedDays) * daysInMonth);
}

function pct(rate) {
  return `${round2(rate * 100)}%`;
}

function compact(n) {
  return n >= 1000 ? `${round2(n / 1000)}k` : String(n);
}

function fmtRange(a, b) {
  return `${compact(a)}–${compact(b)}`;
}
