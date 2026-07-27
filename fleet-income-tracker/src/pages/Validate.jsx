import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { amount, count, dayLabel, pct } from '../format.js';
import MonthNav from '../components/MonthNav.jsx';

/**
 * GPS check: days where both distance sources exist.
 *
 * Uber's figure is on-trip distance only, so total odometer distance always
 * runs well above it — this fleet averages about 1.9x. The flag marks days
 * where the gap is far larger than that, meaning the car covered ground its
 * fares do not account for.
 */
export default function Validate({ month, setMonth }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.validate(month).then(setData).catch((e) => setError(e.message));
  }, [month]);

  return (
    <div>
      <MonthNav month={month} setMonth={setMonth} />
      {error && (
        <p className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2 mb-4">
          {error}
        </p>
      )}

      {data && (
        <div className="card overflow-x-auto">
          <div className="flex items-baseline justify-between mb-3 gap-4 flex-wrap">
            <h2 className="label">Uber km vs GPS km</h2>
            <span className="text-xs text-slate-400">
              Uber counts on-trip km only · flagged above{' '}
              <span className="num">+{data.threshold}%</span> ·{' '}
              <span className={data.flaggedCount ? 'text-warn' : 'text-slate-400'}>
                <span className="num">{count(data.flaggedCount)}</span> flagged
              </span>
            </span>
          </div>

          {data.rows.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">
              No day this month has both an Uber km and a GPS km reading. Import a trip
              activity CSV for Uber distance; GPS mileage arrives from the nightly sync.
            </p>
          ) : (
            <table className="w-full text-sm min-w-[36rem]">
              <thead>
                <tr>
                  <th className="th">Date</th>
                  <th className="th text-right">Uber km</th>
                  <th className="th text-right">GPS km</th>
                  <th className="th text-right">Δ km</th>
                  <th className="th text-right">Δ %</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.date} className={r.flagged ? 'bg-warn/5' : ''}>
                    <td className="td num whitespace-nowrap">{dayLabel(r.date)}</td>
                    <td className="td num text-right">{amount(r.uberKm)}</td>
                    <td className="td num text-right">{amount(r.gpsKm)}</td>
                    <td className={`td num text-right ${r.flagged ? 'text-warn' : 'text-slate-400'}`}>
                      {r.deltaKm > 0 ? '+' : ''}
                      {amount(r.deltaKm)}
                    </td>
                    <td className={`td num text-right ${r.flagged ? 'text-warn' : 'text-slate-400'}`}>
                      {pct(r.deltaPct)}
                    </td>
                    <td className="td">
                      {r.flagged ? (
                        <span className="text-xs px-2 py-0.5 rounded bg-warn/15 text-warn border border-warn/30">
                          check
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">ok</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
