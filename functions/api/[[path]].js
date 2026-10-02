const ROUTES = new Map([
  ['healthz', new Set(['GET'])],
  ['calendar', new Set(['GET'])],
  ['catalog', new Set(['GET'])],
  ['reviews', new Set(['GET', 'POST'])],
  ['applications', new Set(['GET', 'POST'])],
  ['telegram/webhook', new Set(['POST'])],
  ['mini/session', new Set(['POST'])],
  ['mini/me', new Set(['GET', 'PATCH'])],
  ['mini/events', new Set(['GET'])],
  ['mini/tags', new Set(['GET'])],
  ['mini/games', new Set(['GET'])],
  ['mini/rsvp', new Set(['POST'])],
  ['auth/login', new Set(['POST'])],
  ['auth/me', new Set(['GET'])],
  ['auth/logout', new Set(['POST'])],
]);
const MAX_BODY_BYTES = 32 * 1024;
const API_SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

function masterMethods(endpoint) {
  if (endpoint === 'master/catalog' || endpoint === 'master/events') return new Set(['GET', 'POST']);
  if (endpoint === 'master/participants' || endpoint === 'master/reviews') return new Set(['GET']);
  if (endpoint === 'master/applications') return new Set(['GET']);
  if (/^master\/applications\/[^/]+$/.test(endpoint)) return new Set(['PATCH']);
  if (/^master\/reviews\/[^/]+$/.test(endpoint)) return new Set(['PATCH', 'DELETE']);
  if (/^master\/(catalog|events)\/[^/]+$/.test(endpoint)) return new Set(['PATCH', 'DELETE']);
  return null;
}
 
function jsonError(message, status, extraHeaders = {}) {
  return Response.json({ error: message }, { status, headers: { ...API_SECURITY_HEADERS, ...extraHeaders } });
}
 
export async function onRequest(context) {
  const segments = Array.isArray(context.params.path) ? context.params.path : [context.params.path].filter(Boolean);
  const endpoint = segments.join('/');
  const method = context.request.method.toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { Allow: 'GET, POST, PATCH, DELETE, OPTIONS' } });
  if (endpoint.startsWith('master/')) {
    const allowedMethods = masterMethods(endpoint);
    if (!allowedMethods) return jsonError('API route not found.', 404);
    if (!allowedMethods.has(method)) return jsonError('Method not allowed.', 405, { Allow: [...allowedMethods, 'OPTIONS'].join(', ') });
    if (['POST', 'PATCH'].includes(method) && Number(context.request.headers.get('Content-Length') ?? '0') > MAX_BODY_BYTES) return jsonError('Запрос слишком большой.', 413);
    return proxy(context, endpoint);
  }
  const allowedMethods = ROUTES.get(endpoint);
  if (!allowedMethods) return jsonError('API route not found.', 404);
  if (!allowedMethods.has(method)) return jsonError('Method not allowed.', 405, { Allow: [...allowedMethods, 'OPTIONS'].join(', ') });
  if (method === 'POST' && Number(context.request.headers.get('Content-Length') ?? '0') > MAX_BODY_BYTES) return jsonError('Запрос слишком большой.', 413);
  return proxy(context, endpoint);
}
 
async function proxy(context, endpoint) {
  const incomingUrl = new URL(context.request.url);
  let apiOrigin;
  try {
    const configured = context.env?.API_ORIGIN;
    if (!configured) return jsonError('API origin is not configured.', 503);
    const parsed = new URL(configured);
    if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
      return jsonError('API origin is invalid.', 503);
    }
    apiOrigin = parsed.origin;
  } catch {
    return jsonError('API origin is invalid.', 503);
  }
  const upstreamUrl = new URL(`/api/${endpoint}`, apiOrigin);
  upstreamUrl.search = incomingUrl.search;
  const headers = new Headers({ Accept: 'application/json' });
  for (const name of ['Content-Type', 'Cookie', 'X-CSRF-Token', 'X-Telegram-Init-Data', 'X-Telegram-Bot-Api-Secret-Token', 'Origin']) {
    const value = context.request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const upstream = await fetch(upstreamUrl, { method: context.request.method, headers, body: ['GET', 'HEAD'].includes(context.request.method) ? undefined : context.request.body, redirect: 'manual' });
    const type = upstream.headers.get('Content-Type') ?? '';
    if (!type.toLowerCase().includes('application/json') && upstream.status !== 204) return jsonError('Источник вернул неверный ответ.', 502);
    const responseHeaders = new Headers({ ...API_SECURITY_HEADERS, 'Content-Type': type || 'application/json; charset=utf-8' });
    for (const name of ['Set-Cookie', 'Retry-After', 'Allow']) { const value = upstream.headers.get(name); if (value) responseHeaders.set(name, value); }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch { return jsonError('Не удалось связаться с API.', 502); }
}
