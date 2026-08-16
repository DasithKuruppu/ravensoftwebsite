/**
 * Local dev wrapper: a tiny Express server that converts requests into API
 * Gateway HTTP API (payload v2) events and calls the *same* handler that runs in
 * Lambda. No route logic lives here — if it works locally it works deployed.
 *
 * Clerk is the one thing that cannot be faked into working offline. With
 * CLERK_ISSUER set in .env the real tokens from the dev frontend verify
 * normally. Without it, set DEV_FAKE_USER=1 and every request is treated as a
 * signed-in test customer, so the booking flow can be exercised before the Clerk
 * account exists. That switch is honoured only here, never in the Lambda.
 */
import 'dotenv/config';
import express from 'express';

const PORT = process.env.API_PORT || 3002;

const { handler } = await import('./handler.mjs');
const { storeMode } = await import('./store.mjs');

const app = express();
app.use(express.text({ type: '*/*', limit: '2mb' }));

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
  if (process.env.DEV_FAKE_USER === '1') {
    console.log('  Auth     DEV_FAKE_USER — every request is a signed-in test customer');
  } else if (!process.env.CLERK_ISSUER) {
    console.log('  Auth     no CLERK_ISSUER: quotes work, booking returns 500. See .env.example');
  }
});
