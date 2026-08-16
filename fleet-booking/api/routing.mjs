/**
 * Places and routes, from Google Maps Platform.
 *
 *   autocomplete  Places API (New)  — text → suggestions (no coordinates)
 *   resolvePlace  Places API (New)  — a chosen suggestion → coordinates
 *   routeDistance Routes API        — coordinates → kilometres, hours, polyline
 *
 * Every call is made from the server, never the browser. That keeps the billed
 * key out of the bundle, lets it be locked to two APIs and no referrer, and
 * means one cache serves every visitor rather than each browser paying again.
 *
 * **Session tokens.** Autocomplete is billed per *session*, not per keystroke:
 * all the requests made while somebody types one place, plus the single details
 * call when they pick it, count once — but only if they share a token. The
 * browser mints one per field and sends it up; we forward it and it is retired
 * on resolve. Without this, a customer typing "Bandaranaike" is eleven billed
 * requests instead of one.
 *
 * A routing failure never breaks a quote outright: `routeDistance` falls back to
 * great-circle distance with a detour factor and says so, so the page shows an
 * approximate price rather than an error.
 */
import { cache } from './store.mjs';
import { inServiceArea } from '../shared/trip.mjs';

const PLACES = 'https://places.googleapis.com/v1';
const ROUTES = 'https://routes.googleapis.com/directions/v2:computeRoutes';

const ROUTE_TTL_DAYS = 30;
/**
 * Place details keep Google's 30-day cap. Suggestions are held far shorter:
 * they are cheap to refetch and a stale list is more annoying than a billed one.
 */
const PLACE_TTL_DAYS = 30;
const SUGGEST_TTL_DAYS = 1;
const TIMEOUT_MS = Number(process.env.ROUTING_TIMEOUT_MS || 8000);

/** Bias and restrict to Sri Lanka. */
const REGION = 'lk';

/**
 * Google answers in whichever language it is asked for, and it has real Sinhala
 * data — මහනුවර for Kandy, කොළඹ - නුවර මාර්ගය for the Colombo road. So the
 * language the customer is reading travels with the request.
 *
 * It also has to travel into the cache key. Without that the first Sinhala
 * visitor to price Colombo→Kandy would fill the cache with Sinhala road names
 * and every English visitor after them would read them too.
 */
function lang(code) {
  return code === 'si' ? 'si' : 'en';
}

let cachedKey;
async function apiKey() {
  if (cachedKey !== undefined) return cachedKey;
  if (process.env.GOOGLE_MAPS_API_KEY) {
    cachedKey = process.env.GOOGLE_MAPS_API_KEY;
    return cachedKey;
  }
  const prefix = process.env.SSM_PREFIX || '/fleet-booking';
  try {
    const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
    const client = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const res = await client.send(
      new GetParameterCommand({ Name: `${prefix}/google-maps-api-key`, WithDecryption: true }),
    );
    cachedKey = res.Parameter?.Value || null;
  } catch (err) {
    // A missing key must not take the whole quote down — distance falls back to
    // an estimate and the page says the price is approximate. Logged loudly
    // because it is a deployment step that was skipped, not a user's mistake.
    console.error('Google Maps API key unavailable:', err.name, err.message);
    cachedKey = null;
  }
  return cachedKey;
}

async function postJson(url, body, headers = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const message = json?.error?.message || `${res.status}`;
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url, headers = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(json?.error?.message || `${res.status}`);
      err.status = res.status;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/* ────────────────────────────── autocomplete ────────────────────────────── */

/**
 * Suggestions for what the customer has typed so far.
 *
 * Deliberately returns no coordinates. Google bills a details lookup per place,
 * and resolving six suggestions the customer will not choose costs six times
 * what resolving their one choice does. The `placeId` is enough to render the
 * list; `resolvePlace` turns the chosen one into a point.
 */
export async function autocomplete(query, sessionToken, locale) {
  const q = String(query || '').trim();
  if (q.length < 3) return [];

  const key = await apiKey();
  if (!key) return [];

  const language = lang(locale);
  const cacheKey = `SUGGEST#${language}#${q.toLowerCase()}`;
  const hit = await cache.get(cacheKey);
  if (hit) return hit;

  let data;
  try {
    data = await postJson(
      `${PLACES}/places:autocomplete`,
      {
        input: q,
        includedRegionCodes: [REGION],
        languageCode: language,
        ...(sessionToken ? { sessionToken } : {}),
      },
      { 'X-Goog-Api-Key': key },
    );
  } catch (err) {
    console.warn('autocomplete failed', err.message);
    return [];
  }

  const places = (data?.suggestions || [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p) => ({
      placeId: p.placeId,
      label: p.structuredFormat?.mainText?.text || p.text?.text || '',
      full: p.text?.text || '',
    }))
    .filter((p) => p.placeId && p.label);

  await cache.put(cacheKey, places, SUGGEST_TTL_DAYS);
  return places;
}

/**
 * A chosen suggestion, as a point.
 *
 * The service-area check lives here rather than on the suggestion list: this is
 * the moment a place becomes something the quote will rest on, and refusing it
 * here means an out-of-area place can never reach a booking even if Google's
 * region filter lets one through.
 */
export async function resolvePlace(placeId, sessionToken, locale) {
  const id = String(placeId || '').trim();
  if (!id) return null;

  const language = lang(locale);
  const cacheKey = `PLACE#${language}#${id}`;
  const hit = await cache.get(cacheKey);
  if (hit) return hit;

  const key = await apiKey();
  if (!key) return null;

  let data;
  try {
    data = await getJson(
      `${PLACES}/places/${encodeURIComponent(id)}?languageCode=${language}` +
        (sessionToken ? `&sessionToken=${encodeURIComponent(sessionToken)}` : ''),
      {
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'id,displayName,formattedAddress,location',
      },
    );
  } catch (err) {
    console.warn('place details failed', err.message);
    return null;
  }

  const lat = data?.location?.latitude;
  const lon = data?.location?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const place = {
    label: data.displayName?.text || data.formattedAddress || '',
    full: data.formattedAddress || '',
    lat,
    lon,
  };
  if (!inServiceArea(place)) return null;

  await cache.put(cacheKey, place, PLACE_TTL_DAYS);
  return place;
}

/* ────────────────────────────── routing ────────────────────────────── */

/**
 * Drive `waypoints` in order.
 *
 * `departureTime` is the trip's start. Passing it matters: with a departure in
 * the future Google returns a duration from historical traffic for that hour of
 * that weekday, so a 6am departure to Kandy is not quoted at the same speed as a
 * 6pm one. That is the whole reason this is worth paying for, and it is why no
 * traffic fudge factor is applied to a Google duration the way one was to
 * OSRM's free-flow numbers.
 */
export async function routeOptions(waypoints, departureTime, locale) {
  const points = (waypoints || []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
  if (points.length < 2) {
    return [{ distanceKm: 0, drivingHours: 0, geometry: null, source: 'none', label: 'No route' }];
  }

  // The departure hour is part of the key: the same road at 6am and 6pm are two
  // different answers now, and sharing one cache entry would hand a rush-hour
  // customer a dawn duration.
  const hourBucket = departureHour(departureTime);
  // The version prefix covers the *order* of the options as well as their
  // shape. g2 entries were stored fastest-first, and a 30-day TTL would keep
  // handing cached routes back in the old order — so a customer would get the
  // expressway as their default on any road somebody had already priced, and
  // the cheapest-first rule would appear to work only intermittently.
  const language = lang(locale);
  const key =
    `ROUTES#g3#${language}#${hourBucket}#` +
    points.map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join(';');
  const hit = await cache.get(key);
  if (hit) return hit.map((r) => ({ ...r, cached: true }));

  const apiKeyValue = await apiKey();
  if (!apiKeyValue) return [estimate(points)];

  // Two calls, in parallel. The first asks Google for its own alternatives; the
  // second explicitly refuses expressways and tolls.
  //
  // The second is not redundant. On this island the expressway route is often
  // *longer* — Colombo to Ella is 314 km via the E01 but 199 km on the A4 — and
  // a hire billed per kilometre beyond an allowance can cost meaningfully more
  // on the faster road. Google will not always volunteer the short slow one
  // among its alternatives, so it is asked for directly.
  const [alternatives, noHighway] = await Promise.all([
    fetchRoutes(points, departureTime, apiKeyValue, {}, true, language).catch(() => []),
    fetchRoutes(points, departureTime, apiKeyValue, { avoidHighways: true, avoidTolls: true }, false, language)
      .then((rs) => rs.map((r) => ({ ...r, avoidsHighways: true })))
      .catch(() => []),
  ]);

  // Three at most. A fourth road is a choice nobody makes carefully, and this
  // list sits on a phone above the price.
  //
  // Then ordered shortest first, which on a hire billed per kilometre past an
  // allowance is also cheapest first. Google returns its fastest route first,
  // and taking that as the default meant the dearest option was the one a
  // customer got by not choosing — the wrong way round for a page whose whole
  // argument is that the quick road costs more.
  const merged = dedupe([...alternatives, ...noHighway])
    .slice(0, 3)
    .sort((a, b) => a.distanceKm - b.distanceKm);
  if (merged.length === 0) return [estimate(points)];

  const labelled = merged.map(label);
  await cache.put(key, labelled, ROUTE_TTL_DAYS);
  return labelled;
}

/**
 * The single route a quote rests on. `index` is the customer's choice; out of
 * range falls back to the first, because a stale index from an edited form must
 * not fail a quote.
 */
export async function routeDistance(waypoints, departureTime, index = 0, locale) {
  const options = await routeOptions(waypoints, departureTime, locale);
  return options[index] || options[0];
}

async function fetchRoutes(points, departureTime, key, routeModifiers, alternatives, language = 'en') {
  const waypointOf = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lon } } });
  const body = {
    origin: waypointOf(points[0]),
    destination: waypointOf(points[points.length - 1]),
    ...(points.length > 2 ? { intermediates: points.slice(1, -1).map(waypointOf) } : {}),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    polylineQuality: 'OVERVIEW',
    regionCode: REGION,
    languageCode: language,
    units: 'METRIC',
    ...(alternatives ? { computeAlternativeRoutes: true } : {}),
    ...(Object.keys(routeModifiers).length ? { routeModifiers } : {}),
    ...(futureDeparture(departureTime) ? { departureTime: futureDeparture(departureTime) } : {}),
  };

  const data = await postJson(ROUTES, body, {
    'X-Goog-Api-Key': key,
    'X-Goog-FieldMask':
      'routes.distanceMeters,routes.duration,routes.description,routes.polyline.encodedPolyline',
  });

  return (data?.routes || []).map((route) => ({
    distanceKm: Math.round((route.distanceMeters / 1000) * 10) / 10,
    drivingHours: Math.round((parseDuration(route.duration) / 3600) * 100) / 100,
    // Encoded polyline, precision 5 — the same format OSRM used, so the decoder
    // in shared/ is unchanged.
    geometry: route.polyline?.encodedPolyline || null,
    via: shortenVia(route.description || ''),
    source: 'google',
  }));
}

/**
 * Google's alternatives and the no-highway request often overlap — when the
 * fastest route already avoids expressways, both calls return it. Two options
 * a customer cannot tell apart is worse than one.
 */
function dedupe(routes) {
  const out = [];
  for (const r of routes) {
    // Proportional, not absolute. Google's alternative and its no-highway
    // answer for the same road differ by a couple of kilometres at a junction —
    // 198.9 km and 196.0 km on the A4 are one road to a customer, and offering
    // both as choices worth LKR 0 apart is noise dressed as a decision.
    const i = out.findIndex(
      (o) =>
        Math.abs(o.distanceKm - r.distanceKm) <= Math.max(2, o.distanceKm * 0.02) &&
        Math.abs(o.drivingHours - r.drivingHours) <= Math.max(0.15, o.drivingHours * 0.03),
    );
    if (i === -1) {
      out.push({ ...r });
      continue;
    }
    const kept = out[i];
    // Of two versions of the same road, keep the shorter: it is the cheaper one
    // to quote, and quoting the dearer of two indistinguishable options is the
    // wrong way to round.
    if (r.distanceKm < kept.distanceKm) {
      out[i] = { ...r, avoidsHighways: kept.avoidsHighways || r.avoidsHighways };
    } else if (r.avoidsHighways) {
      // Keep the fact that this road needs no expressway, even when it arrived
      // first as an ordinary alternative.
      kept.avoidsHighways = true;
    }
  }
  return out;
}

/**
 * Google's `description` is a slash-separated pile of every road name on the
 * route — "Panadura-Nambapana-Ratnapura Hwy/PNR Hwy/Ratnapura - Horana -
 * Panadura Hwy/A8 and Colombo - Batticaloa Hwy/…/A4". Unreadable on a phone.
 * The first name plus the last road number is what a Sri Lankan driver would
 * actually say.
 */
function shortenVia(description) {
  if (!description) return '';
  const parts = description.split(/\s+and\s+|\//).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  const codes = parts.filter((p) => /^[AEB]\d+$/i.test(p));
  const name = parts.find((p) => !/^[AEB]\d+$/i.test(p)) || parts[0];
  const code = codes[codes.length - 1];
  return code && !name.includes(code) ? `${name} (${code})` : name;
}

function label(route, i, all) {
  const fastest = all.reduce((a, b) => (b.drivingHours < a.drivingHours ? b : a));
  const shortest = all.reduce((a, b) => (b.distanceKm < a.distanceKm ? b : a));
  let name;
  if (all.length === 1) name = 'Recommended route';
  else if (route === fastest) name = 'Fastest';
  else if (route === shortest) name = 'Shortest';
  else name = 'Alternative';
  return { ...route, id: `r${i}`, label: name };
}

/** "3600s" → 3600. */
function parseDuration(d) {
  const n = Number(String(d || '').replace(/s$/, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Routes rejects a departure in the past, and a booking form can hold a stale
 * one while the customer edits. Returns undefined rather than a rejected call.
 */
function futureDeparture(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime()) || t.getTime() <= Date.now() + 60_000) return undefined;
  return t.toISOString();
}

/** Weekday + hour in Colombo — the granularity traffic actually varies at. */
function departureHour(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return 'na';
  const local = new Date(t.getTime() + 330 * 60_000);
  return `${local.getUTCDay()}-${local.getUTCHours()}`;
}

/* ────────────────────────────── fallback ────────────────────────────── */

/** Roads are not straight lines; this is the usual ratio for the island. */
const DETOUR_FACTOR = 1.35;
/** Average door-to-door speed, km/h, when we have to guess entirely. */
const FALLBACK_SPEED = 45;

function estimate(points) {
  let km = 0;
  for (let i = 1; i < points.length; i += 1) km += haversineKm(points[i - 1], points[i]);
  const distanceKm = Math.round(km * DETOUR_FACTOR * 10) / 10;
  return {
    distanceKm,
    drivingHours: Math.round((distanceKm / FALLBACK_SPEED) * 100) / 100,
    // No geometry: the map draws straight dashed lines between the waypoints
    // rather than inventing a road that was never routed.
    geometry: null,
    source: 'estimate',
    id: 'r0',
    label: 'Estimated route',
    via: '',
  };
}

export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Test seam. */
export function resetKeyCache() {
  cachedKey = undefined;
}
