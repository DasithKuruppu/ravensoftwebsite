/**
 * Auth: HS256 JWTs for exactly two users, `owner` and `driver`.
 *
 * Secrets never live in code or in the frontend bundle. In production the JWT
 * secret and both bcrypt password hashes are read from SSM Parameter Store
 * (SecureString) at cold start and cached for the life of the container.
 * Locally the same values come from .env.
 *
 * The JWT is signed with node:crypto rather than a library so the Lambda
 * bundle stays tiny; bcryptjs verifies the password hashes.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

export const ROLES = { OWNER: 'owner', DRIVER: 'driver' };
const TOKEN_TTL_SECONDS = 12 * 60 * 60;

let cachedConfig;

/** Read a SecureString from SSM, falling back to an env var for local dev. */
async function readParam(envName, ssmName) {
  if (process.env[envName]) return process.env[envName];
  if (!ssmName) return undefined;
  const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
  const client = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });
  try {
    const res = await client.send(
      new GetParameterCommand({ Name: ssmName, WithDecryption: true }),
    );
    return res.Parameter?.Value;
  } catch (err) {
    // SSM's ParameterNotFound carries an empty message, which surfaces to the
    // browser as the useless "UnknownError". Say what is actually missing and
    // how to fix it — this is a deployment step, not a bug.
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

/** A misconfiguration rather than a runtime fault: worth reporting verbatim. */
export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
    this.isConfigError = true;
  }
}

async function config() {
  if (cachedConfig) return cachedConfig;
  const prefix = process.env.SSM_PREFIX || '/fleet-tracker';
  const [secret, ownerHash, driverHash] = await Promise.all([
    readParam('JWT_SECRET', `${prefix}/jwt-secret`),
    readParam('OWNER_PASSWORD_HASH', `${prefix}/owner-password-hash`),
    readParam('DRIVER_PASSWORD_HASH', `${prefix}/driver-password-hash`),
  ]);
  if (!secret) throw new ConfigError('JWT secret is not configured');
  cachedConfig = { secret, hashes: { owner: ownerHash, driver: driverHash } };
  return cachedConfig;
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromB64url = (str) => Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function sign(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = b64url(crypto.createHmac('sha256', secret).update(data).digest());
  return `${data}.${sig}`;
}

/** @returns {{sub:string, role:string}|null} */
export async function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const { secret } = await config();
  const data = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', secret).update(data).digest();
  const given = fromB64url(parts[2]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  let payload;
  try {
    payload = JSON.parse(fromB64url(parts[1]).toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
  return payload;
}

/** @returns {{token:string, role:string, expiresAt:number}|null} on success */
export async function login(username, password) {
  const { secret, hashes } = await config();
  const user = String(username || '').toLowerCase().trim();
  const hash = hashes[user];
  // Always run a compare so a wrong username costs the same time as a wrong password.
  const ok = await bcrypt.compare(String(password || ''), hash || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
  if (!ok || !hash) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: user, role: user, iat: now, exp: now + TOKEN_TTL_SECONDS };
  return { token: sign(payload, secret), role: user, expiresAt: payload.exp };
}

export function isOwner(auth) {
  return auth?.role === ROLES.OWNER;
}
