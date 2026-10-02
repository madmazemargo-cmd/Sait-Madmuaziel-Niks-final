const DEFAULT_API_ORIGIN = 'https://madmuazelle-niks-api.dndmaster.workers.dev';

export function apiEndpoint(path: string) {
  const configured =
    process.env.API_ORIGIN?.trim() ||
    (process.env.NODE_ENV === "production" ? "" : DEFAULT_API_ORIGIN);
  if (!configured) {
    throw new Error("API_ORIGIN must be configured in production.");
  }

  const origin = new URL(configured);
  const localHttp = origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !localHttp) throw new Error('API_ORIGIN must be HTTPS (except localhost).');
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
    throw new Error('API_ORIGIN must contain only an origin, without a path or credentials.');
  }
  return new URL(`/api/${path.replace(/^\/+/, '')}`, origin.origin).toString();
}
