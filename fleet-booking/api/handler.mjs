/**
 * The whole booking API — one Lambda, all routes, behind an API Gateway HTTP API.
 *
 * Routes
 *   GET    /health                     → { ok }
 *   GET    /rates                      → the customer-facing rate card   (public)
 *   GET    /places?q=&session=         → place suggestions               (public)
 *   POST   /places/resolve             → a chosen suggestion → coordinates (public)
 *   POST   /quote                      → price a trip                    (public)
 *   POST   /bookings                   → request a ride                  (signed in)
 *   GET    /bookings                   → my bookings                     (signed in)
 *   GET    /bookings/{ref}             → one booking                     (mine, or owner)
 *   POST   /bookings/{ref}/cancel      → withdraw a request              (mine)
 *   GET    /admin/bookings             → every booking                   (owner)
 *   PUT    /admin/bookings/{ref}       → confirm / decline / reprice      (owner)
 *   GET    /admin/rates                → the full rate card              (owner)
 *   PUT    /admin/rates                → edit it                         (owner)
 *
 * Quoting is deliberately public: a stranger should see a price before being
 * asked to sign in. Booking is not, because a booking has to belong to someone
 * we can call back.
 *
 * The price on a booking is always recomputed here from the stored rate card.
 * The quote the browser is holding is a display artefact; a client that posts a
 * total of 1 gets charged the real one.
 */
import {
  DEFAULT_RATES,
  withDefaults,
  quote as priceTrip,
  suggestedChoice,
  daysForHours,
  dailyBasis,
} from '../shared/pricing.mjs';
import {
  normaliseTrip,
  normaliseDailyTrip,
  dwellHours,
  legsOf,
  MAX_STOPS,
  MIN_NOTICE_HOURS,
  MAX_DAYS,
} from '../shared/trip.mjs';
import { bookings, rates as rateStore } from './store.mjs';
import { autocomplete, resolvePlace, routeOptions } from './routing.mjs';
import { verify } from './auth.mjs';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'https://fleet.ravensoft.click,http://localhost:5174')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Statuses a booking can hold, and who may move it there. */
export const STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
};
const OWNER_STATUSES = [STATUS.CONFIRMED, STATUS.DECLINED, STATUS.COMPLETED, STATUS.PENDING];

export async function handler(event) {
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
  const rawPath = event.rawPath || event.path || '/';
  const path = rawPath.replace(/\/+$/, '') || '/';
  const cors = corsHeaders(headerOf(event, 'origin'));

  if (method === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  try {
    return await route(method, path, event, cors);
  } catch (err) {
    console.error('unhandled error', err);
    if (err.isConfigError) {
      return json(500, { error: 'not_configured', message: err.message }, cors);
    }
    return json(500, { error: 'internal_error', message: err.message || 'unknown' }, cors);
  }
}

async function route(method, path, event, cors) {
  const query = event.queryStringParameters || {};
  const body = parseBody(event);

  /* ─────────────────────────────── public ─────────────────────────────── */

  if (method === 'GET' && path === '/health') {
    return json(200, { ok: true }, cors);
  }

  if (method === 'GET' && path === '/rates') {
    // The public card, without the internal knobs. A customer needs to know the
    // day rate and what it includes; the traffic factor and the rounding step
    // are ours.
    const r = await currentRates();
    return json(
      200,
      {
        currency: r.currency,
        hoursPerDay: r.hoursPerDay,
        dayRate: r.dayRate,
        includedKmPerDay: r.includedKmPerDay,
        perKmOver: r.perKmOver,
        overtimePerHour: r.overtimePerHour,
        overnightStay: r.overnightStay,
        overnightStayHosted: r.overnightStayHosted,
        stopFee: r.stopFee,
        vehicleClasses: r.vehicleClasses,
        quoteValidMinutes: r.quoteValidMinutes,
        maxStops: MAX_STOPS,
        minNoticeHours: MIN_NOTICE_HOURS,
        maxDays: MAX_DAYS,
      },
      cors,
    );
  }

  // Suggestions carry a placeId and no coordinates — see api/routing.mjs for
  // why resolving all six would cost six times what resolving the chosen one
  // does. `session` groups a customer's keystrokes into one billed lookup.
  if (method === 'GET' && path === '/places') {
    const results = await autocomplete(query.q, query.session, query.lang);
    return json(200, { places: results }, cors);
  }

  if (method === 'POST' && path === '/places/resolve') {
    const place = await resolvePlace(body.placeId, body.session, body.lang);
    if (!place) {
      return json(
        404,
        {
          error: 'place_unavailable',
          message: 'That place could not be located in Sri Lanka. Try a nearby town.',
        },
        cors,
      );
    }
    return json(200, { place }, cors);
  }

  if (method === 'POST' && path === '/quote') {
    const result = await buildQuote(body);
    if (result.error) return json(400, result, cors);
    return json(200, result, cors);
  }

  /* ─────────────────── everything below needs a session ─────────────────── */

  const caller = await verify(bearer(event));
  if (!caller) return json(401, { error: 'unauthorized', message: 'Sign in to continue.' }, cors);

  if (method === 'POST' && path === '/bookings') {
    const result = await buildQuote(body);
    if (result.error) return json(400, result, cors);

    const contact = cleanContact(body.contact, caller);
    if (!contact.phone) {
      return json(400, { error: 'phone_required', message: 'A phone number so the driver can reach you.' }, cors);
    }

    const now = new Date();
    const booking = {
      ref: newRef(),
      userId: caller.userId,
      status: STATUS.PENDING,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      startAt: result.trip.startAt,
      trip: result.trip,
      route: result.route,
      // Which of the offered roads the customer picked, per leg. Stored so the
      // driver is sent the routes that were priced, not whichever ones Google
      // prefers on the morning of the trip.
      routeIndex: result.routeIndex,
      returnRouteIndex: result.returnRouteIndex,
      legs: result.legs,
      // The price and the card that produced it, frozen together. Editing the
      // rate card must never silently restate what an existing customer owes.
      quote: result.quote,
      rateCard: result.rateCardVersion,
      contact,
    };

    await bookings.put(booking);
    console.log('booking requested', booking.ref, booking.startAt, booking.quote.total);
    return json(201, { booking }, cors);
  }

  if (method === 'GET' && path === '/bookings') {
    const mine = await bookings.forUser(caller.userId);
    return json(200, { bookings: mine }, cors);
  }

  const refMatch = path.match(/^\/bookings\/([A-Z0-9-]+)(\/cancel)?$/i);
  if (refMatch) {
    const ref = refMatch[1].toUpperCase();
    const booking = await bookings.get(ref);
    // Same answer for "does not exist" and "is not yours": a 403 here would
    // confirm that a guessed reference is real.
    if (!booking || (booking.userId !== caller.userId && !caller.isOwner)) {
      return json(404, { error: 'not_found', message: 'No booking with that reference.' }, cors);
    }

    if (method === 'GET' && !refMatch[2]) return json(200, { booking }, cors);

    if (method === 'POST' && refMatch[2]) {
      if (booking.status !== STATUS.PENDING && booking.status !== STATUS.CONFIRMED) {
        return json(409, { error: 'not_cancellable', message: `This booking is already ${booking.status}.` }, cors);
      }
      const updated = {
        ...booking,
        status: STATUS.CANCELLED,
        cancelledBy: caller.isOwner && booking.userId !== caller.userId ? 'owner' : 'customer',
        cancelReason: String(body.reason || '').slice(0, 500),
        updatedAt: new Date().toISOString(),
      };
      await bookings.put(updated);
      return json(200, { booking: updated }, cors);
    }

    return json(405, { error: 'method_not_allowed' }, cors);
  }

  /* ─────────────────────────────── owner ─────────────────────────────── */

  if (path.startsWith('/admin')) {
    if (!caller.isOwner) return json(403, { error: 'forbidden', message: 'Owner only.' }, cors);

    if (method === 'GET' && path === '/admin/bookings') {
      let all = await bookings.all();
      if (query.status) all = all.filter((b) => b.status === query.status);
      return json(200, { bookings: all }, cors);
    }

    const adminRef = path.match(/^\/admin\/bookings\/([A-Z0-9-]+)$/i);
    if (adminRef && method === 'PUT') {
      const booking = await bookings.get(adminRef[1].toUpperCase());
      if (!booking) return json(404, { error: 'not_found' }, cors);

      const next = { ...booking, updatedAt: new Date().toISOString() };

      if (body.status !== undefined) {
        if (!OWNER_STATUSES.includes(body.status)) {
          return json(400, { error: 'bad_status', message: `Cannot set status to "${body.status}".` }, cors);
        }
        next.status = body.status;
      }
      if (body.ownerNote !== undefined) next.ownerNote = String(body.ownerNote).slice(0, 1000);
      if (body.driverName !== undefined) next.driverName = String(body.driverName).slice(0, 120);
      if (body.vehicle !== undefined) next.vehicle = String(body.vehicle).slice(0, 120);

      // An agreed price that differs from the quote — a discount for a repeat
      // customer, say. Kept beside the quote rather than overwriting it, so the
      // difference stays visible.
      if (body.agreedTotal !== undefined && body.agreedTotal !== null && body.agreedTotal !== '') {
        const agreed = Number(body.agreedTotal);
        if (!Number.isFinite(agreed) || agreed < 0) {
          return json(400, { error: 'bad_total', message: 'The agreed total must be a number.' }, cors);
        }
        next.agreedTotal = Math.round(agreed);
      }

      await bookings.put(next);
      return json(200, { booking: next }, cors);
    }

    if (method === 'GET' && path === '/admin/rates') {
      return json(200, { rates: await currentRates() }, cors);
    }

    if (method === 'PUT' && path === '/admin/rates') {
      const saved = await rateStore.put(sanitiseRates(body.rates, await currentRates()));
      return json(200, { rates: withDefaults(saved) }, cors);
    }
  }

  return json(404, { error: 'not_found', message: `No route for ${method} ${path}` }, cors);
}

/* ────────────────────────────── quoting ────────────────────────────── */

/**
 * Validate, route, price. Shared by `/quote` and `/bookings` so the number the
 * customer saw and the number stored on the booking come from one code path.
 */
export async function buildQuote(body, now = new Date()) {
  const rates = await currentRates();

  // The simple way to buy: days and a kilometre allowance, no itinerary. It
  // reaches the same priceTrip() as a routed journey, so the two can never
  // disagree about what four days and 800 km cost — but it makes no network
  // call at all, which is why it answers instantly and costs nothing to quote.
  if (body?.mode === 'daily') {
    const daily = normaliseDailyTrip(body, rates, now);
    if (daily.error) return daily;
    const q = priceTrip(dailyBasis(daily.trip, rates), rates);
    return {
      trip: daily.trip,
      route: {
        distanceKm: daily.trip.allowanceKm,
        drivingHours: 0,
        geometries: [],
        geometry: null,
        source: 'daily',
        dwellHours: 0,
      },
      legs: [],
      routeIndex: 0,
      returnRouteIndex: null,
      onRoadHours: 0,
      suggestion: null,
      quote: q,
      approximate: false,
      expiresAt: new Date(now.getTime() + rates.quoteValidMinutes * 60_000).toISOString(),
      rateCardVersion: rates.updatedAt || 'default',
    };
  }

  const { trip, error, message, field, vars } = normaliseTrip(body, rates, now);
  // `field` travels with the message so the form can put it under the input it
  // is about instead of in one catch-all spot; `vars` lets a translated client
  // build its own sentence from the code rather than showing English.
  if (error) return { error, message, field, vars };

  const legs = legsOf(trip);
  const dwell = dwellHours(trip.stops);

  // Each leg is routed separately, in parallel.
  //
  // The return leg's departure is the *end* of the hire, not the start — a car
  // leaving Ella at 4pm on the last day meets different traffic from one leaving
  // Colombo at 7am on the first. It is an estimate, since the exact hour depends
  // on how long the driving turns out to take, but an estimate in the right part
  // of the week beats reusing the outbound hour.
  const endAt = new Date(
    new Date(trip.startAt).getTime() + trip.requestedHours * 3600_000,
  ).toISOString();

  const legOptions = await Promise.all(
    legs.map((leg) => routeOptions(leg.points, leg.key === 'return' ? endAt : trip.startAt, body?.lang)),
  );

  // A stale index from a form the customer has since edited must not fail the
  // quote — it falls back to the first route, which is Google's own preference.
  const asked = [Number(body?.routeIndex), Number(body?.returnRouteIndex)];
  const chosenIndex = legOptions.map((opts, i) =>
    Number.isInteger(asked[i]) && asked[i] >= 0 && asked[i] < opts.length ? asked[i] : 0,
  );

  /** Price the journey with one leg's route swapped for `candidate`. */
  const priceWith = (legIndex, candidate) => {
    const picked = legOptions.map((opts, i) =>
      i === legIndex ? candidate : opts[chosenIndex[i]] || opts[0],
    );
    return priceTrip(
      {
        distanceKm: picked.reduce((sum, r) => sum + (r?.distanceKm || 0), 0),
        drivingHours: picked.reduce((sum, r) => sum + (r?.drivingHours || 0), 0),
        dwellHours: dwell,
        requestedHours: trip.requestedHours,
        startAt: trip.startAt,
        stops: trip.stops.length,
        vehicleClass: trip.vehicleClass,
        driverHosted: trip.driverHosted,
      },
      rates,
    );
  };

  // Every option on every leg is priced, not just the chosen one. On this island
  // the fastest road is often the longest, and a hire billed per kilometre can
  // cost more on it — so "which route" is a question about money, and answering
  // it without the money would be answering the wrong question.
  const pricedLegs = legs.map((leg, i) => ({
    key: leg.key,
    label: leg.label,
    from: leg.from?.label || '',
    to: leg.to?.label || '',
    index: chosenIndex[i],
    options: legOptions[i].map((route, j) => ({
      id: route.id || `r${j}`,
      label: route.label,
      via: route.via,
      distanceKm: route.distanceKm,
      drivingHours: route.drivingHours,
      avoidsHighways: Boolean(route.avoidsHighways),
      total: priceWith(i, route).total,
    })),
  }));

  const chosen = legOptions.map((opts, i) => opts[chosenIndex[i]] || opts[0]);
  const q = priceWith(-1, null);

  const combined = {
    distanceKm: Math.round(chosen.reduce((sum, r) => sum + (r?.distanceKm || 0), 0) * 10) / 10,
    drivingHours: Math.round(chosen.reduce((sum, r) => sum + (r?.drivingHours || 0), 0) * 100) / 100,
    // One geometry per leg, in order, so the map can draw the way out and the
    // way back as separate lines even where they share tarmac.
    geometries: chosen.map((r) => r?.geometry || null),
    geometry: chosen[0]?.geometry || null,
    via: chosen.map((r) => r?.via).filter(Boolean).join(' · '),
    avoidsHighways: chosen.every((r) => r?.avoidsHighways),
    source: chosen.some((r) => r?.source === 'estimate') ? 'estimate' : chosen[0]?.source || 'none',
    dwellHours: dwell,
  };

  // Time the driver is actually working: at the wheel, plus parked waiting at
  // the customer's stops. If that exceeds what the chosen length can hold, say
  // so — the price already accounts for the overrun, but a customer booking one
  // day for a ten-hour drive should hear about it before they book, not after.
  const onRoadHours = Math.round((combined.drivingHours + dwell) * 100) / 100;
  const wants = suggestedChoice(onRoadHours, rates);
  const picked = daysForHours(trip.requestedHours, rates);
  const suggestion =
    wants.days > picked ? { days: wants.days, label: wants.label, onRoadHours } : null;

  return {
    trip,
    route: combined,
    legs: pricedLegs,
    onRoadHours,
    suggestion,
    routeIndex: chosenIndex[0],
    returnRouteIndex: chosenIndex[1] ?? null,
    quote: q,
    // An approximate route means an approximate price; the page says so rather
    // than presenting a guess with the same confidence as a measured route.
    // True if *any* leg fell back to a straight-line estimate — half a journey
    // guessed still makes the whole price a guess.
    approximate: combined.source === 'estimate',
    expiresAt: new Date(now.getTime() + rates.quoteValidMinutes * 60_000).toISOString(),
    rateCardVersion: rates.updatedAt || 'default',
  };
}

async function currentRates() {
  const saved = await rateStore.get();
  return withDefaults(saved);
}

/**
 * Only known numeric fields, and only sane values.
 *
 * A rate card arrives from a form, and a stray empty string saved as `dayRate`
 * would make every subsequent quote NaN — which would look like a working page
 * quoting "LKR NaN" rather than an error anyone would notice.
 */
function sanitiseRates(input, current) {
  const out = { ...current };
  const numeric = [
    'hoursPerDay',
    'dayRate',
    'includedKmPerDay',
    'perKmOver',
    'overtimePerHour',
    'overnightStay',
    'overnightStayHosted',
    'stopFee',
    'roundTo',
    'quoteValidMinutes',
    'bufferHoursPerDay',
  ];
  for (const key of numeric) {
    if (input?.[key] === undefined || input[key] === '') continue;
    const n = Number(input[key]);
    if (Number.isFinite(n) && n >= 0) out[key] = n;
  }
  // Zero-length days or zero rounding would divide by zero downstream.
  if (!(out.hoursPerDay > 0)) out.hoursPerDay = DEFAULT_RATES.hoursPerDay;
  if (!(out.roundTo > 0)) out.roundTo = DEFAULT_RATES.roundTo;

  if (Array.isArray(input?.vehicleClasses) && input.vehicleClasses.length) {
    const classes = input.vehicleClasses
      .map((v) => ({
        key: String(v.key || '').trim().slice(0, 30),
        label: String(v.label || '').trim().slice(0, 80),
        seats: Math.max(1, Math.round(Number(v.seats) || 1)),
        multiplier: Number(v.multiplier),
      }))
      .filter((v) => v.key && Number.isFinite(v.multiplier) && v.multiplier > 0);
    if (classes.length) out.vehicleClasses = classes;
  }
  return out;
}

/* ────────────────────────────── helpers ────────────────────────────── */

/**
 * A booking reference a customer can read down a phone line.
 *
 * No I, O, 0 or 1 — the four characters that get misheard and mistyped — and
 * grouped so it can be read in two breaths.
 */
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRef(random = () => Math.random()) {
  const chars = Array.from(
    { length: 6 },
    () => REF_ALPHABET[Math.floor(random() * REF_ALPHABET.length)],
  ).join('');
  return `RF-${chars.slice(0, 3)}-${chars.slice(3)}`;
}

function cleanContact(input, caller) {
  const c = input || {};
  return {
    name: String(c.name || caller.name || '').slice(0, 120).trim(),
    // The Clerk profile's email is authoritative; a typed one would let a
    // customer send someone else's confirmation somewhere they choose.
    email: caller.email || String(c.email || '').slice(0, 200).trim().toLowerCase(),
    phone: String(c.phone || caller.phone || '').slice(0, 40).trim(),
    whatsapp: String(c.whatsapp || '').slice(0, 40).trim(),
  };
}

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    vary: 'origin',
  };
}

function headerOf(event, name) {
  const headers = event.headers || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

function bearer(event) {
  const raw = headerOf(event, 'authorization') || '';
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function json(statusCode, payload, cors) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', ...cors },
    body: JSON.stringify(payload),
  };
}
