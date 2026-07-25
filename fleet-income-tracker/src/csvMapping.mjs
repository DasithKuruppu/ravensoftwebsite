/**
 * Deciding which day a row of an Uber export belongs to.
 *
 * A day's income is the income from the trips that STARTED that day. A trip
 * requested at 23:40 and dropped off at 00:20 earns its fare on the day the
 * driver went out for it, and the driver's own sense of "what did I make
 * yesterday" works the same way. Dating that fare by its drop-off or by the
 * moment Uber posted the payment moves it to the next day, which quietly
 * understates one day and inflates the next — and, near a month boundary,
 * moves revenue between commission months.
 *
 * Two mechanisms keep attribution on the trip start:
 *
 *   1. Column choice. The trip activity export carries "Trip request time";
 *      never date a row by a drop-off or completion column, even when it is the
 *      only date-shaped column in the file.
 *   2. Trip ID lookup. The payments export has no start time at all — its only
 *      timestamp is when the transaction was posted — but it does carry a Trip
 *      UUID. Start dates learned from a trip activity import are remembered, so
 *      a payment can be dated by the trip it paid for rather than by when it
 *      settled.
 */

/**
 * Columns that describe when a trip ENDED or when money moved, rather than when
 * the trip began. Never a valid basis for attributing a day's income.
 */
export const END_TIME_COLUMN = /(drop-?off|dropoff|complet|arriv|finish|\bend(ed|s|ing)?\b)/i;

/**
 * Columns that genuinely record when a trip BEGAN. Only these may teach the
 * trip-start lookup: the payments export's "vs reporting" is date-shaped and is
 * not an end-of-trip column, but it is when the money was posted, so learning
 * start times from it would file the very fares this module exists to place
 * correctly under the settlement day instead.
 */
export const START_TIME_COLUMN = /(request time|pick-?up time|trip date|\bstart)/i;

/** Columns holding a trip identifier, used to look up a remembered start date. */
export const TRIP_ID_HINTS = ['trip uuid', 'trip id'];

/** Cap on the remembered lookup, so a long history cannot fill localStorage. */
export const MAX_REMEMBERED_TRIPS = 20000;

/**
 * The date part of an Uber timestamp.
 *
 * Formats seen: "2026-07-25 09:32:39" (trip activity) and
 * "2026-07-20 12:11:07.293 +0530 +0530" (payments). Both are already in the
 * fleet's local time, so the leading date is taken as-is rather than being put
 * through Date parsing, which would shift it by the viewer's timezone.
 */
export function datePart(value) {
  const raw = String(value ?? '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return '';
}

/**
 * Trip ID → start date, learned from any file that carries both.
 *
 * Only a real start-time column is accepted as a source; anything else is
 * ignored, so a payments import cannot poison the lookup with settlement dates.
 *
 * Returns a new object rather than mutating, and drops the oldest keys once the
 * cap is hit — a fleet running for years would otherwise accumulate a lookup
 * far larger than the months anyone still looks at.
 */
export function rememberTripStarts(existing, rows, { tripIdColumn, dateColumn }) {
  if (!tripIdColumn || !dateColumn) return existing || {};
  if (!START_TIME_COLUMN.test(dateColumn)) return existing || {};

  const next = { ...(existing || {}) };
  for (const row of rows || []) {
    const id = String(row[tripIdColumn] ?? '').trim();
    const date = datePart(row[dateColumn]);
    if (!id || !date) continue;
    // Re-inserting moves the key to the end, so the pruning below drops the
    // least recently seen rather than an arbitrary one.
    delete next[id];
    next[id] = date;
  }

  const keys = Object.keys(next);
  if (keys.length > MAX_REMEMBERED_TRIPS) {
    for (const key of keys.slice(0, keys.length - MAX_REMEMBERED_TRIPS)) delete next[key];
  }
  return next;
}

/**
 * Which day a row belongs to, and how that was decided.
 *
 * A known trip start always wins over the row's own timestamp: on the trip
 * activity export the two agree, and on the payments export the remembered
 * start is the only thing that knows when the trip actually began.
 */
export function resolveRowDate(row, { mapping, tripStarts, fallbackDate }) {
  const id = mapping.tripId ? String(row[mapping.tripId] ?? '').trim() : '';
  const known = id ? tripStarts?.[id] : null;
  if (known) return { date: known, basis: 'tripStart' };

  if (mapping.date) {
    const date = datePart(row[mapping.date]);
    if (date) return { date, basis: id ? 'timestampUnmatched' : 'timestamp' };
    return { date: '', basis: 'unreadable' };
  }

  return { date: fallbackDate || '', basis: 'fallback' };
}

/**
 * Guess a column for a field from its header name.
 *
 * `exclude` is what keeps a generic hint off the wrong column: without it the
 * "date" hint will happily settle on "Trip drop-off time" in a file that has no
 * request time, which is exactly the misattribution this module exists to
 * prevent.
 */
export function guessColumn(field, columns, sampleRow, { skip } = {}) {
  const eligible = columns.filter(
    (c) =>
      !skip?.test(c) &&
      !field.exclude?.test(c) &&
      (!field.numeric || looksNumeric(sampleRow?.[c])),
  );

  // Hints run most- to least-specific; the first hit wins. Matching starts at a
  // word boundary so "count" cannot match inside "Bank Account", while
  // "earning" still hits "Your earnings".
  for (const hint of field.hints || []) {
    const re = new RegExp(`\\b${hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    const hit = eligible.find((c) => re.test(c));
    if (hit) return hit;
  }
  return '';
}

/**
 * A numeric field must never auto-map to a column of identifiers. "Trip UUID"
 * matches a naive "trip" hint and would be parsed into a nonsense trip count,
 * so candidates are checked against a real value from the file first.
 */
export function looksNumeric(sample) {
  if (sample === undefined || sample === null) return false;
  const raw = String(sample).trim();
  if (!raw) return false;
  // Tolerate a currency prefix, but any other letter means this is an
  // identifier, a plate, a status or a timestamp — never a measure.
  const withoutCurrency = raw.replace(/^(lkr|rs\.?|usd|\$|₨)\s*/i, '');
  if (/[a-z]/i.test(withoutCurrency)) return false;
  return /^-?\d+(\.\d+)?$/.test(withoutCurrency.replace(/[,\s]/g, ''));
}

/** Does this column's sample value look like a date at all? */
export function looksDateLike(sample) {
  return Boolean(datePart(sample));
}
