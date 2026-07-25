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
