/**
 * Uber's own charges belong in the return on capital.
 *
 * They are a real monthly cost of running the car, but they arrive with the
 * daily entries rather than the cost ledger — so `levelisedMonthly`, which only
 * ever sees `allCosts`, cannot find them. Two of the three ROI bases used to
 * omit them entirely, which quietly overstated the headline return by the whole
 * subscription for every month of the holding period. These tests hold the
 * three bases to the profit figures the rest of the dashboard shows.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';

process.env.LOCAL_STORE_FILE = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-roi-test-')),
  'store.json',
);

let handler;
let ownerToken;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.OWNER_PASSWORD_HASH = bcrypt.hashSync('owner-pw', 4);
  process.env.DRIVER_PASSWORD_HASH = bcrypt.hashSync('driver-pw', 4);
  ({ handler } = await import('./handler.mjs'));
  ownerToken = await signIn('owner', 'owner-pw');
});

// Mid-month, so "this month" is genuinely partial and the projection and the
// next-month card are both exercised.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-05-15T06:00:00Z'));
});
afterEach(() => vi.useRealTimers());

function event(method, p, { token, body } = {}) {
  const [pathname, query = ''] = p.split('?');
  return {
    version: '2.0',
    rawPath: pathname,
    rawQueryString: query,
    requestContext: { http: { method, path: pathname } },
    headers: token ? { authorization: `Bearer ${token}` } : {},
    queryStringParameters: Object.fromEntries(new URLSearchParams(query)),
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

async function call(method, p, options) {
  const res = await handler(event(method, p, options));
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

async function signIn(username, password) {
  const res = await call('POST', '/login', { body: { username, password } });
  return res.body.token;
}

/** Fourteen driven days, and whatever Uber charged across them. */
async function seed({ feesPerDay }) {
  const rows = [];
  for (let day = 1; day <= 14; day++) {
    rows.push({
      date: `2026-05-${String(day).padStart(2, '0')}`,
      revenue: 14000,
      uberKm: 190,
      uberFees: feesPerDay,
    });
  }
  const res = await call('POST', '/entries/import', { token: ownerToken, body: { rows } });
  expect(res.status).toBe(200);
}

async function summary() {
  const res = await call('GET', '/summary?month=2026-05', { token: ownerToken });
  expect(res.status).toBe(200);
  return res.body;
}

beforeAll(async () => {
  await call('PUT', '/settings', {
    token: ownerToken,
    body: {
      capitalInvested: 12_000_000,
      leasedPercent: 40,
      alternativeRatePct: 9,
      holdingYears: 5,
      resaleValue: 6_000_000,
    },
  });
  await call('PUT', '/costs', {
    token: ownerToken,
    body: {
      costs: [
        { id: 'lease', label: 'Lease', category: 'lease', amount: 52000, frequency: 'monthly', date: '2026-01-01', termMonths: 60 },
        { id: 'ins', label: 'Insurance', category: 'insurance', amount: 150000, frequency: 'annual' },
      ],
    },
  });
});

describe('return on capital carries the Uber charges', () => {
  it('reports them as their own monthly figure', async () => {
    await seed({ feesPerDay: -800 });
    const s = await summary();

    // Same rate the next-month card runs on — one number, not two estimates.
    expect(s.roi.uberFeesMonthly).toBe(s.nextMonth.uberFees);
    expect(s.roi.uberFeesMonthly).toBeLessThan(0);
  });

  it('deducts them from the levelled holding-period profit', async () => {
    await seed({ feesPerDay: -800 });
    const s = await summary();

    expect(s.roi.overHolding.monthlyProfit).toBeCloseTo(
      s.nextMonth.ownerShare - s.roi.levelised.total + s.nextMonth.uberFees,
      2,
    );
    // The levelled costs alone would have left more — that gap is the charges.
    expect(s.roi.overHolding.monthlyProfit).toBeLessThan(
      s.nextMonth.ownerShare - s.roi.levelised.total,
    );
  });

  it('states the same this-month profit as the running-costs card', async () => {
    await seed({ feesPerDay: -800 });
    const s = await summary();

    expect(s.roi.thisMonth.monthlyProfit).toBe(s.projectedOwnerProfit);
  });

  /**
   * The total-return headline is built off `overHolding`, so an omitted charge
   * compounds through the IRR and the cash multiple as well as the monthly
   * line. Charging more must return less, by the full amount, every month.
   */
  it('carries them into the total return', async () => {
    await seed({ feesPerDay: -800 });
    const cheap = await summary();

    await seed({ feesPerDay: -2000 });
    const dear = await summary();

    const gap = cheap.roi.uberFeesMonthly - dear.roi.uberFeesMonthly;
    expect(gap).toBeGreaterThan(0);
    expect(cheap.roi.overHolding.monthlyProfit - dear.roi.overHolding.monthlyProfit).toBeCloseTo(gap, 2);
    expect(dear.roi.totalReturn.totalCash).toBeCloseTo(
      cheap.roi.totalReturn.totalCash - gap * dear.roi.horizonMonths,
      2,
    );
    expect(dear.roi.totalReturn.annualPct).toBeLessThan(cheap.roi.totalReturn.annualPct);
  });

  it('leaves the return alone when Uber charged nothing', async () => {
    await seed({ feesPerDay: 0 });
    const s = await summary();

    expect(s.roi.uberFeesMonthly).toBe(0);
    expect(s.roi.overHolding.monthlyProfit).toBeCloseTo(
      s.nextMonth.ownerShare - s.roi.levelised.total,
      2,
    );
  });
});
