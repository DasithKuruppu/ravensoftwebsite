/**
 * What the cash card actually renders.
 *
 * Two of its rules are about output rather than arithmetic — whole rupees
 * everywhere, and a single "Holding now" line until a handover has been confirmed
 * — so they are asserted against the rendered markup. `renderToStaticMarkup`
 * needs no browser: the card is a plain function of its props, and its only state
 * is the closed handover form.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CashPocket from './components/CashPocket.jsx';
import { DriverCostsTeaser } from './components/DriverCosts.jsx';
import { chargingHeadline, chargingWeek, cashPocket } from './display.js';

/** A month with cents in every stored figure, as the API really sends them. */
function summary(over = {}) {
  const { cash, ...top } = over;
  return {
    revenue: 57035.8,
    bankCredited: 25097.77,
    cashKnown: true,
    driverName: 'Driver',
    driverPay: 19354.84,
    ...top,
    cash: {
      collected: 31938.03,
      confirmed: 0,
      pending: 0,
      holding: 31938.03,
      cashShare: 0.5612,
      cashShareBasis: '30d',
      cashShareDays: 5,
      projectedCash: 70268.11,
      settlement: 39270.67,
      handovers: [],
      ...(cash || {}),
    },
  };
}

const hero = { kind: 'goal', amount: 14000 };
const markupOf = (props) =>
  renderToStaticMarkup(<CashPocket hero={hero} onChange={() => {}} {...props} />);

/**
 * The visible text, with tags and attributes stripped.
 *
 * Class names carry decimals of their own — `h-2.5`, `gap-2.5`, `stroke-width=1.8`
 * — so a decimal check against raw markup fails on the stylesheet rather than on
 * anything a driver can see.
 */
const render = (props) => markupOf(props).replace(/<[^>]*>/g, ' ');

/** Any number with a decimal point in it, e.g. "31,938.03". */
const DECIMALS = /\d[\d,]*\.\d/;

describe('the cash card renders whole rupees', () => {
  it('shows no decimals anywhere, from figures that all have them', () => {
    const markup = render({ summary: summary(), voice: 'driver' });
    // Every stored figure above carries cents; none of them may reach the glass.
    expect(markup).not.toMatch(DECIMALS);
    expect(markup).toContain('31,938');
    expect(markup).toContain('25,098');
    expect(markup).toContain('57,036');
  });

  it('rounds the ledger for display while the store keeps it exact', () => {
    const ledger = [
      { id: 'a', date: '2026-07-23', amount: 12000.55, confirmed: true, loggedBy: 'driver' },
      { id: 'b', date: '2026-07-26', amount: 6000.49, confirmed: false, loggedBy: 'driver' },
    ];
    const s = summary({ cash: { confirmed: 12000.55, pending: 6000.49, holding: 19937.48, handovers: ledger } });
    const markup = render({ summary: s, voice: 'driver' });
    expect(markup).not.toMatch(DECIMALS);
    expect(markup).toContain('12,001');
    // The exact figures are untouched in what the card was handed.
    expect(s.cash.handovers[0].amount).toBe(12000.55);
  });

  it('holds to whole rupees in the owner mirror too', () => {
    expect(render({ summary: summary(), voice: 'owner' })).not.toMatch(DECIMALS);
  });
});

describe('the holding breakdown has two states', () => {
  it('is one line until a handover has been confirmed', () => {
    const markup = render({ summary: summary(), voice: 'driver' });
    expect(markup).toContain('Holding now');
    expect(markup).toContain('nothing handed over yet');
    // No subtraction worth showing: holding IS the cash collected.
    expect(markup).not.toContain('Handed over');
    expect(markup).not.toContain('>Collected<');
  });

  it('shows the working once one is confirmed', () => {
    const s = summary({
      cash: {
        confirmed: 18000,
        holding: 13938.03,
        handovers: [{ id: 'a', date: '2026-07-23', amount: 18000, confirmed: true, loggedBy: 'driver' }],
      },
    });
    const markup = render({ summary: s, voice: 'driver' });
    expect(markup).toContain('Collected');
    expect(markup).toContain('Handed over');
    expect(markup).toContain('Holding now');
    expect(markup).toContain('13,938');
    expect(markup).not.toMatch(DECIMALS);
  });

  it('says so rather than showing zeros when no cash is recorded', () => {
    const markup = render({ summary: summary({ cashKnown: false }), voice: 'driver' });
    expect(markup).toContain('No cash figures yet');
  });
});

describe('the charging teaser and the costs card agree', () => {
  const withCharging = {
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
      last7: {
        from: '2026-07-20',
        to: '2026-07-26',
        perKm: 14.72,
        matchedDays: 3,
        matchedKm: 450,
        matchedEstimated: false,
        days: [{ date: '2026-07-25', cost: 2400, km: 163, perKm: 14.72, estimated: false, sessions: 1 }],
      },
    },
  };

  it('quotes the figure the shared helper returns, not its own arithmetic', () => {
    const s = { ...summary(), ...withCharging };
    const headline = chargingHeadline(s);
    // The week has matched days, so that is the headline.
    expect(headline).toEqual({ perKm: 14.72, matchedDays: 3, basis: '7d', estimated: false });
    expect(headline.perKm).toBe(chargingWeek(s).perKm);

    const markup = renderToStaticMarkup(<DriverCostsTeaser summary={s} onOpen={() => {}} />);
    expect(markup).toContain('14.72');
    expect(markup).toContain('over 3 days');
    // And NOT the month figure, which is the parallel number it used to show.
    expect(markup).not.toContain('18.64');
  });

  it('falls back to the month when the week has nothing matched', () => {
    const s = {
      ...summary(),
      ...withCharging,
      charging: { ...withCharging.charging, last7: { ...withCharging.charging.last7, perKm: null, matchedDays: 0, days: [] } },
    };
    const headline = chargingHeadline(s);
    expect(headline).toEqual({ perKm: 18.64, matchedDays: 5, basis: 'month', estimated: true });
    const markup = renderToStaticMarkup(<DriverCostsTeaser summary={s} onOpen={() => {}} />);
    expect(markup).toContain('18.64');
    expect(markup).toContain('over 5 days');
    expect(markup).toContain('part estimated');
  });

  it('shows nothing at all rather than a rate with no days behind it', () => {
    expect(chargingHeadline(summary())).toBe(null);
    expect(renderToStaticMarkup(<DriverCostsTeaser summary={summary()} onOpen={() => {}} />)).toBe('');
  });
});

describe('cashPocket rounds for the card', () => {
  it('hands the card integers', () => {
    const p = cashPocket(summary(), hero);
    for (const key of ['cashIn', 'bankIn', 'totalIn', 'holding', 'handedOver', 'pending', 'byTonight', 'settlement']) {
      expect(Number.isInteger(p[key])).toBe(true);
    }
  });
});
