import { amount, money } from '../format.js';
import { displayThreshold } from '../display.js';
import { useT } from '../i18n/index.jsx';

/**
 * Horizontal tier ladder: where the month's revenue sits against the two
 * thresholds that decide what the driver keeps.
 *
 * Two variants of one component, because the picture is the same and the
 * reading is not:
 *
 *   - `driver`: the only chart on his screen, so it has to explain itself with
 *     no legend to consult. The rates are written ON the zones (0% · 30% · 50%)
 *     and the markers are tagged "you" and "projected" in words.
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
export default function TierLadder({
  revenue,
  projected,
  goal,
  bandStart,
  bandEnd,
  bandRate,
  topRate,
  variant = 'owner',
}) {
  const { t } = useT();
  const driver = variant === 'driver';
  // Scale so the ladder always shows some headroom past the top tier.
  // The goal joins the scale, or a goal past the top tier would peg its marker
  // to the right-hand edge and read as "already there".
  const max = Math.max(bandEnd * 1.35, revenue * 1.1, projected * 1.1, (goal || 0) * 1.1, bandEnd + 1);
  const x = (v) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  const shownStart = displayThreshold(bandStart);
  const shownEnd = displayThreshold(bandEnd);
  // In a prorated month the band is a narrow sliver of the scale, so its two
  // axis labels would print into each other ("92k116k"). When they are that
  // close each label is anchored to its own side of its line instead of being
  // centred on it, which separates them without moving either line.
  const tight = ((bandEnd - bandStart) / max) * 100 < 18;
  // The rates written on the zones come from the plan, not from the copy. They
  // were three literal strings — "0%", "30%", "50%" — repeated again as literals
  // inside the hero's Sinhala and English sentences, so a fleet on different
  // terms would have had a chart and two dictionaries all quietly disagreeing
  // with what it actually pays.
  const zoneRates = [0, bandRate, topRate].map(asPct);
  // The zone labels need their own threshold, not the axis one. An axis label is
  // centred on its line and spends half its width on either side; a zone label is
  // pinned inside the left edge of its zone and needs only its own width. "30%"
  // is about 30px with its offset, so it wants roughly a tenth of the scale —
  // where the axis wants 18% for the same clearance.
  const narrowBand = ((bandEnd - bandStart) / max) * 100 < 10;
  // Every marker sits at the same height, so the set reads as one comparison
  // rather than facts stacked at different levels. Overlap is solved sideways,
  // the way the axis labels solve it: when the figures crowd, the leftmost tag
  // is anchored to the left of its line and the rightmost to the right of its
  // line, which spreads them without moving a single line.
  const align = spreadTags([
    { key: 'revenue', value: revenue },
    { key: 'projected', value: projected > 0 ? projected : null },
    { key: 'goal', value: driver && goal > 0 ? goal : null },
  ], max);

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <span className="label">{driver ? t('ladder.heading') : 'Revenue tier ladder'}</span>
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
          {/* All three labels on one line, so the row of rates reads as a scale.
              Each is pinned to the left edge of its own zone, so the middle one
              only has a neighbour problem when proration squeezes the band into a
              sliver — the same `tight` case the axis labels handle. There, and
              only there, it lifts to the middle to clear the 50% beside it. */}
          <Zone width={x(bandStart)} className="bg-ink-800/70" label={zoneRates[0]} row="bottom" driver={driver} />
          <Zone
            width={`calc(${x(bandEnd)} - ${x(bandStart)})`}
            className="bg-warn/20 border-x border-warn/50"
            label={zoneRates[1]}
            row={narrowBand ? 'middle' : 'bottom'}
            driver={driver}
          />
          <Zone width="auto" className="flex-1 bg-white/[0.10]" label={zoneRates[2]} row="bottom" driver={driver} />
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
        <Marker
          at={x(revenue)}
          tag={t('ladder.you')}
          // Driver only, both markers: the owner's variant carries the exact
          // totals in its legend, so the same figures on the bar would be the
          // third printing.
          figure={driver ? thousands(revenue) : null}
          align={align.revenue}
          title={t('ladder.earnedTitle', { amount: money(revenue) })}
        />
        {projected > 0 && (
          <Marker
            at={x(projected)}
            tag={t('ladder.projected')}
            figure={driver ? thousands(projected) : null}
            align={align.projected}
            dashed
            title={t('ladder.projectedTitle', { amount: money(projected) })}
          />
        )}
        {/* His own goal, level with the other two. The chart otherwise showed
            only where the PLAN's thresholds fall — this is the line he actually
            chose, and without it the ladder could not answer "am I going to make
            it?". */}
        {driver && goal > 0 && (
          <Marker
            at={x(goal)}
            tag={t('ladder.goal')}
            figure={thousands(goal)}
            align={align.goal}
            tone="text-warn"
            title={t('ladder.goalTitle', { amount: money(goal) })}
          />
        )}
      </div>

      {/* Axis: the thresholds themselves, and nothing else. Each tick used to
          carry the per-day rate it implies, which put a second per-day average on
          a screen that already leads with the hero's ask — two figures answering
          "how much a day" with different numbers. The ask is the instruction; the
          axis is the map. */}
      <div className="relative mt-1.5 text-[11px] text-slate-400 h-5">
        <Tick at={x(0)} label="0" align="left" />
        {/* Compact labels on the phone: "240,000" and "300,000" centred 57px
            apart print as one run-together number. */}
        <Tick
          at={x(bandStart)}
          label={driver ? thousands(shownStart) : amount(shownStart)}
          align={tight ? 'right' : 'center'}
        />
        <Tick
          at={x(bandEnd)}
          label={driver ? thousands(shownEnd) : amount(shownEnd)}
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
 * Both tags sit at the same height, so the pair reads as one comparison. `align`
 * is what keeps them apart when the two figures land close together: the caller
 * measures that, since it is the one that knows the scale, and anchors each tag
 * to its own side of its line. `TICK_SHIFT` is shared with the axis labels, so a
 * tag and a tick offset the same way.
 *
 * `figure` prints under the tag. The amount used to live only in the `title`,
 * which is a tooltip: on the phone this chart is read on, there is nothing to
 * hover, so the one number the marker exists to place was invisible. It is
 * abbreviated to thousands to match the axis it is read against.
 */
function Marker({ at, tag, figure, dashed = false, align = 'center', row = 'top', tone, title }) {
  return (
    <div className="absolute inset-y-0 pointer-events-none" style={{ left: at }} title={title}>
      <div
        className={`absolute inset-y-0 ${
          tone === 'text-warn'
            ? 'border-l-2 border-dashed border-warn/70'
            : dashed
              ? 'border-l-2 border-dashed border-slate-300'
              : 'border-l-2 border-slate-100'
        }`}
      />
      <span
        className={`absolute left-0 px-1.5 py-px rounded
                   bg-ink-950/90 border border-ink-600 text-[11px] leading-4
                   whitespace-nowrap ${row === 'bottom' ? 'bottom-1' : 'top-1'} ${
                     tone || 'text-slate-200'
                   } ${
                     align === 'right' ? 'text-right' : align === 'left' ? 'text-left' : 'text-center'
                   }`}
        style={{ transform: TICK_SHIFT[align] }}
      >
        {tag}
        {figure && <span className={`num block ${tone || 'text-slate-50'}`}>{figure}</span>}
      </span>
    </div>
  );
}

/**
 * Anchor each tag so a crowded set cannot print over itself.
 *
 * Centred tags need half their width either side of their line, so two figures
 * landing close together collide. Sorted left to right, the outermost two are
 * anchored to their own outer edge — the leftmost tag hangs left of its line,
 * the rightmost hangs right of its — which buys the width of a whole tag between
 * neighbours. Anything in the middle stays centred: it has nowhere better to go,
 * and its neighbours have already moved away from it.
 *
 * Only kicks in when they are actually close. Well-spaced markers stay centred
 * on their lines, which is what reads best.
 */
function spreadTags(markers, max) {
  const present = markers.filter((m) => Number.isFinite(m.value)).sort((a, b) => a.value - b.value);
  const align = Object.fromEntries(markers.map((m) => [m.key, 'center']));
  if (present.length < 2 || !max) return align;

  const crowded = present.some(
    (m, i) => i > 0 && (Math.abs(m.value - present[i - 1].value) / max) * 100 < TAG_CLEARANCE_PCT,
  );
  if (!crowded) return align;

  align[present[0].key] = 'right';
  align[present[present.length - 1].key] = 'left';
  return align;
}

/**
 * How much of the scale a tag needs to clear its neighbour, in percent. The
 * widest tag is Sinhala's "ඇස්තමේන්තුව" over a five-character figure, which is
 * about a fifth of the bar at 380px.
 */
const TAG_CLEARANCE_PCT = 22;

/** A plan rate as the whole percentage the copy and the chart both print. */
function asPct(rate) {
  return `${Math.round((rate || 0) * 100)}%`;
}

/** 240000 -> "240k", 473337 -> "473k" — axis labels stay short. */
function thousands(n) {
  return `${Math.round(n / 1000)}k`;
}

const TICK_SHIFT = { left: 'none', center: 'translateX(-50%)', right: 'translateX(-100%)' };

function Tick({ at, label, align = 'center' }) {
  return (
    <span
      className={`absolute whitespace-nowrap ${align === 'right' ? 'text-right pr-1' : align === 'left' ? 'text-left pl-1' : 'text-center'}`}
      style={{ left: at, transform: TICK_SHIFT[align] }}
    >
      <span className="num block text-slate-300">{label}</span>
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
