import { amount, money } from '../format.js';
import { displayThreshold, perDayThreshold } from '../display.js';

/**
 * Horizontal tier ladder: where the month's revenue sits against the two
 * thresholds that decide what the driver keeps.
 *
 * Two variants of one component, because the picture is the same and the
 * reading is not:
 *
 *   - `driver`: the only chart on his screen, so it has to explain itself with
 *     no legend to consult. The rates are written ON the zones (0% · 30% · 50%),
 *     the markers are tagged "you" and "projected" in words, and each threshold
 *     carries the per-day rate it implies — over the OPERATING days it covers,
 *     which is the one figure that does not change between a partial month and a
 *     full one.
 *   - owner: the analytical version, keeping the scale note and the legend.
 *
 * Zones are told apart by their text label, not by colour, so the chart still
 * reads with any form of colour blindness. Colour here is deliberately quiet:
 * revenue is not the driver's money, so none of it is green. Amber marks the
 * band he has not finished climbing.
 *
 * Both variants take their threshold labels from `displayThreshold`, so the
 * axis can never disagree with the payroll copy elsewhere on the page.
 */
export default function TierLadder({ revenue, projected, bandStart, bandEnd, operatingDays, variant = 'owner' }) {
  const driver = variant === 'driver';
  // Scale so the ladder always shows some headroom past the top tier.
  const max = Math.max(bandEnd * 1.35, revenue * 1.1, projected * 1.1, bandEnd + 1);
  const x = (v) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  const shownStart = displayThreshold(bandStart);
  const shownEnd = displayThreshold(bandEnd);
  // In a prorated month the band is a narrow sliver of the scale, so its two
  // axis labels would print into each other ("92k116k"). When they are that
  // close each label is anchored to its own side of its line instead of being
  // centred on it, which separates them without moving either line.
  const tight = ((bandEnd - bandStart) / max) * 100 < 18;

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <span className="label">{driver ? 'Where your month sits' : 'Revenue tier ladder'}</span>
        {!driver && (
          <span className="text-xs text-slate-400">
            scale to <span className="num">{thousands(max)}</span>
          </span>
        )}
      </div>

      <div className={`relative rounded-lg overflow-hidden bg-ink-950 border border-ink-700 ${driver ? 'h-20' : 'h-14'}`}>
        {/* Tier zones. The fill sits inside them rather than over them, so each
            zone's own label stays legible underneath. */}
        <div className="absolute inset-0 flex">
          {/* Labels alternate between two heights so neighbouring ones never
              collide, however narrow proration makes the middle zone. */}
          <Zone width={x(bandStart)} className="bg-ink-800/70" label="0%" row="bottom" driver={driver} />
          <Zone
            width={`calc(${x(bandEnd)} - ${x(bandStart)})`}
            className="bg-warn/20 border-x border-warn/50"
            label="30%"
            row="middle"
            driver={driver}
          />
          <Zone width="auto" className="flex-1 bg-white/[0.10]" label="50%" row="bottom" driver={driver} />
        </div>

        {/* Month to date: full height, so it reads as one bar rather than a
            thinner strip sitting inside the zones. It lightens neutrally — this
            is revenue, which is the owner's measure, not the driver's money. */}
        <div
          style={{ width: x(revenue) }}
          className="absolute inset-y-0 left-0 bg-white/[0.16] border-r-2 border-slate-100
                     transition-[width] duration-500"
        />

        {/* Markers are named in words, so neither one depends on recognising a
            line style from a legend that is no longer there. */}
        <Marker at={x(revenue)} tag="you" title={`Earned so far ${money(revenue)}`} />
        {projected > 0 && (
          <Marker
            at={x(projected)}
            tag="projected"
            dashed
            row="bottom"
            title={`Projected ${money(projected)}`}
          />
        )}
      </div>

      {/* Axis. The driver's version leads with the per-day rate each threshold
          implies: prorating divides the threshold and the days by the same
          factor, so "3,742 a day" is true in a partial month and a full one. */}
      <div className={`relative mt-1.5 text-[11px] text-slate-400 ${driver ? 'h-9' : 'h-5'}`}>
        <Tick at={x(0)} label="0" align="left" />
        {/* Compact labels on the phone: "240,000" and "300,000" centred 57px
            apart print as one run-together number. Both thresholds carry their
            per-day equivalent — one on its own read as an orphan figure with
            nothing to compare it to. */}
        <Tick
          at={x(bandStart)}
          label={driver ? thousands(shownStart) : amount(shownStart)}
          per={driver ? perDayThreshold(shownStart, operatingDays) : null}
          align={tight ? 'right' : 'center'}
        />
        <Tick
          at={x(bandEnd)}
          label={driver ? thousands(shownEnd) : amount(shownEnd)}
          per={driver ? perDayThreshold(shownEnd, operatingDays) : null}
          align={tight ? 'left' : 'center'}
        />
      </div>

      {!driver && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs text-slate-300">
          <Legend className="bg-white/[0.16] border border-slate-100">
            Total <span className="num text-slate-100">{amount(revenue)}</span>
          </Legend>
          <Legend className="border-l-2 border-dashed border-slate-300">
            Projected <span className="num text-slate-100">{amount(projected)}</span>
          </Legend>
          <Legend className="bg-warn/20 border border-warn/50">band · 30%</Legend>
          <Legend className="bg-white/[0.10] border border-slate-500">top tier · 50%</Legend>
        </div>
      )}
    </div>
  );
}

/**
 * One zone of the ladder, labelled with the share of every further rupee the
 * driver keeps inside it. The label is the zone's identity — colour only
 * reinforces it.
 */
function Zone({ width, className, label, row = 'middle', driver }) {
  return (
    <div style={width === 'auto' ? undefined : { width }} className={`relative ${className}`}>
      {driver && (
        <span
          className={`absolute left-1.5 text-[11px] font-semibold text-slate-200 num ${
            row === 'bottom' ? 'bottom-1' : 'top-1/2 -translate-y-1/2'
          }`}
        >
          {label}
        </span>
      )}
    </div>
  );
}

/**
 * A named position on the bar: the tag says which, so no legend is needed.
 *
 * The two tags sit on different rows — "you" at the top, "projected" at the
 * bottom — because on a good month the projection lands a few thousand rupees
 * from what is already banked, and two centred labels at the same height then
 * print over each other.
 */
function Marker({ at, tag, dashed = false, row = 'top', title }) {
  return (
    <div className="absolute inset-y-0 pointer-events-none" style={{ left: at }} title={title}>
      <div
        className={`absolute inset-y-0 ${
          dashed ? 'border-l-2 border-dashed border-slate-300' : 'border-l-2 border-slate-100'
        }`}
      />
      <span
        className={`absolute left-0 -translate-x-1/2 px-1.5 py-px rounded
                   bg-ink-950/90 border border-ink-600 text-[11px] leading-4 text-slate-200
                   whitespace-nowrap ${row === 'bottom' ? 'bottom-1' : 'top-1'}`}
      >
        {tag}
      </span>
    </div>
  );
}

/** 240000 -> "240k", 473337 -> "473k" — axis labels stay short. */
function thousands(n) {
  return `${Math.round(n / 1000)}k`;
}

const TICK_SHIFT = { left: 'none', center: 'translateX(-50%)', right: 'translateX(-100%)' };

function Tick({ at, label, per, align = 'center' }) {
  return (
    <span
      className={`absolute whitespace-nowrap ${align === 'right' ? 'text-right pr-1' : align === 'left' ? 'text-left pl-1' : 'text-center'}`}
      style={{ left: at, transform: TICK_SHIFT[align] }}
    >
      <span className="num block text-slate-300">{label}</span>
      {per ? <span className="num block text-slate-400">≈ {amount(per)}/day</span> : null}
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
