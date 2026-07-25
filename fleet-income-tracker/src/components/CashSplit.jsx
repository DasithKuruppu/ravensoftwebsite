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
  const { revenue, cashCollected, bankCredited, cashShare, cashKnown, driverName } = summary;
  const who = driverName || 'the driver';

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
          icon={<CashIcon />}
          label={`Cash collected by ${who}`}
          hint={`held by ${who} — to hand over`}
          value={money(cashCollected)}
          tone="text-warn"
        />
        <Row
          icon={<BankIcon />}
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

// The icon is tinted to match its segment of the bar above, so a separate
// colour swatch would just be noise.
function Row({ icon, label, hint, value, tone }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-slate-400 flex items-start gap-2.5">
        {/* Icon carries the meaning at a glance; the swatch ties the row back
            to its segment of the bar above. */}
        <span className={`shrink-0 mt-0.5 ${tone}`}>{icon}</span>
        <span>
          {label}
          <span className="block text-xs text-slate-600">{hint}</span>
        </span>
      </dt>
      <dd className={`num ${tone}`}>{value}</dd>
    </div>
  );
}

const iconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

/** Banknote — physical cash in the driver's hand. */
function CashIcon() {
  return (
    <svg {...iconProps}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

/** Bank — money that lands in the company account. */
function BankIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 10h18M12 3 3 8h18z" />
      <path d="M6 10v7M10 10v7M14 10v7M18 10v7" />
      <path d="M3 20h18" />
    </svg>
  );
}
