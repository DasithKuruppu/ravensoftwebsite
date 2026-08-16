/**
 * Local dev wrapper: a tiny Express server that converts requests into API
 * Gateway HTTP API (payload v2) events and calls the *same* handler that runs
 * in Lambda. No route logic lives here — if it works locally it works deployed.
 */
import 'dotenv/config';
import express from 'express';
import bcrypt from 'bcryptjs';

const PORT = process.env.API_PORT || 3001;

// Dev-only defaults so `npm run dev` works on a fresh clone with no setup.
// Production reads all three from SSM SecureString parameters.
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'local-dev-secret-not-for-production';
if (!process.env.OWNER_PASSWORD_HASH) {
  process.env.OWNER_PASSWORD_HASH = bcrypt.hashSync('owner123', 10);
}
if (!process.env.DRIVER_PASSWORD_HASH) {
  process.env.DRIVER_PASSWORD_HASH = bcrypt.hashSync('driver123', 10);
}

const { handler } = await import('./handler.mjs');
const { storeMode } = await import('./store.mjs');

const app = express();
app.use(express.text({ type: '*/*', limit: '10mb' }));

app.all('*', async (req, res) => {
  const event = {
    version: '2.0',
    rawPath: req.path,
    rawQueryString: new URLSearchParams(req.query).toString(),
    headers: Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v]),
    ),
    queryStringParameters: Object.fromEntries(
      Object.entries(req.query).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
    ),
    body: typeof req.body === 'string' && req.body.length ? req.body : undefined,
    isBase64Encoded: false,
    requestContext: { http: { method: req.method, path: req.path } },
  };

  const result = await handler(event);
  res.status(result.statusCode);
  for (const [k, v] of Object.entries(result.headers || {})) res.set(k, v);
  res.send(result.body || '');
});

app.listen(PORT, () => {
  console.log(`  API      http://localhost:${PORT}   (store: ${storeMode})`);
  console.log('  Login    owner / owner123   ·   driver / driver123   (dev defaults)');
});
