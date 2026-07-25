import { money, amount, monthLabel } from '../format.js';

/**
 * What the money sunk into the car is earning, against what it could earn
 * sitting in a fixed deposit.
 *
 * Led by the whole HOLDING PERIOD, because that is the investment question.
 * Costs that expire are levelled across it: a 73,000 lease with 57 instalments
 * left, held for ten years, really costs about 34,675 a month averaged over the
 * time the car is kept. Charging the full instalment forever would understate
 * the return on a vehicle owned outright for half its life — and charging none
 * of it would flatter the early years.
 *
 * Single months are kept alongside for contrast: this month is short and
 * prorated, next month is full but still carries the lease at full rate.
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
    r.headlineBasis === 'holding'
      ? `averaged over ${r.holdingYears} years`
      : r.headlineBasis === 'nextMonth' && r.nextMonthLabel
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
        {r.levelised && (
          <Row
            label="Running costs, levelled"
            hint={`per month across ${r.holdingYears} years`}
            value={`− ${amount(r.levelised.total)}`}
            tone="text-warn"
          />
        )}
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

      {/* Expiring costs, so the levelling is visible rather than magic. */}
      {r.levelised && (
        <div className="mt-3 pt-3 border-t border-ink-800">
          <div className="label mb-2">Costs that end</div>
          {r.levelised.items.filter((i) => i.months < r.horizonMonths).length === 0 ? (
            <p className="text-xs text-slate-600">
              None — every cost runs for the whole {r.holdingYears} years.
            </p>
          ) : (
            r.levelised.items
              .filter((i) => i.months < r.horizonMonths)
              .map((i) => (
                <p key={i.id} className="text-xs text-slate-500">
                  {i.label}: <span className="num">{amount(i.amount)}</span>/month for{' '}
                  <span className="num">{i.months}</span> more months — counted as{' '}
                  <span className="num text-slate-300">{amount(i.levelised)}</span>/month across the{' '}
                  {r.holdingYears} years.
                </p>
              ))
          )}
        </div>
      )}

      {/* Single months, for contrast — shown but not led on. */}
      <p className="text-xs text-slate-600 mt-3">
        {r.nextMonth && (
          <>
            Next month alone, still paying the full instalment, returns{' '}
            <span className="num">{r.nextMonth.returnPct}%</span>.{' '}
          </>
        )}
        {r.thisMonth && (
          <>
            This month, partial and prorated, annualises to{' '}
            <span className="num">{r.thisMonth.returnPct}%</span>.
          </>
        )}
      </p>

      {r.leasedPct > 0 && (
        <p className="text-xs text-slate-500 mt-2">
          Interest is charged only on the <span className="num">{amount(r.equity)}</span> you put
          in. The leased {r.leasedPct}% costs you the instalment, already counted in running costs.
        </p>
      )}

      <p className="text-xs text-slate-500 mt-2">
        {h.beatsAlternative
          ? `Over ${r.holdingYears} years at this rate the car beats a ${r.ratePct}% deposit.`
          : `Over ${r.holdingYears} years at this rate the capital would still earn more in a ${r.ratePct}% deposit.`}
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
