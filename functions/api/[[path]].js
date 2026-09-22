const API_ORIGIN = 'https://madmuazelle-niks-api.workers.dev';
const ROUTES = new Map([
  ['healthz', new Set(['GET'])],
  ['calendar', new Set(['GET'])],
  ['catalog', new Set(['GET'])],
  ['applications', new Set(['GET', 'POST'])],
  ['auth/login', new Set(['POST'])],
  ['auth/me', new Set(['GET'])],
  ['auth/logout', new Set(['POST'])],
]);
const MAX_BODY_BYTES = 32 * 1024;

function jsonError(message, status, extraHeaders = {}) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders } });
}

export async function onRequest(context) {
  const segments = Array.isArray(context.params.path) ? context.params.path : [context.params.path].filter(Boolean);
  const endpoint = segments.join('/');
  const method = context.request.method.toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { Allow: 'GET, POST, PATCH, DELETE, OPTIONS' } });
  if (endpoint.startsWith('master/')) return proxy(context, endpoint);
  const allowedMethods = ROUTES.get(endpoint);
  if (!allowedMethods) return jsonError('API route not found.', 404);
  if (!allowedMethods.has(method)) return jsonError('Method not allowed.', 405, { Allow: [...allowedMethods, 'OPTIONS'].join(', ') });
  if (method === 'POST' && Number(context.request.headers.get('Content-Length') ?? '0') > MAX_BODY_BYTES) return jsonError('Запрос слишком большой.', 413);
  return proxy(context, endpoint);
}

async function proxy(context, endpoint) {
  const incomingUrl = new URL(context.request.url);
  const upstreamUrl = new URL(`/api/${endpoint}`, API_ORIGIN);
  upstreamUrl.search = incomingUrl.search;
  const headers = new Headers({ Accept: 'application/json' });
  for (const name of ['Content-Type', 'Cookie', 'X-CSRF-Token', 'Origin']) {
    const value = context.request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const upstream = await fetch(upstreamUrl, { method: context.request.method, headers, body: ['GET', 'HEAD'].includes(context.request.method) ? undefined : context.request.body, redirect: 'manual' });
    const type = upstream.headers.get('Content-Type') ?? '';
    if (!type.toLowerCase().includes('application/json') && upstream.status !== 204) return jsonError('Источник вернул неверный ответ.', 502);
    const responseHeaders = new Headers({ 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    for (const name of ['Set-Cookie', 'Retry-After', 'Allow']) { const value = upstream.headers.get(name); if (value) responseHeaders.set(name, value); }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch { return jsonError('Не удалось связаться с API.', 502); }
}
