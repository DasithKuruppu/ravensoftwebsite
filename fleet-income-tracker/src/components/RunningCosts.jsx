import { money, amount } from '../format.js';
import { categoryLabel } from '../../shared/costs.mjs';

/**
 * The owner's running costs and what is actually left.
 *
 * Owner-share is a gross figure — it only nets off the driver's pay. For an
 * electric fleet car the real cost of running it is large and invisible in
 * Uber's numbers, so this card is the difference between "revenue minus wages"
 * and "money I actually keep".
 *
 * Owner-only, and enforced as such by the API: on a driver token these fields
 * are absent from the payload entirely rather than merely unrendered.
 */
export default function RunningCosts({ summary }) {
  const { costs, revenue, driverPay, ownerProfit, projectedOwnerProfit, driverName } = summary;
  if (!costs) return null;

  const loss = ownerProfit < 0;

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 className="label">Running costs &amp; profit</h2>
        <span className="text-xs text-slate-400">owner only</span>
      </div>

      {costs.items.length === 0 ? (
        <p className="text-sm text-slate-400">
          No costs recorded. Add them under Settings to see what the car actually leaves you.
        </p>
      ) : (
        <dl className="space-y-1.5">
          {costs.items.map((c) => (
            <div key={c.id} className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-slate-400">
                {c.label}
                <span className="text-xs text-slate-400 ml-2">
                  {categoryLabel(c.category)}
                  {c.frequency === 'annual' && ' · yearly ÷ 12'}
                  {c.frequency === 'once' && ' · one-off'}
                  {/* "2,600 × 25 days" for a rate the ledger multiplies out;
                      just the basis for a line that is already an actual, like
                      charging once sessions have been logged. */}
                  {c.basis && (c.amount ? ` · ${amount(c.amount)} × ${c.basis}` : ` · ${c.basis}`)}
                  {c.remaining !== null && c.remaining !== undefined && ` · ${c.remaining} left`}
                </span>
              </dt>
              <dd className="num text-slate-300">{amount(c.monthly)}</dd>
            </div>
          ))}
        </dl>
      )}

      <dl className="mt-3 pt-3 border-t border-ink-800 space-y-1.5">
        {summary.uberFees && summary.uberFees.toDate !== 0 && (
          <>
            {/* Itemised: the subscription is most of it, and the rest is small
                fees and reimbursements that a single net figure hides. */}
            {(summary.uberFees.lines || []).map((line) => (
              <Row
                key={line.label}
                label={line.label}
                hint={line.kind === 'refund' ? 'refunded by Uber' : "Uber's charge"}
                value={amount(line.amount)}
                tone={line.amount < 0 ? 'text-warn' : 'text-slate-100'}
              />
            ))}
            <Row
              label={summary.uberFees.toDate < 0 ? 'Uber charges, net' : 'Uber refunds, net'}
              hint="never charged to the driver"
              value={amount(summary.uberFees.toDate)}
              tone={summary.uberFees.toDate < 0 ? 'text-warn' : 'text-slate-100'}
            />
            {(summary.uberFees.taxes || []).map((tax) => (
              <Row
                key={tax.label}
                label={tax.label}
                hint="already deducted inside revenue"
                value={amount(tax.amount)}
                tone="text-slate-400"
              />
            ))}
          </>
        )}
        {costs.chargingPerKm !== null && costs.chargingPerKm !== undefined && (
          <Row
            label="Charging per km"
            hint={`over ${amount(costs.kmDriven)} km from the tracker`}
            value={amount(costs.chargingPerKm)}
            tone="text-warn"
          />
        )}
        {costs.totalPerKm !== null && costs.totalPerKm !== undefined && (
          <Row label="All costs per km" value={amount(costs.totalPerKm)} tone="text-slate-300" />
        )}
        {/* The chain in full. "Owner share" used to sit here as an
            intermediate — revenue less driver pay — but it reads like income
            when it is really just the amount left to pay for the car with. */}
        <Row label="Revenue" value={amount(revenue)} />
        <Row label={`less ${driverName || 'driver'} pay`} value={`− ${amount(driverPay)}`} tone="text-slate-400" />
        <Row label="less running costs" value={`− ${amount(costs.total)}`} tone="text-warn" />
        <div className="flex items-baseline justify-between gap-4 border-t border-ink-800 pt-2 mt-2">
          <dt className="text-sm font-medium text-slate-300">
            {loss ? 'Shortfall this month' : 'Profit this month'}
          </dt>
          <dd className={`num text-lg ${loss ? 'text-danger' : 'text-slate-50'}`}>
            {money(ownerProfit)}
          </dd>
        </div>
        {projectedOwnerProfit !== undefined && (
          <Row
            label="Projected at month end"
            value={money(projectedOwnerProfit)}
            tone={projectedOwnerProfit < 0 ? 'text-danger' : 'text-slate-200'}
          />
        )}
      </dl>

      {loss && (
        <p className="text-xs text-warn/80 mt-3">
          Costs exceed what is left after paying {driverName || 'the driver'} this month. Annual
          items are spread across twelve months, so a part-month of revenue will always look worse
          than a full one.
        </p>
      )}
    </div>
  );
}

function Row({ label, hint, value, tone = 'text-slate-200' }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-slate-400">
        {label}
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </dt>
      <dd className={`num ${tone}`}>{value}</dd>
    </div>
  );
}
