/**
 * The charging network's session export, turned into the sessions this app
 * stores.
 *
 * The file is a WALLET statement, not an invoice: it interleaves three kinds of
 * row and only one of them is a cost.
 *
 *   COMMERCIAL_CHARGE   electricity actually bought — the only row that is a cost
 *   TOPUP               money put into the wallet
 *   TRANSFER_OUT        money moved to another wallet
 *
 * In the July file the sessions come to 2,298 and the top-ups to 32,500. Reading
 * every row as a cost would report fourteen times the real spend and wreck every
 * per-km figure on the screen, so anything that is not a charge is dropped.
 *
 * The export also ends with a block of `#` summary lines, which are not rows at
 * all.
 */

/** Rows that represent electricity bought. Everything else is wallet movement. */
const CHARGE_TYPE = 'COMMERCIAL_CHARGE';

/**
 * Columns as the export names them. Matched case-insensitively and with
 * punctuation ignored, so a later export that renames `gross_lkr` to `Gross LKR`
 * still lands.
 */
const COLUMNS = {
  timestamp: ['timestamp', 'time', 'datetime', 'startedat', 'date'],
  type: ['type', 'rowtype', 'kind'],
  station: ['chargername', 'stationname', 'station', 'chargeridname', 'location'],
  kwh: ['kwh', 'energykwh', 'energy'],
  // Gross first: it is what left the wallet. The subtotal excludes VAT, and
  // charging VAT is not reclaimable here — the driver paid the gross.
  amount: ['grosslkr', 'gross', 'amountlkr', 'amount', 'totallkr', 'total'],
  ref: ['transactionref', 'transactionid', 'sessionid', 'ref', 'id'],
};

const normalise = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** The first column whose name matches one of `names`, or null. */
function findColumn(headers, names) {
  const cleaned = headers.map(normalise);
  for (const name of names) {
    const i = cleaned.indexOf(name);
    if (i !== -1) return headers[i];
  }
  // Fall back to a contains-match, so `charger_name_full` still resolves.
  for (const name of names) {
    const i = cleaned.findIndex((h) => h.includes(name));
    if (i !== -1) return headers[i];
  }
  return null;
}

/** Map the export's headers onto the fields we need. */
export function mapChargeColumns(headers = []) {
  const out = {};
  for (const [key, names] of Object.entries(COLUMNS)) out[key] = findColumn(headers, names);
  return out;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * The calendar day a timestamp falls on, in the fleet's own timezone.
 *
 * The export stamps UTC. Colombo is +5:30, so a session at 20:30 UTC belongs to
 * the NEXT day here — read as UTC it would be filed against the wrong day, and
 * at a month boundary against the wrong month's costs.
 */
export function localDateOf(timestamp, timeZone = 'Asia/Colombo') {
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * Parse already-split CSV rows (objects keyed by header) into per-day sessions.
 *
 * Returns the sessions grouped by local date, plus a count of what was skipped
 * and why — the caller shows that, because "16 rows, 3 imported" is alarming
 * until you know the other 13 were top-ups.
 *
 * `id` is the export's own transaction reference, so importing the same file
 * twice replaces those sessions rather than doubling the day's cost.
 */
export function parseChargeRows(rows = [], { timeZone = 'Asia/Colombo' } = {}) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const col = mapChargeColumns(headers);
  const byDate = new Map();
  const skipped = { notACharge: 0, noDate: 0, noAmount: 0 };

  for (const row of rows) {
    // The trailing `# Total kWh: …` block parses as a row with one filled cell.
    const rawType = col.type ? String(row[col.type] ?? '').trim() : '';
    const firstCell = String(row[headers[0]] ?? '').trim();
    if (firstCell.startsWith('#')) continue;

    if (normalise(rawType) !== normalise(CHARGE_TYPE)) {
      skipped.notACharge += 1;
      continue;
    }

    const date = col.timestamp ? localDateOf(row[col.timestamp], timeZone) : null;
    if (!date) {
      skipped.noDate += 1;
      continue;
    }

    const amount = col.amount ? toNumber(row[col.amount]) : null;
    if (amount === null || !(amount > 0)) {
      skipped.noAmount += 1;
      continue;
    }

    const kwh = col.kwh ? toNumber(row[col.kwh]) : null;
    const ref = col.ref ? String(row[col.ref] ?? '').trim() : '';
    const session = {
      // Prefixed so an imported session is always distinguishable from one the
      // driver typed, and so two networks cannot collide on a shared reference.
      id: ref ? `csv-${ref}` : `csv-${date}-${Math.round(amount * 100)}`,
      amount: Math.round(amount * 100) / 100,
      station: col.station ? String(row[col.station] ?? '').trim().slice(0, 60) : '',
      kwh: kwh !== null && kwh > 0 ? Math.round(kwh * 100) / 100 : null,
      // Everything in this export was bought at a charging station on the
      // network's own account. Home charging is metered on the house bill and
      // never appears here, so the kind is known rather than guessed.
      type: 'fast',
    };

    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(session);
  }

  const days = [...byDate.entries()]
    .map(([date, sessions]) => ({ date, sessions }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    days,
    skipped,
    sessions: days.reduce((n, d) => n + d.sessions.length, 0),
    total: Math.round(days.reduce((sum, d) => sum + d.sessions.reduce((s, x) => s + x.amount, 0), 0) * 100) / 100,
  };
}

/**
 * Merge imported sessions into a day's existing ones.
 *
 * Sessions the driver typed are kept: he stands at the charger and may have
 * logged one the network's export does not carry. Sessions from a previous
 * import of the same rows are replaced by reference, so re-importing a file —
 * or importing an overlapping date range — cannot double a day's cost.
 */
export function mergeSessions(existing = [], imported = []) {
  const byId = new Map(imported.map((s) => [s.id, s]));
  const kept = existing.filter((s) => !byId.has(String(s?.id)));
  return [...kept, ...imported];
}
