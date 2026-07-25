import { useEffect, useState, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../api.js';
import { nearest, rateNow, bandAt, TOU_BANDS, HOME_TOU } from '../../shared/chargers.mjs';
import { amount } from '../format.js';

/**
 * Vehicle position plus the nearest CCS2 chargers.
 *
 * Both come from one fetch each on mount — no polling. The charger list is
 * held server-side and editable in Settings, and "nearest" is worked out here
 * in the browser from the vehicle's position, so changing the limit costs
 * nothing: no request, no Lambda invocation.
 *
 * Leaflet with OpenStreetMap tiles: no API key and no billing account, unlike
 * Google Maps. Tiles are darkened with a CSS filter to match the dashboard.
 */
const DEFAULT_LIMIT = 3;
const LIMIT_STEPS = [3, 5, 10, 25];

export default function VehicleMap() {
  const [loc, setLoc] = useState(null);
  const [chargers, setChargers] = useState([]);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  // Default to only stations where CCS2 is actually confirmed — driving to a
  // charger that turns out to be CHAdeMO-only is worse than not seeing it.
  const [confirmedOnly, setConfirmedOnly] = useState(true);
  const [error, setError] = useState('');
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api.location().then((l) => !cancelled && setLoc(l)).catch((e) => !cancelled && setError(e.message));
    api.chargers().then((r) => !cancelled && setChargers(r.chargers || [])).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const band = bandAt();
  const pool = useMemo(
    () => (confirmedOnly ? chargers.filter((c) => c.ccs2 === 'confirmed') : chargers),
    [chargers, confirmedOnly],
  );
  const near = useMemo(
    () => (loc?.available && pool.length ? nearest(pool, loc.lat, loc.lng, limit) : []),
    [loc, pool, limit],
  );
  const hiddenCount = chargers.length - pool.length;

  // The nearest charger is often not the cheapest — LKR 150 against 70 is real
  // money per charge — so both are called out, separately and side by side.
  const closest = near[0] || null;
  const cheapest = useMemo(() => {
    const priced = near.filter((c) => rateNow(c) !== null);
    if (!priced.length) return null;
    return priced.reduce((best, c) => (rateNow(c) < rateNow(best) ? c : best));
  }, [near]);
  const sameSite = closest && cheapest && closest.id === cheapest.id;

  // Create the map once, then repaint markers whenever the selection changes.
  useEffect(() => {
    if (!loc?.available || !mapEl.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(mapEl.current, { attributionControl: true, zoomControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(mapRef.current);
      layerRef.current = L.layerGroup().addTo(mapRef.current);
    }

    const map = mapRef.current;
    layerRef.current.clearLayers();

    L.marker([loc.lat, loc.lng], { icon: pin('#4ade80', '🚗'), zIndexOffset: 1000 })
      .bindPopup(
        `<b>${escapeHtml(loc.plate || 'Vehicle')}</b>` +
          `<br>${escapeHtml(statusText(loc))}` +
          `<br>${mapsLink(placeUrl(loc.lat, loc.lng), 'View on Google Maps')}`,
      )
      .addTo(layerRef.current);

    for (const c of near) {
      const rate = rateNow(c);
      const isCheapest = cheapest && c.id === cheapest.id;
      const isClosest = closest && c.id === closest.id;
      L.marker([c.lat, c.lng], {
        icon: pin(
          rateColour(rate),
          c.ccs2 === 'confirmed' ? '⚡' : '?',
          isCheapest ? '#4ade80' : isClosest ? '#e2e8f0' : null,
        ),
        zIndexOffset: isCheapest || isClosest ? 500 : 0,
      })
        .bindPopup(
          `<b>${escapeHtml(c.name)}</b><br>${escapeHtml(c.address || '')}` +
            `<br>${c.distanceKm} km away` +
            (rate ? `<br><b>LKR ${rate}/kWh</b> (${TOU_BANDS[band].label.toLowerCase()})` : '<br>rate unknown') +
            (isCheapest ? '<br><span style="color:#4ade80;font-weight:600">✓ cheapest shown</span>' : '') +
            (isClosest ? '<br><span style="color:#e2e8f0;font-weight:600">✓ closest</span>' : '') +
            (c.app ? `<br>App: ${escapeHtml(c.app)}` : '') +
            (c.ccs2 === 'confirmed'
              ? `<br><span style="color:#4ade80">CCS2 confirmed</span>${c.source ? ` · ${escapeHtml(c.source)}` : ''}`
              : '<br><span style="color:#fbbf24">CCS2 NOT confirmed — check before relying on it</span>') +
            (c.position === 'approx' ? '<br><span style="color:#64748b">approximate location</span>' : '') +
            // Directions rather than a plain pin: the point of tapping a
            // charger is to drive to it.
            `<br>${mapsLink(directionsUrl(c.lat, c.lng), 'Directions in Google Maps')}`,
        )
        .addTo(layerRef.current);
    }

    const points = [[loc.lat, loc.lng], ...near.map((c) => [c.lat, c.lng])];
    if (points.length > 1) map.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
    else map.setView([loc.lat, loc.lng], 14);

    // The container is sized by CSS after mount; Leaflet needs telling.
    setTimeout(() => map.invalidateSize(), 0);
  }, [loc, near, band, cheapest, closest]);

  useEffect(() => () => mapRef.current?.remove(), []);

  if (error) return <Card><p className="text-sm text-slate-500">Location unavailable — {error}</p></Card>;
  if (!loc) return <Card><p className="text-sm text-slate-500">Locating vehicle…</p></Card>;
  if (!loc.available) {
    return (
      <Card>
        <p className="text-sm text-slate-500">
          No position from the tracker{loc.reason ? ` — ${loc.reason}` : '.'}
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 className="label">
          Vehicle &amp; charging{loc.plate ? ` · ${loc.plate}` : ''}
        </h2>
        <span className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
          <Status loc={loc} />
          <span>
            fix <Ago iso={loc.fixedAt} ageSeconds={loc.fixAgeSeconds} />
          </span>
        </span>
      </div>

      {/* Only the tiles are darkened (see index.css) — inverting the whole
          container would also invert the price-coded markers. */}
      <div
        ref={mapEl}
        className="fleet-map w-full h-72 sm:h-96 rounded-lg overflow-hidden border border-ink-800 z-0"
      />

      <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
        <span className="text-xs text-slate-500">
          Nearest <span className="num text-slate-300">{near.length}</span> CCS2 chargers ·
          now on <span className="text-slate-300">{TOU_BANDS[band].label.toLowerCase()}</span> rate
          ({TOU_BANDS[band].from}–{TOU_BANDS[band].to})
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setConfirmedOnly((v) => !v)}
            className={`btn text-xs px-2 py-1 mr-2 ${confirmedOnly ? 'border-accent/50 text-accent' : ''}`}
            title={confirmedOnly ? `${hiddenCount} station(s) hidden where CCS2 is unconfirmed` : 'Showing stations where CCS2 is not confirmed'}
          >
            {confirmedOnly ? 'CCS2 confirmed only' : 'including unconfirmed'}
          </button>
          <span className="text-xs text-slate-500 mr-1">show</span>
          {LIMIT_STEPS.map((n) => (
            <button
              key={n}
              onClick={() => setLimit(n)}
              className={`btn text-xs px-2 py-1 ${limit === n ? 'border-accent/50 text-accent' : ''}`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {(closest || cheapest) && (
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <Pick
            title={sameSite ? 'Closest — and cheapest' : 'Closest'}
            tone={sameSite ? 'accent' : 'slate'}
            charger={closest}
          />
          {!sameSite && <Pick title="Cheapest" tone="accent" charger={cheapest} />}
        </div>
      )}

      {near.length > 0 && (
        <ul className="mt-3 divide-y divide-ink-800 border-t border-ink-800">
          {near.map((c) => {
            const rate = rateNow(c);
            return (
              <li key={c.id} className="py-2 flex items-baseline justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm text-slate-200 flex items-baseline gap-2 flex-wrap">
                    <span>{c.name}</span>
                    {c.ccs2 !== 'confirmed' && (
                      <span
                        className="text-[10px] uppercase tracking-wider text-warn border border-warn/40 bg-warn/10 rounded px-1"
                        title="A charger exists here, but nobody has confirmed a CCS2 gun. Check before relying on it."
                      >
                        CCS2 not sure
                      </span>
                    )}
                    {cheapest && c.id === cheapest.id && (
                      <span className="text-[10px] uppercase tracking-wider text-accent border border-accent/40 bg-accent/10 rounded px-1">
                        cheapest
                      </span>
                    )}
                    {c.position === 'approx' && (
                      <span
                        className="text-[10px] uppercase tracking-wider text-slate-600 border border-ink-700 rounded px-1"
                        title="Charger confirmed at this branch, but the pin is the locality — can be ~1 km out"
                      >
                        approx location
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    <span className="num">{c.distanceKm}</span> km
                    {c.address ? ` · ${c.address}` : ''}
                    {c.app ? ` · ${c.app}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div
                    className={`text-right rounded-md border px-2 py-1 ${
                      rate ? rateChip(rate) : 'border-ink-700 text-slate-600'
                    }`}
                  >
                    <div className="num text-sm font-semibold leading-tight">
                      {rate ? amount(rate) : '—'}
                    </div>
                    <div className="text-[10px] opacity-70 leading-tight">LKR/kWh</div>
                  </div>
                  <a
                    href={directionsUrl(c.lat, c.lng)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn text-xs px-2 py-1"
                    title={`Directions to ${c.name}`}
                  >
                    Directions
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-slate-600 mt-3">
        Home charging on a D-TOU meter is{' '}
        <span className="num text-slate-400">LKR {HOME_TOU.offPeak}/kWh</span> off-peak
        ({TOU_BANDS.offPeak.from}–{TOU_BANDS.offPeak.to}) — cheaper than any public DC rate here.
      </p>
    </Card>
  );
}

/**
 * One of the two headline choices. The rate is the point of the tile, so it is
 * the largest thing in it — the nearest charger being nearly twice the price is
 * exactly the decision this is meant to inform.
 */
function Pick({ title, tone, charger }) {
  if (!charger) return null;
  const rate = rateNow(charger);
  const accent = tone === 'accent';
  return (
    <div
      className={`rounded-md border px-3 py-2 ${
        accent ? 'border-accent/40 bg-accent/5' : 'border-ink-700 bg-ink-950/40'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={`label ${accent ? 'text-accent' : 'text-slate-400'}`}>{title}</span>
        <span className="num text-xs text-slate-500">{charger.distanceKm} km</span>
      </div>
      <div className="text-sm text-slate-200 mt-1 truncate" title={charger.name}>
        {charger.name}
      </div>
      <div className="flex items-end justify-between gap-2 mt-0.5">
        <div className={`num text-lg ${rate ? rateClass(rate) : 'text-slate-600'}`}>
          {rate ? `LKR ${amount(rate)}` : 'rate unknown'}
          {rate && <span className="text-xs text-slate-500"> /kWh</span>}
        </div>
        {/* The point of surfacing a station is to go to it, so the action sits
            on the recommendation rather than only in the list below. */}
        <a
          href={directionsUrl(charger.lat, charger.lng)}
          target="_blank"
          rel="noreferrer"
          className={`btn text-xs px-2 py-1 shrink-0 ${
            accent ? 'btn-primary' : ''
          }`}
          title={`Directions to ${charger.name}`}
        >
          Directions
        </a>
      </div>
    </div>
  );
}

/* Cheap → expensive, so the map is readable at a glance. */
function rateColour(rate) {
  if (rate === null || rate === undefined) return '#64748b';
  if (rate <= 60) return '#4ade80';
  if (rate <= 90) return '#fbbf24';
  return '#f87171';
}
/** Background chip for the per-row rate, same cheap→expensive scale. */
function rateChip(rate) {
  if (rate <= 60) return 'border-accent/40 bg-accent/10 text-accent';
  if (rate <= 90) return 'border-warn/40 bg-warn/10 text-warn';
  return 'border-danger/40 bg-danger/10 text-danger';
}
function rateClass(rate) {
  if (rate <= 60) return 'text-accent';
  if (rate <= 90) return 'text-warn';
  return 'text-danger';
}

/** Inline SVG pin — avoids Leaflet's default icons, which 404 under Vite. */
/** `ring` highlights a station: green for cheapest, light for closest. */
function pin(colour, glyph, ring = null) {
  const size = ring ? 34 : 26;
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;align-items:center;justify-content:center;
      width:${size}px;height:${size}px;border-radius:50%;background:${colour};
      border:${ring ? `3px solid ${ring}` : '2px solid #0a0c10'};
      font-size:${ring ? 16 : 13}px;line-height:1;
      box-shadow:${ring ? `0 0 0 4px ${ring}40, 0 1px 6px rgba(0,0,0,.6)` : '0 1px 4px rgba(0,0,0,.5)'}"
      >${glyph}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 2)],
  });
}

/** Google Maps deep links. Both open the native app on a phone. */
function placeUrl(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
function directionsUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
function mapsLink(href, label) {
  return `<a href="${href}" target="_blank" rel="noreferrer" style="color:#4ade80;font-weight:600">${label} ↗</a>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Movement status.
 *
 * The tracker's own speed field reads 0 permanently on this device, so the API
 * derives speed from how far the vehicle moved between fixes. When it has only
 * one fix to go on it says "position only" rather than claiming "stationary" —
 * which is what the old code did, and why the car always looked parked.
 */
function Status({ loc }) {
  const { status, speedKmh, movedM } = loc;

  if (status === 'offline') {
    return <Chip tone="warn">offline</Chip>;
  }
  if (status === 'moving') {
    return (
      <Chip tone="accent">
        moving{speedKmh != null ? ` · ${speedKmh} km/h` : movedM != null ? ` · ${movedM} m` : ''}
      </Chip>
    );
  }
  if (status === 'parked') return <Chip tone="slate">parked</Chip>;
  return (
    <Chip tone="slate" title="Only one fix so far — movement is known once a second fix arrives">
      position only
    </Chip>
  );
}

function statusText(loc) {
  if (loc.status === 'offline') return 'offline';
  if (loc.status === 'moving') return loc.speedKmh != null ? `moving · ${loc.speedKmh} km/h` : 'moving';
  if (loc.status === 'parked') return 'parked';
  return 'position only';
}

function Chip({ tone, children, title }) {
  const tones = {
    accent: 'text-accent border-accent/40 bg-accent/10',
    warn: 'text-warn border-warn/40 bg-warn/10',
    slate: 'text-slate-400 border-ink-700 bg-ink-800/60',
  };
  return (
    <span className={`text-[11px] px-1.5 py-0.5 rounded border ${tones[tone]}`} title={title}>
      {children}
    </span>
  );
}

/**
 * Age of the fix. Prefers the age the API measured against the tracker's own
 * clock — comparing our clock to the portal's timestamp assumes we agree on its
 * timezone, and we did not: it stamps +05:00, not Colombo's +05:30.
 */
function Ago({ iso, ageSeconds }) {
  let ms;
  if (ageSeconds !== null && ageSeconds !== undefined) ms = ageSeconds * 1000;
  else if (iso) ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return <span>time unknown</span>;
  const mins = Math.round(ms / 60000);
  const text =
    mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
  return <span className={mins > 30 ? 'text-warn' : 'text-slate-400'}>{text}</span>;
}

function Card({ children }) {
  return <div className="card">{children}</div>;
}
