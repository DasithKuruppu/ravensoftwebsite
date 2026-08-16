import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { SignedIn, SignedOut, SignInButton } from '@clerk/clerk-react';
import PlaceField from '../components/PlaceField.jsx';
import QuoteCard from '../components/QuoteCard.jsx';
import RouteChoice from '../components/RouteChoice.jsx';
import RouteMap from '../components/RouteMap.jsx';
import DailyHireForm from '../components/DailyHireForm.jsx';
import DriverHosting from '../components/DriverHosting.jsx';
import { api, ApiError } from '../api.js';
import {
  toLocalInput,
  fromLocalInput,
  earliestStart,
  money,
  hireLength,
  duration,
  km,
} from '../format.js';
import { DURATION_CHOICES, hoursForDays } from '../../shared/pricing.mjs';
import { useT } from '../i18n/index.jsx';
import { lineLabel } from '../i18n/lines.js';
import { vehicleParts } from '../i18n/vehicles.js';

/**
 * The whole customer journey on one page: route, when, how long, price, book.
 *
 * The price re-quotes itself as the form changes rather than waiting behind a
 * "get a price" button — the promise made on the landing page is an instant
 * rate, and a button between the customer and the number breaks it. Quoting is
 * public, so the sign-in wall sits at the booking step and not before.
 *
 * On a wide screen the form and the map sit side by side, with the map sticky:
 * a route is easier to trust when you can see it change as you add a stop. On a
 * phone they stack, and the total follows you up the page in a bar at the
 * bottom, because the price is the one thing worth a permanent place.
 */
export default function Book({ clerkMissing }) {
  const navigate = useNavigate();
  const { t } = useT();
  const [rates, setRates] = useState(null);
  // 'route' — describe a journey and have it measured.
  // 'daily' — take the car for N days with a kilometre allowance, no itinerary.
  const [mode, setMode] = useState('route');
  const [allowanceKm, setAllowanceKm] = useState(0);
  const [driverHosted, setDriverHosted] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [stops, setStops] = useState([]);
  const [startLocal, setStartLocal] = useState(() => defaultStart());
  // Days, not hours: a customer thinks in days, and the list of choices is the
  // list of lengths the fleet actually sells.
  const [days, setDays] = useState(1);
  // Where the car finishes. Defaults to the pickup point — most hires come home
  // — but it is a place, so "drop us at the airport" is the same control.
  const [oneWay, setOneWay] = useState(false);
  const [endAt, setEndAt] = useState(null);
  const [endEdited, setEndEdited] = useState(false);
  const [returnRouteIndex, setReturnRouteIndex] = useState(0);
  // Set from the rate card once it loads — the fleet's vehicles are data, not a
  // constant, so there is no sensible key to hardcode here.
  const [vehicleClass, setVehicleClass] = useState('');
  const [passengers, setPassengers] = useState(2);
  const [notes, setNotes] = useState('');
  // Which of the offered roads. Reset to Google's own preference whenever the
  // route itself changes, since option 2 of the old route is not option 2 of
  // the new one.
  const [routeIndex, setRouteIndex] = useState(0);
  const [phone, setPhone] = useState('');

  const [result, setResult] = useState(null);
  const [quoting, setQuoting] = useState(false);
  // { message, field } — `field` decides which input wears the message.
  const [problem, setProblem] = useState(null);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState('');

  useEffect(() => {
    api
      .rates()
      .then((r) => {
        setRates(r);
        // Select the first vehicle, and re-select if the one held is no longer
        // in the fleet — a stale key would otherwise be sent and silently
        // resolved to something else by the server.
        setVehicleClass((current) => {
          const list = r?.vehicleClasses || [];
          return list.some((c) => c.key === current) ? current : list[0]?.key || '';
        });
      })
      .catch(() => setRates(null));
  }, []);

  // Until the customer touches it, the finish follows the pickup point. After
  // that it is theirs, and changing the origin must not silently move it back.
  useEffect(() => {
    if (!endEdited) setEndAt(origin);
  }, [origin, endEdited]);

  const returnTo = oneWay ? null : endAt || origin;

  const dailyTrip = {
    mode: 'daily',
    origin,
    startAt: fromLocalInput(startLocal),
    days,
    allowanceKm,
    vehicleClass,
    driverHosted,
    passengers: Number(passengers) || 1,
  };

  const routedTrip = {
    origin,
    destination,
    stops,
    startAt: fromLocalInput(startLocal),
    requestedHours: hoursForDays(days, rates),
    vehicleClass,
    passengers: Number(passengers) || 1,
    routeIndex,
    returnRouteIndex,
    returnTo,
    driverHosted,
  };

  const trip = mode === 'daily' ? dailyTrip : routedTrip;

  // A daily hire needs no destination, which is the whole point of it.
  const ready =
    mode === 'daily'
      ? Boolean(origin?.lat && startLocal && days)
      : Boolean(origin?.lat && destination?.lat && startLocal && days);

  /* Re-quote on every meaningful change, debounced. The signature deliberately
     excludes notes and phone: neither moves the price, and re-quoting on each
     keystroke of a message to the driver would be a request per character. */
  const signature = JSON.stringify({
    o: origin && [origin.lat, origin.lon],
    d: destination && [destination.lat, destination.lon],
    s: stops.map((x) => [x.lat, x.lon, x.waitHours || 0]),
    t: trip.startAt,
    h: trip.requestedHours,
    v: vehicleClass,
    p: trip.passengers,
    r: routeIndex,
    rr: returnRouteIndex,
    e: returnTo && [returnTo.lat, returnTo.lon],
    m: mode,
    a: allowanceKm,
    dh: driverHosted,
  });

  // The offered routes are recomputed whenever the waypoints move, so a held
  // index would point at a different road than the one the customer picked.
  const places = JSON.stringify([
    origin && [origin.lat, origin.lon],
    stops.map((x) => [x.lat, x.lon]),
    destination && [destination.lat, destination.lon],
    returnTo && [returnTo.lat, returnTo.lon],
  ]);
  useEffect(() => {
    setRouteIndex(0);
    setReturnRouteIndex(0);
  }, [places]);

  // The allowance follows the days until the customer picks one explicitly —
  // four days should mean four days' worth of kilometres without being asked.
  const [allowanceEdited, setAllowanceEdited] = useState(false);
  const includedKm = days * (rates?.includedKmPerDay ?? 150);
  useEffect(() => {
    if (!allowanceEdited || allowanceKm < includedKm) setAllowanceKm(includedKm);
  }, [includedKm, allowanceEdited, allowanceKm]);

  const latest = useRef(0);
  useEffect(() => {
    if (!ready) {
      setResult(null);
      setProblem(null);
      return undefined;
    }
    const ctl = new AbortController();
    const seq = ++latest.current;
    const timer = setTimeout(async () => {
      setQuoting(true);
      try {
        const q = await api.quote(trip, ctl.signal);
        // Only the newest request may write. Two quotes in flight can return out
        // of order, and the older one landing last would show a price for a form
        // the customer has already changed.
        if (seq === latest.current) {
          setResult(q);
          setProblem(null);
          // The server clamps an out-of-range index; follow it rather than
          // leaving the highlighted option and the quoted price disagreeing.
          if (typeof q.routeIndex === 'number' && q.routeIndex !== routeIndex) {
            setRouteIndex(q.routeIndex);
          }
          if (typeof q.returnRouteIndex === 'number' && q.returnRouteIndex !== returnRouteIndex) {
            setReturnRouteIndex(q.returnRouteIndex);
          }
        }
      } catch (err) {
        if (err.name === 'AbortError' || seq !== latest.current) return;
        setResult(null);
        // Prefer the code: the server's `message` is English, and a Sinhala
        // customer should not be shown one English sentence among Sinhala ones.
        // Falls back to it when the code is one this build has no wording for.
        const code = err instanceof ApiError ? err.code : undefined;
        const translated = code ? t(`error.${code}`, err.payload?.vars) : null;
        setProblem({
          message:
            translated && translated !== `error.${code}`
              ? translated
              : err.message || t('error.couldNotPrice'),
          field: err instanceof ApiError ? err.field : undefined,
        });
      } finally {
        if (seq === latest.current) setQuoting(false);
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, ready]);

  /** The message for one input, or nothing. */
  const errorFor = (field) => (problem?.field === field ? problem.message : undefined);
  /** A problem with no field named belongs in the quote card, as before. */
  const generalError = problem && !problem.field ? problem.message : '';

  const submit = useCallback(async () => {
    setBooking(true);
    setBookError('');
    try {
      const { booking: made } = await api.book({ ...trip, notes, contact: { phone } });
      navigate(`/bookings/${made.ref}`, { state: { justBooked: true } });
    } catch (err) {
      setBookError(
        err instanceof ApiError && err.status === 401
          ? t('finish.sessionExpired')
          : err.message,
      );
    } finally {
      setBooking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, notes, phone]);

  const classes = rates?.vehicleClasses || [];
  const minStart = earliestStart(rates?.minNoticeHours ?? 6);
  const seats = classes.find((c) => c.key === vehicleClass)?.seats ?? classes[0]?.seats ?? 3;

  // Switching to a smaller vehicle must not leave more passengers selected than
  // it seats — the quote would be refused for a number the customer never
  // chose after the change.
  useEffect(() => {
    if (Number(passengers) > seats) setPassengers(seats);
  }, [seats, passengers]);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('book.title')}</h1>
        <p className="mt-1.5 text-ink-500">{t('book.subtitle')}</p>
      </header>

      {/* Two ways to buy the same thing, so the choice belongs at the top —
          before the customer starts filling in a form that may be the wrong one. */}
      {/* A grid, not an inline-flex: the Sinhala labels are long enough that two
          of them will not share a 360px line, and an inline-flex cannot wrap —
          it just pushes the page sideways. Two equal columns always fit. */}
      <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg border border-line bg-paper p-1 sm:inline-grid">
        {[
          { key: 'route', label: t('mode.route') },
          { key: 'daily', label: t('mode.daily') },
        ].map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            aria-pressed={mode === m.key}
            className={`rounded-md px-2 py-2 text-center text-sm leading-tight transition sm:px-4 ${
              mode === m.key ? 'bg-brand text-white' : 'text-ink-500 hover:text-ink-900'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="mb-6 -mt-4 text-xs text-ink-500">
        {t('mode.driverNote')}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        {/* ── 1. where the trip goes. First on every screen. ── */}
        <div className="order-1 space-y-5 lg:col-start-1 lg:row-start-1">
          {mode === 'daily' ? (
            <DailyHireForm
              rates={rates}
              origin={origin}
              setOrigin={setOrigin}
              startLocal={startLocal}
              setStartLocal={setStartLocal}
              minStart={minStart}
              days={days}
              setDays={setDays}
              allowanceKm={allowanceKm}
              setAllowanceKm={(v) => {
                setAllowanceEdited(true);
                setAllowanceKm(v);
              }}
              passengers={passengers}
              setPassengers={setPassengers}
              seats={seats}
              errorFor={errorFor}
              nights={result?.quote?.basis?.nights}
              driverHosted={driverHosted}
              setDriverHosted={setDriverHosted}
            />
          ) : (
            <>
              <section className="card p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-500">
              {t('route.heading')}
            </h2>

            <div className="space-y-4">
              <PlaceField
                label={t('route.from')}
                value={origin}
                onChange={setOrigin}
                placeholder={t('route.fromPlaceholder')}
                error={errorFor('origin')}
                marker={<Dot className="bg-brand" />}
                autoFocus
              />

              <Stops
                stops={stops}
                setStops={setStops}
                max={rates?.maxStops ?? 8}
                errorFor={errorFor}
              />

              <PlaceField
                label={t('route.to')}
                value={destination}
                onChange={setDestination}
                placeholder={t('route.toPlaceholder')}
                error={errorFor('destination')}
                marker={<Dot className="bg-ink-900" />}
              />

              <div className="rounded-lg border border-line bg-canvas p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
                    {t('route.finishHeading')}
                  </span>
                  <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-ink-700">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-brand"
                      checked={oneWay}
                      onChange={(e) => setOneWay(e.target.checked)}
                    />
                    {t('route.notReturning')}
                  </label>
                </div>

                {oneWay ? (
                  <p className="text-xs text-ink-500">
                    {t('route.oneWayNote', { place: destination?.label || '—' })}
                  </p>
                ) : (
                  <>
                    <PlaceField
                      value={returnTo}
                      onChange={(place) => {
                        setEndEdited(true);
                        setEndAt(place);
                      }}
                      placeholder={t('route.finishPlaceholder')}
                      error={errorFor('returnTo')}
                      marker={<Dot className="bg-brand" />}
                    />
                    <p className="mt-1 text-xs text-ink-500">
                      {endEdited ? t('route.finishEdited') : t('route.finishDefault')}
                    </p>
                  </>
                )}
              </div>
            </div>
          </section>
            </>
          )}
        </div>

        {/* ── 2. the map and the price ──
             On a phone this sits directly under the places, where it can be
             checked against what was just typed; at the bottom of a long form it
             was scrolled past and never seen. On a wide screen it moves to the
             right column and stays put while the rest of the form is filled in. ── */}
        <div className="order-2 space-y-4 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-start lg:sticky lg:top-20">
          {mode === 'route' && (
            <RouteMap
              origin={origin}
              destination={destination}
              stops={stops.filter((s) => s.lat)}
              returnTo={returnTo}
              geometries={result?.route?.geometries}
              approximate={result?.approximate}
            />
          )}
          <QuoteCard
            quote={result?.quote}
            route={result?.route}
            approximate={result?.approximate}
            loading={quoting}
            error={generalError}
          />
        </div>

        {/* ── 3. everything else ── */}
        <div className="order-3 space-y-5 lg:col-start-1 lg:row-start-2">
          {mode === 'route' && (
            <>

          <RouteChoice
            legs={result?.legs}
            onChange={(legKey, i) =>
              legKey === 'return' ? setReturnRouteIndex(i) : setRouteIndex(i)
            }
            currency={result?.quote?.currency}
          />

          <section className="card p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-500">
              {t('when.heading')}
            </h2>

            <div className="grid gap-4">
              <div className="sm:max-w-xs">
                <label className="label" htmlFor="start">
                  {t('when.pickup')}
                </label>
                <input
                  id="start"
                  type="datetime-local"
                  className={`input ${errorFor('startAt') ? 'border-danger' : ''}`}
                  value={startLocal}
                  min={minStart}
                  onChange={(e) => setStartLocal(e.target.value)}
                />
                <p className={`mt-1 text-xs ${errorFor('startAt') ? 'text-danger' : 'text-ink-500'}`}>
                  {errorFor('startAt') || t('when.timezone')}
                </p>
              </div>

              <div>
                <span className="label">{t('when.howLong')}</span>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Length of hire">
                  {DURATION_CHOICES.map((c) => (
                    <button
                      key={c.days}
                      type="button"
                      onClick={() => setDays(c.days)}
                      aria-pressed={days === c.days}
                      className={`rounded-full border px-3 py-1.5 text-sm transition ${
                        days === c.days
                          ? 'border-brand bg-brand-soft font-medium text-brand-dark'
                          : 'border-line text-ink-700 hover:border-ink-400'
                      }`}
                    >
                      {t(`duration.${c.days}`)}
                    </button>
                  ))}
                </div>
                <p
                  className={`mt-1.5 text-xs ${
                    errorFor('requestedHours') ? 'text-danger' : 'text-ink-500'
                  }`}
                >
                  {errorFor('requestedHours') || t('when.dayNote')}
                </p>

                <div className="mt-3">
                  <DriverHosting
                    rates={rates}
                    nights={result?.quote?.basis?.nights}
                    checked={driverHosted}
                    onChange={setDriverHosted}
                  />
                </div>

                {/* Not a warning and not a block — the price already covers the
                    overrun. It is the thing a person at a desk would say before
                    letting you book a ten-hour drive as a single day. */}
                {result?.suggestion && (
                  <div className="mt-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2.5">
                    <p className="text-sm text-ink-900">
                      {t('when.suggestion', { hours: duration(result.suggestion.onRoadHours) })}
                    </p>
                    <button
                      type="button"
                      className="btn-quiet mt-2 py-1.5 text-xs"
                      onClick={() => setDays(result.suggestion.days)}
                    >
                      {t('when.suggestionAction', {
                        length: t(`duration.${result.suggestion.days}`).toLowerCase(),
                      })}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-500">
              {t('who.heading')}
            </h2>

            {/* With one vehicle this is information, not a decision: a picker
                with a single option asks the customer to choose between one
                thing. It becomes a real picker on its own the moment a second
                vehicle is added to the rate card. */}
            {classes.length === 1 ? (
              <div className="rounded-lg border border-line bg-canvas px-3 py-2.5">
                <span className="block text-sm font-medium">{vehicleParts(t, classes[0])[0]}</span>
                <span className="block text-xs text-ink-500">{vehicleParts(t, classes[0])[1]}</span>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                {classes.map((c) => {
                  const [name, seatNote] = vehicleParts(t, c);
                  const active = vehicleClass === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setVehicleClass(c.key)}
                      aria-pressed={active}
                      className={`rounded-lg border px-3 py-2.5 text-left transition ${
                        active ? 'border-brand bg-brand-soft' : 'border-line hover:border-ink-400'
                      }`}
                    >
                      <span className="block text-sm font-medium">{name}</span>
                      <span className="block text-xs text-ink-500">{seatNote}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-4">
              <span className="label">{t('who.passengers')}</span>
              {/* Few enough seats to show every option: one tap instead of a
                  number field a customer can type 8 into and be refused. */}
              {seats <= 6 ? (
                <div className="flex gap-1.5" role="group" aria-label="Passengers">
                  {Array.from({ length: seats }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setPassengers(n)}
                      aria-pressed={Number(passengers) === n}
                      className={`h-10 w-12 rounded-lg border text-sm font-medium transition ${
                        Number(passengers) === n
                          ? 'border-brand bg-brand-soft text-brand-dark'
                          : 'border-line text-ink-700 hover:border-ink-400'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  id="passengers"
                  type="number"
                  className={`input max-w-40 ${errorFor('passengers') ? 'border-danger' : ''}`}
                  min="1"
                  max={seats}
                  value={passengers}
                  onChange={(e) => setPassengers(e.target.value)}
                />
              )}
              <p className={`mt-1 text-xs ${errorFor('passengers') ? 'text-danger' : 'text-ink-500'}`}>
                {errorFor('passengers') || t('who.upTo', { n: seats })}
              </p>
            </div>
          </section>
            </>
          )}

          {result?.quote && (
            <section id="finish" className="card scroll-mt-20 p-5 space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
                {t('finish.heading')}
              </h2>

              <div>
                <label className="label" htmlFor="phone">
                  {t('finish.phone')}
                </label>
                <input
                  id="phone"
                  type="tel"
                  className="input"
                  placeholder="+94 77 123 4567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                <p className="mt-1 text-xs text-ink-500">{t('finish.phoneNote')}</p>
              </div>

              <div>
                <label className="label" htmlFor="notes">
                  {t('finish.notes')}{' '}
                  <span className="font-normal text-ink-400">{t('finish.optional')}</span>
                </label>
                <textarea
                  id="notes"
                  rows={3}
                  className="input"
                  placeholder={t('finish.notesPlaceholder')}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {bookError && <p className="text-sm text-danger">{bookError}</p>}

              {clerkMissing ? (
                <p className="hint">Sign-in is not configured, so bookings cannot be taken yet.</p>
              ) : (
                <>
                  <SignedIn>
                    <button
                      type="button"
                      className="btn-primary w-full"
                      onClick={submit}
                      disabled={booking}
                    >
                      {booking
                        ? t('finish.sending')
                        : t('finish.request', {
                            total: money(result.quote.total, result.quote.currency),
                          })}
                    </button>
                    <p className="hint text-center">
                      {t('finish.noCharge')}
                    </p>
                  </SignedIn>
                  <SignedOut>
                    <SignInButton mode="modal">
                      <button type="button" className="btn-primary w-full">
                        {t('finish.signInToBook')}
                      </button>
                    </SignInButton>
                    <p className="hint text-center">{t('finish.kept')}</p>
                  </SignedOut>
                </>
              )}
            </section>
          )}

          <RateNote rates={rates} />
        </div>
      </div>

      {/* On a phone the price follows you up the page.

          No jump link. One used to sit here going straight to the booking
          section, which meant the quickest path through the form was to skip
          the route choice, the length and the passengers — and book a one-day
          hire on the expressway without ever seeing the alternatives. The bar's
          job is to keep the price in view, so it does that and nothing else,
          with the lines behind a tap for anyone asking how it adds up. */}
      {result?.quote && (
        <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-line bg-paper/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
          {showBreakdown && (
            <ul className="mb-3 max-h-48 space-y-1.5 overflow-y-auto border-b border-line pb-3">
              {result.quote.lines.map((line) => (
                <li key={line.key} className="flex items-baseline gap-3 text-sm">
                  <span className="min-w-0 break-words text-ink-700">{lineLabel(t, line)}</span>
                  <span className="ml-auto shrink-0 tabular-nums">
                    {money(line.amount, result.quote.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => setShowBreakdown((v) => !v)}
            aria-expanded={showBreakdown}
            className="flex w-full items-center gap-3 text-left"
          >
            <span className="min-w-0">
              <span className="block text-lg font-semibold tabular-nums leading-tight">
                {money(result.quote.total, result.quote.currency)}
              </span>
              <span className="block truncate text-xs text-ink-500">
                {hireLength(result.quote.basis)} · {km(result.quote.basis.distanceKm)}
              </span>
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-ink-500">
              {showBreakdown ? t('quote.hideBreakdown') : t('quote.showBreakdown')}
              <svg
                viewBox="0 0 20 20"
                aria-hidden="true"
                className={`h-4 w-4 transition-transform ${showBreakdown ? 'rotate-180' : ''}`}
              >
                <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────── stops ────────────────────────────── */

/**
 * Stops carry an `id` rather than being keyed by array position. Removing the
 * first of three otherwise shifts every later row's React state onto its
 * neighbour, so a place field keeps the text of the stop above it.
 */
let nextStopId = 1;
const blankStop = () => ({ id: nextStopId++, label: '', lat: null, lon: null });

function Stops({ stops, setStops, max, errorFor }) {
  const { t } = useT();
  const update = (i, patch) => setStops(stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  if (stops.length === 0) {
    return (
      <button type="button" className="btn-link" onClick={() => setStops([blankStop()])}>
        {t('route.addStop')}
      </button>
    );
  }

  return (
    <div className="space-y-3">
      {stops.map((stop, i) => (
        <div key={stop.id} className="rounded-lg border border-line bg-canvas p-3 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
              {t('route.stop', { n: i + 1 })}
            </span>
            <button
              type="button"
              className="ml-auto text-xs text-ink-500 hover:text-danger"
              onClick={() => setStops(stops.filter((_, idx) => idx !== i))}
            >
              {t('route.remove')}
            </button>
          </div>

          <PlaceField
            value={stop.lat ? stop : null}
            onChange={(place) =>
              setStops(
                stops.map((s, idx) =>
                  idx === i ? { id: s.id, ...(place || { label: '' }), waitHours: s.waitHours } : s,
                ),
              )
            }
            placeholder={t('route.stopPlaceholder')}
            error={errorFor(`stops.${i}`)}
            marker={<Dot className="bg-ink-400" />}
          />

          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-ink-700" htmlFor={`wait-${stop.id}`}>
              {t('route.waiting')}
            </label>
            <input
              id={`wait-${stop.id}`}
              type="number"
              className="input w-24 py-1.5"
              min="0"
              max="24"
              step="0.5"
              value={stop.waitHours ?? ''}
              placeholder="0"
              onChange={(e) =>
                update(i, { waitHours: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
            <span className="text-sm text-ink-500">{t('route.hours')}</span>
          </div>
        </div>
      ))}

      {stops.length < max && (
        <button type="button" className="btn-link" onClick={() => setStops([...stops, blankStop()])}>
          {t('route.addAnotherStop')}
        </button>
      )}
    </div>
  );
}

/* ────────────────────────────── bits ────────────────────────────── */

function Dot({ className }) {
  return <span className={`block h-2.5 w-2.5 rounded-full ${className}`} />;
}


function RateNote({ rates }) {
  const { t } = useT();
  if (!rates) return null;
  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold">{t('rates.heading')}</h2>
      <ul className="mt-3 space-y-1.5 text-sm text-ink-700">
        <li>
          {t('rates.day', {
            amount: money(rates.dayRate, rates.currency),
            hours: rates.hoursPerDay,
            km: rates.includedKmPerDay,
          })}
        </li>
        <li>{t('rates.perKm', { amount: money(rates.perKmOver, rates.currency) })}</li>
        <li>{t('rates.overtime', { amount: money(rates.overtimePerHour, rates.currency) })}</li>
        <li>{t('rates.overnight', { amount: money(rates.overnightStay, rates.currency) })}</li>
      </ul>
      <p className="mt-3 text-xs text-ink-400">
        {t('rates.included')}
      </p>
    </section>
  );
}

/** Tomorrow at 07:00 Colombo — the shape of most long hires. */
function defaultStart() {
  const d = new Date(Date.now() + 86_400_000);
  return `${toLocalInput(d.toISOString()).slice(0, 10)}T07:00`;
}
