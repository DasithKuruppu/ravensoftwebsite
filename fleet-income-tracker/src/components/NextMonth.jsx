import { useState } from 'react';
import { money, amount, monthLabel } from '../format.js';
import { categoryLabel } from '../../shared/costs.mjs';

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
  // Open by default. Collapsing it hid the one part of the forecast worth
  // arguing with — a projected cost is an assumption, and an assumption you
  // cannot see is one you cannot correct. It still folds away.
  const [showCosts, setShowCosts] = useState(true);
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
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-slate-400">
                <button
                  type="button"
                  className="text-left hover:text-slate-200 transition-colors"
                  onClick={() => setShowCosts((v) => !v)}
                  aria-expanded={showCosts}
                >
                  Running costs{' '}
                  <span className="text-slate-600 text-xs">
                    {showCosts ? '▾' : '▸'} {n.costs.items.length} item
                    {n.costs.items.length === 1 ? '' : 's'}
                  </span>
                </button>
                <span className="block text-xs text-slate-600">
                  {amount(n.kmDriven)} km projected
                </span>
              </dt>
              <dd className="num text-warn">− {amount(n.costs.total)}</dd>
            </div>

            {/* Same shape as the running-costs card for this month, so the two
                read as the same ledger at two dates. Each line shows what it
                was multiplied by — a per-km cost next month is a projection of
                distance as much as of price. */}
            {showCosts && (
              <div className="pl-3 border-l border-ink-800 space-y-1.5 py-1">
                {n.costs.items.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No costs recorded. Add them under Settings.
                  </p>
                ) : (
                  n.costs.items.map((c) => (
                    <div key={c.id} className="flex items-baseline justify-between gap-4">
                      <dt className="text-xs text-slate-500">
                        {c.label}
                        <span className="text-slate-600 ml-2">
                          {categoryLabel(c.category)}
                          {c.frequency === 'annual' && ' · yearly ÷ 12'}
                          {c.frequency === 'once' && ' · one-off'}
                          {c.basis && ` · ${amount(c.amount)} × ${c.basis}`}
                          {c.remaining !== null &&
                            c.remaining !== undefined &&
                            ` · ${c.remaining} left`}
                        </span>
                      </dt>
                      <dd className="num text-xs text-slate-400">{amount(c.monthly)}</dd>
                    </div>
                  ))
                )}
              </div>
            )}
            {n.uberFees !== undefined && n.uberFees !== 0 && (
              <Row
                label={n.uberFees < 0 ? 'Uber charges' : 'Uber refunds'}
                hint="at this month's rate — subscriptions and fees"
                value={amount(n.uberFees)}
                tone={n.uberFees < 0 ? 'text-warn' : 'text-accent'}
              />
            )}
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
