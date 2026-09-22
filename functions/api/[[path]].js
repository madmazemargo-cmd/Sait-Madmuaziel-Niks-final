const UPSTREAM = 'https://dndmaster.dndmaster.workers.dev';
const ROUTES = new Map([
  ['calendar', new Set(['GET'])],
  ['catalog', new Set(['GET'])],
  ['applications', new Set(['GET', 'POST'])],
]);
const MAX_APPLICATION_BYTES = 32 * 1024;

function jsonError(message, status, extraHeaders = {}) {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...extraHeaders,
      },
    },
  );
}

export async function onRequest(context) {
  const segments = Array.isArray(context.params.path)
    ? context.params.path
    : [context.params.path].filter(Boolean);
  const endpoint = segments.join('/');
  const allowedMethods = ROUTES.get(endpoint);
  const method = context.request.method.toUpperCase();

  if (!allowedMethods) return jsonError('API route not found.', 404);
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { Allow: [...allowedMethods, 'OPTIONS'].join(', ') },
    });
  }
  if (!allowedMethods.has(method)) {
    return jsonError('Method not allowed.', 405, {
      Allow: [...allowedMethods, 'OPTIONS'].join(', '),
    });
  }

  if (method === 'POST') {
    const contentLength = Number(context.request.headers.get('Content-Length') ?? '0');
    if (contentLength > MAX_APPLICATION_BYTES) {
      return jsonError('Заявка слишком большая.', 413);
    }
  }

  const incomingUrl = new URL(context.request.url);
  const upstreamUrl = new URL(`/api/${endpoint}`, UPSTREAM);
  upstreamUrl.search = incomingUrl.search;

  const headers = new Headers({ Accept: 'application/json' });
  const contentType = context.request.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);

  try {
    const upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body: method === 'GET' ? undefined : context.request.body,
      redirect: 'manual',
    });
    const upstreamType = upstream.headers.get('Content-Type') ?? '';
    if (!upstreamType.toLowerCase().includes('application/json')) {
      return jsonError('Источник вернул неверный ответ.', 502);
    }

    const responseHeaders = new Headers({
      'Content-Type': upstreamType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    const retryAfter = upstream.headers.get('Retry-After');
    if (retryAfter) responseHeaders.set('Retry-After', retryAfter);

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return jsonError('Не удалось связаться с источником данных.', 502);
  }
}
