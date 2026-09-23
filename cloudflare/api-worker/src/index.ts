export interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN?: string;
  SESSION_PEPPER?: string;
  RATE_LIMITER?: DurableObjectNamespace;
}

type Row = Record<string, unknown>;
const MAX_BODY_BYTES = 32 * 1024;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 310000;
const fallbackAttempts = new Map<string, { count: number; resetAt: number }>();

const json = (data: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

const isRecord = (value: unknown): value is Row => Boolean(value) && typeof value === 'object';
const text = (value: unknown, max = 4000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const nowIso = () => new Date().toISOString();
const id = () => crypto.randomUUID();
function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function legacyExcludedDates(row: Row) {
  const source = row.excluded_dates;
  const values = Array.isArray(source) ? source : typeof source === 'string' && source.trim() ? (() => {
    try { return JSON.parse(source) as unknown; } catch { return []; }
  })() : [];
  return Array.isArray(values) ? [...new Set(values.filter(validDate))] : [];
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGIN?.trim();
  return {
    'Access-Control-Allow-Origin': allowed && origin === allowed ? allowed : (allowed ? '' : '*'),
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
    Vary: 'Origin',
  };
}

function secure(response: Response, request: Request, env: Env) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) if (value) headers.set(key, value);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return new Response(response.body, { status: response.status, headers });
}

function clientIp(request: Request) { return request.headers.get('CF-Connecting-IP') ?? 'unknown'; }

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function csrfTokenForSession(token: string, env: Env) {
  return sha256(`${env.SESSION_PEPPER ?? ''}:csrf:${token}`);
}

async function derivePassword(password: string, salt: string, iterations = PASSWORD_ITERATIONS) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations, hash: 'SHA-256' }, material, 256);
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken() { return `${crypto.randomUUID()}${crypto.randomUUID()}`; }
function cookies(request: Request) {
  return Object.fromEntries((request.headers.get('Cookie') ?? '').split(';').map((part) => part.trim().split('=' as string, 2)).filter(([key, value]) => key && value));
}

async function readBody(request: Request) {
  const length = Number(request.headers.get('Content-Length') ?? '0');
  if (length > MAX_BODY_BYTES) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}

async function rateLimit(key: string, env: Env) {
  if (env.RATE_LIMITER) {
    const limiter = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(key));
    const result = await limiter.fetch('https://rate-limit/check', { method: 'POST' });
    return result.status === 429;
  }
  const current = fallbackAttempts.get(key);
  const time = Date.now();
  if (!current || current.resetAt <= time) { fallbackAttempts.set(key, { count: 1, resetAt: time + RATE_WINDOW_MS }); return false; }
  current.count += 1;
  return current.count > RATE_LIMIT;
}

function dateUtc(value: string) { const [year, month, day] = value.split('-').map(Number); return Date.UTC(year, month - 1, day); }
function occursOn(row: Row, date: string) {
  const start = String(row.event_date); if (date < start) return false;
  const until = validDate(row.recurrence_until) ? row.recurrence_until : null; if (until && date > until) return false;
  const recurrence = String(row.recurrence ?? 'none'); if (recurrence === 'none') return date === start;
  if (recurrence === 'daily') return true;
  const days = Math.round((dateUtc(date) - dateUtc(start)) / 86400000);
  if (recurrence === 'weekly') return days % 7 === 0;
  if (recurrence === 'biweekly') return days % 14 === 0;
  if (recurrence === 'monthly') return date.slice(8) === start.slice(8);
  return false;
}

function toPublicEvent(row: Row): {
  id: unknown; title: unknown; eventDate: unknown; startTime: unknown; status: unknown; seats: number | null;
  description: unknown; system: unknown; format: unknown; location: unknown; duration: unknown; price: unknown;
  experience: unknown; age: unknown; playerPrep: unknown; archived: boolean; applicationUrl: string;
  recurrence: unknown; recurrenceUntil: string | null; excludedDates: string[]; revision: number;
} {
  const recurrenceUntil = validDate(row.recurrence_until) ? row.recurrence_until : null;
  return {
    id: row.id, title: row.title, eventDate: row.event_date, startTime: row.start_time,
    status: row.status, seats: nullableNumber(row.seats), description: row.description,
    system: row.system, format: row.format, location: row.location, duration: row.duration,
    price: row.price, experience: row.experience, age: row.age, playerPrep: row.player_prep,
    archived: Boolean(row.archived), applicationUrl: '', recurrence: row.recurrence,
    recurrenceUntil,
    excludedDates: legacyExcludedDates(row), revision: Number(row.revision ?? 1),
  };
}

async function publicCalendar(env: Env) {
  // The production database predates the master-calendar schema and does not
  // have sort_order on calendar_events. Date/time ordering works for both
  // the legacy and newly provisioned schemas.
  const { results } = await env.DB.prepare('SELECT * FROM calendar_events WHERE archived = 0 ORDER BY event_date, start_time, id').all();
  const events = results.map(toPublicEvent);
  for (const event of events) {
    const exclusions = await env.DB.prepare('SELECT occurrence_date FROM calendar_event_exclusions WHERE event_id = ? ORDER BY occurrence_date').bind(event.id).all();
    event.excludedDates = [...new Set([...event.excludedDates, ...exclusions.results.map((row) => String((row as Row).occurrence_date)).filter(validDate)])];
  }
  return { events };
}

async function findSelection(env: Env, eventId: string, date: string) {
  const row = await env.DB.prepare('SELECT * FROM calendar_events WHERE id = ? AND archived = 0').bind(eventId).first<Row>();
  if (!row || !validDate(date) || !occursOn(row, date)) return null;
  const status = String(row.status ?? 'available');
  const seats = row.seats === null || row.seats === undefined || row.seats === '' ? null : Number(row.seats);
  if (status !== 'available' && status !== 'waiting') return null;
  if (status === 'available' && seats !== null && (!Number.isFinite(seats) || seats <= 0)) return null;
  const excluded = await env.DB.prepare('SELECT 1 FROM calendar_event_exclusions WHERE event_id = ? AND occurrence_date = ?').bind(eventId, date).first();
  if (excluded || legacyExcludedDates(row).includes(date)) return null;
  return {
    id: String(row.id), title: String(row.title), date, dateLabel: date, time: String(row.start_time || 'Уточняется'),
    status: String(row.status), price: String(row.price), place: String(row.location || 'Формат уточняется'),
    location: String(row.location), preparation: String(row.player_prep), revision: String(row.revision ?? 1),
  };
}

async function auth(request: Request, env: Env) {
  const token = cookies(request).master_session;
  if (!token) return null;
  const tokenHash = await sha256(`${env.SESSION_PEPPER ?? ''}${token}`);
  const row = await env.DB.prepare(`SELECT s.*, u.login, u.role, u.active FROM master_sessions s JOIN master_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`).bind(tokenHash, nowIso()).first<Row>();
  return row && Number(row.active) === 1 ? row : null;
}

async function requireCsrf(request: Request, session: Row) {
  const provided = text(request.headers.get('X-CSRF-Token'), 200);
  return !provided || await sha256(provided) !== String(session.csrf_token_hash);
}

async function login(request: Request, env: Env) {
  const body = await readBody(request);
  if (!isRecord(body)) return json({ error: 'Введите логин и пароль.' }, 400);
  if (await rateLimit(`login:${clientIp(request)}:${text(body.login, 100)}`, env)) return json({ error: 'Слишком много попыток. Попробуйте позже.' }, 429, { 'Retry-After': '900' });
  const user = await env.DB.prepare('SELECT * FROM master_users WHERE login = ? AND active = 1').bind(text(body.login, 100)).first<Row>();
  const password = text(body.password, 200);
  if (!user || !password) return json({ error: 'Неверный логин или пароль.' }, 401);
  const hash = await derivePassword(password, String(user.password_salt), Number(user.password_iterations));
  if (hash !== String(user.password_hash)) return json({ error: 'Неверный логин или пароль.' }, 401);
  const token = randomToken(); const csrf = await csrfTokenForSession(token, env); const created = nowIso();
  await env.DB.prepare('INSERT INTO master_sessions (id, user_id, token_hash, csrf_token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id(), user.id, await sha256(`${env.SESSION_PEPPER ?? ''}${token}`), await sha256(csrf), new Date(Date.now() + SESSION_TTL_MS).toISOString(), created, created).run();
  await env.DB.prepare('UPDATE master_users SET last_login_at = ?, updated_at = ? WHERE id = ?').bind(created, created, user.id).run();
  return json({ authenticated: true, user: { id: user.id, login: user.login, role: user.role }, csrfToken: csrf }, 200, { 'Set-Cookie': `master_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}` });
}

async function masterEvents(env: Env) {
  const { results } = await env.DB.prepare('SELECT * FROM calendar_events ORDER BY event_date, start_time, id').all();
  return { events: results.map((row) => ({ ...row, seats: nullableNumber((row as Row).seats), archived: Boolean((row as Row).archived), revision: Number((row as Row).revision ?? 1) })) };
}

type CatalogType = 'campaign' | 'oneshot';

function catalogSystemKey(value: unknown) {
  const source = text(value, 100).toLowerCase().replace(/ё/g, 'е');
  if (source.includes('dnd') || source.includes('d&d') || source.includes('dungeons') || source.includes('днд')) return 'dnd';
  if (source.includes('vampire') || source.includes('вампир')) return 'vampires';
  if (source.includes('dagger')) return 'daggerheart';
  if (source.includes('cyber')) return 'cyberpunk';
  if (source.includes('cthulhu') || source.includes('ктул')) return 'cthulhu';
  return null;
}

function firstField(value: Row, keys: string[], fallback: unknown = '') {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  }
  return fallback;
}

function catalogType(value: unknown): CatalogType | null {
  const normalized = text(value, 30).toLowerCase();
  if (normalized === 'campaign' || normalized === 'campaigns' || normalized === 'кампания' || normalized === 'кампании') return 'campaign';
  if (normalized === 'oneshot' || normalized === 'one-shot' || normalized === 'ваншот' || normalized === 'ваншоты') return 'oneshot';
  return null;
}

function catalogBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return fallback;
}

function catalogImage(value: unknown) {
  const source = text(value, 1000);
  if (!source) return '';
  if (source.startsWith('/') && !source.startsWith('//')) return source;
  try {
    const parsed = new URL(source);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? source : '';
  } catch {
    return '';
  }
}

function catalogSortOrder(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 100000 ? number : fallback;
}

function toCatalogItem(row: Row) {
  return {
    id: String(row.id),
    systemKey: catalogSystemKey(row.system_key) ?? String(row.system_key ?? ''),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    imageUrl: String(row.image_url ?? ''),
    age: String(row.age ?? ''),
    format: String(row.format ?? ''),
    price: String(row.price ?? ''),
    gameType: catalogType(row.game_type) ?? 'oneshot',
    status: String(row.status ?? ''),
    sortOrder: Number(row.sort_order ?? 0),
    published: catalogBoolean(row.published, false),
    revision: Number(row.revision ?? 1),
    updatedAt: String(row.updated_at ?? ''),
  };
}

async function publicCatalog(env: Env) {
  const { results } = await env.DB.prepare('SELECT * FROM catalog_items WHERE published = 1 ORDER BY sort_order, updated_at DESC, title COLLATE NOCASE').all();
  return { items: results.map((row) => toCatalogItem(row as Row)) };
}

async function masterCatalog(env: Env) {
  const { results } = await env.DB.prepare('SELECT * FROM catalog_items ORDER BY sort_order, updated_at DESC, title COLLATE NOCASE').all();
  return { items: results.map((row) => toCatalogItem(row as Row)) };
}

function normalizeCatalogInput(body: Row, current?: Row) {
  const systemKey = catalogSystemKey(firstField(body, ['systemKey', 'system_key', 'system'], current?.system_key ?? ''));
  const title = text(firstField(body, ['title'], current?.title ?? ''), 200);
  const description = text(firstField(body, ['description'], current?.description ?? ''), 4000);
  const imageUrl = catalogImage(firstField(body, ['imageUrl', 'image_url', 'image'], current?.image_url ?? ''));
  const age = text(firstField(body, ['age'], current?.age ?? ''), 100);
  const format = text(firstField(body, ['format'], current?.format ?? ''), 100);
  const price = text(firstField(body, ['price'], current?.price ?? ''), 100);
  const gameType = catalogType(firstField(body, ['gameType', 'type', 'game_type'], current?.game_type ?? 'oneshot'));
  const status = text(firstField(body, ['status'], current?.status ?? ''), 200);
  const sortOrder = catalogSortOrder(firstField(body, ['sortOrder', 'sort_order'], current?.sort_order ?? 0), Number(current?.sort_order ?? 0));
  const published = catalogBoolean(firstField(body, ['published'], current?.published ?? 1), Boolean(current?.published ?? 1));

  if (!systemKey) return { error: 'Выберите поддерживаемую систему игры.' } as const;
  if (!title) return { error: 'Укажите название игры.' } as const;
  if (!gameType) return { error: 'Выберите тип игры.' } as const;
  return { systemKey, title, description, imageUrl, age, format, price, gameType, status, sortOrder, published } as const;
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname.replace(/\/$/, '') || '/';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method === 'GET' && path === '/api/healthz') return json({ status: 'ok' });
  if (request.method === 'POST' && path === '/api/auth/login') return login(request, env);
  if (request.method === 'GET' && path === '/api/catalog') return json(await publicCatalog(env));
  if (request.method === 'GET' && path === '/api/calendar') return json(await publicCalendar(env));
  if (request.method === 'GET' && path === '/api/applications') {
    const game = await findSelection(env, text(url.searchParams.get('event'), 100), text(url.searchParams.get('date'), 10));
    return game ? json({ game }) : json({ error: 'Выбранная игра или дата больше недоступны.' }, 404);
  }
  if (request.method === 'POST' && path === '/api/applications') {
    const body = await readBody(request);
    if (!isRecord(body) || body.consent !== true) return json({ ok: false, error: 'Проверьте обязательные поля и согласие.' }, 400);
    if (text(body.website, 100)) return json({ ok: true, notice: 'Заявка принята.' }, 202);
    const name = text(body.name, 100), contact = text(body.contact, 120), players = Number(body.players);
    if (!name || !contact || !Number.isInteger(players) || players < 1 || players > 20) return json({ ok: false, error: 'Проверьте имя и контакт для связи.' }, 400);
    if (await rateLimit(`application:${clientIp(request)}`, env)) return json({ ok: false, error: 'Слишком много заявок. Попробуйте через 15 минут.' }, 429, { 'Retry-After': '900' });
    const existing = await env.DB.prepare('SELECT id FROM applications WHERE submission_id = ?').bind(text(body.submissionId, 100)).first();
    if (existing) return json({ ok: true, notice: 'Заявка уже принята.' });
    const eventId = text(body.eventId, 100) || null, occurrenceDate = validDate(body.occurrenceDate) ? body.occurrenceDate : null;
    if (eventId && occurrenceDate && !await findSelection(env, eventId, occurrenceDate)) return json({ ok: false, error: 'Выбранная игра больше недоступна.', selectionChanged: true }, 409);
    const timestamp = nowIso();
    await env.DB.prepare(`INSERT INTO applications (id, submission_id, event_id, occurrence_date, event_revision, name, contact, players, format, place, experience, system, genres, tone, wishes, schedule, boundaries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id(), text(body.submissionId, 100) || id(), eventId, occurrenceDate, text(body.eventRevision, 50) || null, name, contact, players, text(body.format, 200), text(body.place, 200), text(body.experience, 2000), text(body.system, 200), text(body.genres, 500), text(body.tone, 500), text(body.wishes, 4000), text(body.schedule, 2000), text(body.boundaries, 2000), timestamp, timestamp).run();
    return json({ ok: true });
  }
  const session = await auth(request, env);
  if (!session) return json({ error: 'Требуется вход в кабинет мастера.' }, 401);
  if (request.method === 'GET' && path === '/api/auth/me') {
    const csrfToken = await csrfTokenForSession(cookies(request).master_session, env);
    await env.DB.prepare('UPDATE master_sessions SET csrf_token_hash = ?, last_seen_at = ? WHERE id = ?').bind(await sha256(csrfToken), nowIso(), session.id).run();
    return json({ authenticated: true, user: { id: session.user_id, login: session.login, role: session.role }, csrfToken });
  }
  if (request.method === 'POST' && path === '/api/auth/logout') {
    await env.DB.prepare('UPDATE master_sessions SET revoked_at = ?, last_seen_at = ? WHERE id = ?').bind(nowIso(), nowIso(), session.id).run();
    return json({ ok: true }, 200, { 'Set-Cookie': 'master_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
  }
  if (request.method === 'GET' && path === '/api/master/events') return json(await masterEvents(env));
  if (request.method === 'GET' && path === '/api/master/applications') {
    const { results } = await env.DB.prepare('SELECT * FROM applications ORDER BY created_at DESC LIMIT 200').all();
    return json({ applications: results });
  }
  if (request.method === 'GET' && path === '/api/master/catalog') return json(await masterCatalog(env));
  if (request.method === 'POST' && path === '/api/master/catalog') {
    if (await requireCsrf(request, session)) return json({ error: 'Недействительный CSRF-токен.' }, 403);
    const body = await readBody(request);
    if (!isRecord(body)) return json({ error: 'Некорректные данные.' }, 400);
    const input = normalizeCatalogInput(body);
    if ('error' in input) return json({ error: input.error }, 400);
    const timestamp = nowIso();
    const itemId = id();
    await env.DB.prepare(`INSERT INTO catalog_items (id, system_key, title, description, image_url, age, format, price, game_type, status, sort_order, published, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).bind(itemId, input.systemKey, input.title, input.description, input.imageUrl, input.age, input.format, input.price, input.gameType, input.status, input.sortOrder, input.published ? 1 : 0, timestamp, timestamp).run();
    const created = await env.DB.prepare('SELECT * FROM catalog_items WHERE id = ?').bind(itemId).first<Row>();
    return json({ item: created ? toCatalogItem(created) : { id: itemId } }, 201);
  }
  const catalogMatch = path.match(/^\/api\/master\/catalog\/([^/]+)$/);
  if (catalogMatch && (request.method === 'PATCH' || request.method === 'DELETE')) {
    if (await requireCsrf(request, session)) return json({ error: 'Недействительный CSRF-токен.' }, 403);
    const itemId = decodeURIComponent(catalogMatch[1]);
    const current = await env.DB.prepare('SELECT * FROM catalog_items WHERE id = ?').bind(itemId).first<Row>();
    if (!current) return json({ error: 'Игра в каталоге не найдена.' }, 404);
    if (request.method === 'DELETE') {
      const result = await env.DB.prepare('DELETE FROM catalog_items WHERE id = ?').bind(itemId).run();
      return result.meta.changes ? json({ ok: true }) : json({ error: 'Игра в каталоге не найдена.' }, 404);
    }
    const body = await readBody(request);
    if (!isRecord(body)) return json({ error: 'Некорректные данные.' }, 400);
    const input = normalizeCatalogInput(body, current);
    if ('error' in input) return json({ error: input.error }, 400);
    const result = await env.DB.prepare(`UPDATE catalog_items SET system_key = ?, title = ?, description = ?, image_url = ?, age = ?, format = ?, price = ?, game_type = ?, status = ?, sort_order = ?, published = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`).bind(input.systemKey, input.title, input.description, input.imageUrl, input.age, input.format, input.price, input.gameType, input.status, input.sortOrder, input.published ? 1 : 0, nowIso(), itemId, Number(body.revision ?? 0)).run();
    if (!result.meta.changes) return json({ error: 'Запись уже изменилась. Обновите страницу.' }, 409);
    const updated = await env.DB.prepare('SELECT * FROM catalog_items WHERE id = ?').bind(itemId).first<Row>();
    return json({ item: updated ? toCatalogItem(updated) : { id: itemId } });
  }
  if (request.method === 'POST' && path === '/api/master/events') {
    if (await requireCsrf(request, session)) return json({ error: 'Недействительный CSRF-токен.' }, 403);
    const body = await readBody(request); if (!isRecord(body) || !validDate(body.eventDate)) return json({ error: 'Укажите дату игры.' }, 400);
    const timestamp = nowIso(); const eventId = id();
    await env.DB.prepare(`INSERT INTO calendar_events (id, title, event_date, start_time, status, seats, description, system, format, location, duration, price, experience, age, player_prep, recurrence, recurrence_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(eventId, text(body.title, 200), body.eventDate, text(body.startTime, 20), text(body.status, 40) || 'available', body.seats === null || body.seats === undefined || body.seats === '' ? null : Number(body.seats), text(body.description, 4000), text(body.system, 200), text(body.format, 100), text(body.location, 200), text(body.duration, 100), text(body.price, 100), text(body.experience, 500), text(body.age, 100), text(body.playerPrep, 2000), text(body.recurrence, 30) || 'none', validDate(body.recurrenceUntil) ? body.recurrenceUntil : null, timestamp, timestamp).run();
    return json({ id: eventId }, 201);
  }
  const match = path.match(/^\/api\/master\/events\/([^/]+)$/);
  if (match && (request.method === 'PATCH' || request.method === 'DELETE')) {
    if (await requireCsrf(request, session)) return json({ error: 'Недействительный CSRF-токен.' }, 403);
    const eventId = decodeURIComponent(match[1]); const body = request.method === 'PATCH' ? await readBody(request) : {};
    const current = await env.DB.prepare('SELECT revision FROM calendar_events WHERE id = ?').bind(eventId).first<Row>();
    if (!current) return json({ error: 'Игра не найдена.' }, 404);
    if (request.method === 'DELETE') { await env.DB.prepare('UPDATE calendar_events SET archived = 1, revision = revision + 1, updated_at = ? WHERE id = ?').bind(nowIso(), eventId).run(); return json({ ok: true }); }
    if (!isRecord(body)) return json({ error: 'Некорректные данные.' }, 400);
    const fields: [string, unknown][] = [['title', text(body.title, 200)], ['event_date', validDate(body.eventDate) ? body.eventDate : null], ['start_time', text(body.startTime, 20)], ['status', text(body.status, 40)], ['seats', body.seats === null || body.seats === '' ? null : Number(body.seats)], ['description', text(body.description, 4000)], ['system', text(body.system, 200)], ['format', text(body.format, 100)], ['location', text(body.location, 200)], ['duration', text(body.duration, 100)], ['price', text(body.price, 100)], ['experience', text(body.experience, 500)], ['age', text(body.age, 100)], ['player_prep', text(body.playerPrep, 2000)], ['recurrence', text(body.recurrence, 30)], ['recurrence_until', validDate(body.recurrenceUntil) ? body.recurrenceUntil : null]];
    const set = fields.filter(([, value]) => value !== null || Object.keys(body).some((key) => key === 'eventDate' || key === 'recurrenceUntil')).map(([key]) => `${key} = ?`).join(', '); const values = fields.filter(([, value]) => value !== null || Object.keys(body).some((key) => key === 'eventDate' || key === 'recurrenceUntil')).map(([, value]) => value);
    const result = await env.DB.prepare(`UPDATE calendar_events SET ${set}, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`).bind(...values, nowIso(), eventId, Number(body.revision ?? 0)).run();
    return result.meta.changes ? json({ ok: true }) : json({ error: 'Запись уже изменилась. Обновите страницу.' }, 409);
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request: Request, env: Env) {
    try {
      return secure(await handle(request, env), request, env);
    } catch (error) {
      console.error(JSON.stringify({
        message: 'request failed',
        method: request.method,
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return secure(json({ error: 'Внутренняя ошибка сервера.' }, 500), request, env);
    }
  },
};

export class RateLimiter {
  constructor(private readonly state: DurableObjectState) {}
  async fetch(): Promise<Response> {
    const now = Date.now(); const current = await this.state.storage.get<{ count: number; resetAt: number }>('window');
    if (!current || current.resetAt <= now) { await this.state.storage.put('window', { count: 1, resetAt: now + RATE_WINDOW_MS }); return new Response('ok'); }
    if (current.count >= RATE_LIMIT) return new Response('limited', { status: 429, headers: { 'Retry-After': '900' } });
    await this.state.storage.put('window', { count: current.count + 1, resetAt: current.resetAt }); return new Response('ok');
  }
}
