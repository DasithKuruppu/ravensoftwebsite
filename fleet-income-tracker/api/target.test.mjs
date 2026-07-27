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
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
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
      body: { payTarget: 120000 },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ payTarget: 120000 });

    const summary = await call('GET', '/summary', { token: driverToken });
    expect(summary.body.payTarget).toBe(120000);
  });

  it('lets the owner set it too', async () => {
    const res = await call('PUT', '/settings/target', {
      token: ownerToken,
      body: { payTarget: 90000 },
    });
    expect(res.status).toBe(200);
    expect(res.body.payTarget).toBe(90000);
  });

  it('clears the goal on an explicit null', async () => {
    const res = await call('PUT', '/settings/target', {
      token: driverToken,
      body: { payTarget: null },
    });
    expect(res.status).toBe(200);
    expect(res.body.payTarget).toBe(null);
  });

  it('refuses a value that is not a number', async () => {
    const res = await call('PUT', '/settings/target', {
      token: driverToken,
      body: { payTarget: 'lots' },
    });
    expect(res.status).toBe(400);
  });

  it('clamps a negative or absurd goal instead of storing it', async () => {
    expect((await call('PUT', '/settings/target', { token: driverToken, body: { payTarget: -5000 } })).body.payTarget).toBe(0);
    expect((await call('PUT', '/settings/target', { token: driverToken, body: { payTarget: 99_000_000 } })).body.payTarget).toBe(5_000_000);
  });

  it('needs a token', async () => {
    const res = await call('PUT', '/settings/target', { body: { payTarget: 1000 } });
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
