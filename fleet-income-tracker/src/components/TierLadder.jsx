import { amount, money } from '../format.js';

/**
 * Horizontal tier ladder:
 *   shaded zones for 0–bandStart / band / above bandEnd,
 *   a solid fill for revenue so far this month,
 *   a dashed marker at the projected month-end revenue.
 */
export default function TierLadder({ revenue, projected, bandStart, bandEnd }) {
  // Scale so the ladder always shows some headroom past the top tier.
  const max = Math.max(bandEnd * 1.35, revenue * 1.1, projected * 1.1, bandEnd + 1);
  const x = (v) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;

  return (
    <div className="card">
      <div className="flex items-baseline justify-between mb-4">
        <span className="label">Tier ladder</span>
        <span className="text-xs text-slate-500">
          scale to <span className="num">{thousands(max)}</span>
        </span>
      </div>

      <div className="relative h-14 rounded-lg overflow-hidden bg-ink-950 border border-ink-800">
        {/* tier zones — kept legible, so the fill sits inside them rather than over them */}
        <div className="absolute inset-0 flex">
          <div style={{ width: x(bandStart) }} className="bg-ink-800/70" />
          <div
            style={{ width: `calc(${x(bandEnd)} - ${x(bandStart)})` }}
            className="bg-warn/20 border-x border-warn/40"
          />
          <div className="flex-1 bg-accent/10" />
        </div>

        {/* Month-to-date fill: full height, so it reads as one bar rather than a
            thinner strip sitting inside the zones. It lightens neutrally rather
            than painting green over the top, which keeps each zone's own colour
            legible underneath while still showing clearly how far along we are. */}
        <div
          style={{ width: x(revenue) }}
          className="absolute inset-y-0 left-0 bg-white/[0.18] border-r-2 border-accent
                     shadow-[inset_0_0_0_1px_rgba(74,222,128,0.25)]
                     transition-[width] duration-500"
        />

        {/* projected marker */}
        {projected > 0 && (
          <div
            style={{ left: x(projected) }}
            className="absolute inset-y-0 border-l-2 border-dashed border-slate-100"
            title={`Projected ${money(projected)}`}
          />
        )}
      </div>

      {/* axis */}
      <div className="relative h-5 mt-1 text-[11px] text-slate-500">
        <Tick at={x(0)} label="0" align="left" />
        <Tick at={x(bandStart)} label={thousands(bandStart)} />
        <Tick at={x(bandEnd)} label={thousands(bandEnd)} />
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs text-slate-400">
        <Legend className="bg-white/[0.18] border border-accent">
          Total <span className="num text-slate-200">{amount(revenue)}</span>
        </Legend>
        <Legend className="border-l-2 border-dashed border-slate-100">
          Projected <span className="num text-slate-200">{amount(projected)}</span>
        </Legend>
        <Legend className="bg-warn/20 border border-warn/40">band</Legend>
        <Legend className="bg-accent/10 border border-accent/20">top tier</Legend>
      </div>
    </div>
  );
}

/** 240000 -> "240k", 473337 -> "473k" — axis labels stay short. */
function thousands(n) {
  return `${Math.round(n / 1000)}k`;
}

function Tick({ at, label, align = 'center' }) {
  return (
    <span
      className="absolute num whitespace-nowrap"
      style={{ left: at, transform: align === 'left' ? 'none' : 'translateX(-50%)' }}
    >
      {label}
    </span>
  );
}

function Legend({ className, children }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-3 h-3 rounded-sm ${className}`} />
      {children}
    </span>
  );
}
