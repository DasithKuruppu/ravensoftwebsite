import { money, km, duration } from '../format.js';
import { useT } from '../i18n/index.jsx';

/**
 * Which roads to take — one choice per leg.
 *
 * Shown as a price comparison, not a map preference, because on this island the
 * two are the same question: the expressway from Colombo to Ella is 314 km and
 * the coast-and-hills road is 199 km, so the faster route is also the dearer one
 * once distance is billed past an allowance. A customer with a whole day and no
 * flight to catch will often take the slow road and the saving, and they can
 * only make that choice if the saving is on the screen.
 *
 * Each leg is chosen separately: there is no reason to take the expressway home
 * just because it was taken out, and the return often has a different answer
 * because it is driven at a different hour.
 *
 * A leg with one route renders as a plain line — a picker with a single option
 * asks the customer to choose between one thing.
 */
export default function RouteChoice({ legs, onChange, currency = 'LKR' }) {
  const { t } = useT();
  const choosable = (legs || []).filter((l) => l.options?.length > 1);
  if (choosable.length === 0) return null;

  return (
    <section className="card p-5">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-500">
        {t('routes.heading', { count: legs.length })}
      </h2>
      <p className="mb-4 text-xs text-ink-500">
        {t('routes.note')}
      </p>

      <div className="space-y-5">
        {legs.map((leg) =>
          leg.options?.length > 1 ? (
            <Leg
              key={leg.key}
              leg={leg}
              currency={currency}
              multiple={legs.length > 1}
              onChange={(i) => onChange(leg.key, i)}
            />
          ) : null,
        )}
      </div>

      <p className="mt-3 text-xs text-ink-400">
        {t('routes.tollNote')}
      </p>
    </section>
  );
}

function Leg({ leg, currency, multiple, onChange }) {
  const { t } = useT();
  // Cheapest *for this leg*, holding the other leg fixed — so the "+LKR" figures
  // read as what changing this one road costs, not the whole journey.
  const cheapest = Math.min(...leg.options.map((o) => o.total));

  return (
    <div>
      {multiple && (
        <p className="mb-2 text-xs font-medium text-ink-700">
          {t(`routes.${leg.key}`)}
          <span className="font-normal text-ink-500">
            {' '}
            · {leg.from} → {leg.to}
          </span>
        </p>
      )}

      <div className="space-y-2">
        {leg.options.map((o, i) => {
          const active = leg.index === i;
          const extra = o.total - cheapest;
          return (
            <button
              key={o.id || i}
              type="button"
              onClick={() => onChange(i)}
              aria-pressed={active}
              className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                active ? 'border-brand bg-brand-soft' : 'border-line hover:border-ink-400'
              }`}
            >
              <span
                className={`mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                  active ? 'border-brand bg-brand' : 'border-ink-400'
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium">{optionLabel(t, o.label)}</span>
                  {o.avoidsHighways && (
                    <span className="pill bg-line text-ink-700">{t('routes.noExpressway')}</span>
                  )}
                </span>
                {o.via && (
                  <span className="block truncate text-xs text-ink-500">
                    {t('routes.via', { road: o.via })}
                  </span>
                )}
                <span className="block text-xs text-ink-500">
                  {t('routes.detail', { km: km(o.distanceKm), hours: duration(o.drivingHours) })}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-medium tabular-nums">{money(o.total, currency)}</span>
                {extra > 0 && (
                  <span className="block text-xs text-ink-500 tabular-nums">
                    +{money(extra, currency)}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The router names its options in English; the browser renames them. */
const OPTION_KEYS = {
  Fastest: 'routes.label.fastest',
  Shortest: 'routes.label.shortest',
  Alternative: 'routes.label.alternative',
  'Recommended route': 'routes.label.only',
  'Estimated route': 'routes.label.estimate',
};

function optionLabel(t, label) {
  const key = OPTION_KEYS[label];
  return key ? t(key) : label;
}
