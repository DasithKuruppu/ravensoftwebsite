/**
 * Currency + number formatting. Everything money-shaped goes through here.
 *
 * Digits stay Latin in both languages. A Sinhala-reading driver reads 121,395
 * exactly as fast as an English-reading one — Sinhala has no separate digit set
 * in daily use, and the numeric keyboard he types a handover into has none
 * either. What does move is every word attached to a number: the currency, the
 * unit, the month, the weekday, and "3 h ago". Those come from the dictionary,
 * which is why this module reads the locale directly.
 */
import { translate, getLocale } from './i18n/i18n.js';

const lkr = new Intl.NumberFormat('en-LK', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const plain = new Intl.NumberFormat('en-LK', { maximumFractionDigits: 0 });

/** "LKR" / "රු" — the unit that precedes an amount. */
const unit = () => translate('unit.currency');

/**
 * Money is shown in whole rupees.
 *
 * Nobody drives for sixty cents, and "121,394.60" spends two glyphs of
 * precision that nothing on the dashboard can act on while making every figure
 * slower to read. The cents survive only where they actually settle — cash the
 * driver is holding and has to hand over, and the owner's reconciliation views
 * — which call `moneyExact` / `amountExact` instead. The rounding is
 * display-only: every calculation still runs on the exact value, and this is
 * the last step before the glass.
 */

/** "LKR 121,395" — non-breaking space so the unit never wraps off its number. */
export function money(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return `${unit()}\u00a0—`;
  return `${unit()}\u00a0${plain.format(n)}`;
}

/** "121,395" — for table cells where the LKR prefix would be noise. */
export function amount(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return plain.format(n);
}

/** "LKR 121,394.60" — settlement and reconciliation only. */
export function moneyExact(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return `${unit()}\u00a0—`;
  return `${unit()}\u00a0${lkr.format(n)}`;
}

/** "121,394.60" — the same, without the unit. */
export function amountExact(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return lkr.format(n);
}

/**
 * A per-unit rate — cost per km, revenue per trip. Two decimals, because these
 * are small numbers where the second digit is a real difference: 34.20 per km
 * against 34.90 is 2% of a month's charging.
 */
export function rate(n) {
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
  return `${lkr.format(n)} ${translate('unit.km')}`;
}

export function pct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

/**
 * "March 2026" / "මාර්තු 2026"
 *
 * Assembled from the dictionary rather than handed to `Intl` with an `si-LK`
 * locale. Two reasons: the English output has to stay byte-identical (its shape
 * is asserted elsewhere and read by the owner), and Sinhala month names are the
 * one place where the transliterated form everyone uses differs from what the
 * CLDR data would give us.
 */
export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${translate(`month.${m}`)} ${y}`;
}

/** "March" — the month on its own, for "Full plan from March". */
export function monthName(month) {
  const [, m] = month.split('-').map(Number);
  return translate(`month.${m}`);
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

/**
 * The moment a document was produced: "31 Jul 2026, 17:42".
 *
 * Colombo time, like every other date the app decides, so a statement generated
 * at 00:30 local is not stamped with yesterday from a UTC clock. The clock is
 * 24-hour and the digits Latin in both languages — the month name is the only
 * part that translates, which is the same rule the rest of the app follows.
 *
 * Separate from `stamp` below, which hands the job to `toLocaleString` with an
 * `si-LK` locale. That is right for a tooltip but wrong here: it would print
 * CLDR's Sinhala month names, and `monthLabel` exists precisely because those
 * differ from the transliterated forms everyone actually uses. A document should
 * spell the month the way the rest of the app does.
 *
 * `at` is injectable so the stamp can be tested rather than depending on when
 * the suite happens to run.
 */
export function generatedAt(at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  return `${dateLabel(date)} ${get('year')}, ${get('hour')}:${get('minute')}`;
}

/** "Mon, 21 Jul" / "සඳු, 21 ජූලි" */
export function dayLabel(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return `${translate(`weekday.${d.getUTCDay()}`)}, ${dateLabel(date)}`;
}

/**
 * "21 Jul" — the same date without its weekday.
 *
 * Its own function rather than a regex over `dayLabel`: the partial-month banner
 * used to strip the weekday with a leading-word-character pattern, and a word
 * character matches no Sinhala letter at all, so that line would have kept its
 * weekday in one language and lost it in the other.
 *
 * The two halves are ordered by `format.dateLabel` rather than hardcoded here:
 * Sinhala reads the month first ("ජූලි 21"), English the day.
 */
export function dateLabel(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const day = String(d.getUTCDate()).padStart(2, '0');
  return translate('format.dateLabel', {
    day,
    month: translate(`monthShort.${d.getUTCMonth() + 1}`),
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
  if (!Number.isFinite(ms)) return { text: translate('time.unknown'), minutes: null };

  const minutes = Math.round(ms / 60000);
  const text =
    minutes < 1
      ? translate('time.justNow')
      : minutes < 60
        ? translate('time.minutes', { count: minutes })
        : minutes < 1440
          ? translate('time.hours', { count: Math.round(minutes / 60) })
          : translate('time.days', { count: Math.round(minutes / 1440) });
  return { text, minutes };
}

/** Full local date and time, for the tooltip behind a relative time. */
export function stamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(getLocale() === 'si' ? 'si-LK' : undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
}
