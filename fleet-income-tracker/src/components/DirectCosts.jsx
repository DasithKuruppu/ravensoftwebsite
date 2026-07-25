import { money, amount } from '../format.js';

/**
 * The running costs the driver is shown — charging, by default.
 *
 * He chooses where and when to plug in, and Sri Lankan CCS2 tariffs run from
 * about 54 to 150 per kWh, so this is a number he can actually move. The rest
 * of the ledger — lease, depreciation, insurance — stays with the owner.
 *
 * Shown to both roles: the owner needs to know what the driver is being told.
 */
export default function DirectCosts({ summary }) {
  const d = summary.directCosts;
  if (!d || d.items.length === 0) return null;

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 className="label">Cost of running the car</h2>
        <span className="text-xs text-slate-500">
          <span className="num">{amount(d.kmDriven)}</span> km this month
        </span>
      </div>

      <dl className="space-y-1.5">
        {d.items.map((c) => (
          <div key={c.id} className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-slate-400">
              {c.label}
              {c.basis && <span className="text-xs text-slate-600 ml-2">{amount(c.amount)} × {c.basis}</span>}
            </dt>
            <dd className="num text-warn">{amount(c.monthly)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 border-t border-ink-800 pt-2 mt-2">
          <dt className="text-sm font-medium text-slate-300">
            Total
            {d.perKm !== null && (
              <span className="block text-xs text-slate-600">
                <span className="num">{amount(d.perKm)}</span> per km driven
              </span>
            )}
          </dt>
          <dd className="num text-lg text-warn">{money(d.total)}</dd>
        </div>
      </dl>

      {d.shareOfRevenue !== null && (
        <p className="text-xs text-slate-500 mt-3">
          That is <span className="num text-slate-300">{d.shareOfRevenue}%</span> of the revenue
          brought in this month. Charging off-peak or at a cheaper station lowers it — the map on
          this page shows the rate at each one.
        </p>
      )}
    </div>
  );
}
