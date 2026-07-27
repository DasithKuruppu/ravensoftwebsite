import { amount, count } from '../format.js';
import { displayThreshold, perDayThreshold } from '../display.js';

/**
 * How much of every extra rupee the driver keeps, and where the lines are.
 *
 * Lifted out of the push card and moved one tap deep on the driver view. It is
 * the strongest argument the plan contains — past the top threshold every
 * further rupee is worth 1.7× what it is worth below it — but it is an
 * explanation, not an instruction, and it was competing with the one number he
 * actually needs before a day out.
 *
 * Each zone is identified by its rate in text, so the three read apart without
 * relying on colour. Amber marks the zone he is standing in when that zone is
 * still short of the target; the top zone is where his money starts, and is the
 * only one allowed green.
 */
export default function MarginalRates({ summary }) {
  const p = summary.push;
  if (!p) return null;

  const start = displayThreshold(p.bandStart);
  const end = displayThreshold(p.bandEnd);
  // Operating days, not calendar days: the thresholds above are already scaled
  // to the days he can work, so dividing by the month would scale them twice.
  const days = summary.operatingDays || summary.daysInMonth || 31;
  const multiple = Math.round((p.topRate / p.bandRate) * 10) / 10;

  return (
    <div className="space-y-4">
      <div>
        <div className="label mb-2">How much of every extra rupee you keep</div>
        <div className="flex gap-1.5">
          <Zone
            active={p.marginalNow === 0}
            tone="slate"
            pct="0%"
            per="nothing extra yet"
            range={`below ${amount(start)}`}
            perDay={perDayThreshold(start, days)}
          />
          <Zone
            active={p.marginalNow === p.bandRate}
            tone="warn"
            pct={`${Math.round(p.bandRate * 100)}%`}
            per={`${count(1000 * p.bandRate)} per ${count(1000)}`}
            range={`${amount(start)}–${amount(end)}`}
            perDay={perDayThreshold(end, days)}
          />
          <Zone
            active={p.marginalNow === p.topRate}
            tone="accent"
            pct={`${Math.round(p.topRate * 100)}%`}
            per={`${count(1000 * p.topRate)} per ${count(1000)}`}
            range={`above ${amount(end)}`}
            perDay={null}
          />
        </div>
      </div>

      {/* A single fact, so it is allowed to be a sentence. */}
      <p className="text-sm text-slate-300">
        Past <span className="num">{amount(end)}</span> — that is{' '}
        <span className="num">{amount(perDayThreshold(end, days))}</span> a day — every rupee you
        earn is worth <span className="num text-accent">{multiple}× more</span> to you than it is
        below the line.
      </p>
    </div>
  );
}

function Zone({ active, tone, pct, per, range, perDay }) {
  const tones = {
    slate: 'border-ink-600 text-slate-300',
    warn: 'border-warn/50 text-warn',
    accent: 'border-accent/50 text-accent',
  };
  const fills = { slate: 'bg-ink-800/60', warn: 'bg-warn/10', accent: 'bg-accent/10' };
  return (
    <div
      className={`flex-1 min-w-0 rounded-md border px-2 py-2 text-center ${tones[tone]} ${
        active ? `${fills[tone]} ring-1 ring-inset ring-current` : 'opacity-80'
      }`}
    >
      <div className="num text-base font-semibold">{pct}</div>
      <div className="text-[11px] text-slate-300 mt-0.5 num">{per}</div>
      <div className="text-[11px] text-slate-400 mt-0.5 num">{range}</div>
      {perDay ? (
        <div className="text-[11px] text-slate-400 num">
          {amount(perDay)}/day
        </div>
      ) : null}
      {active && <div className="text-[11px] mt-1 font-medium">you are here</div>}
    </div>
  );
}
