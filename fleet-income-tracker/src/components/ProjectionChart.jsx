import { useEffect, useRef, useState } from 'react';
import { amount, money } from '../format.js';

/**
 * Take-home across the month, and where it lands under different finishes.
 *
 * Deliberately NOT a revenue chart. Revenue is the owner's measure; the driver
 * is paid the take-home, so that is the only quantity plotted — one axis, one
 * unit, no second scale to misread.
 *
 * The two projected lines separate only after the tier threshold, because the
 * plan pays nothing extra below it. That divergence is the argument for pushing:
 * the gap between the line ends is the money at stake.
 *
 * Colours are the validated categorical set for this dark surface (#141821):
 * aqua #199e70, blue #3987e5, orange #d95926 and mauve #a855a8 — checked for
 * lightness band, chroma floor, ALL-PAIRS CVD separation (worst ΔE 9.4 under
 * deuteranopia, 19.0 normal vision) and contrast. All four lines share one
 * plot, so adjacent-pair checking is not enough; purple was the obvious fourth
 * hue and failed against the blue at ΔE 4.1.
 *
 * The app's own accent green fails the lightness band as a chart mark here.
 */
const ACTUAL = '#199e70';
const STRETCH = '#3987e5';
const YESTERDAY = '#d95926';
const TODAY = '#a855a8';

const COLOUR = { current: ACTUAL, today: TODAY, yesterday: YESTERDAY, stretch: STRETCH };
const DASH = { current: '5 4', today: '1 3', yesterday: '2 3', stretch: '8 4' };

const PAD = { top: 22, right: 16, bottom: 26, left: 62 };
const HEIGHT = 230;

export default function ProjectionChart({ summary }) {
  const { series, driverName } = summary;
  const actual = series?.actual || [];
  const scenarios = series?.scenarios || [];
  const wrapRef = useRef(null);
  const width = useElementWidth(wrapRef, 640);
  const [hover, setHover] = useState(null);

  if (actual.length < 1) return null;

  const current = scenarios.find((s) => s.key === 'current');
  const stretch = scenarios.find((s) => s.key === 'stretch');
  const drawable = scenarios.filter((s) => s.points.length > 1);

  const innerW = Math.max(120, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const allPts = [...actual, ...scenarios.flatMap((s) => s.points)];
  const firstDay = actual[0].day;
  const lastDay = series?.lastDay ?? allPts[allPts.length - 1].day;
  const maxY = Math.max(...allPts.map((p) => p.pay)) * 1.12;
  const minY = Math.min(...allPts.map((p) => p.pay)) * 0.9;

  const x = (day) => PAD.left + ((day - firstDay) / Math.max(1, lastDay - firstDay)) * innerW;
  const y = (v) => PAD.top + innerH - ((v - minY) / Math.max(1, maxY - minY)) * innerH;

  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day)},${y(p.pay)}`).join(' ');
  const today = actual[actual.length - 1];
  const ticks = niceTicks(minY, maxY, 3);
  const best = drawable.reduce((b, sc) => (!b || sc.endPay > b.endPay ? sc : b), null);

  // Roughly 22px per label before they touch at this font size.
  const totalDays = lastDay - firstDay + 1;
  const step = Math.max(1, Math.ceil(totalDays / Math.max(1, Math.floor(innerW / 22))));
  const dayTicks = [];
  for (let d = firstDay; d <= lastDay; d += step) dayTicks.push(d);
  if (dayTicks[dayTicks.length - 1] !== lastDay) dayTicks.push(lastDay);
  if (!dayTicks.includes(today.day)) {
    dayTicks.push(today.day);
    dayTicks.sort((a, b) => a - b);
  }

  // Hover reads the day off both finishes, so the difference is legible.
  const at = (pts, day) => pts.find((p) => p.day === day)?.pay ?? null;

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="label">{driverName || 'Driver'} take-home this month</h2>
        <span className="flex items-center gap-3 text-xs text-slate-400">
          <Key colour={ACTUAL} label="so far / average pace" />
          {drawable
            .filter((sc) => sc.key !== 'current')
            .map((sc) => (
              <Key key={sc.key} colour={COLOUR[sc.key]} label={sc.label} dashed />
            ))}
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-2">
        Solid to today, dashed for the rest of the month. Today's pace counts only the
        hours driven so far, so it climbs as the shift goes on.
      </p>

      <div ref={wrapRef} className="w-full">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label="Take-home so far and projected under each finish"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - box.left;
            const span = Math.max(1, lastDay - firstDay);
            const day = Math.round(firstDay + ((px - PAD.left) / innerW) * span);
            setHover(Math.min(lastDay, Math.max(firstDay, day)));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke="#262c38" strokeWidth="1" />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#64748b" className="num">
                {shortK(t)}
              </text>
            </g>
          ))}

          {/* Each finish gets its own dash pattern as well as its own hue, so
              the lines stay tellable apart without relying on colour. */}
          {drawable.map((sc) => (
            <path
              key={sc.key}
              d={path(sc.points)}
              fill="none"
              stroke={COLOUR[sc.key]}
              strokeWidth="2"
              strokeDasharray={DASH[sc.key] || '8 4'}
              strokeLinecap="round"
              opacity="0.95"
            />
          ))}

          {/* actual */}
          <path d={path(actual)} fill="none" stroke={ACTUAL} strokeWidth="2.5" strokeLinecap="round" />

          {/* today */}
          <line x1={x(today.day)} x2={x(today.day)} y1={PAD.top} y2={PAD.top + innerH} stroke="#3a4150" strokeWidth="1" />
          <circle cx={x(today.day)} cy={y(today.pay)} r="4.5" fill={ACTUAL} stroke="#141821" strokeWidth="2" />

          {/* end points, labelled directly — the two numbers that matter */}
          {drawable.map((sc) => (
            <EndLabel key={sc.key} x={x(lastDay)} y={y(sc.endPay)} colour={COLOUR[sc.key]} value={sc.endPay} width={width} />
          ))}

          {/* Every day is labelled, thinning to every 2nd or 3rd only when the
              axis is too narrow to fit them without colliding. Today is always
              shown, and stands out. */}
          {dayTicks.map((d) => (
            <text
              key={d}
              x={x(d)}
              y={HEIGHT - 8}
              textAnchor="middle"
              fontSize="10"
              fill={d === today.day ? '#e2e8f0' : '#64748b'}
              fontWeight={d === today.day ? 600 : 400}
              className="num"
            >
              {d}
            </text>
          ))}

          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="#94a3b8" strokeWidth="1" opacity="0.55" />
          )}
        </svg>
      </div>

      <div className="mt-2 text-xs min-h-[2.25rem]">
        {hover !== null && hover > today.day ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-slate-400">
              Day <span className="num text-slate-200">{hover}</span>
            </span>
            {drawable.map((sc) => (
              <Val key={sc.key} colour={COLOUR[sc.key]} label={sc.label} value={at(sc.points, hover)} />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-slate-500">Month end:</span>
            {drawable.map((sc) => (
              <Val key={sc.key} colour={COLOUR[sc.key]} label={sc.label} sc={sc} />
            ))}
            {best && current && best.endPay > current.endPay && (
              <span className="text-accent">
                {money(best.endPay - current.endPay)} more at {best.label}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Direct label at a line's end — selective labelling, not one per point. */
function EndLabel({ x, y, colour, value, width }) {
  const flip = x > width - 90;
  return (
    <g>
      <circle cx={x} cy={y} r="4" fill={colour} stroke="#141821" strokeWidth="2" />
      <text
        x={flip ? x - 8 : x + 8}
        y={y - 8}
        textAnchor={flip ? 'end' : 'start'}
        fontSize="11"
        fill="#e2e8f0"
        className="num"
      >
        {amount(value)}
      </text>
    </g>
  );
}

function Key({ colour, label, dashed }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block w-3.5 h-0 border-t-2"
        style={{ borderColor: colour, borderStyle: dashed ? 'dashed' : 'solid' }}
      />
      {label}
    </span>
  );
}

/**
 * A finish: what he takes home, and the daily earning rate that gets him there.
 *
 * The rate rather than the share of revenue, because the rate is the thing he
 * can act on — "37% of 350,000" describes an outcome, "13,500 a day" describes
 * a shift, and the whole point of showing three paces side by side is to
 * compare the daily numbers.
 */
function Val({ colour, label, value, sc }) {
  const pay = sc ? sc.endPay : value;
  if (pay === null || pay === undefined) return null;
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block w-3 h-[3px] rounded-sm" style={{ background: colour }} />
      <span className="text-slate-500">{label}</span>
      <span className="num text-slate-200">{amount(pay)}</span>
      {sc && sc.dailyRate !== null && sc.dailyRate !== undefined && (
        <span className="text-slate-500">
          at <span className="num">{amount(sc.dailyRate)}</span>/day
        </span>
      )}
    </span>
  );
}

function shortK(v) {
  return v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v));
}

function niceTicks(min, max, count) {
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
  return out;
}

function useElementWidth(ref, fallback) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([entry]) => setW(Math.round(entry.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}
