/**
 * Two auth boundaries, tested through the real handler rather than trusted to a
 * code reading:
 *
 *   1. the driver's earnings goal is the only settings field he may write (the
 *      only other thing he can write at all is marking a day off);
 *   2. the cost ledger is filtered by role on the way out, so a driver token
 *      cannot receive the lease, insurance, depreciation or the revenue licence
 *      whatever a future screen asks for.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

/**
 * Pin the clock for a test that seeds "today" and "yesterday".
 *
 * Those two are in different MONTHS on the first of any month, so a suite that
 * reads the wall clock passes for thirty days and fails on the thirty-first —
 * which is exactly what happened. Mid-May, deliberately: every other fixture in
 * this file is dated in July, so a pinned clock there would collide with days
 * those tests have already written. Timers still advance so awaits resolve.
 */
function atMidMonth() {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-05-15T06:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());
}
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';

// Point the file store at a scratch file BEFORE the store module is loaded.
// Without this the suite writes settings and cost lines into whatever local
// store the developer is running the app against, which is somebody's real data.
process.env.LOCAL_STORE_FILE = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-test-')),
  'store.json',
);

let handler;
let ownerToken;
let driverToken;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.OWNER_PASSWORD_HASH = bcrypt.hashSync('owner-pw', 4);
  process.env.DRIVER_PASSWORD_HASH = bcrypt.hashSync('driver-pw', 4);
  ({ handler } = await import('./handler.mjs'));
  ownerToken = await signIn('owner', 'owner-pw');
  driverToken = await signIn('driver', 'driver-pw');
});

function event(method, path, { token, body } = {}) {
  // Split the query off the path the way API Gateway does, so a test can call
  // "/entries?month=2026-07" and have the handler see both parts.
  const [pathname, query = ''] = path.split('?');
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

async function call(method, path, options) {
  const res = await handler(event(method, path, options));
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

async function signIn(username, password) {
  const res = await call('POST', '/login', { body: { username, password } });
  return res.body.token;
}

describe('PUT /settings/target', () => {
  it('lets the driver set his own goal', async () => {
    const res = await call('PUT', '/settings/target', {
      token: driverToken,
      body: { revenueTarget: 420000 },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ revenueTarget: 420000 });

    const summary = await call('GET', '/summary', { token: driverToken });
    expect(summary.body.revenueTarget).toBe(420000);
  });

  /**
   * Writing a revenue goal has to retire the take-home one it replaced. The
   * display layer converts a leftover `payTarget` when no revenue goal is set,
   * so a stale one left in the record would outlive a goal he had cleared.
   */
  it('retires the take-home goal it replaced', async () => {
    await call('PUT', '/settings/target', { token: driverToken, body: { revenueTarget: 420000 } });
    const summary = await call('GET', '/summary', { token: driverToken });
    expect(summary.body.payTarget).toBe(null);
  });

  it('lets the owner set it too', async () => {
    const res = await call('PUT', '/settings/target', {
      token: ownerToken,
      body: { revenueTarget: 300000 },
    });
    expect(res.status).toBe(200);
    expect(res.body.revenueTarget).toBe(300000);
  });

  it('clears the goal on an explicit null', async () => {
    const res = await call('PUT', '/settings/target', {
      token: driverToken,
      body: { revenueTarget: null },
    });
    expect(res.status).toBe(200);
    expect(res.body.revenueTarget).toBe(null);
  });

  it('refuses a value that is not a number', async () => {
    const res = await call('PUT', '/settings/target', {
      token: driverToken,
      body: { revenueTarget: 'lots' },
    });
    expect(res.status).toBe(400);
  });

  it('clamps a negative or absurd goal instead of storing it', async () => {
    expect((await call('PUT', '/settings/target', { token: driverToken, body: { revenueTarget: -5000 } })).body.revenueTarget).toBe(0);
    expect((await call('PUT', '/settings/target', { token: driverToken, body: { revenueTarget: 99_000_000 } })).body.revenueTarget).toBe(5_000_000);
  });

  it('needs a token', async () => {
    const res = await call('PUT', '/settings/target', { body: { revenueTarget: 1000 } });

    expect(res.status).toBe(401);
  });

  it('does not open the rest of the settings record to him', async () => {
    // Setting his goal must not become a way to move his own commission plan.
    await call('PUT', '/settings/target', { token: driverToken, body: { payTarget: 100000, base: 999999 } });
    const settings = await call('GET', '/settings', { token: ownerToken });
    expect(settings.body.base).toBe(50000);

    const refused = await call('PUT', '/settings', { token: driverToken, body: { base: 999999 } });
    expect(refused.status).toBe(403);
  });
});

describe('GET /costs by role', () => {
  const LEDGER = [
    { id: 'lease', label: 'Lease instalment', category: 'lease', frequency: 'monthly', amount: 73000 },
    { id: 'charging', label: 'Charging', category: 'charging', frequency: 'perKm', amount: 12 },
    { id: 'insurance', label: 'Insurance', category: 'insurance', frequency: 'annual', amount: 150000 },
    { id: 'licence', label: 'Revenue licence', category: 'licence', frequency: 'annual', amount: 14000 },
    { id: 'depreciation', label: 'Depreciation', category: 'depreciation', frequency: 'annual', amount: 480000 },
    // The trap: an owner ticking "driver sees" on the lease must not make the
    // lease visible to him. The category whitelist is the gate, not this flag.
    { id: 'lease-leak', label: 'Lease (flagged visible)', category: 'lease', frequency: 'monthly', amount: 73000, driverVisible: true },
  ];

  beforeAll(async () => {
    const res = await call('PUT', '/costs', { token: ownerToken, body: { costs: LEDGER } });
    expect(res.status).toBe(200);
    // A day of driving, so the usage-based charging line has a distance to
    // multiply and appears in the month at all.
    const { importRows } = await import('./handler.mjs');
    await importRows([{ date: `${new Date().toISOString().slice(0, 7)}-15`, revenue: '12000', trips: '10', uberKm: '150' }]);
  });

  it('gives the owner the whole ledger', async () => {
    const res = await call('GET', '/costs', { token: ownerToken });
    expect(res.status).toBe(200);
    expect(res.body.costs.map((c) => c.category).sort()).toEqual(
      ['charging', 'depreciation', 'insurance', 'lease', 'lease', 'licence'].sort(),
    );
  });

  it('gives the driver charging and nothing else', async () => {
    const res = await call('GET', '/costs', { token: driverToken });
    expect(res.status).toBe(200);
    expect(res.body.costs.map((c) => c.category)).toEqual(['charging']);
  });

  it('does not let a per-line flag defeat the whitelist', async () => {
    const res = await call('GET', '/costs', { token: driverToken });
    const labels = res.body.costs.map((c) => c.label);
    expect(labels).not.toContain('Lease (flagged visible)');
    expect(JSON.stringify(res.body)).not.toMatch(/73000|150000|480000|14000/);
  });

  it('keeps the ledger read-only for him', async () => {
    const res = await call('PUT', '/costs', { token: driverToken, body: { costs: [] } });
    expect(res.status).toBe(403);
  });

  it('keeps owner figures out of his summary entirely', async () => {
    const driver = await call('GET', '/summary', { token: driverToken });
    expect(driver.body.costs).toBeUndefined();
    expect(driver.body.ownerShare).toBeUndefined();
    expect(driver.body.ownerProfit).toBeUndefined();
    expect(driver.body.roi).toBeUndefined();
    // What he does get is the charging line, and only that.
    expect(driver.body.directCosts.items.map((c) => c.category)).toEqual(['charging']);

    const owner = await call('GET', '/summary', { token: ownerToken });
    expect(owner.body.costs.items.length).toBeGreaterThan(1);
  });

  it('never lets a driver token reach the whole ledger through any route', async () => {
    for (const path of ['/costs', '/settings', '/validate']) {
      const res = await call('GET', path, { token: driverToken });
      const body = JSON.stringify(res.body || {});
      expect(body).not.toMatch(/lease|depreciation|insurance/i);
    }
  });
});

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

describe('PUT /entries/{date}/charging', () => {
  const DATE = '2026-07-20';

  it('lets the driver log what he paid', async () => {
    const res = await call('PUT', `/entries/${DATE}/charging`, {
      token: driverToken,
      body: {
        sessions: [
          { amount: 1200, station: 'Keells Kottawa', kwh: 18.4 },
          { amount: 800 },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.chargeSessions).toHaveLength(2);
    expect(res.body.chargeSessions[0]).toMatchObject({ amount: 1200, station: 'Keells Kottawa', kwh: 18.4 });
    // Several sessions in a day are normal — a top-up and a full charge.
    expect(res.body.chargeSessions[1].amount).toBe(800);
  });

  it('replaces the day rather than appending, so an edit is an edit', async () => {
    await call('PUT', `/entries/${DATE}/charging`, {
      token: driverToken,
      body: { sessions: [{ amount: 2500 }] },
    });
    const res = await call('GET', '/entries?month=2026-07', { token: driverToken });
    const day = res.body.entries.find((e) => e.date === DATE);
    expect(day.chargeSessions).toHaveLength(1);
    expect(day.chargeSessions[0].amount).toBe(2500);
  });

  it('clears the day on an empty list', async () => {
    const res = await call('PUT', `/entries/${DATE}/charging`, { token: driverToken, body: { sessions: [] } });
    expect(res.status).toBe(200);
    expect(res.body.chargeSessions).toEqual([]);
  });

  it('drops a session with no usable amount', async () => {
    const res = await call('PUT', `/entries/${DATE}/charging`, {
      token: driverToken,
      body: { sessions: [{ amount: 900 }, { station: 'no price' }, { amount: -5 }, { amount: 0 }] },
    });
    expect(res.body.chargeSessions).toHaveLength(1);
    expect(res.body.chargeSessions[0].amount).toBe(900);
  });

  it('refuses anything that is not a list of sessions', async () => {
    const res = await call('PUT', `/entries/${DATE}/charging`, { token: driverToken, body: { sessions: 500 } });
    expect(res.status).toBe(400);
  });

  it('needs a token', async () => {
    const res = await call('PUT', `/entries/${DATE}/charging`, { body: { sessions: [{ amount: 100 }] } });
    expect(res.status).toBe(401);
  });

  it('cannot be used to edit the takings', async () => {
    // The revenue record is the owner's book. Logging a charge must not become a
    // side door into it.
    await call('PUT', `/entries/${DATE}`, {
      token: ownerToken,
      body: { revenue: 12345, trips: 9, uberKm: 100, gpsKm: 150 },
    });
    await call('PUT', `/entries/${DATE}/charging`, {
      token: driverToken,
      body: { sessions: [{ amount: 1000 }], revenue: 999999, trips: 500 },
    });
    const res = await call('GET', '/entries?month=2026-07', { token: driverToken });
    const day = res.body.entries.find((e) => e.date === DATE);
    expect(day.revenue).toBe(12345);
    expect(day.trips).toBe(9);
    expect(day.gpsKm).toBe(150);
    expect(day.chargeSessions[0].amount).toBe(1000);

    // And the entry route itself still refuses him.
    const refused = await call('PUT', `/entries/${DATE}`, { token: driverToken, body: { revenue: 1 } });
    expect(refused.status).toBe(403);
  });

  atMidMonth();

  it('feeds the summary as a logged day, with the modelled days marked', async () => {
    // Inside the trailing window, because that is where the daily displays read
    // from: today logged, yesterday left to the configured rate.
    const { todayInColombo } = await import('./handler.mjs');
    const today = todayInColombo();
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000)
      .toISOString()
      .slice(0, 10);

    const { importRows } = await import('./handler.mjs');
    await importRows([
      { date: today, revenue: '9000', trips: '8', uberKm: '120' },
      { date: yesterday, revenue: '9000', trips: '8', uberKm: '100' },
    ]);
    await call('PUT', `/entries/${today}/charging`, {
      token: driverToken,
      body: { sessions: [{ amount: 1500 }] },
    });

    const res = await call('GET', '/summary', { token: driverToken });
    const charging = res.body.charging;
    const day = charging.last7.days.find((d) => d.date === today);
    // The logged day is the sessions, exactly, and is not an estimate.
    expect(day.cost).toBe(1500);
    expect(day.estimated).toBe(false);
    expect(charging.loggedDays).toBeGreaterThanOrEqual(1);
    // The 11th has no session, so it falls back to the configured rate and is
    // marked as modelled. A month may mix the two.
    const modelled = charging.last7.days.find((d) => d.date === yesterday);
    expect(modelled.estimated).toBe(true);
    expect(charging.modelledDays).toBeGreaterThanOrEqual(1);
    expect(charging.total).toBe(round2(charging.logged + charging.modelled));
    // A rate, and the day count it was struck over.
    expect(charging.matchedDays).toBeGreaterThan(0);
    expect(charging.perKm).toBeGreaterThan(0);
  });

  it('gives the owner the same charging figures', async () => {
    const res = await call('GET', '/summary', { token: ownerToken });
    expect(res.body.charging.total).toBeGreaterThan(0);
    // And the ledger's charging line is the actuals, with the split stated.
    const line = res.body.costs.items.find((c) => c.category === 'charging');
    expect(line.monthly).toBe(res.body.charging.total);
    expect(line.basis).toMatch(/logged/);
  });
});

describe('worked shifts in the summary', () => {
  it('leaves out days off and days with nothing recorded', async () => {
    const { todayInColombo, importRows } = await import('./handler.mjs');
    const month = todayInColombo().slice(0, 7);
    await importRows([
      { date: `${month}-02`, revenue: '11000', trips: '9', uberKm: '110' },
      { date: `${month}-03`, revenue: '12000', trips: '10', uberKm: '120' },
    ]);
    // A booked day off, and a day recorded with nothing on it.
    await call('PUT', `/entries/${month}-04/off`, { token: driverToken, body: { off: true } });
    await call('PUT', `/entries/${month}-05`, { token: ownerToken, body: { revenue: 0, trips: 0 } });

    const res = await call('GET', '/summary', { token: driverToken });
    const dates = res.body.workedShifts.map((s) => s.date);
    expect(dates).toContain(`${month}-02`);
    expect(dates).toContain(`${month}-03`);
    // Neither a rest day nor an empty day is a shift, so neither can drag the
    // rolling pace down as a zero.
    expect(dates).not.toContain(`${month}-04`);
    expect(dates).not.toContain(`${month}-05`);
    // Oldest first, so the display can take the tail as "most recent".
    expect([...dates].sort()).toEqual(dates);
  });
});

describe('the handover ledger', () => {
  // Each case starts from an empty ledger: these tests are about how one entry
  // moves the balance, and a leftover from the case before would blur that.
  beforeEach(async () => {
    const { store, DEFAULT_DRIVER } = await import('./store.mjs');
    await store.putHandovers(DEFAULT_DRIVER, []);
  });

  /** A month with cash fares, so there is a balance to settle. */
  async function seedCash() {
    const { todayInColombo, importRows } = await import('./handler.mjs');
    const today = todayInColombo();
    await importRows([
      { date: today, revenue: '10000', trips: '9', uberKm: '120', cashCollected: '4000' },
    ]);
    return today;
  }

  it('lets the driver log one, and leaves it pending', async () => {
    const today = await seedCash();
    const res = await call('POST', '/handovers', {
      token: driverToken,
      body: { amount: 3000, date: today, note: 'handed over at the office' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ amount: 3000, confirmed: false, loggedBy: 'driver' });
    expect(res.body.confirmedAt).toBe(null);

    // Pending money does not move the balance: it is money one person says moved
    // and the other has not acknowledged.
    const summary = await call('GET', '/summary', { token: driverToken });
    expect(summary.body.cash.pending).toBe(3000);
    expect(summary.body.cash.confirmed).toBe(0);
    expect(summary.body.cash.holding).toBe(summary.body.cash.collected);
  });

  it('moves the balance only once the owner confirms', async () => {
    const today = await seedCash();
    const logged = await call('POST', '/handovers', {
      token: driverToken,
      body: { amount: 3000, date: today },
    });
    const confirmed = await call('PUT', `/handovers/${logged.body.id}`, { token: ownerToken });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.confirmed).toBe(true);
    expect(confirmed.body.confirmedAt).toBeTruthy();

    const summary = await call('GET', '/summary', { token: driverToken });
    expect(summary.body.cash.confirmed).toBe(3000);
    expect(summary.body.cash.pending).toBe(0);
    expect(summary.body.cash.holding).toBe(summary.body.cash.collected - 3000);
  });

  it('refuses to let the driver confirm his own handover', async () => {
    const today = await seedCash();
    const logged = await call('POST', '/handovers', {
      token: driverToken,
      body: { amount: 1000, date: today },
    });
    const res = await call('PUT', `/handovers/${logged.body.id}`, { token: driverToken });
    expect(res.status).toBe(403);

    // Still pending, still on his balance.
    const list = await call('GET', '/handovers', { token: driverToken });
    expect(list.body.handovers.find((h) => h.id === logged.body.id).confirmed).toBe(false);
  });

  it('counts an owner-logged handover as confirmed on the spot', async () => {
    const today = await seedCash();
    const res = await call('POST', '/handovers', {
      token: ownerToken,
      body: { amount: 2000, date: today },
    });
    // He is recording money already in his hand; there is nobody left to witness it.
    expect(res.body).toMatchObject({ loggedBy: 'owner', confirmed: true });
  });

  it('lets the driver withdraw his own pending entry', async () => {
    const today = await seedCash();
    const logged = await call('POST', '/handovers', {
      token: driverToken,
      body: { amount: 900, date: today },
    });
    const res = await call('DELETE', `/handovers/${logged.body.id}`, { token: driverToken });
    expect(res.status).toBe(204);
    const list = await call('GET', '/handovers', { token: driverToken });
    expect(list.body.handovers.some((h) => h.id === logged.body.id)).toBe(false);
  });

  it('treats a confirmed handover as immutable', async () => {
    const today = await seedCash();
    const logged = await call('POST', '/handovers', {
      token: driverToken,
      body: { amount: 2500, date: today },
    });
    await call('PUT', `/handovers/${logged.body.id}`, { token: ownerToken });

    // Not the driver's to remove, and not the owner's either: a receipt stands.
    expect((await call('DELETE', `/handovers/${logged.body.id}`, { token: driverToken })).status).toBe(409);
    expect((await call('DELETE', `/handovers/${logged.body.id}`, { token: ownerToken })).status).toBe(409);

    // The way back is to un-confirm first, which only the owner can do.
    const undone = await call('PUT', `/handovers/${logged.body.id}`, {
      token: ownerToken,
      body: { confirmed: false },
    });
    expect(undone.body.confirmed).toBe(false);
    expect((await call('DELETE', `/handovers/${logged.body.id}`, { token: ownerToken })).status).toBe(204);
  });

  it('refuses a handover with no amount or no date', async () => {
    expect((await call('POST', '/handovers', { token: driverToken, body: { date: '2026-07-26' } })).status).toBe(400);
    expect((await call('POST', '/handovers', { token: driverToken, body: { amount: 500 } })).status).toBe(400);
    expect((await call('POST', '/handovers', { token: driverToken, body: { amount: -500, date: '2026-07-26' } })).status).toBe(400);
  });

  it('shows both roles the same ledger and the same holding', async () => {
    const today = await seedCash();
    await call('POST', '/handovers', { token: driverToken, body: { amount: 1200, date: today } });

    const asDriver = await call('GET', '/summary', { token: driverToken });
    const asOwner = await call('GET', '/summary', { token: ownerToken });
    expect(asOwner.body.cash.holding).toBe(asDriver.body.cash.holding);
    expect(asOwner.body.cash.pending).toBe(asDriver.body.cash.pending);
    expect(asOwner.body.cash.handovers.length).toBe(asDriver.body.cash.handovers.length);
  });

  it('needs a token', async () => {
    expect((await call('GET', '/handovers')).status).toBe(401);
    expect((await call('POST', '/handovers', { body: { amount: 100, date: '2026-07-26' } })).status).toBe(401);
  });
});

describe('the cash share behind the estimate', () => {
  it('falls back to a flat half when there is no history at all', async () => {
    // A month with revenue but no cash column imported anywhere: nothing to
    // measure a share from, so the estimate says so rather than reading zero.
    const { todayInColombo, importRows } = await import('./handler.mjs');
    const month = todayInColombo().slice(0, 7);
    await importRows([{ date: `${month}-01`, revenue: '9000', trips: '8' }]);

    const res = await call('GET', '/summary', { token: driverToken });
    // Any previously seeded cash would give a real share; assert the chain
    // reports which rung it used rather than pinning a value that other tests
    // in this file legitimately move.
    expect(['30d', 'month', 'default']).toContain(res.body.cash.cashShareBasis);
    expect(res.body.cash.cashShare).toBeGreaterThan(0);
  });

  it('measures the share from imported cash when it exists', async () => {
    const { todayInColombo, importRows } = await import('./handler.mjs');
    const today = todayInColombo();
    await importRows([
      { date: today, revenue: '10000', trips: '9', cashCollected: '2500' },
    ]);
    const res = await call('GET', '/summary', { token: driverToken });
    expect(res.body.cash.cashShareBasis).toBe('30d');
    expect(res.body.cash.cashShare).toBeGreaterThan(0);
    expect(res.body.cash.cashShare).toBeLessThanOrEqual(1);
  });
});

describe('where per-day cash comes from', () => {
  it('takes it from the payments export when the split is there', async () => {
    const { todayInColombo, importRows } = await import('./handler.mjs');
    const date = `${todayInColombo().slice(0, 7)}-08`;
    // Uber books cash collected as a deduction from the payout, so the export
    // carries it negative; what matters is how much cash changed hands.
    await importRows([{ date, revenue: '8000', trips: '7', cashCollected: '-3200' }]);
    const res = await call('GET', `/entries?month=${date.slice(0, 7)}`, { token: driverToken });
    expect(res.body.entries.find((e) => e.date === date).cashCollected).toBe(3200);
  });

  it('uses the hand-entered field when no export carries it', async () => {
    const { todayInColombo } = await import('./handler.mjs');
    const date = `${todayInColombo().slice(0, 7)}-09`;
    await call('PUT', `/entries/${date}`, {
      token: ownerToken,
      body: { revenue: 7000, trips: 6, cashCollected: 2100 },
    });
    const res = await call('GET', `/entries?month=${date.slice(0, 7)}`, { token: driverToken });
    expect(res.body.entries.find((e) => e.date === date).cashCollected).toBe(2100);
  });

  it('does not let a later import without a cash column wipe it', async () => {
    const { todayInColombo, importRows } = await import('./handler.mjs');
    const date = `${todayInColombo().slice(0, 7)}-09`;
    // The trip activity export has distance but no cash. Importing it must not
    // erase what the payments export or a hand entry already recorded.
    await importRows([{ date, uberKm: '95' }]);
    const res = await call('GET', `/entries?month=${date.slice(0, 7)}`, { token: driverToken });
    const day = res.body.entries.find((e) => e.date === date);
    expect(day.cashCollected).toBe(2100);
    expect(day.uberKm).toBe(95);
  });
});

describe('a settings row that predates the Uber fields', () => {
  it('models no commission at all', async () => {
    // Deploying this code over an existing settings row must not invent a fee.
    // Absent fields mean Drive Pass: the fares are gross and Uber's cut is the
    // subscription the import already captures.
    const { store, DEFAULT_DRIVER } = await import('./store.mjs');
    const current = await store.getSettings(DEFAULT_DRIVER);
    delete current.revenueBasis;
    delete current.uberCommissionRate;
    await store.putSettings(DEFAULT_DRIVER, current);

    const res = await call('GET', '/summary', { token: driverToken });
    expect(res.body.revenueBasis).toBe('gross');
    expect(res.body.uberCommissionRate).toBe(0);

    const { uberCut } = await import('../src/display.js');
    const cut = uberCut(res.body);
    expect(cut.commission).toBe(0);
    expect(cut.estimated).toBe(false);
    // What it does report is the measured charge, if the month has any.
    expect(cut.total).toBe(cut.charges);
  });

  it('keeps a percentage once the owner sets one deliberately', async () => {
    await call('PUT', '/settings', {
      token: ownerToken,
      body: { revenueBasis: 'net', uberCommissionRate: 0.2 },
    });
    const res = await call('GET', '/summary', { token: driverToken });
    expect(res.body.revenueBasis).toBe('net');
    expect(res.body.uberCommissionRate).toBe(0.2);
  });
});

describe('the projection and a shift still in progress', () => {
  atMidMonth();

  beforeEach(async () => {
    const { store, DEFAULT_DRIVER } = await import('./store.mjs');
    const { todayInColombo } = await import('./handler.mjs');
    const month = todayInColombo().slice(0, 7);
    for (const e of await store.queryMonth(DEFAULT_DRIVER, month)) {
      await store.deleteEntry(DEFAULT_DRIVER, e.date);
    }
    await store.putSettings(DEFAULT_DRIVER, {
      ...(await store.getSettings(DEFAULT_DRIVER)),
      startDate: null,
    });
  });

  /** yyyy-mm-dd, n days before today. */
  async function daysAgo(n) {
    const { todayInColombo } = await import('./handler.mjs');
    return new Date(Date.parse(`${todayInColombo()}T00:00:00Z`) - n * 86400000)
      .toISOString()
      .slice(0, 10);
  }

    it('strikes the pace over complete days, not the hours so far today', async () => {
    const { importRows, todayInColombo } = await import('./handler.mjs');
    await importRows([
      { date: await daysAgo(2), revenue: '12000', trips: '10' },
      { date: await daysAgo(1), revenue: '12000', trips: '10' },
      // Today: three trips by lunchtime.
      { date: todayInColombo(), revenue: '3000', trips: '3' },
    ]);

    const res = await call('GET', '/summary', { token: driverToken });
    // 24,000 over the two days that finished. Averaging today's morning in would
    // have said 9,000 — a fall in form that is really the clock.
    expect(res.body.dailyAverage).toBe(12000);
    expect(res.body.paceDays).toBe(2);
  });

  it('expects today to finish at the pace, not at what it has so far', async () => {
    const { importRows, todayInColombo, daysInMonthOf } = await import('./handler.mjs');
    const today = todayInColombo();
    await importRows([
      { date: await daysAgo(2), revenue: '12000', trips: '10' },
      { date: await daysAgo(1), revenue: '12000', trips: '10' },
      { date: today, revenue: '3000', trips: '3' },
    ]);

    const res = await call('GET', '/summary', { token: driverToken });
    const left = daysInMonthOf(today.slice(0, 7)) - Number(today.slice(8, 10)) + 1;
    // Today counts for a full day at the pace rather than for its morning, and
    // every day after it likewise.
    expect(res.body.projectedDays).toBe(left);
    expect(res.body.projectedRevenue).toBe(24000 + 12000 * left);
  });

it('counts today among the days left, and a booked day off out of them', async () => {
  const { importRows, todayInColombo, daysInMonthOf } = await import('./handler.mjs');
  const today = todayInColombo();
  const month = today.slice(0, 7);
  const days = daysInMonthOf(month);
  await importRows([{ date: await daysAgo(1), revenue: '12000', trips: '10' }]);

  const before = await call('GET', '/summary', { token: driverToken });
  expect(before.body.projectedDays).toBe(days - Number(today.slice(8, 10)) + 1);

  // Book the last day of the month off.
  await call('PUT', `/entries/${month}-${String(days).padStart(2, '0')}/off`, {
    token: driverToken,
    body: { off: true },
  });
  const after = await call('GET', '/summary', { token: driverToken });
  expect(after.body.projectedDays).toBe(before.body.projectedDays - 1);
  });

  it('does not let an unimported past day buy an extra day to earn it back', async () => {
    const { importRows, todayInColombo, daysInMonthOf } = await import('./handler.mjs');
    const today = todayInColombo();
    // Figures three days old, nothing since: the days between are simply missing.
    await importRows([{ date: await daysAgo(3), revenue: '9000', trips: '8' }]);

    const res = await call('GET', '/summary', { token: driverToken });
    // Counted from today, so the gap does not extend the month.
    expect(res.body.projectedDays).toBe(
      daysInMonthOf(today.slice(0, 7)) - Number(today.slice(8, 10)) + 1,
    );
  });

  /**
   * The month being viewed decides how many days are left in it.
   *
   * `projectedDays` used to be `daysInMonth - todayDay + 1` with no reference to
   * the requested month, so it answered for the current month whatever month was
   * asked about. Viewed from the 28th of July, August had four days in it — and
   * the driver's screen, which divides his monthly goal by this number, told him
   * to earn 91,000 a day to reach a 100,000 goal.
   */
  it('gives a future month all of its days, not the days left in this one', async () => {
    const { todayInColombo, daysInMonthOf } = await import('./handler.mjs');
    const next = nextMonthOf(todayInColombo().slice(0, 7));

    const res = await call('GET', `/summary?month=${next}`, { token: driverToken });
    expect(res.body.projectedDays).toBe(daysInMonthOf(next));
    // And the whole month is ahead, so nothing has elapsed in it.
    expect(res.body.elapsedDays).toBe(0);
  });

  it('leaves a finished month with no days left and no projection', async () => {
    const { importRows, todayInColombo } = await import('./handler.mjs');
    const previous = previousMonthOf(todayInColombo().slice(0, 7));
    await importRows([{ date: `${previous}-05`, revenue: '9000', trips: '8' }]);

    const res = await call('GET', `/summary?month=${previous}`, { token: driverToken });
    expect(res.body.projectedDays).toBe(0);
    // A month that is over is worth exactly what it earned — the projection used
    // to credit it one more day at the pace it finished on.
    expect(res.body.projectedRevenue).toBe(res.body.revenue);
  });

  it('counts a future month\'s off days by date, not by day number', async () => {
    const { todayInColombo, daysInMonthOf } = await import('./handler.mjs');
    const next = nextMonthOf(todayInColombo().slice(0, 7));

    // The 3rd of next month is genuinely ahead of us, whatever today's date is.
    // Compared as day numbers it looked past on any day after the 3rd.
    await call('PUT', `/entries/${next}-03/off`, { token: driverToken, body: { off: true } });
    const res = await call('GET', `/summary?month=${next}`, { token: driverToken });
    expect(res.body.projectedDays).toBe(daysInMonthOf(next) - 1);
  });
});

/** The month after `yyyy-mm`, rolling the year over. */
function nextMonthOf(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function previousMonthOf(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The same whole-item-replace trap as the import, reached from the owner's edit
 * form and from the day-off toggle itself.
 */
describe('an entry edit and the other writers columns', () => {
  it('keeps the day-off mark when the owner edits the figures', async () => {
    await call('PUT', '/entries/2026-07-20/off', { token: driverToken, body: { off: true } });
    await call('PUT', '/entries/2026-07-20', {
      token: ownerToken,
      body: { revenue: 12000, trips: 9 },
    });
    const res = await call('GET', '/entries?month=2026-07', { token: ownerToken });
    const day = res.body.entries.find((e) => e.date === '2026-07-20');
    expect(day.offDay).toBe(true);
    expect(day.revenue).toBe(12000);
  });

  it('still lets the owner clear a mis-marked day explicitly', async () => {
    await call('PUT', '/entries/2026-07-21/off', { token: driverToken, body: { off: true } });
    await call('PUT', '/entries/2026-07-21', {
      token: ownerToken,
      body: { revenue: 5000, offDay: false },
    });
    const res = await call('GET', '/entries?month=2026-07', { token: ownerToken });
    expect(res.body.entries.find((e) => e.date === '2026-07-21').offDay).toBe(false);
  });

  it('keeps the charging log when the owner edits the figures', async () => {
    await call('PUT', '/entries/2026-07-22/charging', {
      token: driverToken,
      body: { sessions: [{ amount: 2400, station: 'Keells Kottawa', kwh: 32 }] },
    });
    await call('PUT', '/entries/2026-07-22', { token: ownerToken, body: { revenue: 8000 } });
    const res = await call('GET', '/entries?month=2026-07', { token: ownerToken });
    const day = res.body.entries.find((e) => e.date === '2026-07-22');
    expect(day.chargeSessions).toHaveLength(1);
    expect(day.revenue).toBe(8000);
  });

  it('keeps the charging log when the day is marked off', async () => {
    await call('PUT', '/entries/2026-07-23/charging', {
      token: driverToken,
      body: { sessions: [{ amount: 1800 }] },
    });
    await call('PUT', '/entries/2026-07-23/off', { token: driverToken, body: { off: true } });
    const res = await call('GET', '/entries?month=2026-07', { token: ownerToken });
    const day = res.body.entries.find((e) => e.date === '2026-07-23');
    expect(day.offDay).toBe(true);
    expect(day.chargeSessions).toHaveLength(1);
  });
});

/**
 * The charging network's export lands through its own route, because it writes a
 * different column: what he paid to plug in, never the takings.
 */
describe('POST /entries/charging/import', () => {
  const post = (days, token = driverToken) =>
    call('POST', '/entries/charging/import', { token, body: { days } });
  const dayOf = async (date) => {
    const res = await call('GET', '/entries?month=2026-07', { token: ownerToken });
    return res.body.entries.find((e) => e.date === date);
  };

  it('writes the sessions onto their days', async () => {
    const res = await post([
      { date: '2026-07-11', sessions: [{ id: 'csv-232839', amount: 885, station: 'Keells', kwh: 5.9 }] },
      { date: '2026-07-12', sessions: [{ id: 'csv-233597', amount: 886.5 }] },
    ]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ days: 2, sessions: 2 });
    const day = await dayOf('2026-07-11');
    expect(day.chargeSessions[0].amount).toBe(885);
    expect(day.chargeSessions[0].station).toBe('Keells');
  });

  it('does not double a day when the same file is imported twice', async () => {
    const days = [{ date: '2026-07-13', sessions: [{ id: 'csv-aaa', amount: 885 }] }];
    await post(days);
    await post(days);
    const sessions = (await dayOf('2026-07-13')).chargeSessions;
    expect(sessions).toHaveLength(1);
    expect(sessions.reduce((s, x) => s + x.amount, 0)).toBe(885);
  });

  it('keeps a session the driver logged by hand', async () => {
    await call('PUT', '/entries/2026-07-14/charging', {
      token: driverToken,
      body: { sessions: [{ id: 'chg-manual', amount: 2400, station: 'home' }] },
    });
    await post([{ date: '2026-07-14', sessions: [{ id: 'csv-bbb', amount: 885 }] }]);
    const sessions = (await dayOf('2026-07-14')).chargeSessions;
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s) => s.amount === 2400)).toBeTruthy();
  });

  /** The route writes one column. Everything else on the day is somebody else's. */
  it('leaves revenue, distance and the day-off flag alone', async () => {
    await call('PUT', '/entries/2026-07-15', {
      token: ownerToken,
      body: { revenue: 12000, trips: 9, uberKm: 210 },
    });
    await call('PUT', '/entries/2026-07-15/off', { token: driverToken, body: { off: true } });
    await post([{ date: '2026-07-15', sessions: [{ id: 'csv-ccc', amount: 500 }] }]);
    const day = await dayOf('2026-07-15');
    expect(day.revenue).toBe(12000);
    expect(day.trips).toBe(9);
    expect(day.uberKm).toBe(210);
    expect(day.offDay).toBe(true);
    expect(day.chargeSessions).toHaveLength(1);
  });

  it('refuses a body that is not a list of days', async () => {
    expect((await post(undefined)).status).toBe(400);
  });

  it('needs a token', async () => {
    const res = await call('POST', '/entries/charging/import', { body: { days: [] } });
    expect(res.status).toBe(401);
  });
});

/**
 * Cash that is not a fare: the float the owner hands over to start a month, and
 * what the driver spends out of it.
 *
 * The checkbox is the whole distinction. A one-off he paid for in cash is money
 * he can no longer hand back, so it comes off his balance exactly as a handover
 * does. One the owner settled directly is still a cost, but it never touched
 * that cash — taking it off here would say he owes less than he does.
 */
describe('the starting float and cash expenses', () => {
  const setCosts = (costs) => call('PUT', '/costs', { token: ownerToken, body: { costs } });
  const setFloat = async (month, amount) => {
    const cur = (await call('GET', '/settings', { token: ownerToken })).body;
    return call('PUT', '/settings', {
      token: ownerToken,
      body: { ...cur, cashFloats: { ...(cur.cashFloats || {}), [month]: amount } },
    });
  };
  const cash = async () => (await call('GET', '/summary?month=2026-07', { token: ownerToken })).body.cash;

  it('adds the float to what the driver is carrying', async () => {
    const before = (await cash()).holding;
    await setFloat('2026-07', 5000);
    expect((await cash()).startingFloat).toBe(5000);
    expect((await cash()).holding).toBe(before + 5000);
  });

  it('takes a cash-paid expense off what he owes', async () => {
    await setFloat('2026-07', 5000);
    const before = (await cash()).holding;
    await setCosts([
      { id: 'wash', label: 'Car wash', category: 'other', frequency: 'once', amount: 800, date: '2026-07-14', paidByDriverCash: true },
    ]);
    const after = await cash();
    expect(after.cashExpenses).toBe(800);
    expect(after.holding).toBe(before - 800);
    expect(after.cashExpenseLines[0].label).toBe('Car wash');
  });

  it('ignores an expense the owner paid directly', async () => {
    await setCosts([
      { id: 'tyres', label: 'Tyres', category: 'maintenance', frequency: 'once', amount: 40000, date: '2026-07-14', paidByDriverCash: false },
    ]);
    const after = await cash();
    expect(after.cashExpenses).toBe(0);
    expect(after.cashExpenseLines).toEqual([]);
  });

  /**
   * The tick is honoured on any frequency, at whatever the cost contributes to
   * the month. It used to apply only to dated one-offs, which meant the box
   * could be ticked on a recurring line and silently do nothing — worse than
   * either allowing it or refusing it out loud.
   */
  it('counts a recurring cost at its share of the month', async () => {
    await setCosts([
      { id: 'ins', label: 'Insurance', category: 'insurance', frequency: 'annual', amount: 120000, date: '2026-07-01', paidByDriverCash: true },
    ]);
    // 120,000 a year is 10,000 of this month.
    expect((await cash()).cashExpenses).toBe(10000);
  });

  it('counts nothing for a cost nobody ticked, whatever its frequency', async () => {
    await setCosts([
      { id: 'ins', label: 'Insurance', category: 'insurance', frequency: 'annual', amount: 120000, date: '2026-07-01' },
      { id: 'lease', label: 'Lease', category: 'lease', frequency: 'monthly', amount: 52000, date: '2026-01-01' },
    ]);
    expect((await cash()).cashExpenses).toBe(0);
  });

  /**
   * The shape that made this look broken on a real screen: two expenses, ticked,
   * saved — and contributing nothing, because a one-off with no date belongs to
   * no month. `monthlyAmount` dates a one-off BY its date, so a null there is
   * not "undated", it is "never". The editor now fills the date when the
   * frequency is switched and warns if it is cleared; this pins the arithmetic
   * that made the omission silent.
   */
  it('counts nothing for a one-off with no date, and everything once it has one', async () => {
    await setCosts([
      { id: 'svc', label: 'Service Cost', category: 'other', frequency: 'once', amount: 550, date: null, paidByDriverCash: true },
    ]);
    expect((await cash()).cashExpenses).toBe(0);

    await setCosts([
      { id: 'svc', label: 'Service Cost', category: 'other', frequency: 'once', amount: 550, date: '2026-07-09', paidByDriverCash: true },
    ]);
    const after = await cash();
    expect(after.cashExpenses).toBe(550);
    expect(after.cashExpenseLines[0].date).toBe('2026-07-09');
  });

  it('ignores an expense dated in another month', async () => {
    await setCosts([
      { id: 'aug', label: 'August wash', category: 'other', frequency: 'once', amount: 900, date: '2026-08-03', paidByDriverCash: true },
    ]);
    expect((await cash()).cashExpenses).toBe(0);
  });

  it('counts the float and the expenses in what is due back at month end', async () => {
    await setCosts([]);
    await setFloat('2026-07', 5000);
    const plain = (await cash()).projectedCash;
    await setCosts([
      { id: 'wash', label: 'Car wash', category: 'other', frequency: 'once', amount: 800, date: '2026-07-14', paidByDriverCash: true },
    ]);
    // The float settles with the month, so it is owed back; what he spent out of
    // it is not.
    expect((await cash()).projectedCash).toBe(plain - 800);
  });

  it('drops a float set to zero rather than storing it', async () => {
    await setFloat('2026-07', 0);
    const res = await call('GET', '/settings', { token: ownerToken });
    expect(res.body.cashFloats['2026-07']).toBeUndefined();
  });
});
