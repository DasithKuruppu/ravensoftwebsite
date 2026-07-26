import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, amount, count, monthLabel, ago, stamp } from '../format.js';
import MonthNav from '../components/MonthNav.jsx';
import TierLadder from '../components/TierLadder.jsx';
import VehicleMap from '../components/VehicleMap.jsx';
import CashSplit from '../components/CashSplit.jsx';
import ProjectionChart from '../components/ProjectionChart.jsx';
import PushToTier from '../components/PushToTier.jsx';
import RunningCosts from '../components/RunningCosts.jsx';
import ReturnOnCapital from '../components/ReturnOnCapital.jsx';
import NextMonth from '../components/NextMonth.jsx';
import DirectCosts from '../components/DirectCosts.jsx';

export default function Dashboard({ month, setMonth, isOwner, onDriverName }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .summary(month)
      .then((s) => !cancelled && (setSummary(s), setError(''), onDriverName?.(s.driverName)))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [month]);

  return (
    <div>
      <MonthNav month={month} setMonth={setMonth} />

      {error && <Banner>{error}</Banner>}
      {loading && !summary && <p className="text-slate-500 text-sm">Loading…</p>}

      {summary && (
        <div className="space-y-5">
          {summary.prorationFactor < 1 && (
            <div className="rounded-lg border border-warn/30 bg-warn/5 px-4 py-3 text-sm">
              <span className="text-warn font-medium">Partial month.</span>{' '}
              <span className="text-slate-300">
                {summary.driverName} started {summary.startDate}, so this month has{' '}
                <span className="num">{count(summary.operatingDays)}</span> of{' '}
                <span className="num">{count(summary.daysInMonth)}</span> operating days. The plan
                is scaled to <span className="num">{Math.round(summary.prorationFactor * 100)}%</span>{' '}
                — base <span className="num">{money(summary.plan.base)}</span>, band{' '}
                <span className="num">{amount(summary.plan.bandStart)}</span>–
                <span className="num">{amount(summary.plan.bandEnd)}</span>. Full rates resume next
                month.
              </span>
            </div>
          )}
          <Section
            title={`This month · ${monthLabel(month)}`}
            subtitle={`${count(summary.elapsedDays)} of ${count(summary.operatingDays)} operating days`}
            meta={<LastUpdated last={summary.lastUpdated} />}
          >
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <Stat label="Total revenue (LKR)" value={amount(summary.revenue)} accent />
            <Stat
              label="Daily average (LKR)"
              value={amount(summary.dailyAverage)}
              // Say what it is divided by. Days off and days still waiting on
              // an import are not in it, and the number is meaningless without
              // knowing that.
              hint={`over ${count(summary.earningDays)} earning day${summary.earningDays === 1 ? '' : 's'}`}
            />
            <Stat
              label="Today (LKR)"
              value={summary.today ? amount(summary.today.revenue) : '—'}
              hint={
                summary.today
                  ? summary.today.offDay
                    ? 'day off'
                    : `${count(summary.today.trips ?? 0)} trips so far`
                  : 'nothing imported yet'
              }
            />
            {summary.yesterday && (
              <Stat
                label="Yesterday (LKR)"
                value={amount(summary.yesterday.revenue)}
                // Measured against the pace the next tier needs, not the month
                // average — against the month average this reads near zero
                // early on, since recent days ARE the month. Against the
                // required pace it answers the question that matters: am I on
                // track today?
                target={summary.push && !summary.push.reached ? summary.push.catchUpDaily : null}
                current={summary.yesterday.revenue}
              />
            )}
            <Stat label="Trips" value={count(summary.trips)} />
            <Stat
              label="Days logged"
              value={`${count(summary.earningDays)} / ${count(summary.operatingDays)}`}
              hint={
                summary.offDaysElapsed > 0
                  ? `${count(summary.offDaysElapsed)} day off`
                  : summary.pendingDays > 0
                    ? `${count(summary.pendingDays)} awaiting figures`
                    : undefined
              }
            />
            <Stat
              label={`${summary.driverName} take-home (LKR)`}
              value={amount(summary.driverPay)}
              accent
            />
          </div>

          <TierLadder
            revenue={summary.revenue}
            projected={summary.projectedRevenue}
            bandStart={summary.plan.bandStart}
            bandEnd={summary.plan.bandEnd}
          />

          {/* Ahead of the chart: the ask should be the first thing read, and it
              is the one card written for the driver rather than the owner. */}
          <PushToTier summary={summary} />

          <ProjectionChart summary={summary} />

          {/* One flowing two-column grid rather than a series of ad-hoc rows.
              Two of those rows previously held a single card, which rendered as
              a half-width orphan with dead space beside it. Here the cards fill
              left to right in a fixed order, so the columns line up whatever
              mix of cards a role happens to see. `items-start` keeps each card
              its natural height instead of stretching to match its neighbour. */}
          <div className="grid md:grid-cols-2 gap-5 items-start">
            <div className="card">
              <h2 className="label">{summary.driverName} pay on revenue so far</h2>
              <p className="text-xs text-slate-500 mb-3 mt-1">
                {monthLabel(month)} to date · <span className="num">{amount(summary.revenue)}</span>{' '}
                earned
              </p>
              <dl className="space-y-2">
                {summary.tiers.map((t) => (
                  <div key={t.key} className="flex items-baseline justify-between gap-4">
                    <dt className="text-sm text-slate-400">
                      {t.label}
                      {t.basis > 0 && (
                        <span className="num text-slate-600 ml-2 text-xs">on {amount(t.basis)}</span>
                      )}
                    </dt>
                    <dd className="num text-slate-200">{amount(t.amount)}</dd>
                  </div>
                ))}
                <div className="flex items-baseline justify-between gap-4 border-t border-ink-800 pt-2 mt-2">
                  <dt className="text-sm font-medium text-slate-300">Total</dt>
                  <dd className="num text-accent text-lg">{money(summary.driverPay)}</dd>
                </div>

              </dl>
            </div>

            <div className="card">
              <h2 className="label">Projected month end</h2>
              <p className="text-xs text-slate-500 mb-3 mt-1">
                at average pace · <span className="num">{amount(summary.dailyAverage)}</span>/day ·{' '}
                {count(summary.elapsedDays)} of {count(summary.operatingDays)} operating days
                elapsed
              </p>
              <dl className="space-y-2">
                <Row label="Projected revenue" value={money(summary.projectedRevenue)} />
                <Row
                  label="Projected take-home"
                  value={money(summary.projectedDriverPay)}
                  strong
                />
                {isOwner && summary.projectedOwnerProfit !== undefined && (
                  <Row
                    label="Projected profit"
                    hint="after running costs"
                    value={money(summary.projectedOwnerProfit)}
                    tone={summary.projectedOwnerProfit < 0 ? 'text-danger' : undefined}
                  />
                )}
              </dl>
              {summary.pendingDays > 0 && (
                <p className="text-xs text-slate-500 mt-4">
                  <span className="num">{count(summary.pendingDays)}</span> elapsed day
                  {summary.pendingDays === 1 ? ' has' : 's have'} no Uber figures — left out of
                  both the average and the projection rather than counted as zero. Import the
                  day, or mark it off if he was not driving.
                </p>
              )}
            </div>

            {/* Driver-only: the one cost he can act on. */}
            {!isOwner && <DirectCosts summary={summary} />}

            <CashSplit summary={summary} />

            {isOwner && summary.costs && <RunningCosts summary={summary} />}

          </div>
          </Section>

          <Section
            title={`Next month · ${monthLabel(`${summary.nextMonth?.month || month}-01`)}`}
            subtitle="at average pace, on full commission bands"
          >
            <div className="grid md:grid-cols-2 gap-5 items-start">
              <NextMonth summary={summary} isOwner={isOwner} />
              {isOwner && summary.costs && <ReturnOnCapital summary={summary} />}
            </div>
          </Section>

          {/* Last on the page: the money figures are what the dashboard is for,
              and the map is the tallest block — putting it above them pushed
              everything else below the fold.
              Shown to both roles — the driver sees the same position the owner
              does, rather than being tracked one-way. */}
          <Section title="Vehicle" subtitle="where the car is, and where to charge it">
            <VehicleMap />
          </Section>
        </div>
      )}
    </div>
  );
}

/**
 * A titled band of the page. The dashboard had grown into an unbroken run of
 * cards mixing what has happened with what is forecast; the headings say which
 * you are looking at.
 */
function Section({ title, subtitle, meta, children }) {
  return (
    <section className="space-y-5">
      <div className="flex items-baseline gap-x-3 gap-y-1 flex-wrap border-b border-ink-800 pb-2">
        <h2 className="text-xs uppercase tracking-[0.18em] text-slate-400">{title}</h2>
        {subtitle && <span className="text-xs text-slate-600">{subtitle}</span>}
        {meta && <span className="sm:ml-auto text-xs">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * When the figures were last written to.
 *
 * Amber past a day: the dashboard is only as current as the last import, and a
 * projection built on stale days is confidently wrong rather than merely old.
 */
function LastUpdated({ last }) {
  if (!last) return <span className="text-slate-600">never updated</span>;
  const { text, minutes } = ago(last.at);
  const how = { csv: 'CSV import', api: 'Uber API', gps: 'GPS sync', manual: 'hand entry' }[last.source] || last.source;
  return (
    <span
      className={minutes >= 1440 ? 'text-warn' : 'text-slate-500'}
      title={`${stamp(last.at)} — ${how}, for ${last.date}`}
    >
      updated {text}
    </span>
  );
}

function Stat({ label, value, accent = false, target, current, hint }) {
  // A recent average is only meaningful against the pace being chased.
  const gap = typeof target === 'number' && typeof current === 'number' ? current - target : null;
  const showTrend = gap !== null && Math.abs(gap) >= 1;
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div
        className={`num mt-1.5 text-base sm:text-xl whitespace-nowrap ${
          accent ? 'text-accent' : 'text-slate-100'
        }`}
      >
        {value}
      </div>
      {showTrend && (
        <div className={`num text-[11px] mt-0.5 ${gap >= 0 ? 'text-accent' : 'text-warn'}`}>
          {gap >= 0 ? '▲ on pace' : `▼ ${amount(Math.abs(gap))} below pace`}
        </div>
      )}
      {!showTrend && hint && <div className="text-[11px] text-slate-600 mt-0.5">{hint}</div>}
    </div>
  );
}

function Row({ label, hint, value, strong = false, tone }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-slate-400">
        {label}
        {hint && <span className="block text-xs text-slate-600">{hint}</span>}
      </dt>
      <dd className={`num ${tone || (strong ? 'text-accent text-lg' : 'text-slate-200')}`}>{value}</dd>
    </div>
  );
}

function Banner({ children }) {
  return (
    <p className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2 mb-4">
      {children}
    </p>
  );
}
