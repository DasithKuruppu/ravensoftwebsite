/**
 * What a trip request must look like before it can be priced.
 *
 * The browser validates too, but this is the copy that counts: a quote is a
 * number this fleet is willing to honour, so the inputs it rests on are checked
 * where they cannot be edited. Every function here is pure and runs identically
 * in the form and in the Lambda.
 */
import { withDefaults } from './pricing.mjs';

/** Sri Lanka, generously bounded. Keeps a mis-geocoded pin out of a quote. */
export const SERVICE_AREA = { minLat: 5.6, maxLat: 10.1, minLon: 79.4, maxLon: 82.1 };

export const MAX_STOPS = 8;
/** A hire cannot be requested for less notice than this. */
export const MIN_NOTICE_HOURS = 6;
/** Nor further out than this — rates would be guesswork. */
export const MAX_AHEAD_DAYS = 365;
/**
 * The longest single hire the form will price — a month, the largest entry in
 * DURATION_CHOICES, plus room for the route stretching it.
 */
export const MAX_HOURS = 24 * 32;
/** The longest daily hire the form will price, matching DURATION_CHOICES. */
export const MAX_DAYS = 30;
/**
 * The largest distance allowance quotable in advance. A month at 200 km a day
 * is 6,000; past roughly twice that the car needs servicing mid-hire and the
 * arithmetic stops describing anything real.
 */
export const MAX_ALLOWANCE_KM = 12000;

export function inServiceArea(place) {
  if (!place || typeof place.lat !== 'number' || typeof place.lon !== 'number') return false;
  return (
    place.lat >= SERVICE_AREA.minLat &&
    place.lat <= SERVICE_AREA.maxLat &&
    place.lon >= SERVICE_AREA.minLon &&
    place.lon <= SERVICE_AREA.maxLon
  );
}

function cleanPlace(p) {
  if (!p || typeof p !== 'object') return null;
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const place = {
    label: String(p.label || '').slice(0, 200).trim(),
    lat: Math.round(lat * 1e6) / 1e6,
    lon: Math.round(lon * 1e6) / 1e6,
  };
  // A stop can carry a wait: an hour at a temple is an hour of the hire, and
  // pretending otherwise would quote a day that cannot fit the itinerary.
  const wait = Number(p.waitHours);
  if (Number.isFinite(wait) && wait > 0) place.waitHours = Math.min(24, Math.round(wait * 4) / 4);
  return place;
}

/**
 * Normalise and validate. Returns `{ trip }` or `{ error, message, field }` —
 * never throws, because every caller wants to turn the failure into a 400 or a
 * hint under a field rather than a stack trace.
 *
 * `field` names which input is at fault (`origin`, `destination`, `stops.2`,
 * `startAt`, …). Without it the form has one place to put every message, and a
 * complaint about the pickup point appears under whichever field the customer
 * happened to touch last — which reads as the form rejecting a perfectly good
 * answer.
 */
export function normaliseTrip(input, rates, now = new Date()) {
  const r = withDefaults(rates);
  const body = input || {};

  const origin = cleanPlace(body.origin);
  const destination = cleanPlace(body.destination);
  if (!origin) return fail('origin_required', 'Choose where the trip starts.', 'origin');
  if (!destination) return fail('destination_required', 'Choose where the trip ends.', 'destination');

  // Keep each stop's position in the array the customer sees, so a message
  // about the third stop can be attached to the third row rather than to the
  // third *valid* one.
  // Absent means one-way. The form sends the pickup point by default, so an
  // omitted value here is a deliberate "not returning" rather than an oversight.
  const returnTo = cleanPlace(body.returnTo);

  const kept = [];
  (Array.isArray(body.stops) ? body.stops : []).forEach((raw, at) => {
    const place = cleanPlace(raw);
    if (place) kept.push({ place, at });
  });
  if (kept.length > MAX_STOPS) {
    return fail('too_many_stops', `A trip can have at most ${MAX_STOPS} stops.`, 'stops', { n: MAX_STOPS });
  }

  const labelled = [
    { place: origin, field: 'origin' },
    ...kept.map((s) => ({ place: s.place, field: `stops.${s.at}` })),
    { place: destination, field: 'destination' },
    ...(returnTo ? [{ place: returnTo, field: 'returnTo' }] : []),
  ];
  for (const { place, field } of labelled) {
    if (!inServiceArea(place)) {
      return fail(
        'outside_service_area',
        `${place.label || 'That place'} is outside Sri Lanka.`,
        field,
        { place: place.label || 'That place' },
      );
    }
  }

  const startAt = new Date(body.startAt);
  if (Number.isNaN(startAt.getTime())) {
    return fail('start_required', 'Choose when the trip starts.', 'startAt');
  }

  const noticeHours = (startAt.getTime() - now.getTime()) / 3600_000;
  if (noticeHours < MIN_NOTICE_HOURS) {
    return fail(
      'too_soon',
      `Bookings need at least ${MIN_NOTICE_HOURS} hours' notice. Pick a later start.`,
      'startAt',
      { n: MIN_NOTICE_HOURS },
    );
  }
  if (noticeHours > MAX_AHEAD_DAYS * 24) {
    return fail('too_far_ahead', `Bookings open ${MAX_AHEAD_DAYS} days ahead.`, 'startAt');
  }

  const requestedHours = Number(body.requestedHours);
  if (!Number.isFinite(requestedHours) || requestedHours <= 0) {
    return fail('hours_required', 'Say how long you need the car for.', 'requestedHours');
  }
  if (requestedHours < r.hoursPerDay) {
    return fail('too_short', `The shortest hire is ${r.hoursPerDay} hours.`, 'requestedHours', {
      n: r.hoursPerDay,
    });
  }
  if (requestedHours > MAX_HOURS) {
    return fail(
      'too_long',
      `The longest hire the form can price is ${MAX_HOURS / 24} days.`,
      'requestedHours',
    );
  }

  const vc = r.vehicleClasses.find((v) => v.key === body.vehicleClass);
  const passengers = Number(body.passengers) || 1;
  const chosen = vc || r.vehicleClasses[0];
  if (passengers > chosen.seats) {
    const name = chosen.label.split('·')[0].trim();
    // "Pick a larger vehicle" is only advice when there is one. With a
    // single-vehicle fleet it sends the customer looking for a control that
    // does not exist; tell them to get in touch instead.
    const biggest = Math.max(...r.vehicleClasses.map((v) => v.seats));
    return fail(
      'too_many_passengers',
      biggest > chosen.seats
        ? `The ${name} seats ${chosen.seats}. Pick a larger vehicle.`
        : `We can carry ${chosen.seats} passengers at the moment. Get in touch if you need more.`,
      'passengers',
    );
  }

  return {
    trip: {
      origin,
      destination,
      stops: kept.map((s) => s.place),
      startAt: startAt.toISOString(),
      requestedHours: Math.round(requestedHours * 4) / 4,
      vehicleClass: chosen.key,
      // Where the car finishes. Usually the pickup point, sometimes an airport,
      // sometimes nowhere — a one-way hire leaves it at the destination. Held as
      // a place rather than a boolean so all three cases are the same field.
      returnTo,
      // The customer has offered to feed and house the driver overnight, which
      // reduces what each night away costs them.
      driverHosted: Boolean(body.driverHosted),
      passengers: Math.max(1, Math.round(passengers)),
      notes: String(body.notes || '').slice(0, 1000).trim(),
    },
  };
}

/**
 * The other way to buy: N days with a kilometre allowance and no itinerary.
 *
 * Far less to validate than a routed trip, because there is far less being
 * promised — a pickup point, a date, a length and an allowance. No destination,
 * no stops, no return leg, and nothing to route.
 */
export function normaliseDailyTrip(input, rates, now = new Date()) {
  const r = withDefaults(rates);
  const body = input || {};

  const origin = cleanPlace(body.origin);
  if (!origin) return fail('origin_required', 'Choose where we should pick you up.', 'origin');
  if (!inServiceArea(origin)) {
    return fail(
      'outside_service_area',
      `${origin.label || 'That place'} is outside Sri Lanka.`,
      'origin',
    );
  }

  const startAt = new Date(body.startAt);
  if (Number.isNaN(startAt.getTime())) {
    return fail('start_required', 'Choose when the hire starts.', 'startAt');
  }
  const noticeHours = (startAt.getTime() - now.getTime()) / 3600_000;
  if (noticeHours < MIN_NOTICE_HOURS) {
    return fail(
      'too_soon',
      `Bookings need at least ${MIN_NOTICE_HOURS} hours' notice. Pick a later start.`,
      'startAt',
      { n: MIN_NOTICE_HOURS },
    );
  }
  if (noticeHours > MAX_AHEAD_DAYS * 24) {
    return fail('too_far_ahead', `Bookings open ${MAX_AHEAD_DAYS} days ahead.`, 'startAt');
  }

  const days = Math.round(Number(body.days) || 0);
  if (!(days >= 1)) return fail('days_required', 'Say how many days you need the car.', 'days');
  if (days > MAX_DAYS) {
    return fail('too_long', `The longest hire the form can price is ${MAX_DAYS} days.`, 'days');
  }

  const included = days * r.includedKmPerDay;
  const allowanceKm = Math.max(included, Math.round(Number(body.allowanceKm) || 0));
  if (allowanceKm > MAX_ALLOWANCE_KM) {
    return fail(
      'allowance_too_large',
      `The most we can quote in advance is ${MAX_ALLOWANCE_KM} km. Get in touch for more.`,
      'allowanceKm',
    );
  }

  const vc = r.vehicleClasses.find((v) => v.key === body.vehicleClass);
  const chosen = vc || r.vehicleClasses[0];
  const passengers = Number(body.passengers) || 1;
  if (passengers > chosen.seats) {
    const biggest = Math.max(...r.vehicleClasses.map((v) => v.seats));
    return fail(
      'too_many_passengers',
      biggest > chosen.seats
        ? `The ${chosen.label.split('·')[0].trim()} seats ${chosen.seats}. Pick a larger vehicle.`
        : `We can carry ${chosen.seats} passengers at the moment. Get in touch if you need more.`,
      'passengers',
    );
  }

  return {
    trip: {
      mode: 'daily',
      origin,
      // No destination, stops or return leg — that is the point of this mode.
      stops: [],
      destination: null,
      returnTo: null,
      startAt: startAt.toISOString(),
      days,
      allowanceKm,
      includedKm: included,
      vehicleClass: chosen.key,
      driverHosted: Boolean(body.driverHosted),
      passengers: Math.max(1, Math.round(passengers)),
      notes: String(body.notes || '').slice(0, 1000).trim(),
    },
  };
}

/** Hours the itinerary spends parked at its stops. */
export function dwellHours(stops) {
  return (stops || []).reduce((sum, s) => sum + (Number(s.waitHours) || 0), 0);
}

/**
 * The journey split into legs, because each is routed and chosen separately.
 *
 * The way out can go over the expressway while the way back takes the coast —
 * and on this island that is not a preference, it is a different price. Sri
 * Lankan roads are not symmetrical either: one-way systems, a different
 * expressway entrance, and a bypass taken outbound but not inbound all make the
 * return leg its own number rather than a doubling of the first.
 *
 * A return to the pickup point, a finish somewhere else, and a one-way hire are
 * all the same shape here — the second leg simply exists or does not.
 */
export function legsOf(trip) {
  const legs = [
    {
      key: 'outbound',
      label: 'Outbound',
      from: trip.origin,
      to: trip.destination,
      points: [trip.origin, ...(trip.stops || []), trip.destination],
    },
  ];
  if (trip.returnTo) {
    legs.push({
      key: 'return',
      label: 'Return',
      from: trip.destination,
      to: trip.returnTo,
      points: [trip.destination, trip.returnTo],
    });
  }
  return legs;
}

/** Every point the car visits, in order. */
export function waypoints(trip) {
  const out = [trip.origin, ...(trip.stops || []), trip.destination];
  if (trip.returnTo) out.push(trip.returnTo);
  return out;
}

function fail(error, message, field, vars) {
  // `message` is the English fallback; `error` + `vars` are what a translated
  // client renders from. Both travel, so an old client keeps working.
  return { error, message, field, vars };
}
