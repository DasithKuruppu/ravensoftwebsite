import { money, amount, monthLabel } from '../format.js';

/**
 * What the money sunk into the car is earning, against what it could earn
 * sitting in a fixed deposit.
 *
 * Led by NEXT month, not this one. The first month is short and prorated, so
 * annualising it exaggerates whatever it happens to show — here it reads −17.3%
 * against a full month's 0.1%. The part-month is kept alongside for contrast
 * rather than hidden, but it is not the headline.
 *
 * This answers a different question from profit. Profit asks "am I making
 * money"; this asks "is this a better use of the capital than the obvious
 * alternative". So the forgone interest is a line of its own rather than buried
 * in running costs — it is not cash leaving the account, and folding it in
 * would make the profit figure wrong for cash flow.
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

  const h = r.headline;
  const basisLabel =
    r.headlineIsNextMonth && r.nextMonthLabel
      ? `${monthLabel(`${r.nextMonthLabel}-01`)} at this rate`
      : 'this month, annualised';
  const tone = h.beatsAlternative ? 'text-accent' : 'text-danger';

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="label">Return on capital</h2>
        <span className="text-xs text-slate-500">owner only</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">based on {basisLabel}</p>

      <div className="grid grid-cols-2 gap-3">
        <Side
          label={r.leasedPct > 0 ? 'The car, on your equity' : 'The car'}
          pct={h.returnPct === null ? '—' : `${h.returnPct}%`}
          sub={`${money(h.monthlyProfit)}/month`}
          tone={tone}
          active={h.beatsAlternative}
        />
        <Side
          label={`Fixed deposit @ ${r.ratePct}%`}
          pct={`${r.ratePct}%`}
          sub={`${money(r.monthlyAlternative)}/month`}
          tone="text-slate-300"
          active={!h.beatsAlternative}
        />
      </div>

      <dl className="mt-4 space-y-1.5">
        <Row label="Vehicle value" value={amount(r.capital)} />
        {r.leasedPct > 0 && (
          <>
            <Row
              label={`Leased (${r.leasedPct}%)`}
              hint="the financier's money — paid for by the instalment"
              value={amount(r.leased)}
              tone="text-slate-500"
            />
            <Row label="Your own money in it" value={amount(r.equity)} />
          </>
        )}
        <Row
          label="Profit, annualised"
          hint={basisLabel}
          value={amount(h.annualisedProfit)}
          tone={h.annualisedProfit < 0 ? 'text-danger' : 'text-slate-200'}
        />
        <Row
          label="Interest given up"
          hint="not cash — what your own money could have earned"
          value={`− ${amount(r.monthlyAlternative)}`}
          tone="text-warn"
        />
        <div className="flex items-baseline justify-between gap-4 border-t border-ink-800 pt-2 mt-2">
          <dt className="text-sm font-medium text-slate-300">
            Versus leaving it in the bank
            <span className="block text-xs text-slate-600">per month</span>
          </dt>
          <dd className={`num text-lg ${h.economicProfit < 0 ? 'text-danger' : 'text-accent'}`}>
            {money(h.economicProfit)}
          </dd>
        </div>
      </dl>

      {/* The part-month, for contrast — shown but not led on. */}
      {r.headlineIsNextMonth && r.thisMonth && (
        <p className="text-xs text-slate-600 mt-3">
          This month, being partial and prorated, annualises to{' '}
          <span className="num">{r.thisMonth.returnPct}%</span> — which is why it is not the basis
          here.
        </p>
      )}

      {r.leasedPct > 0 && (
        <p className="text-xs text-slate-500 mt-2">
          Interest is charged only on the <span className="num">{amount(r.equity)}</span> you put
          in. The leased {r.leasedPct}% costs you the instalment, already counted in running costs.
        </p>
      )}

      <p className="text-xs text-slate-500 mt-2">
        {h.beatsAlternative
          ? `A full month at this rate beats a ${r.ratePct}% deposit.`
          : `On a full month at this rate the capital would still earn more in a ${r.ratePct}% deposit.`}
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
