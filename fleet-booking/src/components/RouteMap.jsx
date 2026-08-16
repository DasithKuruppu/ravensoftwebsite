import { useEffect, useRef, useState } from 'react';
import { decodePolyline } from '../../shared/polyline.mjs';
import { useLocale } from '../i18n/index.jsx';

const BROWSER_KEY = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY;

/**
 * The trip, drawn on a Google map.
 *
 * Google's terms require their basemap under a route their Routes API produced,
 * so this is not merely a nicer tile set — it is the condition of using the
 * routing at all.
 *
 * The map is imperative, not React state: it owns a large mutable DOM tree, and
 * rebuilding it on every keystroke of a re-quoting form would flicker and throw
 * away the customer's pan. So the instance is created once and each render
 * updates only the overlays that changed.
 *
 * The line is the routed geometry when there is one. When routing fell back to
 * a straight-line estimate the waypoints are joined by a dashed line instead —
 * a solid road that was never routed would claim more than the quote supports.
 */
export default function RouteMap({ origin, destination, stops = [], returnTo, geometries, geometry, approximate }) {
  const holder = useRef(null);
  const map = useRef(null);
  const overlays = useRef([]);
  const observer = useRef(null);
  const [locale] = useLocale();
  const [status, setStatus] = useState(BROWSER_KEY ? 'loading' : 'nokey');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!BROWSER_KEY) return undefined;
    let cancelled = false;

    setStatus('loading');
    loadMaps(BROWSER_KEY, locale)
      .then(() => {
        if (cancelled || !holder.current) return;
        map.current = new window.google.maps.Map(holder.current, {
          center: { lat: 7.6, lng: 80.7 },
          zoom: 7,
          // A map inside a scrolling form must not swallow the page scroll:
          // ctrl/⌘+wheel zooms on a desktop, two fingers on a phone.
          gestureHandling: 'cooperative',
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        });
        setStatus('ready');

        // A map created while its container is still being laid out — which is
        // what happens on a phone when the column above it is still resolving —
        // renders as grey tiles until something tells it the box changed.
        // Watching the element covers that, and orientation changes too.
        if (typeof ResizeObserver !== 'undefined') {
          observer.current = new ResizeObserver(() => {
            const centre = map.current?.getCenter();
            window.google.maps.event.trigger(map.current, 'resize');
            if (centre) map.current.setCenter(centre);
          });
          observer.current.observe(holder.current);
        }
      })
      .catch((err) => {
        console.warn('Google Maps failed to load:', err.message);
        if (!cancelled) {
          setReason(err.message);
          setStatus('failed');
        }
      });

    return () => {
      cancelled = true;
      observer.current?.disconnect();
      observer.current = null;
      // Drop this map instance. Re-running for a new language means a new API,
      // and a map object built by the old one cannot be handed to the new.
      overlays.current.forEach((o) => o.setMap?.(null));
      overlays.current = [];
      map.current = null;
      if (holder.current) holder.current.innerHTML = '';
    };
    // Re-running on `locale` is the whole point: Google fixes a map's language
    // when it initialises, so a switch has to rebuild it.
  }, [locale]);

  // Redraw whenever the route changes.
  useEffect(() => {
    const m = map.current;
    if (!m || status !== 'ready') return;
    const g = window.google.maps;

    overlays.current.forEach((o) => o.setMap(null));
    overlays.current = [];

    const points = [origin, ...stops, destination].filter(
      (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon),
    );
    if (points.length === 0) {
      m.setCenter({ lat: 7.6, lng: 80.7 });
      m.setZoom(7);
      return;
    }

    // One entry per leg. Falling back to the single `geometry` prop keeps a
    // stored booking from an earlier version drawing correctly.
    const legGeometries = geometries?.length ? geometries : [geometry];
    // Where a leg has no routed shape, join its endpoints directly rather than
    // invent a road: leg 0 runs origin → stops → destination, leg 1 runs
    // destination → wherever the car finishes.
    const legFallback = [
      points.map((p) => [p.lat, p.lon]),
      returnTo && Number.isFinite(returnTo.lat)
        ? [
            [destination?.lat, destination?.lon],
            [returnTo.lat, returnTo.lon],
          ]
        : [],
    ];

    const allPath = [];
    legGeometries.forEach((geo, leg) => {
      const path = (geo ? decodePolyline(geo) : legFallback[leg] || [])
        .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
        .map(([lat, lng]) => ({ lat, lng }));
      if (path.length < 2) return;
      allPath.push(...path);

      // Two strokes: a wide pale casing under a narrow dark line, so the route
      // stays readable over both the green interior and the grey towns.
      overlays.current.push(
        new g.Polyline({ path, map: m, strokeColor: '#ffffff', strokeWeight: 7, strokeOpacity: 0.9, zIndex: 1 }),
      );
      // The return leg is dashed and darker. The two legs often share tarmac,
      // and a solid line drawn twice would hide the fact that the car comes
      // back along the same road.
      const isReturn = leg > 0;
      overlays.current.push(
        new g.Polyline({
          path,
          map: m,
          strokeColor: isReturn ? '#16181d' : '#0f6f4f',
          strokeWeight: 3.5,
          zIndex: isReturn ? 3 : 2,
          ...(geo && !isReturn
            ? { strokeOpacity: 1 }
            : {
                strokeOpacity: 0,
                icons: [
                  {
                    icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3.5 },
                    offset: isReturn ? '7px' : '0',
                    repeat: '14px',
                  },
                ],
              }),
        }),
      );
    });

    const markers = [...points];
    // Only when it is somewhere new: a car returning to its pickup point would
    // otherwise stack a second pin on the first.
    if (
      returnTo &&
      Number.isFinite(returnTo.lat) &&
      (Math.abs(returnTo.lat - origin?.lat) > 1e-6 || Math.abs(returnTo.lon - origin?.lon) > 1e-6)
    ) {
      markers.push({ ...returnTo, finish: true });
    }

    markers.forEach((p, i) => {
      const kind = i === 0 ? 'start' : p.finish || i === markers.length - 1 ? 'end' : 'stop';
      overlays.current.push(
        new g.Marker({
          position: { lat: p.lat, lng: p.lon },
          map: m,
          zIndex: 5 + i,
          title: `${labelFor(kind, i, p.finish)}: ${p.label || ''}`,
          icon: iconFor(kind, g),
          label:
            kind === 'stop'
              ? { text: String(i), color: '#3d424b', fontSize: '11px', fontWeight: '600' }
              : undefined,
        }),
      );
    });

    const bounds = new g.LatLngBounds();
    (allPath.length > 1 ? allPath : markers.map((p) => ({ lat: p.lat, lng: p.lon }))).forEach((c) =>
      bounds.extend(c),
    );
    if (!bounds.isEmpty()) {
      m.fitBounds(bounds, 36);
      // A single point fits to maximum zoom, which is a street view of a hotel
      // rather than a trip. Pull it back to something with context.
      const once = g.event.addListenerOnce(m, 'idle', () => {
        if (m.getZoom() > 14) m.setZoom(14);
      });
      overlays.current.push({ setMap: () => g.event.removeListener(once) });
    }
  }, [origin, destination, stops, returnTo, geometries, geometry, status]);

  return (
    <div className="relative">
      <div
        ref={holder}
        className="h-80 min-h-64 w-full overflow-hidden rounded-xl border border-line bg-canvas sm:h-[26rem] lg:h-[28rem]"
        role="img"
        aria-label="Map of the route"
      />
      {status !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl px-6 text-center">
          <p className="text-sm text-ink-500">
            {status === 'nokey'
              ? 'Map unavailable — no Google Maps key was set at build time.'
              : status === 'failed'
                ? `The map could not be loaded${reason ? ` — ${reason}` : ''}. Your price is unaffected.`
                : 'Loading map…'}
          </p>
        </div>
      )}
      {approximate && status === 'ready' && (
        <p className="pointer-events-none absolute bottom-2 left-2 right-2 rounded-md bg-paper/95 px-2 py-1 text-xs text-warn shadow-sm">
          Straight-line estimate — the routing service did not answer.
        </p>
      )}
    </div>
  );
}

/* ────────────────────────────── loader ────────────────────────────── */

let loader;
let loadedLocale;

/**
 * Forget the loaded API so it can be loaded again in another language.
 *
 * Google has no supported way to relabel a live map, and its loader
 * short-circuits on the `google.maps` global — so switching language means
 * removing the script tags *and* the global, then letting the next `loadMaps`
 * fetch a fresh copy. It logs "included multiple times" while doing so, which
 * is expected and harmless here: nothing from the old API survives the teardown.
 *
 * The alternative was reloading the page, which would throw away a half-filled
 * booking form to relabel a map.
 */
function unloadMaps() {
  document
    .querySelectorAll('script[src*="maps.googleapis.com/maps/api/js"]')
    .forEach((el) => el.remove());
  try {
    delete window.google;
  } catch {
    window.google = undefined;
  }
  loader = undefined;
  loadedLocale = undefined;
}

/**
 * Load the Maps JS API once per page, in the language being read.
 *
 * A module-level promise rather than a per-component effect: three maps on a
 * page would otherwise inject three script tags, and the second would fail with
 * Google's "included multiple times" error.
 *
 * The language is fixed at load. Google offers no way to relabel a map that has
 * already initialised, and injecting the script twice is the error above — so a
 * customer who switches language mid-visit keeps the map they started with
 * until the page is reloaded. Everything else on the page switches instantly;
 * this one thing does not, and pretending otherwise would mean a page reload
 * that threw away a half-filled booking form.
 */
function loadMaps(key, locale = 'en') {
  if (loader && loadedLocale === locale) return loader;
  if (loader && loadedLocale !== locale) unloadMaps();
  loadedLocale = locale;
  loader = new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve(window.google.maps);
      return;
    }

    // `callback` is required, not optional. With `loading=async` the script's
    // own onload fires before the library has finished initialising, so
    // resolving there hands back a `google.maps` that is missing most of its
    // constructors — which is a map that silently never appears.
    const done = '__fleetBookingMapsReady';
    window[done] = () => {
      delete window[done];
      resolve(window.google.maps);
    };

    // Google reports a rejected or misconfigured key at runtime through this
    // global, not through the script's onerror — without it, an unauthorised
    // referrer looks identical to a slow network.
    window.gm_authFailure = () => reject(new Error('key rejected (referrer or API restriction)'));

    const script = document.createElement('script');
    script.src =
      'https://maps.googleapis.com/maps/api/js' +
      `?key=${encodeURIComponent(key)}&v=weekly&loading=async&region=LK` +
      `&language=${encodeURIComponent(locale)}&callback=${done}`;
    script.async = true;
    script.onerror = () => reject(new Error('script failed to load'));
    document.head.appendChild(script);

    // A key that is valid but has no billing account attached neither calls the
    // callback nor trips gm_authFailure; it simply never resolves. Time it out
    // so the panel says something instead of showing "Loading map…" forever.
    setTimeout(() => reject(new Error('timed out waiting for Google Maps')), 15000);
  });
  return loader;
}

/* ── pins, as inline SVG paths so no image assets ship ── */

const CIRCLE = 'M 0,-8 a 8,8 0 1,0 0.001,0 z';

function iconFor(kind, g) {
  const fill = kind === 'start' ? '#0f6f4f' : kind === 'end' ? '#16181d' : '#ffffff';
  return {
    path: CIRCLE,
    fillColor: fill,
    fillOpacity: 1,
    strokeColor: kind === 'stop' ? '#6b7280' : '#ffffff',
    strokeWeight: 2.5,
    scale: 1.3,
    labelOrigin: new g.Point(0, 0),
  };
}

function labelFor(kind, index, finish) {
  if (kind === 'start') return 'Starting from';
  if (finish) return 'Finishing at';
  if (kind === 'end') return 'Going to';
  return `Stop ${index}`;
}
