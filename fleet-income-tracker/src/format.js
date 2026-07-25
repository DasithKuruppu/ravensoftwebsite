/** Currency + number formatting. Everything money-shaped goes through here. */

const lkr = new Intl.NumberFormat('en-LK', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const plain = new Intl.NumberFormat('en-LK', { maximumFractionDigits: 0 });

/** "LKR 121,394.60" — non-breaking space so the unit never wraps off its number. */
export function money(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return 'LKR\u00a0—';
  return `LKR\u00a0${lkr.format(n)}`;
}

/** "121,394.60" — for table cells where the LKR prefix would be noise. */
export function amount(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return lkr.format(n);
}

/** "406,789" */
export function count(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return plain.format(n);
}

export function km(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${lkr.format(n)} km`;
}

export function pct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

/** "March 2026" */
export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function currentMonth() {
  return todayLocal().slice(0, 7);
}

/** Today in Asia/Colombo, matching how the API decides the current month. */
export function todayLocal() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function dayLabel(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * "just now" / "12 min ago" / "3 h ago" / "2 d ago", plus the age in minutes so
 * the caller can decide what counts as stale — 30 minutes is old for a GPS
 * position, but perfectly normal for an import.
 *
 * Accepts either an ISO timestamp or an age already measured in seconds: the
 * GPS portal reports against its own clock, so ages there are computed there
 * and passed through rather than recomputed against ours.
 */
export function ago(iso, ageSeconds) {
  let ms;
  if (ageSeconds !== null && ageSeconds !== undefined) ms = ageSeconds * 1000;
  else if (iso) ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return { text: 'time unknown', minutes: null };

  const minutes = Math.round(ms / 60000);
  const text =
    minutes < 1
      ? 'just now'
      : minutes < 60
        ? `${minutes} min ago`
        : minutes < 1440
          ? `${Math.round(minutes / 60)} h ago`
          : `${Math.round(minutes / 1440)} d ago`;
  return { text, minutes };
}

/** Full local date and time, for the tooltip behind a relative time. */
export function stamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
