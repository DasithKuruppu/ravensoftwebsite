import { useState, useEffect, useCallback } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { SignedIn, SignedOut, SignInButton } from '@clerk/clerk-react';
import StatusPill from '../components/StatusPill.jsx';
import RouteMap from '../components/RouteMap.jsx';
import { api } from '../api.js';
import { money, km, duration, when, shortDate, hireLength } from '../format.js';
import { useT } from '../i18n/index.jsx';
import { lineLabel } from '../i18n/lines.js';
import { vehicleParts } from '../i18n/vehicles.js';

/**
 * The customer's own trips — the list, or one of them.
 *
 * One component for both because they are the same data at two zoom levels, and
 * the detail view is where someone lands straight after booking. That arrival is
 * the moment the reference number matters most, so it leads.
 */
export default function Bookings({ clerkMissing }) {
  const { ref } = useParams();
  const { t } = useT();
  if (clerkMissing) {
    return <p className="hint">Sign-in is not configured, so there are no bookings to show.</p>;
  }
  return (
    <>
      <SignedIn>{ref ? <Detail refId={ref} /> : <List />}</SignedIn>
      <SignedOut>
        <div className="card p-6 text-center">
          <p className="text-ink-700">{t('trips.signInPrompt')}</p>
          <SignInButton mode="modal">
            <button type="button" className="btn-primary mt-4">
              {t('nav.signIn')}
            </button>
          </SignInButton>
        </div>
      </SignedOut>
    </>
  );
}

function List() {
  const { t } = useT();
  const [state, setState] = useState({ loading: true, bookings: [], error: '' });

  useEffect(() => {
    api
      .myBookings()
      .then(({ bookings }) => setState({ loading: false, bookings, error: '' }))
      .catch((err) => setState({ loading: false, bookings: [], error: err.message }));
  }, []);

  if (state.loading) return <p className="hint">{t('trips.loading')}</p>;
  if (state.error) return <p className="text-sm text-danger">{state.error}</p>;

  if (state.bookings.length === 0) {
    return (
      <div className="card p-6 text-center">
        <p className="text-ink-700">{t('trips.none')}</p>
        <Link to="/" className="btn-primary mt-4">
          {t('trips.bookOne')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('trips.title')}</h1>
      <ul className="space-y-3">
        {state.bookings.map((b) => (
          <li key={b.ref}>
            <Link to={`/bookings/${b.ref}`} className="card block p-4 transition hover:border-ink-400">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-ink-500">{b.ref}</span>
                <StatusPill status={b.status} />
                <span className="ml-auto text-sm tabular-nums">
                  {money(b.agreedTotal ?? b.quote.total, b.quote.currency)}
                </span>
              </div>
              <p className="mt-2 truncate text-sm">
                {b.trip.origin.label} → {b.trip.destination.label}
              </p>
              <p className="text-xs text-ink-500">
                {shortDate(b.startAt)} · {hireLength(b.quote.basis)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Detail({ refId }) {
  const { t } = useT();
  const location = useLocation();
  const justBooked = location.state?.justBooked;
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .booking(refId)
      .then(({ booking: b }) => setBooking(b))
      .catch((err) => setError(err.message));
  }, [refId]);

  useEffect(load, [load]);

  async function cancel() {
    if (!window.confirm(t('trips.cancelConfirm'))) return;
    setBusy(true);
    try {
      const { booking: b } = await api.cancel(refId, '');
      setBooking(b);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!booking) return <p className="hint">{t('trips.loading')}</p>;

  const { trip, quote, route } = booking;
  const cancellable = booking.status === 'pending' || booking.status === 'confirmed';

  return (
    <div className="space-y-5">
      {justBooked && (
        <div className="card border-brand/30 bg-brand-soft p-4">
          <p className="font-medium text-brand-dark">{t('trips.sent')}</p>
          <p className="mt-1 text-sm text-ink-700">{t('trips.sentNote')}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-xl font-semibold">{booking.ref}</h1>
        <StatusPill status={booking.status} />
        <Link to="/bookings" className="btn-link ml-auto">
          {t('trips.all')}
        </Link>
      </div>

      {trip.mode !== 'daily' && (
      <RouteMap
        origin={trip.origin}
        destination={trip.destination}
        stops={trip.stops}
        returnTo={trip.returnTo}
        geometries={route?.geometries}
        geometry={route?.geometry}
        approximate={route?.source === 'estimate'}
      />
      )}

      <section className="card p-5">
        <Route trip={trip} />
        <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-line pt-4 text-sm sm:grid-cols-2">
          <Row label={t('trips.pickupAt')}>{when(trip.startAt)}</Row>
          <Row label={t('trips.hireLength')}>{hireLength(quote.basis)}</Row>
          <Row label={t(trip.mode === 'daily' ? 'trips.allowance' : 'trips.distance')}>
            {km(quote.basis.distanceKm)}
          </Row>
          {(booking.legs || []).map((leg) => {
            const picked = leg.options?.[leg.index];
            if (!picked) return null;
            return (
              <Row
                key={leg.key}
                label={
                  booking.legs.length > 1
                    ? t('trips.routeRowNamed', { leg: t(`routes.${leg.key}`) })
                    : t('trips.routeRow')
                }
              >
                {picked.via || picked.label}
                {picked.avoidsHighways && (
                  <span className="ml-2 pill bg-line text-ink-700">{t('routes.noExpressway')}</span>
                )}
              </Row>
            );
          })}
          <Row label={t('trips.vehicle')}>
            {vehicleParts(t, quote.basis.vehicleClass)[0]} · {t('who.passengers')}{' '}
            {trip.passengers}
          </Row>
          {quote.basis.nights > 0 && (
            <Row label={t('trips.nightsAway')}>{quote.basis.nights}</Row>
          )}
          {booking.driverName && <Row label={t('trips.driver')}>{booking.driverName}</Row>}
          {booking.vehicle && <Row label={t('trips.vehicleNumber')}>{booking.vehicle}</Row>}
        </dl>

        {trip.notes && (
          <p className="mt-4 border-t border-line pt-4 text-sm text-ink-700">
            <span className="text-ink-500">{t('trips.yourNote')} </span>
            {trip.notes}
          </p>
        )}

        {booking.ownerNote && (
          <p className="mt-4 rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand-dark">
            {booking.ownerNote}
          </p>
        )}
      </section>

      <section className="card p-5">
        <div className="flex items-baseline">
          <p className="text-sm text-ink-500">
            {t(booking.agreedTotal != null ? 'trips.agreed' : 'trips.quoted')}
          </p>
          <p className="ml-auto text-2xl font-semibold tabular-nums">
            {money(booking.agreedTotal ?? quote.total, quote.currency)}
          </p>
        </div>
        {booking.agreedTotal != null && booking.agreedTotal !== quote.total && (
          <p className="mt-1 text-right text-xs text-ink-500">
            {t('trips.wasQuoted', { amount: money(quote.total, quote.currency) })}
          </p>
        )}

        <ul className="mt-4 divide-y divide-line border-t border-line">
          {quote.lines.map((line) => (
            <li key={line.key} className="flex items-baseline gap-3 py-2">
              <span className="text-sm">{lineLabel(t, line)}</span>
              <span className="ml-auto text-sm tabular-nums">{money(line.amount, quote.currency)}</span>
            </li>
          ))}
        </ul>
        {route?.source === 'estimate' && (
          <p className="mt-3 text-xs text-warn">
            {t('trips.estimatedDistance')}
          </p>
        )}
      </section>

      {cancellable && (
        <button type="button" className="btn-quiet" onClick={cancel} disabled={busy}>
          {busy ? t('trips.cancelling') : t('trips.cancel')}
        </button>
      )}
    </div>
  );
}

/** origin → stops → destination, as a vertical line the eye can follow. */
export function Route({ trip }) {
  const { t } = useT();
  // A daily hire has no itinerary — only a pickup point. Rendering the usual
  // origin → destination line would draw an empty row where the destination
  // that was never chosen should be.
  if (trip.mode === 'daily') {
    return (
      <div className="flex gap-3">
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
        <div>
          <p className="text-sm font-medium">{trip.origin?.label}</p>
          <p className="text-xs text-ink-500">
            {t('trips.collectedHere', {
              days: t('unit.days_other', { n: trip.days, count: trip.days }),
              km: trip.allowanceKm,
            })}
          </p>
        </div>
      </div>
    );
  }

  const points = [
    { ...trip.origin, kind: 'start' },
    ...(trip.stops || []).map((s) => ({ ...s, kind: 'stop' })),
    { ...trip.destination, kind: 'end' },
    // A return trip ends where it began. Shown as its own row rather than left
    // implied — the driver reads this list to know when the day is over.
    ...(trip.returnTo ? [{ ...trip.returnTo, kind: 'back' }] : []),
  ];
  return (
    <ol className="space-y-0">
      {points.map((p, i) => (
        <li key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                p.kind === 'stop' ? 'bg-ink-400' : p.kind === 'end' ? 'bg-ink-900' : 'bg-brand'
              }`}
            />
            {i < points.length - 1 && <span className="w-px flex-1 bg-line" />}
          </div>
          <div className={i < points.length - 1 ? 'pb-4' : ''}>
            <p className="text-sm font-medium">
              {p.label}
              {p.kind === 'back' && (
                <span className="ml-2 text-xs font-normal text-ink-500">
                  {t(p.label === trip.origin?.label ? 'trips.andBack' : 'trips.finishingHere')}
                </span>
              )}
            </p>
            {p.waitHours > 0 && (
              <p className="text-xs text-ink-500">
                {t('route.waiting')} {duration(p.waitHours)}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Row({ label, children }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}
