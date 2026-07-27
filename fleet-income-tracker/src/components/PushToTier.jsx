import { money, amount, count } from '../format.js';
import { displayThreshold, perDayThreshold } from '../display.js';
import MarginalRates from './MarginalRates.jsx';

/**
 * What it would take to reach the next tier, framed to motivate. The owner's
 * copy of the driver's ask — his own view leads with the same number at hero
 * size, so this stays where the owner reads it.
 *
 * Three deliberate choices:
 *
 * 1. The headline is in TRIPS, not rupees. Trips are what the driver controls;
 *    "23,870 more revenue" is an abstraction, "2 more trips a day" is a shift
 *    he can picture.
 * 2. The prize is his take-home, never gross revenue or the owner's share — and
 *    it is the only figure in the card allowed to be green.
 * 3. The marginal rate is shown, because it is the strongest argument the plan
 *    contains and it is otherwise invisible.
 *
 * Every threshold quoted here goes through `displayThreshold`, so the card, the
 * ladder axis and the driver's screen cannot disagree about where the line is.
 *
 * Below the band the marginal rate is genuinely zero, which is demoralising
 * stated plainly on day three. It is framed as a gate to unlock rather than a
 * wall he is standing at.
 */
export default function PushToTier({ summary }) {
  const p = summary.push;
  if (!p) return null;

  const days = summary.operatingDays || summary.daysInMonth || 31;
  const end = displayThreshold(p.bandEnd);

  if (p.reached) {
    return (
      <div className="card border border-accent/30">
        <h2 className="label mb-2">Top tier reached</h2>
        <p className="text-sm text-slate-200">
          You are in the top tier — you now keep{' '}
          <span className="num text-accent">{Math.round(p.topRate * 100)}%</span> of everything you
          earn from here, <span className="num">{count(1000 * p.topRate)}</span> of every{' '}
          <span className="num">{count(1000)}</span>.
        </p>
      </div>
    );
  }

  const goingForTop = p.tier === 'top';
  const target = displayThreshold(p.target);
  // On track is not the same as arrived. The pace forecasts a finish past the
  // threshold, but the money is not earned yet and the higher rate is not being
  // paid yet, so this state encourages holding the pace rather than
  // congratulating him for a tier he has not reached.
  const title = p.onTrack
    ? goingForTop
      ? 'On track for tier 3'
      : 'On track for tier 2'
    : goingForTop
      ? 'Push to tier 3'
      : 'Unlock tier 2';

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 className="label">{title}</h2>
        <span className="text-xs text-slate-400">
          <span className="num">{p.daysLeft}</span> more shift{p.daysLeft === 1 ? '' : 's'}
        </span>
      </div>

      {/* The ask. Revenue to drive, so it is neutral — the money is below. */}
      <div className="flex items-baseline gap-2 flex-wrap">
        {p.onTrack || !(p.extraTripsPerDay >= 1) ? (
          <>
            <span className="num text-2xl text-slate-50">{amount(p.catchUpDaily || 0)}</span>
            <span className="text-slate-200">a day{p.onTrack ? ' keeps you there' : ''}</span>
          </>
        ) : (
          <>
            <span className="num text-2xl text-slate-50">+{p.extraTripsPerDay}</span>
            <span className="text-slate-200">trips a day</span>
          </>
        )}
      </div>

      {/* Figures live in rows, not in sentences. The old copy ran "you are on X,
          so there is still Y to earn before you cross Z and start keeping W%" —
          four numbers in one breath, none of them findable again. */}
      <dl className="mt-3 space-y-2 border-t border-ink-700 pt-3">
        <Row label={goingForTop ? 'To tier 3' : 'To tier 2'} value={money(p.remainingToTarget)} tone="text-warn" />
        <Row
          label={goingForTop ? 'Tier 3 starts at' : 'Tier 2 starts at'}
          hint={`${amount(perDayThreshold(target, days))} a shift`}
          value={amount(target)}
        />
        <Row label="Earned so far" value={amount(p.revenue)} />
        {p.payGain > 0 && (
          <Row
            label="Extra in your pocket"
            hint={p.payGainPct ? `${p.payGainPct}% on ${money(p.payNow)}` : undefined}
            value={money(p.payGain)}
            tone="text-accent"
          />
        )}
        {!(p.payGain > 0) && (
          <Row
            label="Then you keep"
            hint={`${count(1000 * p.marginalNext)} of every ${count(1000)} after that`}
            value={`${Math.round(p.marginalNext * 100)}%`}
            tone="text-accent"
          />
        )}
      </dl>

      {/* Why it is worth it: what the next rupee earns, now and after. */}
      <div className="mt-4 border-t border-ink-700 pt-4">
        <MarginalRates summary={summary} />
      </div>
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
