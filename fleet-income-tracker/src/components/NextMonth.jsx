import { money, amount, monthLabel } from '../format.js';

/**
 * Next month at the average daily pace.
 *
 * The first month is short, prorated and unrepresentative — judging the
 * arrangement on it means judging it on its worst case. Next month runs on full
 * bands, so this is the figure that says whether the thing actually works.
 *
 * Both roles see the revenue and take-home; only the owner sees costs and
 * profit, and the API omits those fields for a driver token rather than relying
 * on this component to hide them.
 */
export default function NextMonth({ summary, isOwner }) {
  const n = summary.nextMonth;
  if (!n) return null;

  const tierLabel = n.reachesTop ? 'tier 3' : n.reachesBand ? 'tier 2' : 'base only';
  const tierTone = n.reachesTop ? 'text-accent' : n.reachesBand ? 'text-warn' : 'text-slate-400';

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="label">{monthLabel(`${n.month}-01`.slice(0, 10))} at this rate</h2>
        <span className="text-xs text-slate-500">
          full month · <span className="num">{n.days}</span> days · full bands
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        <span className="num">{amount(n.dailyRate)}</span>/day carried forward. This month is
        partial and prorated, so it is not a fair guide.
      </p>

      <dl className="space-y-1.5">
        <Row label="Revenue" value={money(n.revenue)} />
        <Row
          label="Reaches"
          value={tierLabel}
          tone={tierTone}
          hint={`band starts ${amount(n.plan.bandStart)}, top tier ${amount(n.plan.bandEnd)}`}
        />
        <Row
          label={`${summary.driverName || 'Driver'} take-home`}
          value={money(n.driverPay)}
          tone="text-accent"
        />

        {isOwner && n.costs && (
          <>
            <Row
              label="Running costs"
              hint={`${amount(n.kmDriven)} km projected`}
              value={`− ${amount(n.costs.total)}`}
              tone="text-warn"
            />
            <div className="flex items-baseline justify-between gap-4 border-t border-ink-800 pt-2 mt-2">
              <dt className="text-sm font-medium text-slate-300">
                {n.ownerProfit < 0 ? 'Shortfall' : 'Profit'}
              </dt>
              <dd className={`num text-lg ${n.ownerProfit < 0 ? 'text-danger' : 'text-accent'}`}>
                {money(n.ownerProfit)}
              </dd>
            </div>
          </>
        )}
      </dl>

      <p className="text-xs text-slate-600 mt-3">
        Assumes every day is driven — days off are not knowable ahead, so treat this as the ceiling.
      </p>
    </div>
  );
}

function Row({ label, hint, value, tone = 'text-slate-200' }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-slate-400">
        {label}
        {hint && <span className="block text-xs text-slate-600">{hint}</span>}
      </dt>
      <dd className={`num ${tone}`}>{value}</dd>
    </div>
  );
}
