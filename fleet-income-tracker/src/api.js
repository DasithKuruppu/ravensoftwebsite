/**
 * API client. Base URL is a build-time env var: in production Vite bakes in the
 * API Gateway URL; in dev it is empty and requests go through the Vite proxy
 * at /api.
 */
const BASE = import.meta.env.VITE_API_URL || '/api';

const TOKEN_KEY = 'fleet.token';
const ROLE_KEY = 'fleet.role';

// Kept in memory as the primary copy; localStorage only survives reloads.
let memoryToken = localStorage.getItem(TOKEN_KEY) || null;

export function getToken() {
  return memoryToken;
}

export function getRole() {
  return localStorage.getItem(ROLE_KEY) || null;
}

export function setSession(token, role) {
  memoryToken = token;
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(ROLE_KEY, role);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
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
  importRows: (rows) => request('POST', '/entries/import', { rows }),
  settings: () => request('GET', '/settings'),
  saveSettings: (settings) => request('PUT', '/settings', settings),
  validate: (month) => request('GET', `/validate?month=${month}`),
  location: () => request('GET', '/location'),
  costs: () => request('GET', '/costs'),
  saveCosts: (costs) => request('PUT', '/costs', { costs }),
  chargers: () => request('GET', '/chargers'),
  saveChargers: (chargers) => request('PUT', '/chargers', { chargers }),
};
