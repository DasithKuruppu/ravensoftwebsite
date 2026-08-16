/**
 * Auth: Clerk sessions, verified server-side.
 *
 * The browser holds a Clerk session token — an RS256 JWT — and sends it as a
 * bearer. This module verifies the signature against Clerk's published JWKS and
 * checks issuer and expiry. Nothing about the caller is taken from the request
 * body, so a customer cannot book as somebody else by editing a field.
 *
 * Who the owner is comes from `OWNER_EMAILS`, an env var set at deploy time, not
 * from a flag on the user record — a Clerk metadata field is editable from the
 * dashboard by anyone with dashboard access, and this decides who can see every
 * customer's phone number.
 *
 * Clerk's default session token carries `sub` but not an email address, so the
 * profile is fetched once from Clerk's Backend API and cached for the life of
 * the container. Without a secret key configured, sign-in still works and every
 * caller is simply a non-owner.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';

/** A misconfiguration rather than a runtime fault: report it verbatim. */
export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
    this.isConfigError = true;
  }
}

/** Read a SecureString from SSM, falling back to an env var for local dev. */
async function readParam(envName, ssmName) {
  if (process.env[envName]) return process.env[envName];
  if (!ssmName) return undefined;
  const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
  const client = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });
  try {
    const res = await client.send(new GetParameterCommand({ Name: ssmName, WithDecryption: true }));
    return res.Parameter?.Value;
  } catch (err) {
    if (err.name === 'ParameterNotFound' || err.__type === 'ParameterNotFound') {
      throw new ConfigError(
        `Missing SSM parameter "${ssmName}". Create it with:\n` +
          `  aws ssm put-parameter --region ${process.env.AWS_REGION || 'us-east-1'} ` +
          `--type SecureString --overwrite --name ${ssmName} --value '<value>'\n` +
          '(see deploy.md section 4)',
      );
    }
    if (err.name === 'AccessDeniedException') {
      throw new ConfigError(
        `Not allowed to read SSM parameter "${ssmName}" — check the Lambda's IAM policy.`,
      );
    }
    throw err;
  }
}

let cachedConfig;
async function config() {
  if (cachedConfig) return cachedConfig;
  const prefix = process.env.SSM_PREFIX || '/fleet-booking';
  const [issuer, secretKey] = await Promise.all([
    readParam('CLERK_ISSUER', `${prefix}/clerk-issuer`),
    readParam('CLERK_SECRET_KEY', `${prefix}/clerk-secret-key`).catch(() => undefined),
  ]);
  if (!issuer) {
    throw new ConfigError(
      'Clerk is not configured: no CLERK_ISSUER. It looks like ' +
        'https://<your-app>.clerk.accounts.dev (see deploy.md section 4).',
    );
  }
  cachedConfig = {
    issuer: issuer.replace(/\/+$/, ''),
    secretKey,
    ownerEmails: (process.env.OWNER_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  };
  return cachedConfig;
}

/**
 * The local-development bypass: with DEV_FAKE_USER=1 every request is a
 * signed-in test customer, so the booking flow can be walked through before a
 * Clerk account exists.
 *
 * Guarded twice. `AWS_LAMBDA_FUNCTION_NAME` is set by the Lambda runtime and by
 * nothing else, so even if the variable were somehow set on the deployed
 * function — a stray `--environment` on a console edit, a copied .env — the
 * bypass stays off in production. Belt and braces, because the failure mode is
 * every stranger on the internet holding an owner session.
 */
function devFakeUser() {
  if (process.env.DEV_FAKE_USER !== '1') return null;
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    console.error('DEV_FAKE_USER is set on a deployed function — ignoring it.');
    return null;
  }
  return {
    userId: 'user_dev_local',
    sessionId: 'sess_dev_local',
    email: 'dev@localhost',
    name: 'Dev Customer',
    phone: '+94770000000',
    isOwner: process.env.DEV_FAKE_OWNER === '1',
  };
}

let jwks;
function keySet(issuer) {
  // createRemoteJWKSet caches and refreshes the key set itself; building it once
  // per container keeps every warm request off the network.
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return jwks;
}

/**
 * Verify a bearer token. Returns the caller, or null — never throws for a bad
 * token, because an expired session is an ordinary 401 and not an incident.
 */
export async function verify(token) {
  const fake = devFakeUser();
  if (fake) return fake;
  if (!token) return null;
  const cfg = await config();

  let claims;
  try {
    const { payload } = await jwtVerify(token, keySet(cfg.issuer), {
      issuer: cfg.issuer,
      clockTolerance: 30,
    });
    claims = payload;
  } catch (err) {
    if (err.code === 'ERR_JWKS_NO_MATCHING_KEY' || err.code === 'ERR_JOSE_GENERIC') {
      console.warn('token rejected', err.code, err.message);
    }
    return null;
  }

  if (!claims.sub) return null;

  const profile = await userProfile(claims.sub, cfg);
  const email = (profile.email || claims.email || '').toLowerCase();

  return {
    userId: claims.sub,
    sessionId: claims.sid,
    email,
    name: profile.name || claims.name || '',
    phone: profile.phone || '',
    isOwner: Boolean(email) && cfg.ownerEmails.includes(email),
  };
}

/* ── Clerk Backend API, for the fields the session token does not carry ── */

const profiles = new Map();

async function userProfile(userId, cfg) {
  if (profiles.has(userId)) return profiles.get(userId);
  if (!cfg.secretKey) return {};

  let profile = {};
  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
      headers: { authorization: `Bearer ${cfg.secretKey}` },
    });
    if (res.ok) {
      const u = await res.json();
      const primary =
        u.email_addresses?.find((e) => e.id === u.primary_email_address_id) || u.email_addresses?.[0];
      const phone =
        u.phone_numbers?.find((p) => p.id === u.primary_phone_number_id) || u.phone_numbers?.[0];
      profile = {
        email: primary?.email_address || '',
        phone: phone?.phone_number || '',
        name: [u.first_name, u.last_name].filter(Boolean).join(' '),
      };
    } else {
      console.warn('clerk profile lookup failed', res.status);
    }
  } catch (err) {
    // A profile we could not fetch must not block a booking — the session is
    // already proven. The caller is simply treated as a non-owner.
    console.warn('clerk profile lookup errored', err.message);
  }

  profiles.set(userId, profile);
  return profile;
}

/** Test seam. */
export function resetAuthCache() {
  cachedConfig = undefined;
  jwks = undefined;
  profiles.clear();
}
