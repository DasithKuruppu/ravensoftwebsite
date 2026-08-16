import { useState, useEffect, useCallback } from 'react';
import { SignedIn, SignedOut, SignInButton } from '@clerk/clerk-react';
import StatusPill from '../components/StatusPill.jsx';
import { Route } from './Bookings.jsx';
import { api } from '../api.js';
import { money, km, duration, when, hireLength } from '../format.js';

const FILTERS = ['pending', 'confirmed', '', 'cancelled', 'declined'];
const FILTER_LABELS = { pending: 'To confirm', confirmed: 'Confirmed', '': 'All', cancelled: 'Cancelled', declined: 'Declined' };

/**
 * The owner's side: requests to answer, and the rate card behind every price.
 *
 * Deliberately plain. This is a page opened to decide one thing — take this
 * trip or not — so each request shows the route, the money and the customer's
 * phone number without a click, and the two buttons that resolve it sit under
 * them.
 *
 * A 403 here is the expected answer for anyone who is not the owner; the API is
 * what enforces that, and this page only stops rendering around it.
 */
export default function Admin({ clerkMissing }) {
  if (clerkMissing) return <p className="hint">Sign-in is not configured.</p>;
  return (
    <>
      <SignedIn>
        <Console />
      </SignedIn>
      <SignedOut>
        <SignInButton mode="modal">
          <button type="button" className="btn-primary">
            Sign in
          </button>
        </SignInButton>
      </SignedOut>
    </>
  );
}

function Console() {
  const [tab, setTab] = useState('bookings');
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <div className="ml-auto flex gap-1 text-sm">
          <button
            type="button"
            className={tab === 'bookings' ? 'btn-primary' : 'btn-quiet'}
            onClick={() => setTab('bookings')}
          >
            Requests
          </button>
          <button
            type="button"
            className={tab === 'rates' ? 'btn-primary' : 'btn-quiet'}
            onClick={() => setTab('rates')}
          >
            Rates
          </button>
        </div>
      </div>
      {tab === 'bookings' ? <Requests /> : <Rates />}
    </div>
  );
}

/* ────────────────────────────── requests ────────────────────────────── */

function Requests() {
  const [status, setStatus] = useState('pending');
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setBookings(null);
    api
      .adminBookings(status)
      .then(({ bookings: b }) => setBookings(b))
      .catch((err) => setError(err.message));
  }, [status]);

  useEffect(load, [load]);

  const replace = (updated) =>
    setBookings((list) =>
      // A booking that no longer matches the filter drops out of the list rather
      // than sitting there contradicting the tab it is under.
      (list || [])
        .map((b) => (b.ref === updated.ref ? updated : b))
        .filter((b) => !status || b.status === status),
    );

  if (error) return <p className="text-sm text-danger">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f || 'all'}
            type="button"
            onClick={() => setStatus(f)}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              status === f ? 'bg-brand-soft font-medium text-brand-dark' : 'text-ink-500 hover:text-ink-900'
            }`}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {bookings === null && <p className="hint">Loading…</p>}
      {bookings?.length === 0 && <p className="hint">Nothing here.</p>}

      <ul className="space-y-4">
        {(bookings || []).map((b) => (
          <li key={b.ref}>
            <RequestCard booking={b} onChange={replace} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequestCard({ booking, onChange }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [driverName, setDriverName] = useState(booking.driverName || '');
  const [vehicle, setVehicle] = useState(booking.vehicle || '');
  const [ownerNote, setOwnerNote] = useState(booking.ownerNote || '');
  const [agreedTotal, setAgreedTotal] = useState(booking.agreedTotal ?? '');
  const [error, setError] = useState('');

  async function save(patch) {
    setBusy(true);
    setError('');
    try {
      const { booking: updated } = await api.updateBooking(booking.ref, patch);
      onChange(updated);
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const { trip, quote, contact } = booking;

  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm font-semibold">{booking.ref}</span>
        <StatusPill status={booking.status} />
        <span className="ml-auto text-lg font-semibold tabular-nums">
          {money(booking.agreedTotal ?? quote.total, quote.currency)}
        </span>
      </div>

      <p className="text-sm text-ink-700">
        {when(trip.startAt)} · {hireLength(quote.basis)} · {km(quote.basis.distanceKm)}
        {quote.basis.nights > 0 && ` · ${quote.basis.nights} night away`}
      </p>
      {(booking.legs || []).map((leg) => {
        const picked = leg.options?.[leg.index];
        return picked ? (
          <p key={leg.key} className="-mt-2 text-xs text-ink-500">
            {booking.legs.length > 1 ? `${leg.label}: ` : 'via '}
            {picked.via || picked.label}
            {picked.avoidsHighways && ' · no expressway'}
          </p>
        ) : null;
      })}

      <Route trip={trip} />

      <div className="rounded-lg bg-canvas px-3 py-2 text-sm">
        <p className="font-medium">{contact.name || 'No name given'}</p>
        <p className="text-ink-700">
          <a className="underline underline-offset-2" href={`tel:${contact.phone}`}>
            {contact.phone}
          </a>
          {contact.email && <span className="text-ink-500"> · {contact.email}</span>}
        </p>
        <p className="mt-1 text-xs text-ink-500">
          {trip.passengers} passenger{trip.passengers === 1 ? '' : 's'} · {quote.basis.vehicleClass}
        </p>
      </div>

      {trip.notes && <p className="text-sm text-ink-700">“{trip.notes}”</p>}
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {booking.status === 'pending' && (
          <>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => save({ status: 'confirmed' })}>
              Confirm
            </button>
            <button type="button" className="btn-quiet" disabled={busy} onClick={() => save({ status: 'declined' })}>
              Decline
            </button>
          </>
        )}
        {booking.status === 'confirmed' && (
          <button type="button" className="btn-quiet" disabled={busy} onClick={() => save({ status: 'completed' })}>
            Mark completed
          </button>
        )}
        <button type="button" className="btn-link ml-auto" onClick={() => setOpen(!open)}>
          {open ? 'Hide details' : 'Driver, price, note'}
        </button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-line pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Driver</label>
              <input className="input" value={driverName} onChange={(e) => setDriverName(e.target.value)} />
            </div>
            <div>
              <label className="label">Vehicle number</label>
              <input className="input" value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Agreed price</label>
            <input
              type="number"
              className="input"
              placeholder={String(quote.total)}
              value={agreedTotal}
              onChange={(e) => setAgreedTotal(e.target.value)}
            />
            <p className="mt-1 text-xs text-ink-500">
              Leave blank to charge the quote, {money(quote.total, quote.currency)}.
            </p>
          </div>
          <div>
            <label className="label">Note to the customer</label>
            <textarea
              rows={2}
              className="input"
              value={ownerNote}
              onChange={(e) => setOwnerNote(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => save({ driverName, vehicle, ownerNote, agreedTotal })}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────── rate card ────────────────────────────── */

const RATE_FIELDS = [
  { key: 'dayRate', label: 'Day rate', hint: 'One hire day, LKR' },
  { key: 'hoursPerDay', label: 'Hours in a day', hint: 'Also the shortest hire' },
  { key: 'includedKmPerDay', label: 'Km included per day', hint: '' },
  { key: 'perKmOver', label: 'Per km beyond', hint: 'LKR' },
  { key: 'overtimePerHour', label: 'Overtime per hour', hint: 'LKR' },
  { key: 'overnightStay', label: "Driver's overnight stay", hint: 'Per night away, LKR' },
  {
    key: 'overnightStayHosted',
    label: 'Overnight stay, hosted',
    hint: 'Per night when the customer feeds and houses him',
  },
  { key: 'stopFee', label: 'Fee per stop', hint: 'LKR, usually 0' },
  { key: 'bufferHoursPerDay', label: 'Buffer hours per day', hint: 'Added to routed time' },
  { key: 'roundTo', label: 'Round totals to', hint: 'LKR' },
  { key: 'quoteValidMinutes', label: 'Quote valid for', hint: 'Minutes' },
];

function Rates() {
  const [rates, setRates] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .adminRates()
      .then(({ rates: r }) => setRates(r))
      .catch((err) => setError(err.message));
  }, []);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const { rates: r } = await api.saveRates(rates);
      setRates(r);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!rates) return <p className="hint">Loading…</p>;

  const set = (key, value) => setRates({ ...rates, [key]: value });

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <h2 className="font-semibold">Rate card</h2>
        <p className="mt-1 text-sm text-ink-500">
          Every quote from now on uses these. Bookings already made keep the price they were given.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {RATE_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="label" htmlFor={f.key}>
                {f.label}
              </label>
              <input
                id={f.key}
                type="number"
                className="input"
                value={rates[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
              />
              {f.hint && <p className="mt-1 text-xs text-ink-500">{f.hint}</p>}
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <h2 className="font-semibold">Vehicles</h2>
        <p className="mt-1 text-sm text-ink-500">
          What the fleet can actually send. The multiplier applies to time and distance, not to the
          night allowance. The booking form shows a picker only when there is more than one.
        </p>

        <div className="mt-4 grid gap-2 text-xs uppercase tracking-wide text-ink-400 sm:grid-cols-[1fr_5rem_5rem_2rem]">
          <span>Name · description</span>
          <span>Seats</span>
          <span>× rate</span>
          <span />
        </div>

        <div className="mt-1 space-y-2">
          {(rates.vehicleClasses || []).map((v, i) => {
            const edit = (patch) => {
              const next = [...rates.vehicleClasses];
              next[i] = { ...v, ...patch };
              set('vehicleClasses', next);
            };
            return (
              <div key={v.key} className="grid gap-2 sm:grid-cols-[1fr_5rem_5rem_2rem]">
                <input className="input" value={v.label} onChange={(e) => edit({ label: e.target.value })} />
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={v.seats}
                  aria-label={`${v.key} seats`}
                  onChange={(e) => edit({ seats: e.target.value })}
                />
                <input
                  className="input"
                  type="number"
                  step="0.05"
                  min="0"
                  value={v.multiplier}
                  aria-label={`${v.key} multiplier`}
                  onChange={(e) => edit({ multiplier: e.target.value })}
                />
                <button
                  type="button"
                  aria-label={`Remove ${v.key}`}
                  // The last vehicle cannot go: a rate card with none would fall
                  // back to the shipped defaults on the next quote, quietly
                  // offering cars the fleet does not own.
                  disabled={(rates.vehicleClasses || []).length < 2}
                  onClick={() =>
                    set('vehicleClasses', rates.vehicleClasses.filter((_, idx) => idx !== i))
                  }
                  className="h-10 rounded-lg text-ink-400 transition hover:text-danger disabled:opacity-30 disabled:hover:text-ink-400"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="btn-link mt-3"
          onClick={() =>
            set('vehicleClasses', [
              ...(rates.vehicleClasses || []),
              {
                key: `vehicle${(rates.vehicleClasses || []).length + 1}`,
                label: 'New vehicle · up to 4 passengers',
                seats: 4,
                multiplier: 1.3,
              },
            ])
          }
        >
          + Add a vehicle
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save rates'}
        </button>
        {saved && <span className="text-sm text-brand">Saved.</span>}
      </div>
    </div>
  );
}
