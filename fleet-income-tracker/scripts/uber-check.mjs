#!/usr/bin/env node
/**
 * Uber Supplier API connectivity check.
 *
 *   npm run uber:check
 *
 * Reads UBER_CLIENT_ID / UBER_CLIENT_SECRET from .env, requests a
 * client_credentials token, and — if one comes back — lists the vehicle
 * supplier organisations the app can see. The secret is never printed.
 */
import 'dotenv/config';

const TOKEN_URL = 'https://auth.uber.com/oauth/v2/token';
const ORGS_URL = 'https://api.uber.com/v1/vehicle-suppliers/orgs';
const SCOPE = 'vehicle_suppliers.organizations.read';

const CLIENT_ID = process.env.UBER_CLIENT_ID;
const CLIENT_SECRET = process.env.UBER_CLIENT_SECRET;

/** Plain-English reading of the error codes Uber actually returns here. */
const EXPLANATIONS = {
  invalid_scope:
    'Uber has not granted your app Supplier API access yet — request access via the developer dashboard support form. The scope only becomes valid once your app is approved for the Vehicle Suppliers programme.',
  invalid_client:
    'The client ID or secret is wrong, or the app was deleted. Re-copy both from the Uber developer dashboard into .env.',
  unauthorized_client:
    'The app exists but is not allowed to use the client_credentials grant. Uber enables this per-app — ask support to enable it.',
  invalid_grant:
    'Uber rejected the grant type. Confirm the app is configured for server-to-server (client credentials) auth.',
  invalid_request:
    'The request was malformed — usually a missing client_id/client_secret. Check .env is loaded and both values are non-empty.',
  access_denied:
    'Credentials are valid but this app is not entitled to the requested scope. Same fix as invalid_scope: request Supplier API access.',
};

/**
 * Uber reuses `access_denied` for a wrong secret as well as for a missing
 * entitlement — the description is the only thing that tells them apart.
 */
function explain(code, description = '') {
  if (/secret mismatch/i.test(description)) {
    return 'The client secret does not match this client ID. Re-copy UBER_CLIENT_SECRET from the Uber developer dashboard into .env — the client ID itself is being accepted.';
  }
  return (
    EXPLANATIONS[code] ||
    `Unrecognised error code "${code}". Check the Uber developer dashboard for the app's status and entitlements.`
  );
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!CLIENT_ID || !CLIENT_SECRET) {
  fail(
    'UBER_CLIENT_ID and UBER_CLIENT_SECRET must be set in .env.\n' +
      '  Copy .env.example to .env and fill in the secret (the client ID is already there).',
  );
}

console.log('→ Requesting token from', TOKEN_URL);
console.log('  client_id:', CLIENT_ID);
console.log('  scope:    ', SCOPE);

const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'client_credentials',
    scope: SCOPE,
  }),
});

const tokenBody = await tokenRes.text();
let token;
try {
  token = JSON.parse(tokenBody);
} catch {
  fail(`Token endpoint returned non-JSON (HTTP ${tokenRes.status}):\n${tokenBody}`);
}

if (!tokenRes.ok || !token.access_token) {
  const code = token.error || token.code || 'unknown_error';
  console.error(`\n✗ Auth failed — HTTP ${tokenRes.status}`);
  console.error('\n  Exact error body:');
  console.error('  ' + JSON.stringify(token, null, 2).split('\n').join('\n  '));
  console.error('\n  What this means:');
  console.error('  ' + explain(code, token.error_description));
  console.error('');
  process.exit(1);
}

console.log(`\n✓ Token acquired (expires in ${token.expires_in ?? '?'}s, scope: ${token.scope || SCOPE})`);
console.log('→ Fetching', ORGS_URL);

const orgsRes = await fetch(ORGS_URL, {
  headers: { authorization: `Bearer ${token.access_token}`, accept: 'application/json' },
});

const orgsBody = await orgsRes.text();

if (!orgsRes.ok) {
  console.error(`\n✗ Orgs request failed — HTTP ${orgsRes.status}`);
  console.error('\n  Exact error body:');
  console.error('  ' + orgsBody.split('\n').join('\n  '));
  console.error(
    '\n  What this means:\n  The token is valid but this app cannot read supplier organisations.' +
      '\n  Usually the same entitlement gap as invalid_scope — Supplier API access has not been granted.\n',
  );
  process.exit(1);
}

try {
  const orgs = JSON.parse(orgsBody);
  console.log('\n✓ Organisations:\n');
  console.log(JSON.stringify(orgs, null, 2));
  const list = orgs.organizations || orgs.data || (Array.isArray(orgs) ? orgs : null);
  if (Array.isArray(list)) {
    console.log(`\n  ${list.length} organisation(s) visible to this app.`);
    console.log('  Note the org UUID — phase 2 (uber-sync) will need it to pull daily earnings.\n');
  }
} catch {
  console.log('\n✓ Response (non-JSON):\n');
  console.log(orgsBody);
}
