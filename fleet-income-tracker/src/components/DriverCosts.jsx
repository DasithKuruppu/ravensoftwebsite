import { money, amount, rate as rateOf, count, dayLabel } from '../format.js';
import { uberCut, farePer1000, chargingLens, chargingWeek, chargingHeadline } from '../display.js';
import { useT } from '../i18n/index.jsx';

/**
 * What this month's driving cost — the driver's half of the cost picture.
 *
 * Both figures are measured. Charging is real money out of the cost ledger, and
 * Uber's cut is the Drive Pass subscription and fees straight from the payments
 * export — on this arrangement Uber charges a flat subscription rather than a
 * share of each fare, so that subscription IS its cut. A percentage would be a
 * model, and where one is configured the card says so rather than presenting an
 * assumption as confidently as a fact.
 *
 * Two costs, and only two, because these are the only two a driver-role response
 * carries: the electricity he buys, and Uber's cut of the fare. The API filters
 * cost lines against a category whitelist before they are serialised, so the
 * lease, insurance, depreciation and the revenue licence are absent from his
 * payload rather than merely unrendered here — this component could not display
 * them if it tried.
 *
 * The point of showing him any of it is that charging is the one figure he moves:
 * he picks the station and the hour, and the cheapest and dearest CCS2 tariffs
 * differ nearly threefold. Everything is stated as a fact about the month that
 * happened. Nothing here offers him money for driving down a cost — that would be
 * a pay term, and pay terms live in the plan.
 */
export default function DriverCosts({ summary }) {
  const { t, tx } = useT();
  const charging = chargingLens(summary);
  const week = chargingWeek(summary);
  const headline = chargingHeadline(summary);
  const cut = uberCut(summary);
  const split = farePer1000(summary);

  if (!charging && !cut.total) return null;

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="label">{t('costs.heading')}</h2>
        {charging && (
          <span className="text-xs text-slate-400 num">
            {amount(charging.km)} {t('unit.km')}
            {summary.directCosts?.gpsCovers > 0 && (
              <span className="text-slate-400">{t('costs.fromTracker')}</span>
            )}
          </span>
        )}
      </div>

      <dl className="mt-3 space-y-2">
        {charging && (
          <>
            {/* Per km leads on every charging display. Rupees are subtext: a
                big-rupee day after a long shift is a good day, and ranking days
                by what they cost would punish the shifts worth having. */}
            {charging.perKm !== null && (
              <Row
                label={t('costs.perKmMonth')}
                hint={t('costs.perKmMonthHint', {
                  count: charging.matchedDays,
                  estimated: charging.estimated ? t('costs.partEstimated') : '',
                })}
                value={`${rateOf(charging.perKm)}${t('unit.perKm')}`}
                tone="text-warn"
              />
            )}
            {/* The headline: the same figure the teaser on the main screen shows,
                from the same helper. */}
            {headline && headline.basis === '7d' && (
              <Row
                label={t('costs.perKm7d')}
                hint={t('costs.perKm7dHint', {
                  count: headline.matchedDays,
                  estimated: headline.estimated ? t('costs.partEstimated') : '',
                })}
                value={`${rateOf(headline.perKm)}${t('unit.perKm')}`}
                tone="text-warn"
              />
            )}
            <Row
              label={t('costs.chargingMonth')}
              hint={
                charging.modelledDays > 0
                  ? t('costs.loggedAndEstimated', {
                      logged: count(charging.loggedDays),
                      modelled: count(charging.modelledDays),
                    })
                  : t('costs.loggedDays', { count: charging.loggedDays })
              }
              value={money(charging.total)}
              tone="text-slate-100"
            />
            {/* Fast against home, indented under the month's total the way the
                cash card itemises its deductions. This is the split the driver
                can actually act on: home is roughly a third of the price
                off-peak, so a month that is mostly fast is a month with money
                left on the table. Absent until a session says which it was. */}
            {(charging.byType?.fast > 0 || charging.byType?.home > 0) && (
              <ul className="mt-1 ml-3 pl-2 border-l border-ink-700 space-y-0.5">
                {['fast', 'home', 'unknown'].map((kind) =>
                  charging.byType?.[kind] > 0 ? (
                    <li key={kind} className="flex items-baseline justify-between gap-3">
                      <span className="text-xs text-slate-400 min-w-0 truncate">
                        {t(`costs.charging.${kind}`)}
                      </span>
                      <span className="num text-xs text-slate-400 shrink-0">
                        {money(charging.byType[kind])}
                      </span>
                    </li>
                  ) : null,
                )}
              </ul>
            )}
          </>
        )}
        {cut.lines.length > 0 && (
          <>
            {/* Itemised, because "Uber took 3,018" invites the question this
                answers: a subscription, a fee, a toll handed back. Signs read as
                costs — a refund is money returned, so it shows negative. */}
            {cut.lines.map((line) => (
              <Row
                key={line.label}
                label={line.label}
                hint={t(line.kind === 'refund' ? 'costs.refundedToFleet' : 'costs.ubersCharge')}
                value={money(line.amount)}
                tone={line.kind === 'refund' ? 'text-slate-100' : 'text-warn'}
              />
            ))}
            <div className="flex items-baseline justify-between gap-4 border-t border-ink-700 pt-2 mt-2">
              <dt className="text-sm font-medium text-slate-200">{t('costs.ubersCutNet')}</dt>
              <dd className="num text-warn shrink-0">{money(cut.charges - cut.refunded)}</dd>
            </div>
          </>
        )}
        {cut.lines.length === 0 && cut.charges > 0 && (
          <Row
            label={t('costs.ubersCut')}
            hint={t('costs.ubersCutHint')}
            value={money(cut.charges)}
            tone="text-warn"
          />
        )}
        {cut.commission > 0 && (
          <Row
            label={t(cut.estimated ? 'costs.ubersShareEstimated' : 'costs.ubersShare')}
            hint={
              cut.estimated
                ? t('costs.ubersShareHintEstimated', { pct: Math.round(cut.rate * 100) })
                : t('costs.ubersShareHint', {
                    pct: Math.round(cut.rate * 100),
                    gross: amount(cut.gross),
                  })
            }
            value={money(cut.commission)}
            tone="text-warn"
          />
        )}
      </dl>

      {/* Where the fare goes, per 1,000 — the whole picture in one row of three,
          which is easier to hold than three percentages of different bases. */}
      {split && (
        <div className="mt-4 pt-3 border-t border-ink-700">
          <div className="label mb-2">
            {t(split.estimated ? 'costs.per1000Estimated' : 'costs.per1000')}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Share label={t('costs.uberTakes')} value={split.uber} tone="text-warn" />
            <Share label={t('costs.chargingTakes')} value={split.charging} tone="text-warn" />
            <Share label={t('costs.leftToSplit')} value={split.pool} tone="text-slate-100" />
          </div>
          <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
            {t('costs.restNote')}
            {split.estimated && t('costs.estimateNote')}
          </p>
        </div>
      )}

      {/* The week, day by day. Per km is the column that means something; cost
          and distance show the working, and an estimated day says so rather than
          passing a budget off as a receipt. */}
      {week && week.days.length > 0 && (
        <div className="mt-4 pt-3 border-t border-ink-700">
          <div className="label mb-2">{t('costs.last7')}</div>
          <dl className="space-y-1.5">
            {week.days.map((day) => (
              <div key={day.date} className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-slate-300 min-w-0">
                  {dayLabel(day.date)}
                  <span className="block text-xs text-slate-400 num">
                    {money(day.cost)}
                    {day.km > 0 ? ` · ${amount(day.km)} ${t('unit.km')}` : t('costs.noDistance')}
                    {day.estimated ? t('costs.estimated') : ''}
                  </span>
                </dt>
                <dd className={`num shrink-0 ${day.estimated ? 'text-slate-400' : 'text-warn'}`}>
                  {day.perKm === null ? '—' : `${rateOf(day.perKm)}${t('unit.perKm')}`}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">{t('costs.weekNote')}</p>
        </div>
      )}

      {/* Taxes Uber already took out of the fares. Not added to anything above —
          the revenue on this page is what arrived after them. */}
      {cut.taxes.length > 0 && (
        <div className="mt-4 pt-3 border-t border-ink-700">
          <div className="label mb-2">{t('costs.taxesHeading')}</div>
          <dl className="space-y-1.5">
            {cut.taxes.map((tax) => (
              <Row key={tax.label} label={tax.label} value={money(tax.amount)} tone="text-slate-100" />
            ))}
          </dl>
          <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">{t('costs.taxesNote')}</p>
        </div>
      )}

      {/* The one line about what he can change. A fact about his own month, with
          no promise attached to it. */}
      {charging && charging.perKm !== null && (
        <p className="text-sm text-slate-300 mt-4 pt-3 border-t border-ink-700 leading-relaxed">
          {tx('costs.chooseNote', {
            rate: <span className="num text-warn">{rateOf(charging.perKm)}</span>,
            reference: <span className="num">{charging.reference}</span>,
            one: <span className="num">1</span>,
            saving: <span className="num">{count(charging.perRupeePerKm)}</span>,
          })}
        </p>
      )}
    </div>
  );
}

function Share({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-950/40 px-2 py-2">
      <div className={`num text-base ${tone}`}>{amount(value)}</div>
      <div className="text-[11px] text-slate-400 leading-tight mt-0.5">{label}</div>
    </div>
  );
}

function Row({ label, hint, value, tone = 'text-slate-100' }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-slate-300 min-w-0">
        {label}
        {hint && <span className="block text-xs text-slate-400 num">{hint}</span>}
      </dt>
      <dd className={`num shrink-0 ${tone}`}>{value}</dd>
    </div>
  );
}

/**
 * The one-line teaser for the main screen.
 *
 * The main screen answers "what do I drive today"; this says the cost card
 * exists and is worth a tap, in one line and without competing for the glance.
 */
export function DriverCostsTeaser({ summary, onOpen }) {
  const { t, tx } = useT();
  // The same helper the card's headline row reads. Recomputing a rate here from
  // the month total and the month distance is how the teaser and the card came to
  // quote different figures for the same thing.
  const headline = chargingHeadline(summary);
  if (!headline) return null;
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-lg border border-ink-700 bg-ink-900 px-3.5 py-2.5"
    >
      <span className="text-sm text-slate-300 leading-relaxed">
        {tx('teaser.rate', {
          rate: <span className="num text-warn">{rateOf(headline.perKm)}</span>,
        })}
        <span className="text-slate-100 underline underline-offset-2">{t('teaser.cta')}</span>
      </span>
      <span className="block text-[11px] text-slate-400 num mt-0.5">
        {t('teaser.days', { count: headline.matchedDays })}
        {t(headline.basis === '7d' ? 'teaser.last7' : 'teaser.thisMonth')}
        {headline.estimated ? t('costs.partEstimated') : ''}
      </span>
    </button>
  );
}
