/** Formatting for a customer-facing page: money, distance, hours, dates. */

const TZ = 'Asia/Colombo';

/** "LKR 31,000" — non-breaking space so the unit never wraps off its number. */
export function money(amount, currency = 'LKR') {
  const n = Math.round(Number(amount) || 0);
  return `${currency} ${n.toLocaleString('en-US')}`;
}

/** "240 km", "12.5 km" — one decimal only when it says something. */
export function km(value) {
  const n = Number(value) || 0;
  return `${n % 1 === 0 ? n : n.toFixed(1)} km`;
}

/** 10 → "10 hours", 26.5 → "1 day 2.5 hours". */
export function duration(hours) {
  const h = Math.round((Number(hours) || 0) * 4) / 4;
  if (h < 24) return `${trim(h)} ${h === 1 ? 'hour' : 'hours'}`;
  const days = Math.floor(h / 24);
  const rest = Math.round((h - days * 24) * 4) / 4;
  const dayPart = `${days} ${days === 1 ? 'day' : 'days'}`;
  return rest ? `${dayPart} ${trim(rest)} ${rest === 1 ? 'hour' : 'hours'}` : dayPart;
}

/**
 * How long the hire is, said the way it was bought.
 *
 * A week of hire is 152 hours, and `duration` would render that "6 days 8
 * hours" — arithmetically true and unrecognisable to someone who clicked "A
 * week". Past a single day the charged days are the honest unit; within one day
 * the hours still matter, because that is what the customer is choosing between.
 */
export function hireLength(basis) {
  if (!basis) return '';
  const days = Number(basis.days) || 0;
  if (days > 1) return `${days} days`;
  return duration(basis.hours);
}

/** "Thu 3 Sep, 07:30" — in Colombo time, whichever timezone the browser is in. */
export function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** "3 Sep" — for a list where the year and time would be noise. */
export function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' }).format(d);
}

/**
 * An ISO instant as the value a `datetime-local` input wants, in Colombo time.
 *
 * The input has no timezone of its own — it shows whatever local string it is
 * given — so the conversion has to happen here or a customer in another country
 * would pick 06:00 and book a car for 01:30.
 */
export function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** The inverse: a Colombo wall-clock string back to a real instant. */
export function fromLocalInput(value) {
  if (!value) return '';
  // Colombo is UTC+5:30 year round — no DST — so the offset can be stated
  // rather than discovered, and the result is exact.
  return new Date(`${value}:00+05:30`).toISOString();
}

/** The soonest start the form will accept, as a `datetime-local` min. */
export function earliestStart(noticeHours = 6) {
  return toLocalInput(new Date(Date.now() + noticeHours * 3600_000).toISOString());
}

function trim(n) {
  return String(n);
}
