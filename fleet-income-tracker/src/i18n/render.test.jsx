/**
 * What the driver's screen actually renders in Sinhala.
 *
 * The dictionary test proves the two languages hold the same keys; this proves
 * the components ask for them. A hardcoded English literal left in a component
 * passes every other check in the suite — the app builds, the tests are green,
 * and the string simply appears in English on a Sinhala screen. The only way to
 * catch it is to render the thing and look at the words.
 *
 * `renderToStaticMarkup` needs no browser: these are functions of their props,
 * and the locale is module state rather than context, so nothing has to be
 * wrapped in a provider to be rendered in Sinhala.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

// The dashboard imports the map card, and Leaflet touches `window` the moment it
// is loaded. The card itself is not rendered here — it lives behind a tap, and a
// real map needs a real DOM — so a stub is enough to let the module graph load.
vi.mock('leaflet', () => ({ default: {} }));
import { prorate, DEFAULT_SETTINGS } from '../../shared/commission.mjs';
import { setLocale, resetLocale } from './i18n.js';
import DriverDashboard from '../pages/DriverDashboard.jsx';
import CashPocket from '../components/CashPocket.jsx';
import DriverCosts, { DriverCostsTeaser } from '../components/DriverCosts.jsx';
import MarginalRates from '../components/MarginalRates.jsx';
import PayBreakdown from '../components/PayBreakdown.jsx';
import TierLadder from '../components/TierLadder.jsx';
import DaysOff from '../components/DaysOff.jsx';
import ChargeLog from '../components/ChargeLog.jsx';

/** A month with something in every branch the driver's screen can take. */
function summary(over = {}) {
  const plan = prorate(DEFAULT_SETTINGS, 1);
  return {
    month: '2026-07',
    revenue: 257035.8,
    projectedRevenue: 331000,
    driverPay: 79354.84,
    dailyAverage: 18359.7,
    trips: 214,
    earningDays: 14,
    daysInMonth: 31,
    operatingDays: 31,
    elapsedDays: 14,
    projectedDays: 17,
    offDaysElapsed: 0,
    offDaysAhead: 2,
    prorationFactor: 1,
    payTarget: 93000,
    revenueBasis: 'net',
    uberCommissionRate: 0.25,
    driverName: 'Chandima',
    bankCredited: 180000,
    cashKnown: true,
    yesterday: { date: '2026-07-26', revenue: 21400, trips: 18, offDay: false },
    bestDay: { date: '2026-07-24', revenue: 24800, trips: 21 },
    lastMonth: { month: '2026-06', driverPay: 71000, partial: false },
    plan: { base: plan.base, bandStart: plan.bandStart, bandEnd: plan.bandEnd },
    push: {
      bandRate: DEFAULT_SETTINGS.bandRate,
      topRate: DEFAULT_SETTINGS.topRate,
      bandStart: plan.bandStart,
      bandEnd: plan.bandEnd,
      marginalNow: DEFAULT_SETTINGS.bandRate,
      revenuePerTrip: 1201,
    },
    tiers: [
      { key: 'base', label: 'Base', amount: 19500, basis: 0 },
      { key: 'band', label: 'Band', amount: 34839, basis: 116129 },
      { key: 'top', label: 'Top', amount: 25015, basis: 50030 },
    ],
    uberFees: {
      toDate: -3018,
      lines: [{ label: 'Drive Pass', amount: -2400 }],
      taxes: [{ label: 'VAT', amount: -900 }],
    },
    directCosts: { total: 28400, kmDriven: 2410, perKm: 11.78, matchedDays: 9, matchedKm: 1980 },
    charging: {
      logged: 22000,
      modelled: 6400,
      loggedDays: 7,
      modelledDays: 2,
      matchedDays: 9,
      last7: {
        perKm: 11.4,
        matchedDays: 5,
        estimated: false,
        days: [
          { date: '2026-07-26', cost: 2400, km: 210, perKm: 11.43, estimated: false },
          { date: '2026-07-25', cost: 1800, km: 0, perKm: null, estimated: true },
        ],
      },
    },
    cash: {
      collected: 71938.03,
      confirmed: 20000,
      pending: 5000,
      holding: 51938.03,
      settlement: 12000,
      handovers: [
        { id: '1', date: '2026-07-20', amount: 20000, confirmed: true, loggedBy: 'driver' },
        { id: '2', date: '2026-07-25', amount: 5000, confirmed: false, loggedBy: 'driver', note: 'office' },
      ],
    },
    series: { actual: [] },
  };
}

/**
 * Latin letters, ignoring the ones that are Latin in both languages: brand and
 * product names, the units that stay Latin by design, and anything inside an
 * attribute (class names, SVG paths, URLs) rather than in the text the driver
 * reads.
 */
function englishWordsIn(html) {
  const text = html
    // Drop tags entirely — only rendered text is under test.
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/g, ' ');
  const allowed = new Set([
    'Ravensoft',
    'Fleet',
    'Uber',
    'Drive',
    'Pass',
    'VAT',
    'CCS2',
    'GPS',
    'Google',
    'Maps',
    'App',
    'Chandima',
    'office',
    'kWh',
    'km',
    'D',
    'TOU',
    'est',
    // Names of things in Uber's own file, which the driver sees spelled this way
    // in the export itself — translating them would break the instruction.
    'export',
    'payments',
    'collected',
    // Loanwords the translation deliberately keeps in Latin script, because they
    // are what drivers actually say. This list is the seam between "we have not
    // translated this yet" and "this IS the Sinhala" — a word only belongs here
    // once a native speaker has chosen it.
    'cash',
    'Cash',
  ]);
  return [...text.matchAll(/[A-Za-z]{2,}/g)].map((m) => m[0]).filter((w) => !allowed.has(w));
}

beforeEach(() => setLocale('si'));
afterEach(() => resetLocale('en'));

const noop = () => {};

describe('the driver screen in Sinhala', () => {
  it('renders no untranslated English', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DriverDashboard summary={summary()} month="2026-07" setMonth={noop} onRefresh={noop} />
      </MemoryRouter>,
    );
    expect(englishWordsIn(html)).toEqual([]);
  });

  it('leaks no translation keys', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DriverDashboard summary={summary()} month="2026-07" setMonth={noop} onRefresh={noop} />
      </MemoryRouter>,
    );
    // A key that is not in the dictionary renders as itself: `stat.daysLeft`.
    // Checked against the rendered text rather than the markup, so a dotted
    // class name or a URL in an attribute cannot mask a real leak.
    const text = html.replace(/<[^>]*>/g, ' ');
    expect(text).not.toMatch(/[a-z]+\.[a-zA-Z]{2,}/);
  });

  it('renders the cards behind the panels too', () => {
    // Rendered separately because they live behind a tap on the real screen.
    const s = summary();
    for (const card of [
      <CashPocket summary={s} hero={null} onChange={noop} voice="driver" />,
      <DriverCosts summary={s} />,
      <DriverCostsTeaser summary={s} onOpen={noop} />,
      <MarginalRates summary={s} />,
      <PayBreakdown summary={s} />,
      <TierLadder
        variant="driver"
        revenue={s.revenue}
        projected={s.projectedRevenue}
        bandStart={s.plan.bandStart}
        bandEnd={s.plan.bandEnd}
      />,
    ]) {
      expect(englishWordsIn(renderToStaticMarkup(card))).toEqual([]);
    }
  });

  /**
   * The two cards the driver writes on live on the daily-log page rather than the
   * dashboard, which is exactly how they stayed in English through several passes
   * over the dictionary: nothing rendered them in Sinhala, so nothing caught it.
   */
  it('renders the cards the driver writes on', () => {
    const entries = [
      {
        date: '2026-07-26',
        revenue: 21400,
        trips: 18,
        uberKm: 210,
        offDay: false,
        chargeSessions: [
          { id: 'a', amount: 2400, station: 'Keells Kottawa', kwh: 32 },
          { id: 'b', amount: 900, station: '', kwh: null },
        ],
      },
      { date: '2026-07-25', revenue: 0, trips: 0, offDay: true, chargeSessions: [] },
    ];
    for (const card of [
      <DaysOff entries={entries} month="2026-07" onChange={noop} />,
      <ChargeLog entries={entries} onSaved={noop} />,
      // The empty state is its own sentence, and only renders with nothing logged.
      <ChargeLog entries={[{ date: '2026-07-26', revenue: 0, chargeSessions: [] }]} onSaved={noop} />,
    ]) {
      expect(englishWordsIn(renderToStaticMarkup(card))).toEqual([]);
    }
  });

  it('keeps the money in Latin digits, under a Sinhala unit', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DriverDashboard summary={summary()} month="2026-07" setMonth={noop} onRefresh={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain('රු');
    expect(html).not.toContain('LKR');
    expect(html).toMatch(/257,036|257,035/);
  });
});

describe('the same screen in English', () => {
  it('is unchanged by any of this', () => {
    setLocale('en');
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DriverDashboard summary={summary()} month="2026-07" setMonth={noop} onRefresh={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain('Goal today');
    expect(html).toContain('LKR');
    expect(html).toContain('Days left');
  });
});
