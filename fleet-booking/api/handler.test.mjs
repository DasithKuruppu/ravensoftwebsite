/**
 * Route-level tests. The store runs in memory and the router is stubbed, so
 * these exercise the real handler without DynamoDB, Clerk or the network.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.STORE = 'memory';
process.env.ALLOWED_ORIGINS = 'https://fleet.ravensoft.click,http://localhost:5174';

// Stub the two modules that reach outside the process.
vi.mock('./routing.mjs', () => ({
  autocomplete: vi.fn(async (q) =>
    q && q.length >= 3 ? [{ placeId: 'pid_kandy', label: 'Kandy', full: 'Kandy, Sri Lanka' }] : [],
  ),
  resolvePlace: vi.fn(async (id) =>
    id === 'pid_kandy' ? { label: 'Kandy', full: 'Kandy, Sri Lanka', lat: 7.2906, lon: 80.6337 } : null,
  ),
  routeOptions: vi.fn(async () => [
    { id: 'r0', label: 'Fastest', via: 'E01', distanceKm: 310, drivingHours: 5, geometry: 'poly_fast', source: 'google' },
    {
      id: 'r1',
      label: 'Shortest',
      via: 'A4',
      distanceKm: 200,
      drivingHours: 6.3,
      geometry: 'poly_short',
      source: 'google',
      avoidsHighways: true,
    },
  ]),
}));

const caller = { userId: 'user_a', email: 'a@example.com', name: 'A', phone: '+94770000001', isOwner: false };
let currentCaller = caller;
vi.mock('./auth.mjs', () => ({
  verify: vi.fn(async (token) => (token ? currentCaller : null)),
  ConfigError: class extends Error {},
}));

const { handler, newRef } = await import('./handler.mjs');
const { resetMemoryStore } = await import('./store.mjs');
const { routeOptions, resolvePlace } = await import('./routing.mjs');

const COLOMBO = { label: 'Colombo Fort', lat: 6.9344, lon: 79.8428 };
const KANDY = { label: 'Kandy', lat: 7.2906, lon: 80.6337 };
const START = new Date(Date.now() + 5 * 86_400_000).toISOString();

const tripBody = {
  origin: COLOMBO,
  destination: KANDY,
  startAt: START,
  requestedHours: 10,
  vehicleClass: 'baw-e7-pro',
  passengers: 2,
  contact: { name: 'A', phone: '+94770000001' },
};

function call(method, path, { body, token, query, origin } = {}) {
  return handler({
    version: '2.0',
    rawPath: path,
    queryStringParameters: query || {},
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(origin ? { origin } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method, path } },
  });
}

const parse = (res) => JSON.parse(res.body);

beforeEach(() => {
  resetMemoryStore();
  currentCaller = caller;
  routeOptions.mockResolvedValue([
    { id: 'r0', label: 'Fastest', via: 'E01', distanceKm: 310, drivingHours: 5, geometry: 'poly_fast', source: 'google' },
    {
      id: 'r1',
      label: 'Shortest',
      via: 'A4',
      distanceKm: 200,
      drivingHours: 6.3,
      geometry: 'poly_short',
      source: 'google',
      avoidsHighways: true,
    },
  ]);
});

describe('public routes', () => {
  it('answers /health', async () => {
    expect(parse(await call('GET', '/health'))).toEqual({ ok: true });
  });

  it('publishes the rate card without the internal knobs', async () => {
    const card = parse(await call('GET', '/rates'));
    expect(card.dayRate).toBe(20000);
    expect(card.includedKmPerDay).toBe(150);
    expect(card.vehicleClasses).toHaveLength(1);
    expect(card.vehicleClasses[0]).toMatchObject({ key: 'baw-e7-pro', seats: 3 });
    expect(card.roundTo).toBeUndefined();
    expect(card.bufferHoursPerDay).toBeUndefined();
  });

  it('quotes without a session', async () => {
    const res = await call('POST', '/quote', { body: tripBody });
    expect(res.statusCode).toBe(200);
    const q = parse(res);
    expect(q.quote.total).toBeGreaterThan(0);
    expect(q.route.distanceKm).toBe(310);
    expect(q.expiresAt).toBeTruthy();
  });

  it('rejects a trip it cannot honour, with a reason a form can show', async () => {
    const res = await call('POST', '/quote', { body: { ...tripBody, requestedHours: 3 } });
    expect(res.statusCode).toBe(400);
    expect(parse(res)).toMatchObject({ error: 'too_short' });
  });

  it('flags a quote built on a fallback estimate', async () => {
    routeOptions.mockResolvedValue([
      { id: 'r0', label: 'Estimated route', distanceKm: 300, drivingHours: 6.6, source: 'estimate' },
    ]);
    expect(parse(await call('POST', '/quote', { body: tripBody })).approximate).toBe(true);
  });

  it('returns place suggestions without coordinates', async () => {
    const res = await call('GET', '/places', { query: { q: 'kan', session: 'sess1' } });
    const [first] = parse(res).places;
    expect(first.label).toBe('Kandy');
    expect(first.placeId).toBe('pid_kandy');
    // Coordinates cost a billed lookup each; only the chosen one is resolved.
    expect(first.lat).toBeUndefined();
  });

  it('resolves a chosen suggestion to a point', async () => {
    const res = await call('POST', '/places/resolve', {
      body: { placeId: 'pid_kandy', session: 'sess1' },
    });
    expect(parse(res).place).toMatchObject({ lat: 7.2906, lon: 80.6337 });
  });

  it('refuses a place that could not be located in the service area', async () => {
    const res = await call('POST', '/places/resolve', { body: { placeId: 'pid_london' } });
    expect(res.statusCode).toBe(404);
    expect(parse(res).error).toBe('place_unavailable');
  });

  it('passes the departure time to the router for a traffic-aware duration', async () => {
    await call('POST', '/quote', { body: tripBody });
    // The third argument is the customer's language, which Google answers in.
    expect(routeOptions).toHaveBeenCalledWith(
      expect.any(Array),
      tripBody.startAt,
      undefined,
    );
  });

  it('asks Google for the language the customer is reading', async () => {
    await call('POST', '/quote', { body: { ...tripBody, lang: 'si' } });
    expect(routeOptions).toHaveBeenCalledWith(expect.any(Array), tripBody.startAt, 'si');
  });

  it('carries the route geometry through to the client so the map can draw it', async () => {
    const q = parse(await call('POST', '/quote', { body: tripBody }));
    expect(q.route.geometry).toBe('poly_fast');
  });

  it('prices every route on offer, not only the chosen one', async () => {
    const q = parse(await call('POST', '/quote', { body: tripBody }));
    expect(q.legs).toHaveLength(1);
    expect(q.legs[0].options.map((o) => o.label)).toEqual(['Fastest', 'Shortest']);
    q.legs[0].options.forEach((o) => expect(o.total).toBeGreaterThan(0));
    expect(q.legs[0].options[1].avoidsHighways).toBe(true);
  });

  it('shows the shorter road costing less, which is the whole point of the choice', async () => {
    const q = parse(await call('POST', '/quote', { body: tripBody }));
    const [fast, short] = q.legs[0].options;
    expect(short.distanceKm).toBeLessThan(fast.distanceKm);
    expect(short.total).toBeLessThan(fast.total);
  });

  it('routes and prices the return as a second leg', async () => {
    const q = parse(await call('POST', '/quote', { body: { ...tripBody, returnTo: COLOMBO } }));
    expect(q.legs.map((l) => l.key)).toEqual(['outbound', 'return']);
    expect(q.legs[1].from).toBe('Kandy');
    expect(q.legs[1].to).toBe('Colombo Fort');
    // Both legs' distances are in the priced journey.
    expect(q.route.distanceKm).toBe(620);
    expect(q.route.geometries).toHaveLength(2);
  });

  it('costs more with a return leg than without one', async () => {
    const oneWay = parse(await call('POST', '/quote', { body: tripBody }));
    const both = parse(await call('POST', '/quote', { body: { ...tripBody, returnTo: COLOMBO } }));
    expect(both.quote.total).toBeGreaterThan(oneWay.quote.total);
  });

  it('lets each leg take a different road', async () => {
    const q = parse(
      await call('POST', '/quote', {
        body: { ...tripBody, returnTo: COLOMBO, routeIndex: 0, returnRouteIndex: 1 },
      }),
    );
    expect(q.routeIndex).toBe(0);
    expect(q.returnRouteIndex).toBe(1);
    // Fastest out (310) plus shortest back (200).
    expect(q.route.distanceKm).toBe(510);
  });

  it('quotes the route the customer picked', async () => {
    const q = parse(await call('POST', '/quote', { body: { ...tripBody, routeIndex: 1 } }));
    expect(q.routeIndex).toBe(1);
    expect(q.route.distanceKm).toBe(200);
    expect(q.quote.total).toBe(q.legs[0].options[1].total);
  });

  it('falls back to the first route when the index is stale or absurd', async () => {
    for (const bad of [7, -1, 'x', null]) {
      const q = parse(await call('POST', '/quote', { body: { ...tripBody, routeIndex: bad } }));
      expect(q.routeIndex).toBe(0);
      expect(q.route.distanceKm).toBe(310);
    }
  });

  it('reports no return index at all on a one-way hire', async () => {
    expect(parse(await call('POST', '/quote', { body: tripBody })).returnRouteIndex).toBe(null);
  });

  it('echoes only an allowed origin back', async () => {
    const evil = await call('GET', '/health', { origin: 'https://evil.example' });
    expect(evil.headers['access-control-allow-origin']).toBe('https://fleet.ravensoft.click');
    const ok = await call('GET', '/health', { origin: 'http://localhost:5174' });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5174');
  });
});

describe('daily hire — the simple way to buy', () => {
  const dailyBody = {
    mode: 'daily',
    origin: COLOMBO,
    startAt: START,
    days: 4,
    vehicleClass: 'baw-e7-pro',
    passengers: 2,
    contact: { name: 'A', phone: '+94770000001' },
  };

  it('quotes without a destination, and without calling the router at all', async () => {
    routeOptions.mockClear();
    const q = parse(await call('POST', '/quote', { body: dailyBody }));
    expect(q.quote.total).toBeGreaterThan(0);
    expect(q.trip.mode).toBe('daily');
    // The whole point: no itinerary, so no routing call and nothing to bill.
    expect(routeOptions).not.toHaveBeenCalled();
    expect(q.legs).toEqual([]);
  });

  it('defaults the allowance to the days’ included distance', async () => {
    const q = parse(await call('POST', '/quote', { body: dailyBody }));
    expect(q.trip.allowanceKm).toBe(4 * 150);
    expect(q.quote.basis.excessKm).toBe(0);
  });

  it('charges for a bigger allowance', async () => {
    const plain = parse(await call('POST', '/quote', { body: dailyBody }));
    const far = parse(await call('POST', '/quote', { body: { ...dailyBody, allowanceKm: 1600 } }));
    expect(far.quote.total).toBeGreaterThan(plain.quote.total);
  });

  it('insists on a pickup point and a length', async () => {
    expect(parse(await call('POST', '/quote', { body: { ...dailyBody, origin: null } })).field).toBe('origin');
    expect(parse(await call('POST', '/quote', { body: { ...dailyBody, days: 0 } })).field).toBe('days');
  });

  it('books, and stores it as a daily hire', async () => {
    const res = await call('POST', '/bookings', { body: dailyBody, token: 't' });
    expect(res.statusCode).toBe(201);
    const { booking } = parse(res);
    expect(booking.trip.mode).toBe('daily');
    expect(booking.trip.destination).toBe(null);
    expect(booking.quote.total).toBeGreaterThan(0);
  });

  it('never quotes differently from the routed form for the same days and km', async () => {
    const daily = parse(await call('POST', '/quote', { body: { ...dailyBody, days: 2, allowanceKm: 480 } }));
    routeOptions.mockResolvedValue([
      { id: 'r0', label: 'Only route', distanceKm: 480, drivingHours: 0, geometry: 'g', source: 'google' },
    ]);
    const routed = parse(
      await call('POST', '/quote', {
        body: { ...tripBody, requestedHours: 34, passengers: 2 },
      }),
    );
    expect(daily.quote.total).toBe(routed.quote.total);
  });
});

describe('booking', () => {
  it('refuses an anonymous booking', async () => {
    expect((await call('POST', '/bookings', { body: tripBody })).statusCode).toBe(401);
  });

  it('stores which road the customer chose, and prices that one', async () => {
    const res = await call('POST', '/bookings', { body: { ...tripBody, routeIndex: 1 }, token: 't' });
    const { booking } = parse(res);
    expect(booking.routeIndex).toBe(1);
    expect(booking.route.distanceKm).toBe(200);
  });

  it('stores both legs and both road choices on a return hire', async () => {
    const res = await call('POST', '/bookings', {
      body: { ...tripBody, returnTo: COLOMBO, routeIndex: 1, returnRouteIndex: 0 },
      token: 't',
    });
    const { booking } = parse(res);
    expect(booking.trip.returnTo.label).toBe('Colombo Fort');
    expect(booking.legs).toHaveLength(2);
    expect([booking.routeIndex, booking.returnRouteIndex]).toEqual([1, 0]);
    expect(booking.route.distanceKm).toBe(510);
  });

  it('creates a pending booking with a readable reference', async () => {
    const res = await call('POST', '/bookings', { body: tripBody, token: 't' });
    expect(res.statusCode).toBe(201);
    const { booking } = parse(res);
    expect(booking.status).toBe('pending');
    expect(booking.ref).toMatch(/^RF-[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    expect(booking.quote.total).toBeGreaterThan(0);
  });

  it('prices from the rate card, not from what the client posted', async () => {
    const res = await call('POST', '/bookings', {
      body: { ...tripBody, quote: { total: 1 }, total: 1 },
      token: 't',
    });
    expect(parse(res).booking.quote.total).toBeGreaterThan(1000);
  });

  it('takes the email from the session, not from the body', async () => {
    const res = await call('POST', '/bookings', {
      body: { ...tripBody, contact: { phone: '+94770000001', email: 'attacker@example.com' } },
      token: 't',
    });
    expect(parse(res).booking.contact.email).toBe('a@example.com');
  });

  it('insists on a phone number', async () => {
    currentCaller = { ...caller, phone: '' };
    const res = await call('POST', '/bookings', {
      body: { ...tripBody, contact: { name: 'A' } },
      token: 't',
    });
    expect(res.statusCode).toBe(400);
    expect(parse(res).error).toBe('phone_required');
  });

  it('lists only the caller’s own bookings', async () => {
    await call('POST', '/bookings', { body: tripBody, token: 't' });
    currentCaller = { ...caller, userId: 'user_b', email: 'b@example.com' };
    await call('POST', '/bookings', { body: tripBody, token: 't' });

    const mine = parse(await call('GET', '/bookings', { token: 't' })).bookings;
    expect(mine).toHaveLength(1);
    expect(mine[0].userId).toBe('user_b');
  });

  it('hides another customer’s booking behind a 404, not a 403', async () => {
    const { booking } = parse(await call('POST', '/bookings', { body: tripBody, token: 't' }));
    currentCaller = { ...caller, userId: 'user_b' };
    const res = await call('GET', `/bookings/${booking.ref}`, { token: 't' });
    expect(res.statusCode).toBe(404);
  });

  it('lets the customer cancel a pending booking once', async () => {
    const { booking } = parse(await call('POST', '/bookings', { body: tripBody, token: 't' }));
    const first = await call('POST', `/bookings/${booking.ref}/cancel`, { body: { reason: 'plans changed' }, token: 't' });
    expect(parse(first).booking.status).toBe('cancelled');
    const second = await call('POST', `/bookings/${booking.ref}/cancel`, { token: 't' });
    expect(second.statusCode).toBe(409);
  });
});

describe('admin', () => {
  const owner = { userId: 'user_owner', email: 'owner@example.com', name: 'Owner', phone: '', isOwner: true };

  it('refuses a customer', async () => {
    expect((await call('GET', '/admin/bookings', { token: 't' })).statusCode).toBe(403);
  });

  it('lists every booking and filters by status', async () => {
    await call('POST', '/bookings', { body: tripBody, token: 't' });
    currentCaller = { ...caller, userId: 'user_b' };
    const { booking } = parse(await call('POST', '/bookings', { body: tripBody, token: 't' }));

    currentCaller = owner;
    expect(parse(await call('GET', '/admin/bookings', { token: 't' })).bookings).toHaveLength(2);

    await call('PUT', `/admin/bookings/${booking.ref}`, { body: { status: 'confirmed' }, token: 't' });
    const pending = parse(await call('GET', '/admin/bookings', { token: 't', query: { status: 'pending' } }));
    expect(pending.bookings).toHaveLength(1);
  });

  it('confirms a booking with a driver and a note', async () => {
    const { booking } = parse(await call('POST', '/bookings', { body: tripBody, token: 't' }));
    currentCaller = owner;
    const res = await call('PUT', `/admin/bookings/${booking.ref}`, {
      body: { status: 'confirmed', driverName: 'Sunil', vehicle: 'CBA-1234', ownerNote: 'Pickup 05:30' },
      token: 't',
    });
    expect(parse(res).booking).toMatchObject({ status: 'confirmed', driverName: 'Sunil', vehicle: 'CBA-1234' });
  });

  it('keeps an agreed price beside the quote rather than overwriting it', async () => {
    const { booking } = parse(await call('POST', '/bookings', { body: tripBody, token: 't' }));
    const quoted = booking.quote.total;
    currentCaller = owner;
    const res = await call('PUT', `/admin/bookings/${booking.ref}`, { body: { agreedTotal: 12000 }, token: 't' });
    expect(parse(res).booking.agreedTotal).toBe(12000);
    expect(parse(res).booking.quote.total).toBe(quoted);
  });

  it('refuses a status no owner action produces', async () => {
    const { booking } = parse(await call('POST', '/bookings', { body: tripBody, token: 't' }));
    currentCaller = owner;
    const res = await call('PUT', `/admin/bookings/${booking.ref}`, { body: { status: 'paid' }, token: 't' });
    expect(res.statusCode).toBe(400);
  });

  it('edits the rate card, and the next quote follows it', async () => {
    const before = parse(await call('POST', '/quote', { body: tripBody })).quote.total;
    currentCaller = owner;
    await call('PUT', '/admin/rates', { body: { rates: { dayRate: 25000 } }, token: 't' });
    const after = parse(await call('POST', '/quote', { body: tripBody })).quote.total;
    expect(after).toBeGreaterThan(before);
  });

  it('ignores junk in a rate card rather than quoting NaN afterwards', async () => {
    currentCaller = owner;
    await call('PUT', '/admin/rates', { body: { rates: { dayRate: '', perKmOver: 'free', hoursPerDay: 0 } }, token: 't' });
    const q = parse(await call('POST', '/quote', { body: tripBody }));
    expect(Number.isFinite(q.quote.total)).toBe(true);
    expect(q.quote.total).toBeGreaterThan(0);
  });

  it('freezes the price a customer was quoted against a later rate change', async () => {
    const { booking } = parse(await call('POST', '/bookings', { body: tripBody, token: 't' }));
    const agreed = booking.quote.total;
    currentCaller = owner;
    await call('PUT', '/admin/rates', { body: { rates: { dayRate: 99000 } }, token: 't' });
    const stored = parse(await call('GET', `/bookings/${booking.ref}`, { token: 't' })).booking;
    expect(stored.quote.total).toBe(agreed);
  });
});

describe('newRef', () => {
  it('avoids the characters that get misheard on a phone', () => {
    const refs = Array.from({ length: 200 }, () => newRef());
    expect(refs.every((r) => !/[IO01]/.test(r.slice(3)))).toBe(true);
  });

  it('is stable in shape', () => {
    expect(newRef(() => 0)).toBe('RF-AAA-AAA');
  });
});

describe('unknown routes', () => {
  it('404s with the method and path', async () => {
    const res = await call('GET', '/nope', { token: 't' });
    expect(res.statusCode).toBe(404);
    expect(parse(res).message).toContain('GET /nope');
  });

  // The auth gate sits above the fall-through, so an anonymous request to an
  // unknown path is refused before it is looked up. That ordering is deliberate:
  // it keeps the 404 from mapping out which paths exist for an unauthenticated
  // caller. Asserted so a later reshuffle of the routes has to be intentional.
  it('refuses an anonymous unknown path before deciding it does not exist', async () => {
    expect((await call('GET', '/nope')).statusCode).toBe(401);
  });
});
