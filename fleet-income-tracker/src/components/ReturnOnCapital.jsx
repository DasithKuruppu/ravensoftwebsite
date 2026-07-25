import { money, amount } from '../format.js';

/**
 * What the money sunk into the car is earning, against what it could earn
 * sitting in a fixed deposit.
 *
 * This answers a different question from profit. Profit asks "am I making
 * money"; this asks "is this a better use of the capital than the obvious
 * alternative". Both are worth seeing, so the forgone interest is a line of its
 * own rather than being buried in running costs — it is not cash leaving the
 * account, and folding it in would make the profit figure wrong for cash flow.
 */
export default function ReturnOnCapital({ summary }) {
  const r = summary.roi;
  if (!r) {
    return (
      <div className="card">
        <h2 className="label mb-2">Return on capital</h2>
        <p className="text-sm text-slate-500">
          Enter what the vehicle cost under Settings to compare the car against a fixed deposit.
        </p>
      </div>
    );
  }

  const beatsFd = r.annualisedReturnPct >= r.ratePct;
  const tone = beatsFd ? 'text-accent' : 'text-danger';

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 className="label">Return on capital</h2>
        <span className="text-xs text-slate-500">owner only</span>
      </div>

      {/* The comparison, side by side. */}
      <div className="grid grid-cols-2 gap-3">
        <Side
          label={r.leasedPct > 0 ? 'The car, on your equity' : 'The car'}
          pct={`${r.annualisedReturnPct}%`}
          sub={`${money(summary.projectedOwnerProfit)}/month`}
          tone={tone}
          active={beatsFd}
        />
        <Side
          label={`Fixed deposit @ ${r.ratePct}%`}
          pct={`${r.ratePct}%`}
          sub={`${money(r.monthlyAlternative)}/month`}
          tone="text-slate-300"
          active={!beatsFd}
        />
      </div>

      <dl className="mt-4 space-y-1.5">
        <Row label="Vehicle value" value={amount(r.capital)} />
        {r.leasedPct > 0 && (
          <>
            <Row
              label={`Leased (${r.leasedPct}%)`}
              hint="the financier's money, not yours — paid for by the instalment"
              value={amount(r.leased)}
              tone="text-slate-500"
            />
            <Row label="Your own money in it" value={amount(r.equity)} />
          </>
        )}
        <Row
          label="Profit, annualised"
          hint="this month's projection × 12"
          value={amount(r.annualisedProfit)}
          tone={r.annualisedProfit < 0 ? 'text-danger' : 'text-slate-200'}
        />
        <Row
          label="Interest given up"
          hint="not cash — what the money could have earned"
          value={`− ${amount(r.monthlyAlternative)}`}
          tone="text-warn"
        />
        <div className="flex items-baseline justify-between gap-4 border-t border-ink-800 pt-2 mt-2">
          <dt className="text-sm font-medium text-slate-300">
            Versus leaving it in the bank
            <span className="block text-xs text-slate-600">per month</span>
          </dt>
          <dd className={`num text-lg ${r.economicProfit < 0 ? 'text-danger' : 'text-accent'}`}>
            {money(r.economicProfit)}
          </dd>
        </div>
      </dl>

      {r.leasedPct > 0 && (
        <p className="text-xs text-slate-500 mt-3">
          Interest is charged only on the <span className="num">{amount(r.equity)}</span> you put in.
          The leased {r.leasedPct}% costs you the instalment, which is already in running costs —
          counting it here too would bill it twice.
        </p>
      )}

      <p className="text-xs text-slate-500 mt-3">
        {beatsFd
          ? `The car is beating a ${r.ratePct}% deposit on the current month's run rate.`
          : `On this month's run rate the capital would earn more in a ${r.ratePct}% deposit. One partial month annualises badly — judge it over a few full months.`}
      </p>
    </div>
  );
}

function Side({ label, pct, sub, tone, active }) {
  return (
    <div
      className={`rounded-md border px-3 py-2 ${
        active ? 'border-accent/40 bg-accent/5' : 'border-ink-700 bg-ink-950/40'
      }`}
    >
      <div className="label">{label}</div>
      <div className={`num text-xl mt-1 ${tone}`}>{pct}</div>
      <div className="num text-xs text-slate-500 mt-0.5">{sub}</div>
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
