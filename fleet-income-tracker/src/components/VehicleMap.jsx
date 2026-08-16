import { useEffect, useState, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../api.js';
import { nearest, rateNow, bandAt, TOU_BANDS, HOME_TOU } from '../../shared/chargers.mjs';
import { amount, ago } from '../format.js';
import { useT } from '../i18n/index.jsx';

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
  const { t, locale } = useT();
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
        `<b>${escapeHtml(loc.plate || t('map.popup.vehicle'))}</b>` +
          `<br>${escapeHtml(statusText(loc, t))}` +
          `<br>${mapsLink(placeUrl(loc.lat, loc.lng), t('map.popup.viewMaps'))}`,
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
            `<br>${escapeHtml(t('map.popup.away', { km: c.distanceKm }))}` +
            (rate
              ? `<br><b>${escapeHtml(t('unit.perKwh'))} ${rate}</b> (${escapeHtml(bandLabel(band, t))})`
              : `<br>${escapeHtml(t('map.rateUnknown'))}`) +
            (isCheapest
              ? `<br><span style="color:#4ade80;font-weight:600">${escapeHtml(t('map.popup.cheapest'))}</span>`
              : '') +
            (isClosest
              ? `<br><span style="color:#e2e8f0;font-weight:600">${escapeHtml(t('map.popup.closest'))}</span>`
              : '') +
            (c.app ? `<br>${escapeHtml(t('map.popup.app', { name: c.app }))}` : '') +
            (c.ccs2 === 'confirmed'
              ? `<br><span style="color:#4ade80">${escapeHtml(t('map.popup.ccs2ok'))}</span>${c.source ? ` · ${escapeHtml(c.source)}` : ''}`
              : `<br><span style="color:#fbbf24">${escapeHtml(t('map.popup.ccs2no'))}</span>`) +
            (c.position === 'approx'
              ? `<br><span style="color:#64748b">${escapeHtml(t('map.popup.approx'))}</span>`
              : '') +
            // Directions rather than a plain pin: the point of tapping a
            // charger is to drive to it.
            `<br>${mapsLink(directionsUrl(c.lat, c.lng), t('map.popup.directions'))}`,
        )
        .addTo(layerRef.current);
    }

    const points = [[loc.lat, loc.lng], ...near.map((c) => [c.lat, c.lng])];
    if (points.length > 1) map.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
    else map.setView([loc.lat, loc.lng], 14);

    // The container is sized by CSS after mount; Leaflet needs telling.
    setTimeout(() => map.invalidateSize(), 0);
    // `locale` is in here because the popups above are built as HTML strings
    // when the effect runs: without it, switching language leaves every popup in
    // the language the map was first painted in.
  }, [loc, near, band, cheapest, closest, locale]);

  useEffect(() => () => mapRef.current?.remove(), []);

  if (error)
    return (
      <Card>
        <p className="text-sm text-slate-400">{t('map.error', { error })}</p>
      </Card>
    );
  if (!loc)
    return (
      <Card>
        <p className="text-sm text-slate-400">{t('map.locating')}</p>
      </Card>
    );
  if (!loc.available) {
    return (
      <Card>
        <p className="text-sm text-slate-400">
          {t('map.noPosition', { reason: loc.reason ? ` — ${loc.reason}` : '.' })}
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <h2 className="label">
          {t('map.heading')}
          {loc.plate ? ` · ${loc.plate}` : ''}
        </h2>
        <span className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
          <Status loc={loc} />
          <span>
            {/* One string with the age in it: "updated 3 h ago" puts the verb
                first in English and last in Sinhala. */}
            <Updated iso={loc.fixedAt} ageSeconds={loc.fixAgeSeconds} />
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
        <span className="text-xs text-slate-400">
          {t('map.nearest', {
            count: near.length,
            band: bandLabel(band, t),
            from: TOU_BANDS[band].from,
            to: TOU_BANDS[band].to,
          })}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setConfirmedOnly((v) => !v)}
            className={`btn text-xs px-2 py-1 mr-2 ${confirmedOnly ? 'border-slate-400 text-slate-50' : ''}`}
            title={
              confirmedOnly
                ? t('map.hiddenTitle', { count: hiddenCount })
                : t('map.showingUnconfirmed')
            }
          >
            {t(confirmedOnly ? 'map.confirmedOnly' : 'map.includingUnconfirmed')}
          </button>
          <span className="text-xs text-slate-400 mr-1">{t('map.show')}</span>
          {LIMIT_STEPS.map((n) => (
            <button
              key={n}
              onClick={() => setLimit(n)}
              className={`btn text-xs px-2 py-1 ${limit === n ? 'border-slate-400 text-slate-50' : ''}`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {(closest || cheapest) && (
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <Pick
            title={t(sameSite ? 'map.closestAndCheapest' : 'map.closest')}
            tone={sameSite ? 'accent' : 'slate'}
            charger={closest}
          />
          {!sameSite && <Pick title={t('map.cheapest')} tone="accent" charger={cheapest} />}
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
                        className="text-[11px] uppercase text-warn border border-warn/40 bg-warn/10 rounded px-1"
                        title={t('map.ccs2NotSureTitle')}
                      >
                        {t('map.ccs2NotSure')}
                      </span>
                    )}
                    {cheapest && c.id === cheapest.id && (
                      <span className="text-[11px] text-slate-100 border border-slate-500 bg-slate-400/10 rounded px-1">
                        {t('map.cheapestTag')}
                      </span>
                    )}
                    {c.position === 'approx' && (
                      <span
                        className="text-[11px] uppercase text-slate-400 border border-ink-700 rounded px-1"
                        title={t('map.approxTitle')}
                      >
                        {t('map.approx')}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400">
                    <span className="num">{c.distanceKm}</span> {t('unit.km')}
                    {c.address ? ` · ${c.address}` : ''}
                    {c.app ? ` · ${c.app}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div
                    className={`text-right rounded-md border px-2 py-1 ${
                      rate ? rateChip(rate) : 'border-ink-700 text-slate-400'
                    }`}
                  >
                    <div className="num text-sm font-semibold leading-tight">
                      {rate ? amount(rate) : '—'}
                    </div>
                    <div className="text-[11px] opacity-70 leading-tight">{t('unit.perKwh')}</div>
                  </div>
                  <a
                    href={directionsUrl(c.lat, c.lng)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn text-xs px-2 py-1"
                    title={t('map.directionsTo', { name: c.name })}
                  >
                    {t('map.directions')}
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-slate-400 mt-3 leading-relaxed">
        {t('map.homeNote', {
          rate: `${t('unit.perKwh')} ${HOME_TOU.offPeak}`,
          from: TOU_BANDS.offPeak.from,
          to: TOU_BANDS.offPeak.to,
        })}
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
  const { t } = useT();
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
        <span className={`label ${accent ? 'text-slate-100' : 'text-slate-400'}`}>{title}</span>
        <span className="num text-xs text-slate-400">
          {charger.distanceKm} {t('unit.km')}
        </span>
      </div>
      <div className="text-sm text-slate-200 mt-1 truncate" title={charger.name}>
        {charger.name}
      </div>
      <div className="flex items-end justify-between gap-2 mt-0.5">
        <div className={`num text-lg ${rate ? rateClass(rate) : 'text-slate-400'}`}>
          {rate ? `${t('unit.currency')} ${amount(rate)}` : t('map.rateUnknown')}
          {rate && <span className="text-xs text-slate-400"> /kWh</span>}
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
          title={t('map.directionsTo', { name: charger.name })}
        >
          {t('map.directions')}
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
  if (rate <= 60) return 'border-slate-400/50 bg-slate-400/10 text-slate-100';
  if (rate <= 90) return 'border-warn/40 bg-warn/10 text-warn';
  return 'border-danger/40 bg-danger/10 text-danger';
}
function rateClass(rate) {
  if (rate <= 60) return 'text-slate-100';
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
 * one reading to go on it says "movement unknown" rather than claiming
 * "stationary" — which is what the old code did, and why the car always looked
 * parked. "Fix" is the GPS term for a position reading, but it reads as
 * "repaired" to anyone who does not know that, so the UI says "updated".
 */
function Status({ loc }) {
  const { t } = useT();
  const { status, speedKmh, movedM } = loc;

  if (status === 'offline') {
    return <Chip tone="warn">{t('map.status.offline')}</Chip>;
  }
  if (status === 'moving') {
    return (
      <Chip tone="accent">
        {t('map.status.moving')}
        {speedKmh != null
          ? ` · ${speedKmh} ${t('unit.kmh')}`
          : movedM != null
            ? ` · ${movedM} m`
            : ''}
      </Chip>
    );
  }
  if (status === 'parked') return <Chip tone="slate">{t('map.status.parked')}</Chip>;
  return (
    <Chip tone="slate" title={t('map.status.unknownTitle')}>
      {t('map.status.unknown')}
    </Chip>
  );
}

/** The same, flattened for a Leaflet popup, which takes HTML and not elements. */
function statusText(loc, t) {
  if (loc.status === 'offline') return t('map.status.offline');
  if (loc.status === 'moving')
    return loc.speedKmh != null
      ? `${t('map.status.moving')} · ${loc.speedKmh} ${t('unit.kmh')}`
      : t('map.status.moving');
  if (loc.status === 'parked') return t('map.status.parked');
  return t('map.status.unknown');
}

/** "off-peak" / "ඕෆ්-පීක්" — the tariff band's name, from the dictionary rather
    than from `TOU_BANDS`, whose labels are English data shared with the API. */
function bandLabel(band, t) {
  return t(`tou.${band}`);
}

function Chip({ tone, children, title }) {
  const tones = {
    accent: 'text-slate-100 border-slate-500 bg-slate-400/10',
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
function Updated({ iso, ageSeconds }) {
  const { t } = useT();
  const { text, minutes } = ago(iso, ageSeconds);
  return (
    <span className={minutes > 30 ? 'text-warn' : 'text-slate-400'}>
      {t('map.updated', { ago: text })}
    </span>
  );
}

function Card({ children }) {
  return <div className="card">{children}</div>;
}
