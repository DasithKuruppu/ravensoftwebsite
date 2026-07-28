/**
 * API client. Base URL is a build-time env var: in production Vite bakes in the
 * API Gateway URL; in dev it is empty and requests go through the Vite proxy
 * at /api.
 */
const BASE = import.meta.env.VITE_API_URL || '/api';

const TOKEN_KEY = 'fleet.token';
const ROLE_KEY = 'fleet.role';
// The driver's name arrives with the dashboard summary. Remembering it means a
// page that never asks for one — the daily log, say, opened directly — still
// knows who is signed in.
const NAME_KEY = 'fleet.driverName';

/**
 * localStorage, or nothing.
 *
 * The token is held in memory as the primary copy and localStorage only makes it
 * survive a reload — so a context without one still works, it just forgets. That
 * matters because components importing this module are rendered to a string in
 * tests, where reading `localStorage` at module scope would throw before any
 * assertion ran.
 */
const store = typeof localStorage === 'undefined' ? null : localStorage;

let memoryToken = store?.getItem(TOKEN_KEY) || null;

export function getToken() {
  return memoryToken;
}

export function getRole() {
  return store?.getItem(ROLE_KEY) || null;
}

export function getDriverName() {
  return store?.getItem(NAME_KEY) || '';
}

export function rememberDriverName(name) {
  if (!store) return;
  if (name) store.setItem(NAME_KEY, name);
  else store.removeItem(NAME_KEY);
}

export function setSession(token, role) {
  memoryToken = token;
  if (!store) return;
  if (token) {
    store.setItem(TOKEN_KEY, token);
    store.setItem(ROLE_KEY, role);
  } else {
    store.removeItem(TOKEN_KEY);
    store.removeItem(ROLE_KEY);
    // Signing out forgets who it was, so the next person to sign in on this
    // phone is not greeted by somebody else's name.
    store.removeItem(NAME_KEY);
  }
}

export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.message || payload?.error || `Request failed (${status})`);
    this.status = status;
    this.payload = payload;
  }
}

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(memoryToken ? { authorization: `Bearer ${memoryToken}` } : {}),
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

  if (res.status === 401) {
    setSession(null, null);
    window.dispatchEvent(new Event('fleet:logout'));
  }
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload;
}

export const api = {
  login: (username, password) => request('POST', '/login', { username, password }),
  summary: (month) => request('GET', `/summary?month=${month}`),
  entries: (month) => request('GET', `/entries?month=${month}`),
  saveEntry: (date, entry) => request('PUT', `/entries/${date}`, entry),
  deleteEntry: (date) => request('DELETE', `/entries/${date}`),
  setOffDay: (date, off) => request('PUT', `/entries/${date}/off`, { off }),
  // What he paid to charge. Writable by the driver: he is the one at the charger,
  // and it is the only cost figure he records.
  saveCharging: (date, sessions) => request('PUT', `/entries/${date}/charging`, { sessions }),
  importRows: (rows) => request('POST', '/entries/import', { rows }),
  settings: () => request('GET', '/settings'),
  saveSettings: (settings) => request('PUT', '/settings', settings),
  // The driver's own goal. Separate from `saveSettings` because this is the one
  // settings field he is allowed to write.
  saveTarget: (payTarget) => request('PUT', '/settings/target', { payTarget }),
  // The handover ledger. The driver logs; the owner confirms. Both read it.
  handovers: () => request('GET', '/handovers'),
  logHandover: (handover) => request('POST', '/handovers', handover),
  confirmHandover: (id, confirmed = true) => request('PUT', `/handovers/${id}`, { confirmed }),
  deleteHandover: (id) => request('DELETE', `/handovers/${id}`),
  validate: (month) => request('GET', `/validate?month=${month}`),
  location: () => request('GET', '/location'),
  costs: () => request('GET', '/costs'),
  saveCosts: (costs) => request('PUT', '/costs', { costs }),
  chargers: () => request('GET', '/chargers'),
  saveChargers: (chargers) => request('PUT', '/chargers', { chargers }),
};
