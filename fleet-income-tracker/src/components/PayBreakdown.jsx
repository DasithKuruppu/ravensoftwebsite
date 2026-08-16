import { money, amount } from '../format.js';
import { displayThreshold } from '../display.js';
import { useT } from '../i18n/index.jsx';

/**
 * The tier-by-tier breakdown of what the month has paid so far.
 *
 * The labels are rebuilt here rather than taken from the API's tier labels: the
 * API composes them from the exact prorated figures ("30% of 92.9k–116.13k"),
 * and every threshold the user reads has to be the one canonical rounded value.
 * The amounts are untouched — they are the real payout.
 *
 * Second person, and on the driver view it lives one tap deep: it explains a
 * total he has already been shown, which is a different job from telling him
 * what to drive today.
 */
export default function PayBreakdown({ summary, heading, totalLabel }) {
  const { t } = useT();
  const plan = summary.plan || {};
  const push = summary.push || {};
  const start = displayThreshold(plan.bandStart);
  const end = displayThreshold(plan.bandEnd);

  // `tier` rather than `t`: the parameter used to be called `t`, which is now
  // the translator.
  const labelFor = (tier) => {
    if (tier.key === 'base') return t('pay.base');
    if (tier.key === 'band')
      return t('pay.band', { pct: pct(push.bandRate), start: amount(start), end: amount(end) });
    if (tier.key === 'top') return t('pay.top', { pct: pct(push.topRate), end: amount(end) });
    return tier.label;
  };

  return (
    <div className="card">
      <h2 className="label">{heading ?? t('pay.heading')}</h2>
      <dl className="mt-3 space-y-2">
        {summary.tiers.map((tier) => (
          <div key={tier.key} className="flex items-baseline justify-between gap-4">
            <dt className="text-sm text-slate-300 min-w-0">
              {labelFor(tier)}
              {/* No figure here: the amount column beside it already gives the
                  base, and quoting a rounded 19,500 next to a paid 19,355 was the
                  card contradicting itself on one line. Rounding a payment up
                  flatters it; rounding it down understates it; printing it once,
                  as paid, does neither. */}
              {tier.key === 'base' && (
                <span className="text-slate-400 ml-2 text-xs">{t('pay.baseHint')}</span>
              )}
              {tier.basis > 0 && (
                <span className="num text-slate-400 ml-2 text-xs">
                  {t('pay.on', { amount: amount(tier.basis) })}
                </span>
              )}
            </dt>
            <dd className="num text-slate-100 shrink-0">{amount(tier.amount)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 border-t border-ink-700 pt-2 mt-2">
          <dt className="text-sm font-medium text-slate-200">{totalLabel ?? t('pay.total')}</dt>
          <dd className="num text-accent text-lg shrink-0">{money(summary.driverPay)}</dd>
        </div>
      </dl>
    </div>
  );
}

function pct(r) {
  return `${Math.round((r || 0) * 100)}%`;
}
