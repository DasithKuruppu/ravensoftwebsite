import { useEffect, useRef, useState } from 'react';
import { amount } from '../format.js';

/**
 * Cumulative revenue and take-home across the month, actual then projected.
 *
 * Two series on ONE axis — both are LKR, so a second scale would be a lie about
 * their relative size. The gap between the lines is the owner's share, which is
 * readable directly because they share a scale.
 *
 * The pay line is drawn rather than described because the plan is piecewise:
 * flat at the base until revenue reaches the band, then rising at one rate,
 * then a steeper one. A reference line marks the band threshold, which is the
 * question the chart exists to answer — will the month get there.
 *
 * Colours are the validated categorical pair for this dark surface (#141821):
 * blue #3987e5 and aqua #199e70 — checked for lightness band, chroma floor,
 * all-pairs CVD separation (worst ΔE 19.6 under deuteranopia) and contrast.
 * The app's own accent green fails the lightness band as a chart mark here.
 */
const REVENUE = '#3987e5';
const PAY = '#199e70';

const PAD = { top: 18, right: 16, bottom: 26, left: 60 };
const HEIGHT = 240;

export default function ProjectionChart({ summary }) {
  const { series = [], plan, driverName } = summary;
  const wrapRef = useRef(null);
  const width = useElementWidth(wrapRef, 640);
  const [hover, setHover] = useState(null);

  if (series.length < 2) return null;

  const innerW = Math.max(120, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const bandStart = plan?.bandStart ?? 0;
  const maxY = Math.max(...series.map((p) => p.revenue), bandStart * 1.06, 1);
  const days = series.map((p) => p.day);

  const x = (day) => PAD.left + ((day - days[0]) / Math.max(1, days.length - 1)) * innerW;
  const y = (v) => PAD.top + innerH - (v / maxY) * innerH;

  const lastActual = [...series].reverse().find((p) => !p.projected) || series[0];
  const actual = series.filter((p) => !p.projected);
  // Start the projected path at the last actual point so the line is continuous.
  const projected = series.filter((p) => p.projected);
  const projectedPath = projected.length ? [lastActual, ...projected] : [];

  const line = (pts, key) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day)},${y(p[key])}`).join(' ');
  const ticks = niceTicks(maxY, 4);
  const end = series[series.length - 1];

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="label">Month projection</h2>
        <Legend driverName={driverName} />
      </div>
      <p className="text-xs text-slate-500 mb-2">
        Solid to today, dashed at the current daily rate
      </p>

      <div ref={wrapRef} className="w-full">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label="Cumulative revenue and take-home for the month, actual and projected"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - box.left;
            const i = Math.round(((px - PAD.left) / innerW) * (days.length - 1));
            setHover(series[Math.min(series.length - 1, Math.max(0, i))] || null);
          }}
        >
          {/* recessive grid */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke="#262c38" strokeWidth="1" />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#64748b" className="num">
                {shortK(t)}
              </text>
            </g>
          ))}

          {/* band threshold — the number the month is trying to reach */}
          {bandStart > 0 && bandStart <= maxY && (
            <g>
              <line
                x1={PAD.left}
                x2={PAD.left + innerW}
                y1={y(bandStart)}
                y2={y(bandStart)}
                stroke="#fbbf24"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.75"
              />
              <text x={PAD.left + innerW} y={y(bandStart) - 5} textAnchor="end" fontSize="10" fill="#fbbf24">
                tier 2 from {shortK(bandStart)}
              </text>
            </g>
          )}

          {/* revenue */}
          <path d={line(actual, 'revenue')} fill="none" stroke={REVENUE} strokeWidth="2" strokeLinecap="round" />
          {projectedPath.length > 1 && (
            <path
              d={line(projectedPath, 'revenue')}
              fill="none"
              stroke={REVENUE}
              strokeWidth="2"
              strokeDasharray="5 4"
              strokeLinecap="round"
              opacity="0.85"
            />
          )}

          {/* take-home */}
          <path d={line(actual, 'pay')} fill="none" stroke={PAY} strokeWidth="2" strokeLinecap="round" />
          {projectedPath.length > 1 && (
            <path
              d={line(projectedPath, 'pay')}
              fill="none"
              stroke={PAY}
              strokeWidth="2"
              strokeDasharray="5 4"
              strokeLinecap="round"
              opacity="0.85"
            />
          )}

          {/* today marker */}
          <line
            x1={x(lastActual.day)}
            x2={x(lastActual.day)}
            y1={PAD.top}
            y2={PAD.top + innerH}
            stroke="#3a4150"
            strokeWidth="1"
          />
          <circle cx={x(lastActual.day)} cy={y(lastActual.revenue)} r="4" fill={REVENUE} stroke="#141821" strokeWidth="2" />
          <circle cx={x(lastActual.day)} cy={y(lastActual.pay)} r="4" fill={PAY} stroke="#141821" strokeWidth="2" />

          {/* x axis: first, today, last */}
          {[days[0], lastActual.day, days[days.length - 1]].map((d, i) => (
            <text
              key={`${d}-${i}`}
              x={x(d)}
              y={HEIGHT - 8}
              textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
              fontSize="11"
              fill="#64748b"
              className="num"
            >
              {d}
            </text>
          ))}

          {/* hover crosshair */}
          {hover && (
            <g>
              <line x1={x(hover.day)} x2={x(hover.day)} y1={PAD.top} y2={PAD.top + innerH} stroke="#94a3b8" strokeWidth="1" opacity="0.6" />
              <circle cx={x(hover.day)} cy={y(hover.revenue)} r="5" fill={REVENUE} stroke="#141821" strokeWidth="2" />
              <circle cx={x(hover.day)} cy={y(hover.pay)} r="5" fill={PAY} stroke="#141821" strokeWidth="2" />
            </g>
          )}
        </svg>
      </div>

      {/* Tooltip as HTML rather than SVG text, so it wraps and uses real tokens. */}
      <div className="mt-2 text-xs min-h-[2.5rem]">
        {hover ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-slate-400">
              Day <span className="num text-slate-200">{hover.day}</span>
              {hover.projected && <span className="text-slate-600"> · projected</span>}
            </span>
            <Value colour={REVENUE} label="revenue" value={hover.revenue} />
            <Value colour={PAY} label="take-home" value={hover.pay} />
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-slate-500">At month end:</span>
            <Value colour={REVENUE} label="revenue" value={end.revenue} />
            <Value colour={PAY} label="take-home" value={end.pay} />
            {bandStart > end.revenue && (
              <span className="text-warn">
                <span className="num">{amount(bandStart - end.revenue)}</span> short of tier 2
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Legend({ driverName }) {
  return (
    <span className="flex items-center gap-3 text-xs text-slate-400">
      <span className="flex items-center gap-1.5">
        <Swatch colour={REVENUE} /> revenue
      </span>
      <span className="flex items-center gap-1.5">
        <Swatch colour={PAY} /> {driverName || 'driver'} take-home
      </span>
    </span>
  );
}

function Swatch({ colour }) {
  return <span className="inline-block w-3 h-[3px] rounded-sm" style={{ background: colour }} />;
}

/** Value in ink tokens with a coloured mark beside it — never coloured text. */
function Value({ colour, label, value }) {
  return (
    <span className="flex items-center gap-1.5">
      <Swatch colour={colour} />
      <span className="text-slate-500">{label}</span>
      <span className="num text-slate-200">{amount(value)}</span>
    </span>
  );
}

function shortK(v) {
  if (v >= 1000) return `${Math.round(v / 1000)}k`;
  return String(Math.round(v));
}

function niceTicks(max, count) {
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const out = [];
  for (let v = 0; v <= max; v += step) out.push(v);
  return out;
}

/** Render at real pixel width so text stays legible instead of scaling down. */
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
