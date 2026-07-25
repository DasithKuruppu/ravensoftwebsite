import { money, amount } from '../format.js';

/**
 * Cash-versus-bank reconciliation.
 *
 * Every fare is either paid in cash to the driver or charged to a card and
 * settled by Uber into the company bank account. The cash half never touches
 * the bank, so it is the amount the driver is holding and has to hand over —
 * the figure that actually needs reconciling at the end of a period.
 *
 * Both roles see this: the driver needs to know what he owes as much as the
 * owner needs to know what to collect.
 */
export default function CashSplit({ summary }) {
  const { revenue, cashCollected, bankCredited, cashShare, cashKnown } = summary;

  if (!cashKnown) {
    return (
      <div className="card">
        <h2 className="label mb-2">Cash vs bank</h2>
        <p className="text-sm text-slate-500">
          No cash figures yet. Import a payments export and map the
          “Cash collected” column, or type it in on the daily log.
        </p>
      </div>
    );
  }

  const cashPct = revenue > 0 ? Math.min(100, Math.max(0, (cashCollected / revenue) * 100)) : 0;

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 className="label">Cash vs bank</h2>
        <span className="text-xs text-slate-500">
          <span className="num">{cashShare}%</span> of revenue collected in cash
        </span>
      </div>

      {/* One bar, split at the cash share. */}
      <div className="flex h-3 rounded-full overflow-hidden bg-ink-950 border border-ink-800">
        <div className="bg-warn/70" style={{ width: `${cashPct}%` }} />
        <div className="flex-1 bg-accent/60" />
      </div>

      <dl className="mt-4 space-y-2">
        <Row
          swatch="bg-warn/70"
          label="Cash collected by driver"
          hint="held by the driver — to hand over"
          value={money(cashCollected)}
          tone="text-warn"
        />
        <Row
          swatch="bg-accent/60"
          label="Credited to company bank"
          hint="settled by Uber"
          value={money(bankCredited)}
          tone="text-accent"
        />
        <div className="flex items-baseline justify-between gap-4 border-t border-ink-800 pt-2 mt-2">
          <dt className="text-sm font-medium text-slate-300">Gross revenue</dt>
          <dd className="num text-slate-200">{amount(revenue)}</dd>
        </div>
      </dl>
    </div>
  );
}

function Row({ swatch, label, hint, value, tone }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-slate-400 flex items-baseline gap-2">
        <span className={`inline-block w-2.5 h-2.5 rounded-sm shrink-0 ${swatch}`} />
        <span>
          {label}
          <span className="block text-xs text-slate-600">{hint}</span>
        </span>
      </dt>
      <dd className={`num ${tone}`}>{value}</dd>
    </div>
  );
}
