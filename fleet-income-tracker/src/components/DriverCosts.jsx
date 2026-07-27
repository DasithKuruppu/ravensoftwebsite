import { money, amount, rate as rateOf, count, dayLabel } from '../format.js';
import { uberCut, farePer1000, chargingLens, chargingWeek, chargingHeadline } from '../display.js';

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
  const charging = chargingLens(summary);
  const week = chargingWeek(summary);
  const headline = chargingHeadline(summary);
  const cut = uberCut(summary);
  const split = farePer1000(summary);

  if (!charging && !cut.total) return null;

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="label">What this month's driving cost</h2>
        {charging && (
          <span className="text-xs text-slate-400 num">
            {amount(charging.km)} km
            {summary.directCosts?.gpsCovers > 0 && (
              <span className="text-slate-400"> · from the tracker</span>
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
                label="This month, per km"
                hint={`over ${count(charging.matchedDays)} day${charging.matchedDays === 1 ? '' : 's'} with cost and distance${charging.estimated ? ' · part estimated' : ''}`}
                value={`${rateOf(charging.perKm)}/km`}
                tone="text-warn"
              />
            )}
            {/* The headline: the same figure the teaser on the main screen shows,
                from the same helper. */}
            {headline && headline.basis === '7d' && (
              <Row
                label="Last 7 days, per km"
                hint={`${count(headline.matchedDays)} day${headline.matchedDays === 1 ? '' : 's'} · the fair one to judge on${headline.estimated ? ' · part estimated' : ''}`}
                value={`${rateOf(headline.perKm)}/km`}
                tone="text-warn"
              />
            )}
            <Row
              label="Charging this month"
              hint={
                charging.modelledDays > 0
                  ? `${count(charging.loggedDays)} logged, ${count(charging.modelledDays)} estimated`
                  : `${count(charging.loggedDays)} day${charging.loggedDays === 1 ? '' : 's'} logged`
              }
              value={money(charging.total)}
              tone="text-slate-100"
            />
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
                hint={line.kind === 'refund' ? 'refunded to the fleet' : "Uber's charge"}
                value={money(line.amount)}
                tone={line.kind === 'refund' ? 'text-slate-100' : 'text-warn'}
              />
            ))}
            <div className="flex items-baseline justify-between gap-4 border-t border-ink-700 pt-2 mt-2">
              <dt className="text-sm font-medium text-slate-200">Uber's cut, net</dt>
              <dd className="num text-warn shrink-0">{money(cut.charges - cut.refunded)}</dd>
            </div>
          </>
        )}
        {cut.lines.length === 0 && cut.charges > 0 && (
          <Row
            label="Uber's cut"
            hint="Drive Pass subscription and fees"
            value={money(cut.charges)}
            tone="text-warn"
          />
        )}
        {cut.commission > 0 && (
          <Row
            label={cut.estimated ? "Uber's share of fares (estimated)" : "Uber's share of fares"}
            hint={
              cut.estimated
                ? `assumes ${Math.round(cut.rate * 100)}% — the export does not state it`
                : `${Math.round(cut.rate * 100)}% of ${amount(cut.gross)} in fares`
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
            Every LKR 1,000 of fares{split.estimated ? ' (estimated)' : ''}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Share label="Uber takes" value={split.uber} tone="text-warn" />
            <Share label="Charging takes" value={split.charging} tone="text-warn" />
            <Share label="Left to split" value={split.pool} tone="text-slate-100" />
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            The rest pays your plan and runs the car.
            {split.estimated && ' Uber does not state its share of a fare, so that part is an estimate.'}
          </p>
        </div>
      )}

      {/* The week, day by day. Per km is the column that means something; cost
          and distance show the working, and an estimated day says so rather than
          passing a budget off as a receipt. */}
      {week && week.days.length > 0 && (
        <div className="mt-4 pt-3 border-t border-ink-700">
          <div className="label mb-2">Last 7 days</div>
          <dl className="space-y-1.5">
            {week.days.map((day) => (
              <div key={day.date} className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-slate-300 min-w-0">
                  {dayLabel(day.date)}
                  <span className="block text-xs text-slate-400 num">
                    {money(day.cost)}
                    {day.km > 0 ? ` · ${amount(day.km)} km` : ' · no distance'}
                    {day.estimated ? ' · estimated' : ''}
                  </span>
                </dt>
                <dd className={`num shrink-0 ${day.estimated ? 'text-slate-400' : 'text-warn'}`}>
                  {day.perKm === null ? '—' : `${rateOf(day.perKm)}/km`}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-[11px] text-slate-400 mt-2">
            A day you charged for tomorrow's driving reads expensive, and the next reads cheap. That
            is why the seven-day rate above is the one to go by.
          </p>
        </div>
      )}

      {/* Taxes Uber already took out of the fares. Not added to anything above —
          the revenue on this page is what arrived after them. */}
      {cut.taxes.length > 0 && (
        <div className="mt-4 pt-3 border-t border-ink-700">
          <div className="label mb-2">Already taken out of your fares</div>
          <dl className="space-y-1.5">
            {cut.taxes.map((tax) => (
              <Row key={tax.label} label={tax.label} value={money(tax.amount)} tone="text-slate-100" />
            ))}
          </dl>
          <p className="text-[11px] text-slate-400 mt-2">
            Uber deducts these before it pays, so what you see as revenue is already after them.
          </p>
        </div>
      )}

      {/* The one line about what he can change. A fact about his own month, with
          no promise attached to it. */}
      {charging && charging.perKm !== null && (
        <p className="text-sm text-slate-300 mt-4 pt-3 border-t border-ink-700">
          Charging is the cost you choose: you are paying{' '}
          <span className="num text-warn">{rateOf(charging.perKm)}</span> a km against a{' '}
          <span className="num">{charging.reference}</span> a km reference. Every{' '}
          <span className="num">1</span> a km saved is about{' '}
          <span className="num">{count(charging.perRupeePerKm)}</span> a month off what the car
          costs to run.
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
      <span className="text-sm text-slate-300">
        Charging is running at <span className="num text-warn">{rateOf(headline.perKm)}</span> a km.{' '}
        <span className="text-slate-100 underline underline-offset-2">
          See what your driving costs
        </span>
      </span>
      <span className="block text-[11px] text-slate-400 num mt-0.5">
        over {count(headline.matchedDays)} day{headline.matchedDays === 1 ? '' : 's'}
        {headline.basis === '7d' ? ' (last 7 days)' : ' this month'}
        {headline.estimated ? ' · part estimated' : ''}
      </span>
    </button>
  );
}
