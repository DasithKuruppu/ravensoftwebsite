import { money, km, duration, hireLength } from '../format.js';
import { useT } from '../i18n/index.jsx';
import { lineLabel, lineDetail } from '../i18n/lines.js';

/**
 * The price, and every line that made it.
 *
 * Itemised deliberately. A single large number invites a phone call asking how
 * it was arrived at; the same number with "2 days of hire" and "140 km beyond
 * the allowance" underneath answers the call before it happens, and shows the
 * customer which input to change if they want a different figure.
 */
export default function QuoteCard({ quote, route, approximate, loading, error, onBook, booking }) {
  const { t } = useT();
  if (error) {
    return (
      <div className="card border-danger/30 bg-danger/5 p-4">
        <p className="text-sm text-danger">{error}</p>
      </div>
    );
  }

  if (loading && !quote) {
    return (
      <div className="card p-5">
        <div className="h-3 w-24 rounded bg-line" />
        <div className="mt-3 h-8 w-40 rounded bg-line" />
        <div className="mt-4 space-y-2">
          <div className="h-3 w-full rounded bg-line/70" />
          <div className="h-3 w-2/3 rounded bg-line/70" />
        </div>
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="card border-dashed p-5 text-center">
        <p className="hint">{t('quote.empty')}</p>
      </div>
    );
  }

  const b = quote.basis;

  return (
    <div className={`card p-5 transition ${loading ? 'opacity-60' : ''}`}>
      <p className="text-xs uppercase tracking-wide text-ink-500">{t('quote.total')}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{money(quote.total, quote.currency)}</p>

      <p className="mt-1 text-sm text-ink-500">
        {hireLength(b)} · {km(b.distanceKm)}
        {b.nights > 0 && ` · ${t('quote.nightsAway', { count: b.nights })}`}
      </p>

      {/* When the route needs longer than the customer asked for, the extra
          hours are the single most surprising thing on this card. Say why. */}
      {b.hoursDrivenBy === 'route' && (
        <p className="mt-3 rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand-dark">
          {t('quote.stretched', {
            hours: duration(b.minimumHours),
            asked: duration(b.requestedHours),
          })}
        </p>
      )}

      {approximate && (
        <p className="mt-3 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">
          {t('quote.approximate')}
        </p>
      )}

      <ul className="mt-4 divide-y divide-line border-t border-line">
        {quote.lines.map((line) => (
          <li key={line.key} className="flex items-baseline gap-3 py-2.5">
            <div className="min-w-0">
              <p className="break-words text-sm text-ink-900">{lineLabel(t, line)}</p>
              <p className="text-xs text-ink-500">{lineDetail(t, line)}</p>
            </div>
            <p className="ml-auto shrink-0 text-sm tabular-nums">{money(line.amount, quote.currency)}</p>
          </li>
        ))}
      </ul>

      {route?.source === 'osrm' && (
        <p className="mt-3 text-xs text-ink-400">
          {t('quote.measured')}
        </p>
      )}

      {onBook && (
        <button type="button" className="btn-primary mt-5 w-full" onClick={onBook} disabled={booking || loading}>
          {booking ? 'Sending…' : cta}
        </button>
      )}
    </div>
  );
}
