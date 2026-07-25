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
          `<br>${loc.speedKmh > 3 ? `${loc.speedKmh} km/h` : 'stationary'}` +
          `<br>${mapsLink(placeUrl(loc.lat, loc.lng), 'View on Google Maps')}`,
      )
      .addTo(layerRef.current);

    for (const c of near) {
      const rate = rateNow(c);
      L.marker([c.lat, c.lng], { icon: pin(rateColour(rate), c.ccs2 === 'confirmed' ? '⚡' : '?') })
        .bindPopup(
          `<b>${escapeHtml(c.name)}</b><br>${escapeHtml(c.address || '')}` +
            `<br>${c.distanceKm} km away` +
            (rate ? `<br><b>LKR ${rate}/kWh</b> (${TOU_BANDS[band].label.toLowerCase()})` : '<br>rate unknown') +
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
  }, [loc, near, band]);

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
        <span className="text-xs text-slate-500">
          <span className={loc.speedKmh > 3 ? 'text-accent' : 'text-slate-400'}>
            {loc.speedKmh > 3 ? `moving · ${loc.speedKmh} km/h` : 'stationary'}
          </span>
          {' · '}
          <Ago iso={loc.fixedAt} />
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
                  <div className="text-right">
                    <div className={`num text-sm ${rate ? rateClass(rate) : 'text-slate-600'}`}>
                      {rate ? `LKR ${amount(rate)}` : '—'}
                    </div>
                    <div className="text-[10px] text-slate-600">per kWh</div>
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

/* Cheap → expensive, so the map is readable at a glance. */
function rateColour(rate) {
  if (rate === null || rate === undefined) return '#64748b';
  if (rate <= 60) return '#4ade80';
  if (rate <= 90) return '#fbbf24';
  return '#f87171';
}
function rateClass(rate) {
  if (rate <= 60) return 'text-accent';
  if (rate <= 90) return 'text-warn';
  return 'text-danger';
}

/** Inline SVG pin — avoids Leaflet's default icons, which 404 under Vite. */
function pin(colour, glyph) {
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;align-items:center;justify-content:center;
      width:26px;height:26px;border-radius:50%;background:${colour};
      border:2px solid #0a0c10;font-size:13px;line-height:1;
      box-shadow:0 1px 4px rgba(0,0,0,.5)">${glyph}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
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

function Ago({ iso }) {
  if (!iso) return <span>time unknown</span>;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return <span>time unknown</span>;
  const mins = Math.round(ms / 60000);
  const text =
    mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
  return <span className={mins > 30 ? 'text-warn' : 'text-slate-400'}>{text}</span>;
}

function Card({ children }) {
  return <div className="card">{children}</div>;
}
