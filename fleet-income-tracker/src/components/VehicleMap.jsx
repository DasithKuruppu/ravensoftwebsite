import { useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * Last known position of the car.
 *
 * Fetched once when the dashboard mounts — no polling, since the tracker only
 * reports every few minutes anyway and a page refresh is the natural way to ask
 * again. The map is OpenStreetMap's embed iframe: no API key, no billing, no
 * JS dependency, unlike Google Maps.
 *
 * The fix time is always shown. A tracker that has lost signal keeps returning
 * its last known point, so a position without a timestamp would be misleading.
 */
export default function VehicleMap() {
  const [loc, setLoc] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .location()
      .then((l) => !cancelled && setLoc(l))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Card>
        <p className="text-sm text-slate-500">Location unavailable — {error}</p>
      </Card>
    );
  }

  if (!loc) {
    return (
      <Card>
        <p className="text-sm text-slate-500">Locating vehicle…</p>
      </Card>
    );
  }

  if (!loc.available) {
    return (
      <Card>
        <p className="text-sm text-slate-500">
          No position from the tracker{loc.reason ? ` — ${loc.reason}` : '.'}
        </p>
      </Card>
    );
  }

  const { lat, lng, speedKmh, fixedAt, plate } = loc;
  // A small bounding box around the point gives a street-level view.
  const d = 0.004;
  const bbox = [lng - d, lat - d / 2, lng + d, lat + d / 2].join('%2C');
  const embed = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
  const external = `https://www.google.com/maps?q=${lat},${lng}`;

  const moving = speedKmh > 3;

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 className="label">
          Vehicle location{plate ? ` · ${plate}` : ''}
        </h2>
        <span className="text-xs text-slate-500">
          <span className={moving ? 'text-accent' : 'text-slate-400'}>
            {moving ? `moving · ${speedKmh} km/h` : 'stationary'}
          </span>
          {' · '}
          <Ago iso={fixedAt} />
        </span>
      </div>

      <div className="rounded-lg overflow-hidden border border-ink-800 bg-ink-950">
        <iframe
          title="Vehicle location"
          src={embed}
          className="w-full h-64 sm:h-80"
          loading="lazy"
          referrerPolicy="no-referrer"
          // OSM only ships light tiles. Inverting and rotating the hue back
          // gives a dark map that sits with the rest of the dashboard; the
          // marker stays legible because it inverts along with everything else.
          style={{ filter: 'invert(0.92) hue-rotate(180deg) saturate(0.75) brightness(0.95)' }}
        />
      </div>

      <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
        <span className="num text-xs text-slate-500">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </span>
        <a
          href={external}
          target="_blank"
          rel="noreferrer"
          className="btn text-xs"
        >
          Open in Google Maps
        </a>
      </div>
    </Card>
  );
}

/** "4 minutes ago" — the age of the fix matters as much as the fix. */
function Ago({ iso }) {
  if (!iso) return <span>time unknown</span>;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return <span>time unknown</span>;

  const mins = Math.round(ms / 60000);
  let text;
  if (mins < 1) text = 'just now';
  else if (mins < 60) text = `${mins} min ago`;
  else if (mins < 60 * 24) text = `${Math.round(mins / 60)} h ago`;
  else text = `${Math.round(mins / 1440)} d ago`;

  // A fix older than half an hour is worth flagging: the car may be parked
  // underground, or the tracker may be offline.
  const stale = mins > 30;
  return <span className={stale ? 'text-warn' : 'text-slate-400'}>{text}</span>;
}

function Card({ children }) {
  return <div className="card">{children}</div>;
}
