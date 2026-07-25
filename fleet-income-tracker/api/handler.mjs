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
import { costsForMonth, COST_CATEGORIES, COST_FREQUENCIES } from '../shared/costs.mjs';
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

  // Marking a day off is the single write the driver may make. He is recording
  // his own availability, not touching the revenue record — and he is the one
  // who knows he was not driving. Revenue on the day is left untouched either
  // way, so this cannot be used to hide earnings.
  const offMatch = path.match(/^\/entries\/(\d{4}-\d{2}-\d{2})\/off$/);
  if (offMatch && method === 'PUT') {
    const date = offMatch[1];
    const off = body.off === true;
    const existing = await store.getEntry(DRIVER_ID, date);
    const saved = await store.putEntry(DRIVER_ID, {
      date,
      revenue: existing?.revenue ?? 0,
      trips: existing?.trips ?? null,
      uberKm: existing?.uberKm ?? null,
      gpsKm: existing?.gpsKm ?? null,
      cashCollected: existing?.cashCollected ?? null,
      source: existing?.source ?? 'manual',
      offDay: off,
    });
    return json(200, saved, cors);
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
        offDay: body.offDay === true,
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
        capitalInvested: toNumber(body.capitalInvested) ?? current.capitalInvested ?? null,
        alternativeRatePct: toNumber(body.alternativeRatePct) ?? current.alternativeRatePct ?? 9,
        leasedPercent: clampPct(toNumber(body.leasedPercent) ?? current.leasedPercent ?? 0),
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

  // Running costs are the owner's ledger — the driver never sees them, and the
  // route refuses him outright rather than the UI merely hiding a tab.
  if (path === '/costs') {
    if (!isOwner(auth)) return json(403, { error: 'forbidden', message: 'Running costs are owner-only' }, cors);
    if (method === 'GET') return json(200, { costs: await store.getCosts() }, cors);
    if (method === 'PUT') {
      const list = Array.isArray(body.costs) ? body.costs.map(cleanCost).filter(Boolean) : null;
      if (!list) return json(400, { error: 'invalid_costs', message: 'costs must be an array' }, cors);
      return json(200, { costs: await store.putCosts(list) }, cors);
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

  // Days off correct the RUN-RATE but never the target.
  //
  // Excluding them from the average is fair: a day he was not driving should
  // not read as a day he earned nothing. Excluding them from the band would
  // not be — the tiers are a commercial term tied to the start date, and
  // letting time off shrink them would mean the less he worked, the easier
  // his bonus became. So `factor` and `operatingTotal` are left alone and only
  // the denominators of the average and the projection change.
  const offElapsed = entries.filter((e) => e.offDay && e.date <= todayInColombo()).length;
  const offAhead = entries.filter((e) => e.offDay && e.date > todayInColombo()).length;
  const workedDays = Math.max(0, elapsedDays - offElapsed);
  const remainingWorkDays = Math.max(0, operatingTotal - elapsedDays - offAhead);

  const dailyRate = workedDays > 0 ? revenue / workedDays : 0;
  const projectedRevenue = round2(revenue + dailyRate * remainingWorkDays);

  const current = calculatePay(revenue, settings, factor);
  const projected = calculatePay(projectedRevenue, settings, factor);
  const effectivePlan = prorate(settings, factor);

  // Cumulative day-by-day series for the projection chart. Built here rather
  // than in the browser because the pay curve needs the full tier settings,
  // which the driver is not allowed to read.
  const series = buildSeries({
    entries,
    settings,
    factor,
    daysInMonth,
    elapsedDays,
    operatingTotal,
    revenue,
    projectedRevenue,
    yesterday: yesterdayRevenue(entries),
  });

  const payload = {
    month,
    revenue,
    series,
    push: buildPush({
      settings,
      factor,
      revenue,
      trips,
      projectedRevenue,
      dailyAverage: dailyRate,
      elapsedDays,
      operatingTotal,
      remainingWorkDays,
      projectedPay: projected.total,
    }),
    trips,
    daysLogged,
    daysInMonth,
    elapsedDays,
    operatingDays: operatingTotal,
    workedDays,
    offDaysElapsed: offElapsed,
    offDaysAhead: offAhead,
    remainingWorkDays,
    // 1 for a normal month; below 1 only in the month the driver started.
    prorationFactor: Math.round(factor * 10000) / 10000,
    startDate: settings.startDate ?? null,
    driverName: settings.driverName || 'Driver',
    // Average per operating day elapsed — the same run-rate the projection
    // extrapolates, so the two figures always agree with each other.
    // Per day actually worked, so time off does not read as a bad day.
    dailyAverage: round2(dailyRate),
    // Yesterday, not a rolling average and not today: today is still being
    // driven, so it always reads low and would misrepresent recent form.
    // Yesterday is the last complete day and the fairest recent comparison.
    yesterday: yesterdayRevenue(entries),
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

  // Owner-share figures and the cost ledger are withheld from driver tokens at
  // the API level — they are absent from his payload, not hidden in his UI.
  if (isOwner(auth)) {
    const share = ownerShare(revenue, settings, factor);
    const projShare = ownerShare(projectedRevenue, settings, factor);
    const costs = costsForMonth(await store.getCosts(), month);

    payload.ownerShare = share;
    payload.projectedOwnerShare = projShare;
    payload.costs = costs;
    // What is actually left after paying the driver and running the car.
    payload.ownerProfit = round2(share - costs.total);
    payload.projectedOwnerProfit = round2(projShare - costs.total);
    payload.roi = buildRoi({ settings, projectedProfit: round2(projShare - costs.total) });
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
 * Yesterday's revenue in Asia/Colombo, or null if that day is outside the month
 * being viewed — a past month has no "yesterday" to speak of.
 */
function yesterdayRevenue(entries) {
  const date = new Date(Date.parse(`${todayInColombo()}T00:00:00Z`) - 86400000)
    .toISOString()
    .slice(0, 10);
  const entry = entries.find((e) => e.date === date);
  return entry ? { date, revenue: round2(entry.revenue || 0) } : null;
}

/**
 * The next tier, and what it would take to get there.
 *
 * Everything is expressed in what the driver controls and receives — trips per
 * day and his own take-home — not gross revenue, which is the owner's measure
 * and motivates nobody.
 *
 * Two different daily rates matter and they are not the same number: the rate
 * that would have reached the target had it been kept all month, and the rate
 * the REMAINING days now need to make up the shortfall. The second is the
 * honest one once he is behind, and it climbs as the month runs out.
 */
function buildPush({
  settings, factor, revenue, trips, projectedRevenue, dailyAverage,
  elapsedDays, operatingTotal, remainingWorkDays, projectedPay,
}) {
  const plan = prorate(settings, factor);
  const daysLeft = remainingWorkDays;

  // Which threshold is next, judged on the projection rather than today's
  // total — the question is where the month is heading.
  let target = null;
  let tier = null;
  if (projectedRevenue < plan.bandStart) {
    target = plan.bandStart;
    tier = 'band';
  } else if (projectedRevenue < plan.bandEnd) {
    target = plan.bandEnd;
    tier = 'top';
  }

  // What one more rupee is worth right now, and after the next threshold.
  const marginalNow =
    projectedRevenue < plan.bandStart ? 0 : projectedRevenue < plan.bandEnd ? settings.bandRate : settings.topRate;
  const marginalNext = tier === 'band' ? settings.bandRate : tier === 'top' ? settings.topRate : null;

  const base = {
    tier,
    marginalNow,
    marginalNext,
    bandRate: settings.bandRate,
    topRate: settings.topRate,
    bandStart: plan.bandStart,
    bandEnd: plan.bandEnd,
    dailyAverage: round2(dailyAverage),
    revenuePerTrip: trips > 0 ? round2(revenue / trips) : null,
    tripsPerDay: trips > 0 && elapsedDays > 0 ? Math.round((trips / elapsedDays) * 10) / 10 : null,
    daysLeft,
  };

  // Already in the top tier — nothing to chase, so say what he is earning.
  if (!target) return { ...base, reached: true };

  const payAtTarget = calculatePay(target, settings, factor).total;
  const catchUpDaily = daysLeft > 0 ? (target - revenue) / daysLeft : null;
  const extraPerDay = catchUpDaily === null ? null : Math.max(0, catchUpDaily - dailyAverage);

  return {
    ...base,
    reached: false,
    target: round2(target),
    gap: round2(Math.max(0, target - projectedRevenue)),
    dailyNeeded: round2(target / operatingTotal),
    catchUpDaily: catchUpDaily === null ? null : round2(catchUpDaily),
    extraPerDay: extraPerDay === null ? null : round2(extraPerDay),
    extraTripsPerDay:
      extraPerDay !== null && trips > 0 && revenue > 0
        ? Math.round((extraPerDay / (revenue / trips)) * 10) / 10
        : null,
    payNow: round2(projectedPay),
    payAtTarget,
    payGain: round2(payAtTarget - projectedPay),
    payGainPct: projectedPay > 0 ? Math.round(((payAtTarget / projectedPay) - 1) * 100) : null,
  };
}

/**
 * Take-home across the month: what it is so far, and where it lands under
 * different finishes.
 *
 * Pay is recomputed at each cumulative revenue rather than scaled, because the
 * plan is piecewise — flat at the base until revenue reaches the band, then
 * rising at one rate, then a steeper one. Drawing it is the point: the stretch
 * line pulls away from the current-pace line only after the threshold, which is
 * exactly the argument for pushing.
 *
 * Returns { actual, scenarios } where scenarios each carry their own projected
 * tail starting from today's point, so the lines join up.
 */
function buildSeries({
  entries, settings, factor, daysInMonth, elapsedDays, operatingTotal, revenue, projectedRevenue,
  yesterday,
}) {
  if (!operatingTotal) return { actual: [], scenarios: [] };

  const firstDay = daysInMonth - operatingTotal + 1;
  const byDay = new Map(entries.map((e) => [Number(e.date.slice(8, 10)), e.revenue || 0]));
  const plan = prorate(settings, factor);
  const payAt = (r) => calculatePay(r, settings, factor).total;

  // Actual, day by day, up to today.
  const actual = [];
  let cumulative = 0;
  for (let i = 0; i < elapsedDays; i++) {
    const day = firstDay + i;
    cumulative += byDay.get(day) || 0;
    actual.push({ day, revenue: round2(cumulative), pay: payAt(cumulative) });
  }
  if (!actual.length) actual.push({ day: firstDay, revenue: 0, pay: payAt(0) });

  const today = actual[actual.length - 1];
  const daysLeft = operatingTotal - elapsedDays;
  const lastDay = firstDay + operatingTotal - 1;

  // A finish is described by the revenue it ends on; the tail is a straight
  // run from today to that number, with pay recomputed along the way.
  const tail = (endRevenue) => {
    const pts = [{ day: today.day, pay: today.pay }];
    for (let i = 1; i <= daysLeft; i++) {
      const r = today.revenue + ((endRevenue - today.revenue) * i) / daysLeft;
      pts.push({ day: today.day + i, pay: payAt(r) });
    }
    return pts;
  };

  const scenarios = [
    { key: 'current', label: 'current pace', endRevenue: round2(projectedRevenue), points: daysLeft > 0 ? tail(projectedRevenue) : [] },
  ];

  // Yesterday repeated to month end. The month average is dragged down by slow
  // days and by today, which is still being driven; yesterday is a complete
  // day and shows what the month looks like if that effort holds.
  if (yesterday && yesterday.revenue > 0 && daysLeft > 0) {
    const endRevenue = today.revenue + yesterday.revenue * daysLeft;
    scenarios.push({
      key: 'yesterday',
      label: "yesterday's pace",
      endRevenue: round2(endRevenue),
      points: tail(endRevenue),
    });
  }

  // The stretch: the next threshold that actually pays more than today's pace.
  const bestPace = Math.max(projectedRevenue, ...scenarios.map((sc) => sc.endRevenue));
  const stretch = bestPace < plan.bandEnd ? plan.bandEnd : null;
  if (stretch !== null && daysLeft > 0) {
    scenarios.push({ key: 'stretch', label: 'if you reach tier 3', endRevenue: round2(stretch), points: tail(stretch) });
  }

  for (const sc of scenarios) {
    sc.endPay = sc.points.length ? sc.points[sc.points.length - 1].pay : today.pay;
    // The share of that month's revenue the driver ends up keeping. Not the
    // tier rate — the effective rate across the whole month, which is what
    // "my commission" actually means to him.
    sc.effectiveRate = sc.endRevenue > 0 ? Math.round((sc.endPay / sc.endRevenue) * 1000) / 10 : null;
    // What the LAST rupee at that finish is worth: the tier rate he would be on.
    sc.marginalRate =
      sc.endRevenue < plan.bandStart ? 0 : sc.endRevenue < plan.bandEnd ? settings.bandRate : settings.topRate;
  }

  return { actual, scenarios, lastDay };
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
 * Return on the capital tied up in the car, against what it could have earned
 * elsewhere.
 *
 * The opportunity cost is deliberately NOT folded into running costs. Those are
 * cash leaving the account; forgone interest is not, and mixing them would make
 * the profit figure wrong for cash-flow purposes. It is shown as its own line,
 * turning accounting profit ("am I making money") into economic profit ("is
 * this better than the alternative") without conflating the two.
 *
 * Annualising one month is noisy, so the figure is labelled as coming from this
 * month's projection rather than presented as a settled return.
 */
function buildRoi({ settings, projectedProfit }) {
  const capital = Number(settings.capitalInvested) || 0;
  const ratePct = Number(settings.alternativeRatePct) || 0;
  if (capital <= 0) return null;

  // Only the unleased share is money that could have been on deposit instead.
  // The leased portion was never yours to invest — the financier put it up, and
  // you pay for that through the instalment, which is already in running costs.
  // Charging opportunity cost on the whole vehicle would bill you twice for the
  // same 40%.
  const leasedPct = clampPct(Number(settings.leasedPercent) || 0);
  const equity = round2(capital * (1 - leasedPct / 100));
  const leased = round2(capital - equity);

  const monthlyAlternative = round2((equity * (ratePct / 100)) / 12);
  const annualisedProfit = round2(projectedProfit * 12);

  return {
    capital: round2(capital),
    leasedPct,
    leased,
    equity,
    ratePct,
    monthlyAlternative,
    annualisedProfit,
    // Return on the money actually put in, not on the sticker price.
    annualisedReturnPct: equity > 0 ? Math.round((annualisedProfit / equity) * 1000) / 10 : null,
    economicProfit: round2(projectedProfit - monthlyAlternative),
  };
}

const clampPct = (n) => Math.min(100, Math.max(0, Number(n) || 0));

/** Normalise a cost line before storing it. */
function cleanCost(c) {
  const amount = toNumber(c?.amount);
  if (amount === undefined || amount < 0) return null;
  const frequency = COST_FREQUENCIES.some((f) => f.key === c.frequency) ? c.frequency : 'monthly';
  return {
    id: String(c.id || `cost-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    label: String(c.label || 'Cost').slice(0, 60),
    category: COST_CATEGORIES.some((x) => x.key === c.category) ? c.category : 'other',
    frequency,
    amount: round2(amount),
    // A one-off needs its date; a recurring cost may carry a start date so it
    // does not apply to months before it existed.
    date: /^\d{4}-\d{2}-\d{2}$/.test(c.date || '') ? c.date : null,
    // Instalments, for a lease or any other cost that ends.
    termMonths: toNumber(c.termMonths) > 0 ? Math.round(toNumber(c.termMonths)) : null,
  };
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

