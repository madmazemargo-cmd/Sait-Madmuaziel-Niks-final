import { onRequest } from '../functions/api/[[path]].js';

async function call(path, init = {}) {
  return onRequest({
    request: new Request(`https://example.pages.dev/api/${path}`, init),
    params: { path: [path] },
  });
}

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

const unknown = await call('unknown');
if (unknown.status !== 404) throw new Error(`Expected 404, received ${unknown.status}`);

const oversized = await call('applications', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': '40000' },
  body: '{}',
});
if (oversized.status !== 413) throw new Error(`Expected 413, received ${oversized.status}`);

console.log('proxy guards: ok');
