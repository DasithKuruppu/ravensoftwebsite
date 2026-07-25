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

const READ_ONLY = 'Entries are read-only for the driver';

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
    // The driver signs in with his own name as well as the generic "driver".
    const result = await login(await resolveUsername(body.username), body.password);
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
    if (!isOwner(auth)) return json(403, { error: 'forbidden', message: READ_ONLY }, cors);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    return json(200, await importRows(rows), cors);
  }

  const entryMatch = path.match(/^\/entries\/(\d{4}-\d{2}-\d{2})$/);
  if (entryMatch) {
    const date = entryMatch[1];
    // The revenue record is the owner's book. The driver can read it — he needs
    // to see his own earnings and what cash he owes — but cannot alter it.
    if (method !== 'GET' && !isOwner(auth)) {
      return json(403, { error: 'forbidden', message: READ_ONLY }, cors);
    }
    if (method === 'PUT') {
      const entry = {
        date,
        revenue: toNumber(body.revenue) ?? 0,
        trips: toNumber(body.trips),
        uberKm: toNumber(body.uberKm),
        gpsKm: toNumber(body.gpsKm),
        cashCollected: toNumber(body.cashCollected),
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
        driverName:
          typeof body.driverName === 'string' && body.driverName.trim()
            ? body.driverName.trim().slice(0, 40)
            : current.driverName || 'Driver',
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

  // Visible to both roles. The driver is the person being tracked, so showing
  // him the same position the owner sees makes the tracking transparent rather
  // than one-way — and he already knows where he is. Owner-share figures stay
  // owner-only because those are commercial, not data about him.
  // When a second driver exists, scope this to the caller's own vehicle.
  // Charging stations. Readable by both roles — the driver is the one who
  // actually has to find a charger — but only the owner can edit the list.
  if (path === '/chargers') {
    if (method === 'GET') {
      return json(200, { chargers: await store.getChargers() }, cors);
    }
    if (method === 'PUT') {
      if (!isOwner(auth)) {
        return json(403, { error: 'forbidden', message: 'Editing chargers is owner-only' }, cors);
      }
      const list = Array.isArray(body.chargers) ? body.chargers.map(cleanCharger).filter(Boolean) : null;
      if (!list) {
        return json(400, { error: 'invalid_chargers', message: 'chargers must be an array' }, cors);
      }
      return json(200, { chargers: await store.putChargers(list) }, cors);
    }
  }

  if (method === 'GET' && path === '/location') {
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

/**
 * Map whatever was typed to the account it means. The driver's own name is an
 * alias for the `driver` account, so he does not have to sign in as a job title.
 */
async function resolveUsername(input) {
  const typed = String(input || '').trim().toLowerCase();
  if (typed === 'owner' || typed === 'driver') return typed;
  try {
    const settings = await store.getSettings(DRIVER_ID);
    const name = (settings.driverName || '').trim().toLowerCase();
    if (name && typed === name) return 'driver';
  } catch {
    // Settings unreadable — fall through and let the login fail normally.
  }
  return typed;
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

  // Reconciliation: cash the driver holds versus what Uber sends to the bank.
  const cashCollected = round2(entries.reduce((s, e) => s + (e.cashCollected || 0), 0));
  const bankCredited = round2(revenue - cashCollected);
  const daysWithCash = entries.filter((e) => e.cashCollected !== null).length;

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
    driverName: settings.driverName || 'Driver',
    driverPay: current.total,
    tiers: current.tiers,
    // Both roles see this: the driver needs to know how much cash he is holding.
    cashCollected,
    bankCredited,
    cashKnown: daysWithCash > 0,
    cashShare: revenue > 0 ? Math.round((cashCollected / revenue) * 1000) / 10 : 0,
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
      {
        date,
        revenue: 0,
        trips: 0,
        uberKm: 0,
        cashCollected: 0,
        hasRevenue: false,
        hasTrips: false,
        hasDistance: false,
        hasCash: false,
      };

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

    // Uber books cash collected as a deduction from the payout, so the export
    // carries it negative. What matters here is how much cash changed hands.
    const cash = toNumber(raw.cashCollected);
    if (cash !== undefined) {
      acc.cashCollected += Math.abs(cash);
      acc.hasCash = true;
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
      cashCollected: acc.hasCash ? round2(acc.cashCollected) : existing?.cashCollected ?? null,
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
// The tracker reports roughly every 20s while moving, so caching for a minute
// would hide movement between refreshes. 15s still absorbs a burst of reloads.
const LOCATION_TTL_MS = 15_000;

/** Portal's own definition: no heartbeat for this long means offline. */
const OFFLINE_AFTER_MIN = 25;

/** Two fixes further apart than this say nothing useful about current speed. */
const MAX_DERIVE_GAP_S = 300;

/** Below this, GPS jitter rather than movement. */
const MOVED_THRESHOLD_M = 25;

let locationCache = null;

async function vehicleLocation() {
  if (locationCache && Date.now() - locationCache.at < LOCATION_TTL_MS) {
    return { ...locationCache.value, cached: true };
  }

  const session = await dagpsLogin(await dagpsCredentials());
  const fix = await fetchLocation(session);

  // The device's own speed field is stuck at 0 on this hardware, so derive
  // speed from how far the vehicle moved between this fix and the last one.
  const previous = await store.getLastFix();
  const derived = deriveMotion(previous, fix);

  // Only advance the stored fix when the device actually produced a new one;
  // otherwise a page reload would compare a fix against itself and read as
  // stationary.
  if (!previous || previous.fixedAt !== fix.fixedAt) {
    await store.putLastFix({ lat: fix.lat, lng: fix.lng, fixedAt: fix.fixedAt });
  }

  const value = { available: true, ...fix, ...derived };
  locationCache = { at: Date.now(), value };
  return { ...value, cached: false };
}

/**
 * Work out whether the vehicle is moving, and how fast, from two fixes.
 *
 * Returns speedKmh: null when it cannot be known — a long gap between fixes
 * gives an average over that whole window, which would be misleading rather
 * than merely imprecise.
 */
export function deriveMotion(previous, fix) {
  const heartbeatAgeMin =
    fix.heartbeatAgeSeconds !== null && fix.heartbeatAgeSeconds !== undefined
      ? fix.heartbeatAgeSeconds / 60
      : ageMinutes(fix.serverTime, fix.heartbeatAt);
  if (heartbeatAgeMin !== null && heartbeatAgeMin > OFFLINE_AFTER_MIN) {
    return { status: 'offline', speedKmh: null, speedSource: 'none', movedM: null };
  }

  if (!previous || !previous.fixedAt || previous.fixedAt === fix.fixedAt) {
    // No usable comparison yet — say so rather than claiming "stationary".
    return { status: 'unknown', speedKmh: null, speedSource: 'none', movedM: null };
  }

  const gapS = (Date.parse(fix.fixedAt) - Date.parse(previous.fixedAt)) / 1000;
  const movedM = Math.round(haversineKm(previous.lat, previous.lng, fix.lat, fix.lng) * 1000);

  if (gapS <= 0 || gapS > MAX_DERIVE_GAP_S) {
    return {
      status: movedM > MOVED_THRESHOLD_M ? 'unknown' : 'parked',
      speedKmh: null,
      speedSource: 'none',
      movedM,
    };
  }

  const kmh = Math.round((movedM / 1000 / (gapS / 3600)) * 10) / 10;
  return {
    status: movedM > MOVED_THRESHOLD_M ? 'moving' : 'parked',
    speedKmh: movedM > MOVED_THRESHOLD_M ? kmh : 0,
    speedSource: 'derived',
    movedM,
    overSeconds: Math.round(gapS),
  };
}

function ageMinutes(nowIso, thenIso) {
  if (!nowIso || !thenIso) return null;
  const ms = Date.parse(nowIso) - Date.parse(thenIso);
  return Number.isFinite(ms) ? ms / 60000 : null;
}

function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Normalise one station before storing it. A charger with no usable position is
 * dropped rather than saved — it would sort as "nearest" from anywhere.
 */
function cleanCharger(c) {
  const lat = toNumber(c?.lat);
  const lng = toNumber(c?.lng);
  if (lat === undefined || lng === undefined) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  const tou =
    c.tou && ['day', 'peak', 'offPeak'].some((k) => toNumber(c.tou[k]) !== undefined)
      ? {
          day: toNumber(c.tou.day) ?? null,
          peak: toNumber(c.tou.peak) ?? null,
          offPeak: toNumber(c.tou.offPeak) ?? null,
        }
      : null;

  return {
    id: String(c.id || `charger-${lat.toFixed(4)}-${lng.toFixed(4)}`),
    name: String(c.name || 'Unnamed charger').slice(0, 80),
    address: c.address ? String(c.address).slice(0, 160) : '',
    lat,
    lng,
    network: c.network ? String(c.network).slice(0, 60) : '',
    app: c.app ? String(c.app).slice(0, 60) : '',
    connectors: Array.isArray(c.connectors) ? c.connectors.map(String).slice(0, 6) : null,
    powerKw: toNumber(c.powerKw) ?? null,
    hours: c.hours ? String(c.hours).slice(0, 40) : '',
    flatRate: toNumber(c.flatRate) ?? null,
    tou,
    // Default to the cautious value: an unmarked station is NOT a CCS2 promise.
    ccs2: c.ccs2 === 'confirmed' ? 'confirmed' : 'unknown',
    position: c.position === 'approx' ? 'approx' : 'exact',
    source: c.source ? String(c.source).slice(0, 60) : '',
  };
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

