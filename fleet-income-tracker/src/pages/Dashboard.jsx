import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, amount, count, monthLabel } from '../format.js';
import MonthNav from '../components/MonthNav.jsx';
import TierLadder from '../components/TierLadder.jsx';
import VehicleMap from '../components/VehicleMap.jsx';
import CashSplit from '../components/CashSplit.jsx';

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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Revenue MTD (LKR)" value={amount(summary.revenue)} accent />
            <Stat label="Trips" value={count(summary.trips)} />
            <Stat
              label="Days logged"
              value={`${count(summary.daysLogged)} / ${count(summary.operatingDays)}`}
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

          <div className="grid md:grid-cols-2 gap-5">
            <CashSplit summary={summary} />

            <div className="card">
              <h2 className="label mb-3">{summary.driverName} pay at current revenue</h2>
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
                {isOwner && summary.ownerShare !== undefined && (
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-sm text-slate-400">Owner share</dt>
                    <dd className="num text-slate-200">{money(summary.ownerShare)}</dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="card">
              <h2 className="label mb-3">Projected month end</h2>
              <p className="text-xs text-slate-500 mb-3">
                {monthLabel(month)} · {count(summary.elapsedDays)} of{' '}
                {count(summary.operatingDays)} operating days elapsed
              </p>
              <dl className="space-y-2">
                <Row label="Projected revenue" value={money(summary.projectedRevenue)} />
                <Row
                  label="Projected take-home"
                  value={money(summary.projectedDriverPay)}
                  strong
                />
                {isOwner && summary.projectedOwnerShare !== undefined && (
                  <Row label="Projected owner share" value={money(summary.projectedOwnerShare)} />
                )}
              </dl>
              {summary.elapsedDays > 0 && summary.daysLogged < summary.elapsedDays && (
                <p className="text-xs text-warn/80 mt-4">
                  {summary.elapsedDays - summary.daysLogged} elapsed day(s) have no entry — the
                  projection treats them as zero revenue.
                </p>
              )}
            </div>
          </div>

          {/* Last on the page: the money figures are what the dashboard is for,
              and the map is the tallest block — putting it above them pushed
              everything else below the fold.
              Shown to both roles — the driver sees the same position the owner
              does, rather than being tracked one-way. */}
          <VehicleMap />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent = false }) {
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
    </div>
  );
}

function Row({ label, value, strong = false }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-slate-400">{label}</dt>
      <dd className={`num ${strong ? 'text-accent text-lg' : 'text-slate-200'}`}>{value}</dd>
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
