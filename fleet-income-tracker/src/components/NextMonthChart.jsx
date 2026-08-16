import { useEffect, useMemo, useRef, useState } from 'react';
import { calculatePay } from '../../shared/commission.mjs';
import { amount, count, monthLabel } from '../format.js';
import {
  COLOUR,
  DASH,
  EndLabel,
  Key,
  niceTicks,
  shortK,
  spreadLabels,
  useElementWidth,
} from './ProjectionChart.jsx';

/**
 * Next month's take-home, built up day by day under each pace.
 *
 * The card beside this gives one number per pace; the chart gives the shape,
 * and the shape is where the plan lives. The lines are not straight even though
 * the daily revenue is: pay is flat at the base until revenue reaches the band,
 * then rises at one rate, then a steeper one. Each kink is a tier being
 * reached, and the day it happens is the thing worth knowing — it turns "you
 * would finish on 94,811" into "you would be into tier 3 by the 22nd", which is
 * a target you can still act on halfway through the month.
 *
 * Next month rather than this one because this month is partial and prorated:
 * the bands are scaled down, so it says nothing about how the arrangement
 * behaves in the ordinary case.
 *
 * Same colours and dashes as the current-month chart, so a pace keeps its
 * identity across both.
 *
 * The fourth line is his own: a daily rate he can set, starting at yesterday's,
 * so the question stops being "what will happen" and becomes "what would I have
 * to do". Priced in the browser from the plan the API sends, which is why it
 * moves as the number changes rather than waiting on a round trip. While it
 * matches yesterday's rate the built-in yesterday line is dropped, since two
 * lines drawn on top of each other say less than one.
 */
const PAD = { top: 22, right: 16, bottom: 26, left: 62 };
const HEIGHT = 230;

export default function NextMonthChart({ summary }) {
  const n = summary.nextMonth;
  const wrapRef = useRef(null);
  const width = useElementWidth(wrapRef, 640);
  const [hover, setHover] = useState(null);
  const [customRate, setCustomRate] = useState(null);

  const base = n?.series || [];
  // Yesterday if there is one, else the running average: the point of the
  // default is to start somewhere real rather than at zero.
  const defaultRate =
    base.find((l) => l.key === 'yesterday')?.dailyRate ?? base[0]?.dailyRate ?? 0;
  useEffect(() => {
    setCustomRate((r) => (r === null ? defaultRate : r));
  }, [defaultRate]);

  const rate = customRate === null ? defaultRate : customRate;
  const custom = useMemo(
    () => (n && rate > 0 ? buildLine(rate, n) : null),
    [rate, n],
  );

  const matchesYesterday =
    custom && Math.abs(rate - (base.find((l) => l.key === 'yesterday')?.dailyRate ?? -1)) < 1;
  const lines = [
    ...base.filter((l) => !(matchesYesterday && l.key === 'yesterday')),
    ...(custom ? [custom] : []),
  ];
  if (lines.length === 0) return null;

  const innerW = Math.max(120, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const lastDay = n.days;
  const allPay = lines.flatMap((l) => l.points.map((p) => p.pay));
  const maxY = Math.max(...allPay) * 1.12;
  const minY = Math.min(...allPay) * 0.9;

  const x = (day) => PAD.left + ((day - 1) / Math.max(1, lastDay - 1)) * innerW;
  const y = (v) => PAD.top + innerH - ((v - minY) / Math.max(1, maxY - minY)) * innerH;
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day)},${y(p.pay)}`).join(' ');

  const ticks = niceTicks(minY, maxY, 3);
  const step = Math.max(1, Math.ceil(lastDay / Math.max(1, Math.floor(innerW / 22))));
  const dayTicks = [];
  for (let d = 1; d <= lastDay; d += step) dayTicks.push(d);
  if (dayTicks[dayTicks.length - 1] !== lastDay) dayTicks.push(lastDay);

  const endLabels = spreadLabels(
    lines.map((l) => ({ key: l.key, colour: COLOUR[l.key], value: l.endPay, y: y(l.endPay) })),
    PAD.top,
    PAD.top + innerH,
  );

  const at = (pts, day) => pts.find((p) => p.day === day)?.pay ?? null;

  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="label">
          {summary.driverName || 'Driver'} take-home in {monthLabel(`${n.month}-01`)}
        </h2>
        <span className="flex items-center gap-3 text-xs text-slate-400">
          {lines.map((l) => (
            <Key
              key={l.key}
              colour={COLOUR[l.key]}
              label={l.key === 'stretch' && matchesYesterday ? "your rate (yesterday's)" : l.label}
              dashed={l.key !== 'stretch'}
            />
          ))}
        </span>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        A full month on full bands. Each bend is a tier being reached — the flat stretch is the
        base, before the band pays anything extra.
      </p>

      {/* His own line. A rate he sets is a target; a rate we derive is a
          forecast, and only one of those is something he can decide to hit. */}
      {custom && (
        <div className="flex items-center gap-3 flex-wrap mb-3 rounded-md border border-ink-700 bg-ink-950/40 px-3 py-2">
          <label className="text-xs text-slate-400 whitespace-nowrap" htmlFor="custom-rate">
            If he averages
          </label>
          <input
            id="custom-rate"
            type="number"
            step="500"
            min="0"
            className="num w-32"
            value={Math.round(rate)}
            onChange={(e) => setCustomRate(Math.max(0, Number(e.target.value) || 0))}
          />
          <span className="text-xs text-slate-400">a day</span>
          <input
            type="range"
            min="0"
            max={Math.round(Math.max(defaultRate * 2, 25000))}
            step="250"
            value={Math.round(rate)}
            onChange={(e) => setCustomRate(Number(e.target.value))}
            className="flex-1 min-w-[8rem] accent-[#3987e5]"
            aria-label="Daily rate"
          />
          <span className="text-xs num text-slate-300 whitespace-nowrap">
            {amount(custom.endPay)} take-home
          </span>
          {Math.abs(rate - defaultRate) > 1 && (
            <button
              type="button"
              className="text-xs text-slate-400 hover:text-slate-300"
              onClick={() => setCustomRate(defaultRate)}
            >
              reset
            </button>
          )}
        </div>
      )}

      <div ref={wrapRef} className="w-full">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Projected take-home through ${monthLabel(`${n.month}-01`)} under each pace`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const day = Math.round(1 + ((e.clientX - box.left - PAD.left) / innerW) * (lastDay - 1));
            setHover(Math.min(lastDay, Math.max(1, day)));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={PAD.left + innerW}
                y1={y(t)}
                y2={y(t)}
                stroke="#262c38"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 8}
                y={y(t) + 4}
                textAnchor="end"
                fontSize="11"
                fill="#64748b"
                className="num"
              >
                {shortK(t)}
              </text>
            </g>
          ))}

          {lines.map((l) => (
            <path
              key={l.key}
              d={path(l.points)}
              fill="none"
              stroke={COLOUR[l.key]}
              strokeWidth={l.key === 'stretch' ? 2.5 : 2}
              strokeDasharray={l.key === 'stretch' ? undefined : DASH[l.key] || '8 4'}
              strokeLinecap="round"
              opacity="0.95"
            />
          ))}

          {/* The day each pace reaches the top tier, marked on its own line —
              a dot rather than a rule, so three of them do not become a grid. */}
          {lines.map((l) =>
            l.topDay ? (
              <circle
                key={`top-${l.key}`}
                cx={x(l.topDay)}
                cy={y(at(l.points, l.topDay))}
                r="3.5"
                fill="#141821"
                stroke={COLOUR[l.key]}
                strokeWidth="2"
              />
            ) : null,
          )}

          {endLabels.map((l) => (
            <EndLabel
              key={l.key}
              x={x(lastDay)}
              y={l.y}
              labelY={l.labelY}
              colour={l.colour}
              value={l.value}
              width={width}
            />
          ))}

          {dayTicks.map((d) => (
            <text
              key={d}
              x={x(d)}
              y={HEIGHT - 8}
              textAnchor="middle"
              fontSize="10"
              fill="#64748b"
              className="num"
            >
              {d}
            </text>
          ))}

          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="#94a3b8"
              strokeWidth="1"
              opacity="0.55"
            />
          )}
        </svg>
      </div>

      <div className="mt-2 text-xs min-h-[2.25rem]">
        {hover !== null ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-slate-400">
              Day <span className="num text-slate-200">{hover}</span>
            </span>
            {lines.map((l) => (
              <span key={l.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block w-3 h-[3px] rounded-sm"
                  style={{ background: COLOUR[l.key] }}
                />
                <span className="text-slate-400">{l.label}</span>
                <span className="num text-slate-200">{amount(at(l.points, hover))}</span>
              </span>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {lines.map((l) => (
              <span key={l.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block w-3 h-[3px] rounded-sm"
                  style={{ background: COLOUR[l.key] }}
                />
                <span className="text-slate-400">
                  {l.key === 'stretch' && matchesYesterday ? "your rate (yesterday's)" : l.label}
                </span>
                <span className="num text-slate-200">{amount(l.endPay)}</span>
                <span className="text-slate-400">
                  at <span className="num">{amount(l.dailyRate)}</span>/day
                </span>
                {l.topDay ? (
                  <span className="text-slate-100">
                    · tier 3 by day <span className="num">{count(l.topDay)}</span>
                  </span>
                ) : l.bandDay ? (
                  <span className="text-warn">
                    · tier 2 by day <span className="num">{count(l.bandDay)}</span>
                  </span>
                ) : (
                  <span className="text-slate-400">· base only</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Price a daily rate across next month, the same way the API does for the
 * built-in paces — recomputed at each running total, because the plan is
 * piecewise and a scaled figure would miss the tier boundaries entirely.
 *
 * Uses the 'stretch' slot's blue, which the current-month chart uses for its
 * own stretch line and which is validated against the other three for
 * colour-vision separation.
 */
function buildLine(rate, n) {
  const plan = n.plan;
  const points = [];
  for (let day = 1; day <= n.days; day++) {
    const revenue = rate * day;
    points.push({ day, revenue, pay: calculatePay(revenue, plan, 1).total });
  }
  const end = points[points.length - 1];
  return {
    key: 'stretch',
    label: 'your rate',
    dailyRate: rate,
    endRevenue: end.revenue,
    endPay: end.pay,
    bandDay: points.find((p) => p.revenue >= plan.bandStart)?.day ?? null,
    topDay: points.find((p) => p.revenue >= plan.bandEnd)?.day ?? null,
    points,
  };
}
