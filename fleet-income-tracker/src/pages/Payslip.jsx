import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, amount, count, monthLabel, dayLabel, dateLabel, generatedAt } from '../format.js';
import { driverNameIn, cashPocket, payAt } from '../display.js';
import { useT } from '../i18n/index.jsx';

/**
 * The driver's payslip, for the month to date.
 *
 * Monthly, not daily, because that is what the pay actually is: the base and
 * both tier rates are monthly terms, so "today's pay" could only ever be a
 * share of a monthly calculation dressed up as something earned in a day.
 *
 * Two movements, never netted:
 *
 *   1. his pay, in full, to his bank;
 *   2. the cash he is carrying, back to the fleet.
 *
 * Netting them would produce one small transfer and no record of either half.
 * Kept apart, each side has a figure it can check — his bank statement should
 * show the whole of what this page says he earned, and the cash he hands over
 * should match what it says he holds.
 *
 * Printable rather than a generated PDF: the browser's own Save-as-PDF is one
 * tap on the phone he already has, needs no library in the bundle, and — the
 * deciding reason — keeps the document as real text, so it stays in Sinhala.
 * A PDF library would need an embedded Sinhala font to render his own name.
 */
export default function Payslip({ month }) {
  const { t } = useT();
  const [summary, setSummary] = useState(null);
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState('');

  // Both: the summary carries the pay arithmetic, the entries carry the days it
  // was earned over. A payslip that states a total without the days behind it
  // asks to be taken on trust.
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.summary(month), api.entries(month)])
      .then(([s, e]) => {
        if (cancelled) return;
        setSummary(s);
        setEntries(e.entries || []);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [month]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!summary) return <p className="text-sm text-slate-400">{t('payslip.loading')}</p>;

  const pocket = cashPocket(summary, null);
  // Days with something to show: one that earned, or one deliberately taken off.
  // A day nobody has entered anything for is not a fact about the month.
  const days = [...entries]
    .filter((e) => e.offDay || (e.revenue || 0) > 0 || (e.trips || 0) > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const worked = days.filter((d) => !d.offDay).length;
  const off = days.filter((d) => d.offDay).length;
  const name = driverNameIn(summary) || t('cash.driver');
  // The window the month's terms were struck over. In the month he starts, the
  // thresholds and the base are prorated to the days from his start date — so a
  // statement quoting a 92,000 band without saying it covers twelve days looks
  // like a different contract from last month's.
  const period = servicePeriod(summary);
  const gross = Math.round(summary.driverPay || 0);
  // Everything he is carrying: the month's cash fares plus any float, less what
  // he spent out of it and what he has already handed back.
  const owed = Math.max(0, Math.round(pocket?.holding ?? 0));

  return (
    <div className="payslip">
      {/* Screen-only: the button is chrome, and chrome has no place on a
          document somebody is about to print or file. */}
      <div className="no-print flex items-center justify-between gap-3 flex-wrap mb-4">
        <p className="text-xs text-slate-400">{t('payslip.printHint')}</p>
        <button className="btn btn-primary" onClick={() => window.print()}>
          {t('payslip.print')}
        </button>
      </div>

      <article className="card print-plain">
        <header className="flex items-baseline justify-between gap-4 flex-wrap border-b border-ink-700 pb-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-100">{t('payslip.heading')}</h1>
            <p className="text-sm text-slate-400">{monthLabel(`${summary.month}-01`)}</p>
            <p className="text-xs text-slate-400 num mt-0.5">
              {t('payslip.period', {
                from: dateLabel(period.from),
                to: dateLabel(period.to),
              })}
              {' · '}
              {t('payslip.operatingDays', { count: period.days })}
            </p>
            {period.partial && (
              <p className="text-xs text-warn mt-0.5">
                {t('payslip.partial', { date: dateLabel(period.from) })}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-100">{name}</p>
            {/* When the document was produced. A statement without one cannot
                be told apart from an earlier print of the same month, and this
                is a month-to-date figure that moves every day. */}
            <p className="text-xs text-slate-400 num">
              {t('payslip.generated', { at: generatedAt() })}
            </p>
          </div>
        </header>

        {/* What the month did. The pay below is derived from this one figure, so
            it leads. */}
        <Section title={t('payslip.work')}>
          <Line label={t('payslip.revenue')} value={money(summary.revenue)} />
          <Line label={t('payslip.trips')} value={count(summary.trips)} />
          <Line
            label={t('payslip.daysWorked')}
            value={count(summary.earningDays)}
            hint={summary.offDaysElapsed > 0 ? t('payslip.daysOff', { count: summary.offDaysElapsed }) : null}
          />
        </Section>

        {/* Tier by tier, so the total is arithmetic he can follow rather than a
            number handed down. */}
        <Section title={t('payslip.howItAddsUp')}>
          {(summary.tiers || []).map((tier) => (
            <Line
              key={tier.key}
              label={tierLabel(tier, summary, t)}
              hint={tier.basis > 0 ? t('pay.on', { amount: amount(tier.basis) }) : null}
              value={money(tier.amount)}
            />
          ))}
          <Line label={t('payslip.gross')} value={money(gross)} strong />
        </Section>

        {/* Movement one. */}
        <Section title={t('payslip.toBank')}>
          <Line label={t('payslip.bankAmount')} value={money(gross)} strong accent />
          <p className="text-xs text-slate-400 mt-1">{t('payslip.bankNote')}</p>
        </Section>

        {/* Movement two, and the reason the first is not reduced by it. */}
        {owed > 0 && (
          <Section title={t('payslip.cashOwed')}>
            <Line label={t('cash.collectedShort')} value={money(pocket.cashIn)} />
            {pocket.startingFloat > 0 && (
              <Line label={t('cash.startingFloat')} value={`+ ${money(pocket.startingFloat)}`} />
            )}
            {pocket.cashExpenses > 0 && (
              <Line label={t('cash.cashExpenses')} value={`− ${money(pocket.cashExpenses)}`} />
            )}
            {pocket.handedOver > 0 && (
              <Line label={t('cash.handedOver')} value={`− ${money(pocket.handedOver)}`} />
            )}
            <Line label={t('payslip.owedNow')} value={money(owed)} strong warn />
            <p className="text-xs text-slate-400 mt-1">{t('payslip.cashNote')}</p>
          </Section>
        )}

        {/* Every day of the month that has anything to say: what was driven, or
            that it was taken off. The totals above are the sum of this column,
            so the document proves itself rather than asserting a figure. */}
        {days.length > 0 && (
          <Section title={t('payslip.dayByDay')}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th text-left">{t('payslip.col.day')}</th>
                    <th className="th text-right">{t('payslip.col.trips')}</th>
                    <th className="th text-right">{t('payslip.col.revenue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.date} className={d.offDay ? 'text-slate-400' : ''}>
                      <td className="td num whitespace-nowrap">
                        {dayLabel(d.date)}
                        {d.offDay && (
                          <span className="ml-2 text-[11px] uppercase border border-ink-700 rounded px-1">
                            {t('payslip.off')}
                          </span>
                        )}
                      </td>
                      <td className="td num text-right">{d.offDay ? '—' : count(d.trips ?? 0)}</td>
                      <td className="td num text-right text-slate-100">
                        {d.offDay ? '—' : amount(d.revenue || 0)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="td text-sm font-medium text-slate-200">
                      {t('payslip.totals', { worked: count(worked), off: count(off) })}
                    </td>
                    <td className="td num text-right font-medium">{count(summary.trips)}</td>
                    <td className="td num text-right font-medium text-slate-100">
                      {amount(summary.revenue)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>
        )}

        <footer className="border-t border-ink-700 mt-4 pt-3 space-y-1">
          <p className="text-xs text-slate-400">{t('payslip.footer')}</p>
          {/* What the payment IS. The page is otherwise shaped like a payslip,
              and a payslip is an employment artefact — one line of plain fact so
              the form of the document is not mistaken for the nature of the
              arrangement. */}
          <p className="text-xs text-slate-500">{t('payslip.contractNote')}</p>
        </footer>
      </article>
    </div>
  );
}

/**
 * The days this month's terms cover.
 *
 * Normally the whole month. In the month he starts, it runs from his start date
 * — and that is exactly the month where the figures need explaining, because the
 * base and both thresholds have been scaled down to fit it.
 */
function servicePeriod(summary) {
  const [year, month] = summary.month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEnd = `${summary.month}-${String(lastDay).padStart(2, '0')}`;
  const partial = (summary.prorationFactor ?? 1) < 1;
  const started = partial && summary.startDate?.slice(0, 7) === summary.month;
  return {
    from: started ? summary.startDate : `${summary.month}-01`,
    to: monthEnd,
    days: summary.operatingDays || lastDay,
    partial,
  };
}

/** "30% of 240,000–300,000" — the same wording the pay card uses. */
function tierLabel(tier, summary, t) {
  const plan = summary.plan || {};
  const push = summary.push || {};
  const pct = (r) => `${Math.round((r || 0) * 100)}%`;
  if (tier.key === 'base') return t('pay.base');
  if (tier.key === 'band')
    return t('pay.band', {
      pct: pct(push.bandRate),
      start: amount(plan.bandStart),
      end: amount(plan.bandEnd),
    });
  if (tier.key === 'top') return t('pay.top', { pct: pct(push.topRate), end: amount(plan.bandEnd) });
  return tier.label;
}

function Section({ title, children }) {
  return (
    <section className="mt-4">
      <h2 className="label mb-2">{title}</h2>
      <dl className="space-y-1.5">{children}</dl>
    </section>
  );
}

function Line({ label, hint, value, strong, accent, warn }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${
        strong ? 'border-t border-ink-700 pt-2 mt-1' : ''
      }`}
    >
      <dt className={strong ? 'text-sm font-medium text-slate-200' : 'text-sm text-slate-300'}>
        {label}
        {hint && <span className="block text-xs text-slate-400 num">{hint}</span>}
      </dt>
      <dd
        className={`num shrink-0 ${
          accent ? 'text-accent text-lg' : warn ? 'text-warn text-lg' : 'text-slate-100'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
