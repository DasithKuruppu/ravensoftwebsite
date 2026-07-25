import { money, amount } from '../format.js';

/**
 * The running costs the driver is shown — charging, by default.
 *
 * He chooses where and when to plug in, and Sri Lankan CCS2 tariffs run from
 * about 54 to 150 per kWh, so this is a number he can actually move. The rest
 * of the ledger — lease, depreciation, insurance — stays with the owner.
 *
 * Driver-only. The owner already sees charging inside the full cost ledger, so
 * showing this to him as well was duplication that made it read as an owner
 * card rather than the driver's.
 */
export default function DirectCosts({ summary }) {
  const d = summary.directCosts;
  if (!d || d.items.length === 0) return null;

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 className="label">Charging / electricity</h2>
        <span className="text-xs text-slate-500">
          <span className="num">{amount(d.kmDriven)}</span> km this month
          {d.gpsCovers > 0 && <span className="text-slate-600"> · from the tracker</span>}
        </span>
      </div>

      {/* The headline is the per-km rate: it is the figure that survives a
          quiet month or a busy one, and the one a cheaper station moves. */}
      {d.perKm !== null && (
        <div className="flex items-baseline gap-2 mb-3">
          <span className="num text-2xl text-warn">{amount(d.perKm)}</span>
          <span className="text-slate-300">per km driven</span>
          <span className="text-xs text-slate-500">
            — {money(d.total)} over <span className="num">{amount(d.kmDriven)}</span> km
          </span>
        </div>
      )}

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
          <dt className="text-sm font-medium text-slate-300">Total this month</dt>
          <dd className="num text-lg text-warn">{money(d.total)}</dd>
        </div>
      </dl>

      {d.shareOfRevenue !== null && (
        <p className="text-xs text-slate-500 mt-3">
          That is <span className="num text-slate-300">{d.shareOfRevenue}%</span> of the revenue
          brought in this month — the electricity cost of the driving behind it. Charging off-peak
          or at a cheaper station lowers it; the map at the bottom of this page shows the rate at
          every station.
        </p>
      )}
    </div>
  );
}
