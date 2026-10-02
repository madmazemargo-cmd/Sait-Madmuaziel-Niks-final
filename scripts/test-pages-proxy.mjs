import { onRequest } from '../functions/api/[[path]].js';

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = new URL(input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url);
  if (url.pathname === '/api/calendar') return Response.json({ events: [] });
  if (url.pathname === '/api/catalog') return Response.json({ items: [] });
  if (url.pathname === '/api/reviews') return Response.json({ reviews: [] });
  return Response.json({ status: 'ok' });
};

async function call(path, init = {}, env = { API_ORIGIN: 'https://api.example.test' }) {
  return onRequest({
    request: new Request(`https://example.pages.dev/api/${path}`, init),
    params: { path: [path] },
    env,
  });
}

try {
async function expectJsonList(path, key) {
  const response = await call(path);
  const payload = await response.json();
  if (!response.ok || !Array.isArray(payload[key])) {
    throw new Error(`${path} proxy failed: ${response.status}`);
  }
  console.log(`${path}: ${response.status}, ${payload[key].length} records`);
}

await expectJsonList('calendar', 'events');
await expectJsonList('catalog', 'items');
await expectJsonList('reviews', 'reviews');

const missingOrigin = await call('calendar', {}, {});
if (missingOrigin.status !== 503) throw new Error(`Expected unconfigured API origin to return 503, received ${missingOrigin.status}`);
if (!missingOrigin.headers.get('Strict-Transport-Security') || !missingOrigin.headers.get('Content-Security-Policy')?.includes("frame-ancestors 'none'")) {
  throw new Error('API error responses must retain HSTS and frame-ancestors headers.');
}
const insecureOrigin = await call('calendar', {}, { API_ORIGIN: 'http://api.example.test' });
if (insecureOrigin.status !== 503) throw new Error(`Expected insecure API origin to return 503, received ${insecureOrigin.status}`);

const unknown = await call('unknown');
if (unknown.status !== 404) throw new Error(`Expected 404, received ${unknown.status}`);

const miniMethod = await call('mini/session');
if (miniMethod.status !== 405) throw new Error(`Expected mini session GET to be rejected, received ${miniMethod.status}`);

const oversized = await call('applications', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': '40000' },
  body: '{}',
});
if (oversized.status !== 413) throw new Error(`Expected 413, received ${oversized.status}`);

console.log('proxy guards: ok');
} finally {
  globalThis.fetch = originalFetch;
}
