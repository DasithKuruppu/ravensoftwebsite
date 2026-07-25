import { money, amount, count } from '../format.js';

/**
 * What it would take to reach the next tier, framed to motivate.
 *
 * Three deliberate choices:
 *
 * 1. The headline is in TRIPS, not rupees. Trips are what the driver controls;
 *    "23,870 more revenue" is an abstraction, "2 more trips a day" is a shift
 *    he can picture.
 * 2. The prize is his take-home, never gross revenue or the owner's share.
 * 3. The marginal rate is shown, because it is the strongest argument the plan
 *    contains and it is otherwise invisible: crossing into the top tier doubles
 *    what every further rupee is worth to him.
 *
 * Below the band the marginal rate is genuinely zero, which is demoralising
 * stated plainly on day three. It is framed as a gate to unlock rather than a
 * wall he is standing at.
 */
export default function PushToTier({ summary }) {
  const p = summary.push;
  if (!p) return null;

  if (p.reached) {
    return (
      <div className="card border border-accent/30">
        <h2 className="label mb-2">Top tier reached</h2>
        <p className="text-sm text-slate-300">
          You are in the top tier — you now keep{' '}
          <span className="num text-accent">{Math.round(p.topRate * 100)}%</span> of everything you
          earn from here, <span className="num">{count(1000 * p.topRate)}</span> of every{' '}
          <span className="num">{count(1000)}</span>.
        </p>
      </div>
    );
  }

  const goingForTop = p.tier === 'top';
  const title = goingForTop ? 'Push to tier 3' : 'Unlock tier 2';

  return (
    <div className="card border border-accent/30">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 className="label text-accent">{title}</h2>
        <span className="text-xs text-slate-500">
          <span className="num">{p.daysLeft}</span> day{p.daysLeft === 1 ? '' : 's'} left
        </span>
      </div>

      {/* The ask, in the unit he controls. */}
      <div className="flex items-baseline gap-2 flex-wrap">
        {p.extraTripsPerDay >= 1 ? (
          <>
            <span className="num text-2xl text-accent">+{p.extraTripsPerDay}</span>
            <span className="text-slate-300">trips a day</span>
          </>
        ) : (
          <>
            <span className="num text-2xl text-accent">+{amount(p.extraPerDay || 0)}</span>
            <span className="text-slate-300">a day</span>
          </>
        )}
        <span className="text-slate-500 text-sm">
          — about <span className="num">{amount(p.catchUpDaily || 0)}</span>/day, to finish the
          month on <span className="num">{amount(p.target)}</span>
        </span>
      </div>

      {/* The prize, in his money. Reaching a threshold EXACTLY pays nothing
          extra — the band pays a share of what is above it — so when the gain
          is zero, say what the rate unlocks instead of offering "LKR 0.00". */}
      <p className="text-sm text-slate-300 mt-3">
        {p.payGain > 0 ? (
          <>
            Worth <span className="num text-accent">{money(p.payGain)}</span> more in your pocket
            this month
            {p.payGainPct ? (
              <span className="text-slate-500"> — a {p.payGainPct}% rise on {money(p.payNow)}</span>
            ) : null}
            .
          </>
        ) : (
          <>
            Get past it and you start keeping{' '}
            <span className="num text-accent">{Math.round(p.marginalNext * 100)}%</span> of
            everything you earn after that —{' '}
            <span className="num">{count(1000 * p.marginalNext)}</span> of every{' '}
            <span className="num">{count(1000)}</span>.
          </>
        )}
      </p>

      {/* Why it is worth it: what the next rupee earns, now and after. */}
      <div className="mt-4">
        <div className="label mb-2">How much of every extra rupee you keep</div>
        <div className="flex gap-1">
          <Zone
            active={p.marginalNow === 0}
            tone="slate"
            pct="0%"
            per={`nothing extra yet`}
            range={`below ${short(p.bandStart)}`}
          />
          <Zone
            active={p.marginalNow === p.bandRate}
            tone="warn"
            pct={`${Math.round(p.bandRate * 100)}%`}
            per={`${count(1000 * p.bandRate)} per ${count(1000)}`}
            range={`${short(p.bandStart)}–${short(p.bandEnd)}`}
          />
          <Zone
            active={p.marginalNow === p.topRate}
            tone="accent"
            pct={`${Math.round(p.topRate * 100)}%`}
            per={`${count(1000 * p.topRate)} per ${count(1000)}`}
            range={`above ${short(p.bandEnd)}`}
          />
        </div>
        <p className="text-xs text-slate-500 mt-2">
          {goingForTop ? (
            <>
              Past <span className="num">{amount(p.bandEnd)}</span> every rupee you earn is worth{' '}
              <span className="text-accent">
                {Math.round((p.topRate / p.bandRate) * 10) / 10}× more
              </span>{' '}
              to you than it is right now.
            </>
          ) : (
            <>
              <span className="num">{amount(p.gap)}</span> more this month and you start keeping{' '}
              <span className="text-warn">{Math.round(p.bandRate * 100)}%</span> of everything
              above it.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function Zone({ active, tone, pct, per, range }) {
  const tones = {
    slate: 'border-ink-700 text-slate-500',
    warn: 'border-warn/40 text-warn',
    accent: 'border-accent/40 text-accent',
  };
  const fills = { slate: 'bg-ink-800/60', warn: 'bg-warn/10', accent: 'bg-accent/10' };
  return (
    <div
      className={`flex-1 rounded-md border px-2 py-2 text-center ${tones[tone]} ${
        active ? `${fills[tone]} ring-1 ring-inset ring-current` : 'opacity-55'
      }`}
    >
      <div className="num text-base font-semibold">{pct}</div>
      <div className="text-[10px] text-slate-400 mt-0.5 num">{per}</div>
      <div className="text-[10px] text-slate-600 mt-0.5">{range}</div>
      {active && <div className="text-[10px] mt-1 font-medium">you are here</div>}
    </div>
  );
}

function short(v) {
  return v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v));
}
