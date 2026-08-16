/**
 * API client.
 *
 * The bearer token is Clerk's, and Clerk hands it out asynchronously and
 * refreshes it behind the scenes — so rather than caching one, this module holds
 * a *getter* that `App` wires up once from `useAuth`. Every request asks for a
 * fresh token, which means a session that refreshed mid-visit keeps working and
 * one that ended stops working immediately.
 */
import { getLocale } from './i18n/i18n.js';

const BASE = import.meta.env.VITE_API_URL || '/api';

let getToken = async () => null;

/** Called once, from App, with Clerk's `getToken`. */
export function setTokenSource(fn) {
  getToken = fn || (async () => null);
}

export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.message || payload?.error || `Something went wrong (${status})`);
    this.status = status;
    this.code = payload?.error;
    // Which input the message is about, when the server named one.
    this.field = payload?.field;
    this.payload = payload;
  }
}

async function request(method, path, body, { auth = true, signal } = {}) {
  const token = auth ? await getToken() : null;
  const res = await fetch(`${BASE}${path}`, {
    method,
    signal,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return null;

  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { message: text };
  }

  if (!res.ok) throw new ApiError(res.status, payload);
  return payload;
}

export const api = {
  rates: () => request('GET', '/rates', undefined, { auth: false }),
  // Suggestions only — no coordinates. `session` groups everything typed for one
  // field into a single billed Google lookup; see api/routing.mjs.
  // The language rides along on everything Google answers: place names and road
  // names come back in Sinhala for a Sinhala reader, and the server caches them
  // per language so the two never cross.
  places: (q, session, signal) =>
    request(
      'GET',
      `/places?q=${encodeURIComponent(q)}&lang=${getLocale()}` +
        (session ? `&session=${encodeURIComponent(session)}` : ''),
      undefined,
      { auth: false, signal },
    ),
  resolvePlace: (placeId, session) =>
    request('POST', '/places/resolve', { placeId, session, lang: getLocale() }, { auth: false }),
  // Quoting is public: a price before a sign-in wall.
  quote: (trip, signal) =>
    request('POST', '/quote', { ...trip, lang: getLocale() }, { auth: false, signal }),

  book: (trip) => request('POST', '/bookings', { ...trip, lang: getLocale() }),
  myBookings: () => request('GET', '/bookings'),
  booking: (ref) => request('GET', `/bookings/${ref}`),
  cancel: (ref, reason) => request('POST', `/bookings/${ref}/cancel`, { reason }),

  adminBookings: (status) =>
    request('GET', `/admin/bookings${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  updateBooking: (ref, patch) => request('PUT', `/admin/bookings/${ref}`, patch),
  adminRates: () => request('GET', '/admin/rates'),
  saveRates: (rates) => request('PUT', '/admin/rates', { rates }),
};
