import { describe, it, expect } from 'vitest';
import { normaliseTrip, dwellHours, waypoints, legsOf, inServiceArea } from './trip.mjs';
import { DEFAULT_RATES } from './pricing.mjs';

const NOW = new Date('2026-09-01T00:00:00Z');
const COLOMBO = { label: 'Colombo Fort', lat: 6.9344, lon: 79.8428 };
const KANDY = { label: 'Kandy', lat: 7.2906, lon: 80.6337 };

const good = {
  origin: COLOMBO,
  destination: KANDY,
  startAt: '2026-09-03T02:00:00Z',
  requestedHours: 10,
  vehicleClass: 'baw-e7-pro',
  passengers: 2,
};

const run = (over) => normaliseTrip({ ...good, ...over }, DEFAULT_RATES, NOW);

describe('inServiceArea', () => {
  it('accepts a Sri Lankan point and rejects one abroad', () => {
    expect(inServiceArea(COLOMBO)).toBe(true);
    expect(inServiceArea({ lat: 51.5, lon: -0.12 })).toBe(false);
  });

  it('rejects a place with no coordinates at all', () => {
    expect(inServiceArea({ label: 'somewhere' })).toBe(false);
  });
});

describe('normaliseTrip', () => {
  it('accepts a well-formed trip and rounds the ask to a quarter hour', () => {
    const { trip, error } = run({ requestedHours: 10.3 });
    expect(error).toBeUndefined();
    expect(trip.requestedHours).toBe(10.25);
    expect(trip.startAt).toBe('2026-09-03T02:00:00.000Z');
  });

  it('refuses a trip with no notice', () => {
    expect(run({ startAt: '2026-09-01T01:00:00Z' }).error).toBe('too_soon');
  });

  it('refuses a hire shorter than the minimum', () => {
    expect(run({ requestedHours: 4 }).error).toBe('too_short');
  });

  it('refuses a point outside Sri Lanka, naming it', () => {
    const r = run({ destination: { label: 'Chennai', lat: 13.08, lon: 80.27 } });
    expect(r.error).toBe('outside_service_area');
    expect(r.message).toContain('Chennai');
  });

  it('refuses more passengers than the chosen vehicle seats', () => {
    expect(run({ passengers: 6 }).error).toBe('too_many_passengers');
    expect(run({ passengers: 3 }).error).toBeUndefined();
  });

  it('caps the number of stops', () => {
    const stops = Array.from({ length: 9 }, () => KANDY);
    expect(run({ stops }).error).toBe('too_many_stops');
  });

  it('drops malformed stops rather than pricing a trip through NaN', () => {
    const { trip } = run({ stops: [KANDY, { label: 'nowhere' }, null] });
    expect(trip.stops).toHaveLength(1);
  });

  it('clamps a stop’s wait to a quarter hour and a day', () => {
    const { trip } = run({ stops: [{ ...KANDY, waitHours: 1.1 }] });
    expect(trip.stops[0].waitHours).toBe(1);
    const { trip: long } = run({ stops: [{ ...KANDY, waitHours: 99 }] });
    expect(long.stops[0].waitHours).toBe(24);
  });

  it('falls back to the first vehicle class when given an unknown one', () => {
    expect(run({ vehicleClass: 'helicopter' }).trip.vehicleClass).toBe('baw-e7-pro');
  });

  it('never throws on junk input', () => {
    expect(() => normaliseTrip(null, DEFAULT_RATES, NOW)).not.toThrow();
    expect(normaliseTrip({}, DEFAULT_RATES, NOW).error).toBe('origin_required');
  });
});

describe('dwellHours / waypoints', () => {
  it('adds up the waits at stops', () => {
    expect(dwellHours([{ waitHours: 1 }, { waitHours: 0.5 }, {}])).toBe(1.5);
  });

  it('orders waypoints origin, stops, destination', () => {
    const { trip } = run({ stops: [KANDY] });
    expect(waypoints(trip).map((p) => p.label)).toEqual(['Colombo Fort', 'Kandy', 'Kandy']);
  });
});

describe('where the car finishes', () => {
  it('is one-way when no finish is given', () => {
    const { trip } = run({});
    expect(trip.returnTo).toBe(null);
    expect(legsOf(trip)).toHaveLength(1);
    expect(waypoints(trip)).toHaveLength(2);
  });

  it('routes the return as its own leg, not a doubling of the first', () => {
    const { trip } = run({ returnTo: COLOMBO });
    const legs = legsOf(trip);
    expect(legs.map((l) => l.key)).toEqual(['outbound', 'return']);
    expect(legs[1].points.map((p) => p.label)).toEqual(['Kandy', 'Colombo Fort']);
  });

  it('lets the car finish somewhere that is neither end of the trip', () => {
    const airport = { label: 'Bandaranaike Airport', lat: 7.1808, lon: 79.8841 };
    const { trip } = run({ returnTo: airport });
    expect(trip.returnTo.label).toBe('Bandaranaike Airport');
    expect(legsOf(trip)[1].points.map((p) => p.label)).toEqual(['Kandy', 'Bandaranaike Airport']);
    expect(waypoints(trip)).toHaveLength(3);
  });

  it('keeps the stops on the outbound leg only', () => {
    const { trip } = run({ returnTo: COLOMBO, stops: [KANDY] });
    const [out, back] = legsOf(trip);
    expect(out.points).toHaveLength(3);
    expect(back.points).toHaveLength(2);
  });

  it('refuses a finish outside Sri Lanka, and says which field', () => {
    const r = run({ returnTo: { label: 'Chennai', lat: 13.08, lon: 80.27 } });
    expect(r.error).toBe('outside_service_area');
    expect(r.field).toBe('returnTo');
  });

  it('treats a malformed finish as one-way rather than failing the quote', () => {
    expect(run({ returnTo: { label: 'nowhere' } }).trip.returnTo).toBe(null);
  });
});
