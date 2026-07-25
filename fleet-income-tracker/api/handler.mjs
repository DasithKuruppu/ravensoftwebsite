/**
 * The whole API — one Lambda, all routes, behind an API Gateway HTTP API.
 *
 * Routes
 *   POST   /login                 → { token, role }
 *   GET    /summary?month=yyyy-mm → month totals, tier breakdown, projection
 *   GET    /entries?month=yyyy-mm → daily entries
 *   PUT    /entries/{date}        → upsert one day
 *   DELETE /entries/{date}        → delete one day
 *   POST   /entries/import        → batch upsert of normalised CSV rows
 *   GET    /settings              → tier params + saved CSV mapping   (owner)
 *   PUT    /settings              → update tier params / CSV mapping  (owner)
 *   GET    /validate?month=       → uber vs gps km comparison         (owner)
 *
 * Role enforcement is server-side. A `driver` token is refused on settings,
 * GPS comparison and owner-share data — the UI hiding a tab is not the control.
 */
import {
  calculatePay,
  ownerShare,
  projectRevenue,
  round2,
  prorate,
  monthFactor,
  operatingDays,
} from '../shared/commission.mjs';
import { store, DEFAULT_DRIVER } from './store.mjs';
import { login, verifyToken, isOwner } from './auth.mjs';
import {
  credentials as dagpsCredentials,
  login as dagpsLogin,
  fetchLocation,
} from '../jobs/dagps-client.mjs';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'https://tracker.ravensoft.click,http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const DRIVER_ID = process.env.DRIVER_ID || DEFAULT_DRIVER;

export async function handler(event) {
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
  const rawPath = event.rawPath || event.path || '/';
  const path = rawPath.replace(/\/+$/, '') || '/';
  const origin = headerOf(event, 'origin');
  const cors = corsHeaders(origin);

  if (method === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  try {
    return await route(method, path, event, cors);
  } catch (err) {
    console.error('unhandled error', err);
    // A missing or unreadable secret is a deployment step that was skipped, not
    // a fault in the request. Return the actionable message rather than the
    // SDK's opaque "UnknownError".
    if (err.isConfigError) {
      return json(500, { error: 'not_configured', message: err.message }, cors);
    }
    return json(500, { error: 'internal_error', message: err.message || err.name || 'unknown' }, cors);
  }
}

async function route(method, path, event, cors) {
  const query = event.queryStringParameters || {};
  const body = parseBody(event);

  /* ── public ── */
  if (method === 'POST' && path === '/login') {
    const result = await login(body.username, body.password);
    if (!result) return json(401, { error: 'invalid_credentials' }, cors);
    return json(200, result, cors);
  }

  if (method === 'GET' && path === '/health') {
    return json(200, { ok: true }, cors);
  }

  /* ── everything below requires a valid token ── */
  const auth = await verifyToken(bearer(event));
  if (!auth) return json(401, { error: 'unauthorized' }, cors);

  const month = normaliseMonth(query.month);

  if (method === 'GET' && path === '/summary') {
    return json(200, await buildSummary(month, auth), cors);
  }

  if (method === 'GET' && path === '/entries') {
    return json(200, { month, entries: await store.queryMonth(DRIVER_ID, month) }, cors);
  }

  if (method === 'POST' && path === '/entries/import') {
    const rows = Array.isArray(body.rows) ? body.rows : [];
    return json(200, await importRows(rows), cors);
  }

  const entryMatch = path.match(/^\/entries\/(\d{4}-\d{2}-\d{2})$/);
  if (entryMatch) {
    const date = entryMatch[1];
    if (method === 'PUT') {
      const entry = {
        date,
        revenue: toNumber(body.revenue) ?? 0,
        trips: toNumber(body.trips),
        uberKm: toNumber(body.uberKm),
        gpsKm: toNumber(body.gpsKm),
        source: ['manual', 'csv', 'api'].includes(body.source) ? body.source : 'manual',
      };
      return json(200, await store.putEntry(DRIVER_ID, entry), cors);
    }
    if (method === 'DELETE') {
      await store.deleteEntry(DRIVER_ID, date);
      return json(204, null, cors);
    }
  }

  /* ── owner-only ── */
  if (path === '/settings') {
    if (!isOwner(auth)) return json(403, { error: 'forbidden', message: 'Settings are owner-only' }, cors);
    if (method === 'GET') return json(200, await store.getSettings(DRIVER_ID), cors);
    if (method === 'PUT') {
      const current = await store.getSettings(DRIVER_ID);
      const next = {
        base: toNumber(body.base) ?? current.base,
        bandStart: toNumber(body.bandStart) ?? current.bandStart,
        bandEnd: toNumber(body.bandEnd) ?? current.bandEnd,
        bandRate: toNumber(body.bandRate) ?? current.bandRate,
        topRate: toNumber(body.topRate) ?? current.topRate,
        // yyyy-mm-dd, or null to treat every month as full
        startDate:
          body.startDate === undefined
            ? current.startDate ?? null
            : /^\d{4}-\d{2}-\d{2}$/.test(body.startDate || '')
              ? body.startDate
              : null,
        csvMapping: body.csvMapping === undefined ? current.csvMapping ?? null : body.csvMapping,
      };
      if (next.bandEnd <= next.bandStart) {
        return json(400, { error: 'invalid_settings', message: 'bandEnd must be greater than bandStart' }, cors);
      }
      return json(200, await store.putSettings(DRIVER_ID, next), cors);
    }
  }

  if (method === 'GET' && path === '/validate') {
    if (!isOwner(auth)) return json(403, { error: 'forbidden', message: 'GPS comparison is owner-only' }, cors);
    return json(200, await buildValidation(month), cors);
  }

  if (method === 'GET' && path === '/location') {
    if (!isOwner(auth)) {
      return json(403, { error: 'forbidden', message: 'Vehicle location is owner-only' }, cors);
    }
    try {
      return json(200, await vehicleLocation(), cors);
    } catch (err) {
      // The tracker being unreachable or unfixed is an expected state, not a
      // server fault — the dashboard shows the reason rather than an error page.
      console.warn('location unavailable:', err.message);
      return json(200, { available: false, reason: err.message }, cors);
    }
  }

  return json(404, { error: 'not_found', path }, cors);
}

/* ─────────────────────────── domain logic ─────────────────────────── */

async function buildSummary(month, auth) {
  const [entries, settings] = await Promise.all([
    store.queryMonth(DRIVER_ID, month),
    store.getSettings(DRIVER_ID),
  ]);

  const revenue = round2(entries.reduce((s, e) => s + (e.revenue || 0), 0));
  const trips = entries.reduce((s, e) => s + (e.trips || 0), 0);
  const daysLogged = entries.length;

  const daysInMonth = daysInMonthOf(month);

  // A month the driver only worked part of is judged on its operating days,
  // not the calendar: the plan is prorated, and the projection extrapolates
  // over the days actually available rather than the whole month.
  const factor = monthFactor(month, settings.startDate, daysInMonth);
  const { elapsed: elapsedDays, total: operatingTotal } = operatingDays(
    month,
    settings.startDate,
    daysInMonth,
    todayInColombo(),
  );

  const projectedRevenue = projectRevenue(revenue, elapsedDays, operatingTotal);

  const current = calculatePay(revenue, settings, factor);
  const projected = calculatePay(projectedRevenue, settings, factor);
  const effectivePlan = prorate(settings, factor);

  const payload = {
    month,
    revenue,
    trips,
    daysLogged,
    daysInMonth,
    elapsedDays,
    operatingDays: operatingTotal,
    // 1 for a normal month; below 1 only in the month the driver started.
    prorationFactor: Math.round(factor * 10000) / 10000,
    startDate: settings.startDate ?? null,
    driverPay: current.total,
    tiers: current.tiers,
    projectedRevenue,
    projectedDriverPay: projected.total,
    // The ladder needs the band edges to draw its zones; they are not secret
    // in the sense that the driver's own pay already depends on them, but the
    // editable settings record itself stays owner-only.
    plan: { bandStart: effectivePlan.bandStart, bandEnd: effectivePlan.bandEnd, base: effectivePlan.base },
  };

  // Owner-share figures are withheld from driver tokens at the API level.
  if (isOwner(auth)) {
    payload.ownerShare = ownerShare(revenue, settings, factor);
    payload.projectedOwnerShare = ownerShare(projectedRevenue, settings, factor);
  }

  return payload;
}

/**
 * How far GPS distance may exceed Uber's before a day is worth investigating.
 *
 * Calibrated against real data rather than guessed. Uber's `Trip distance`
 * counts only the on-trip leg — passenger aboard — and excludes driving to
 * pickups, repositioning between fares and the trip home. Total odometer
 * distance is therefore always substantially higher: this fleet runs 1.6–2.8×,
 * averaging 1.9×, on days with normal activity.
 *
 * A 15% threshold (the original guess) flags every single day and tells you
 * nothing. 150% sits clear of the observed normal band while still catching a
 * day where the car covered far more ground than its fares account for.
 */
export const GPS_DELTA_THRESHOLD_PCT = 150;

/** Percentage by which GPS distance exceeds Uber's for one day. */
export function gpsDelta(uberKm, gpsKm) {
  const deltaKm = round2(gpsKm - uberKm);
  const deltaPct = uberKm ? round2((deltaKm / uberKm) * 100) : 0;
  return { deltaKm, deltaPct, flagged: deltaPct > GPS_DELTA_THRESHOLD_PCT };
}

async function buildValidation(month) {
  const entries = await store.queryMonth(DRIVER_ID, month);
  const rows = entries
    .filter((e) => e.uberKm && e.gpsKm)
    .map((e) => ({ ...e, ...gpsDelta(e.uberKm, e.gpsKm) }));
  return {
    month,
    threshold: GPS_DELTA_THRESHOLD_PCT,
    rows,
    flaggedCount: rows.filter((r) => r.flagged).length,
  };
}

/**
 * Upsert normalised CSV rows. The SPA parses and maps columns client-side and
 * posts batches of { date, revenue, trips, uberKm } here.
 *
 * Uber's per-trip exports produce several rows per date, so rows are summed
 * per date before writing, and a date already present from an earlier batch of
 * the same import is added to rather than overwritten.
 */
export async function importRows(rows) {
  const byDate = new Map();
  let skipped = 0;

  for (const raw of rows) {
    const date = normaliseDate(raw.date);
    if (!date) {
      skipped++;
      continue;
    }
    const acc =
      byDate.get(date) ||
      { date, revenue: 0, trips: 0, uberKm: 0, hasRevenue: false, hasTrips: false, hasDistance: false };

    const revenue = toNumber(raw.revenue);
    if (revenue !== undefined) {
      acc.revenue += revenue;
      acc.hasRevenue = true;
    }

    const distance = toNumber(raw.uberKm);
    if (distance !== undefined) {
      acc.uberKm += distance;
      acc.hasDistance = true;
    }

    // A per-trip row carries no trip count of its own — it *is* one trip.
    // Only count trips when the import actually describes them: a revenue-only
    // export must not silently invent a trip count.
    const t = toNumber(raw.trips);
    if (t !== undefined) {
      acc.trips += t;
      acc.hasTrips = true;
    } else if (distance !== undefined) {
      acc.trips += 1;
      acc.hasTrips = true;
    }

    byDate.set(date, acc);
  }

  const written = [];
  for (const [date, acc] of byDate) {
    const existing = await store.getEntry(DRIVER_ID, date);
    // Each report carries only some of the columns — Uber's earnings summary has
    // no distance, its trip activity export has no fare. A field the import does
    // not describe keeps whatever is already stored, so importing one report
    // never wipes what the other one wrote.
    const entry = {
      date,
      revenue: acc.hasRevenue ? round2(acc.revenue) : existing?.revenue ?? 0,
      trips: acc.hasTrips ? acc.trips || null : existing?.trips ?? null,
      uberKm: acc.hasDistance ? round2(acc.uberKm) : existing?.uberKm ?? null,
      // never clobber GPS mileage — that comes from the DAGPS sync
      gpsKm: existing?.gpsKm ?? null,
      source: 'csv',
    };
    written.push(await store.putEntry(DRIVER_ID, entry));
  }

  return { imported: written.length, skipped, dates: written.map((w) => w.date).sort() };
}

/**
 * Last known vehicle position, fetched from the tracker portal.
 *
 * The SPA asks once per page load, so the result is cached briefly in the
 * container: a burst of page loads costs the portal one login rather than one
 * per view. The cache is deliberately short — a stale position is worse than a
 * slightly slower page — and the fix's own timestamp is always returned so the
 * UI can say how old it is.
 */
const LOCATION_TTL_MS = 60_000;
let locationCache = null;

async function vehicleLocation() {
  if (locationCache && Date.now() - locationCache.at < LOCATION_TTL_MS) {
    return { ...locationCache.value, cached: true };
  }
  const session = await dagpsLogin(await dagpsCredentials());
  const loc = await fetchLocation(session);
  const value = { available: true, ...loc };
  locationCache = { at: Date.now(), value };
  return { ...value, cached: false };
}

/* ────────────────────────────── helpers ────────────────────────────── */

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'content-type,authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(statusCode, payload, cors) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', ...cors },
    body: payload === null ? '' : JSON.stringify(payload),
  };
}

function headerOf(event, name) {
  const headers = event.headers || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

function bearer(event) {
  const raw = headerOf(event, 'authorization') || '';
  return raw.replace(/^Bearer\s+/i, '').trim();
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function toNumber(v) {
  if (v === undefined || v === null || v === '') return undefined;
  // Tolerate "1,234.50" and "LKR 1234.50" from CSV exports.
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

export function normaliseMonth(month) {
  if (typeof month === 'string' && /^\d{4}-\d{2}$/.test(month)) return month;
  return todayInColombo().slice(0, 7);
}

/** Accepts yyyy-mm-dd, dd/mm/yyyy, mm/dd/yyyy (US exports) and ISO timestamps. */
export function normaliseDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (slash) {
    let [, a, b, year] = slash;
    // Uber exports are US-formatted (mm/dd/yyyy) unless the first field is > 12.
    let month = a;
    let day = b;
    if (Number(a) > 12) {
      month = b;
      day = a;
    }
    return `${year}-${pad(month)}-${pad(day)}`;
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

const pad = (n) => String(n).padStart(2, '0');

/** "Today" is evaluated in Asia/Colombo — the fleet's local day. */
export function todayInColombo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ_NAME || 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function daysInMonthOf(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

