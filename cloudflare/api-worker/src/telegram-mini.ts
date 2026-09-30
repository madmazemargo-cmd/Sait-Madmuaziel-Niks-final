type Row = Record<string, unknown>;

export interface MiniEnv {
  DB: D1Database;
  SESSION_PEPPER?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  MINI_APP_URL?: string;
  GAME_TIMEZONE?: string;
}

type TelegramIdentity = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
};

type MiniSession = Row & {
  id: string;
  telegram_user_id: string;
  token_hash: string;
  csrf_hash: string;
  expires_at: string;
  chat_id: string | null;
  username: string;
  first_name: string;
  last_name: string;
  timezone: string;
  notifications_enabled: number;
};

const MAX_BODY_BYTES = 32 * 1024;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEZONE = 'Europe/Moscow';
const sessionAttempts = new Map<string, { count: number; resetAt: number }>();

const nowIso = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const isRecord = (value: unknown): value is Row => Boolean(value) && typeof value === 'object';
const text = (value: unknown, max = 4000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 9999) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function sessionRateLimited(request: Request) {
  const key = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  const current = sessionAttempts.get(key);
  if (!current || current.resetAt <= now) {
    sessionAttempts.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  current.count += 1;
  return current.count > 12;
}

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

// The Mini App tables are provisioned by an optional migration. Keep the
// calendar CRUD usable while that migration is still pending in production.
function isMissingOptionalTable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table|no such column|does not exist/i.test(message);
}

async function readBody(request: Request): Promise<Row | null> {
  const length = Number(request.headers.get('Content-Length') ?? '0');
  if (length > MAX_BODY_BYTES) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function cookies(request: Request) {
  return Object.fromEntries((request.headers.get('Cookie') ?? '')
    .split(';')
    .map((part) => part.trim().split('=', 2))
    .filter(([key, value]) => key && value));
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmac(key: string | Uint8Array, message: string | Uint8Array) {
  const keyBytes = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const messageBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, messageBytes));
}

function hex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function normalizeTelegramUser(value: unknown): TelegramIdentity | null {
  if (!isRecord(value)) return null;
  const rawId = value.id;
  const userId = typeof rawId === 'number' && Number.isSafeInteger(rawId)
    ? String(rawId)
    : typeof rawId === 'string' && /^\d{1,30}$/.test(rawId) ? rawId : '';
  if (!userId) return null;
  return {
    id: userId,
    username: text(value.username, 100),
    firstName: text(value.first_name, 100),
    lastName: text(value.last_name, 100),
  };
}

async function validateInitData(initData: string, botToken: string): Promise<TelegramIdentity | null> {
  if (!initData || !botToken) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }
  const entries = [...params.entries()];
  const seen = new Set<string>();
  for (const [key] of entries) {
    if (seen.has(key)) return null;
    seen.add(key);
  }
  const hash = params.get('hash')?.toLowerCase() ?? '';
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  const authDate = Number(params.get('auth_date'));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(authDate) || authDate > now + 300 || now - authDate > 24 * 60 * 60) return null;
  const dataCheckString = entries
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = await hmac(botToken, 'WebAppData');
  const calculated = hex(await hmac(secretKey, dataCheckString));
  if (!constantTimeEqual(calculated, hash)) return null;
  try {
    return normalizeTelegramUser(JSON.parse(params.get('user') ?? '{}'));
  } catch {
    return null;
  }
}

function safeTimezone(value: unknown, fallback = DEFAULT_TIMEZONE) {
  const candidate = text(value, 80) || fallback;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: candidate }).format();
    return candidate;
  } catch {
    return fallback;
  }
}

function todayInTimezone(timeZone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function minutesInTimezone(timeZone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

function dateUtc(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function addDays(value: string, amount: number) {
  const date = new Date(dateUtc(value));
  date.setUTCDate(date.getUTCDate() + amount);
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('-');
}

function occursOn(row: Row, date: string) {
  const start = String(row.event_date ?? '');
  if (!validDate(start) || date < start) return false;
  const until = validDate(row.recurrence_until) ? row.recurrence_until : null;
  if (until && date > until) return false;
  const recurrence = String(row.recurrence ?? 'none');
  if (recurrence === 'none') return date === start;
  if (recurrence === 'daily') return true;
  const days = Math.round((dateUtc(date) - dateUtc(start)) / 86400000);
  if (recurrence === 'weekly') return days % 7 === 0;
  if (recurrence === 'biweekly') return days % 14 === 0;
  if (recurrence === 'monthly') return date.slice(8) === start.slice(8);
  return false;
}

function legacyExcludedDates(row: Row) {
  const source = row.excluded_dates;
  const values = Array.isArray(source) ? source : typeof source === 'string' && source.trim() ? (() => {
    try { return JSON.parse(source) as unknown; } catch { return []; }
  })() : [];
  return Array.isArray(values) ? [...new Set(values.filter(validDate))] : [];
}

function normalizeTag(value: unknown) {
  const source = text(value, 80).toLowerCase().replace(/ё/g, 'е');
  return source.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function normalizeTags(value: unknown) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [...new Set(values.map(normalizeTag).filter(Boolean))].slice(0, 20);
}

function tagLabel(tag: string) {
  return tag.replace(/-/g, ' ');
}

export async function readEventTags(db: D1Database, eventId: string) {
  try {
    const { results } = await db.prepare('SELECT tag, label FROM calendar_event_tags WHERE event_id = ? ORDER BY tag').bind(eventId).all();
    return results.map((row) => ({ slug: String((row as Row).tag), label: String((row as Row).label || tagLabel(String((row as Row).tag))) }));
  } catch (error) {
    if (isMissingOptionalTable(error)) return [];
    throw error;
  }
}

export async function setEventTags(db: D1Database, eventId: string, value: unknown) {
  const tags = normalizeTags(value);
  const timestamp = nowIso();
  const statements = [db.prepare('DELETE FROM calendar_event_tags WHERE event_id = ?').bind(eventId)];
  for (const tag of tags) {
    statements.push(db.prepare('INSERT OR IGNORE INTO calendar_event_tags (event_id, tag, label, created_at) VALUES (?, ?, ?, ?)').bind(eventId, tag, tagLabel(tag), timestamp));
  }
  try {
    await db.batch(statements);
  } catch (error) {
    if (!isMissingOptionalTable(error)) throw error;
  }
  return tags;
}

export async function readMiniCapacity(db: D1Database, eventId: string) {
  try {
    const row = await db.prepare('SELECT capacity FROM calendar_event_mini_settings WHERE event_id = ?').bind(eventId).first<Row>();
    if (!row || row.capacity === null || row.capacity === undefined || row.capacity === '') return null;
    const value = Number(row.capacity);
    return Number.isInteger(value) && value >= 0 ? value : null;
  } catch (error) {
    if (isMissingOptionalTable(error)) return null;
    throw error;
  }
}

export async function setMiniCapacity(db: D1Database, eventId: string, value: unknown) {
  const capacity = value === null || value === undefined || value === '' ? null : Number(value);
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 0 || capacity > 1000)) return false;
  try {
    await db.prepare(`INSERT INTO calendar_event_mini_settings (event_id, capacity, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET capacity = excluded.capacity, updated_at = excluded.updated_at`).bind(eventId, capacity, nowIso()).run();
  } catch (error) {
    if (!isMissingOptionalTable(error)) throw error;
  }
  return true;
}

async function upsertTelegramUser(db: D1Database, user: TelegramIdentity, chatId: string | null = null) {
  const timestamp = nowIso();
  await db.prepare(`INSERT INTO telegram_users
    (telegram_user_id, chat_id, username, first_name, last_name, timezone, notifications_enabled, created_at, updated_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(telegram_user_id) DO UPDATE SET
      chat_id = COALESCE(excluded.chat_id, telegram_users.chat_id),
      username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      updated_at = excluded.updated_at,
      last_seen_at = excluded.last_seen_at`).bind(user.id, chatId, user.username, user.firstName, user.lastName, DEFAULT_TIMEZONE, timestamp, timestamp, timestamp).run();
}

async function readMiniSession(request: Request, env: MiniEnv): Promise<MiniSession | null> {
  const token = cookies(request).mini_session;
  if (!token) return null;
  const pepper = env.SESSION_PEPPER ?? '';
  const row = await env.DB.prepare(`SELECT s.*, u.chat_id, u.username, u.first_name, u.last_name, u.timezone, u.notifications_enabled
    FROM telegram_sessions s JOIN telegram_users u ON u.telegram_user_id = s.telegram_user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`).bind(await sha256(`${pepper}:mini:${token}`), nowIso()).first<MiniSession>();
  if (!row) return null;
  await env.DB.prepare('UPDATE telegram_sessions SET last_seen_at = ? WHERE id = ?').bind(nowIso(), row.id).run();
  await env.DB.prepare('UPDATE telegram_users SET last_seen_at = ? WHERE telegram_user_id = ?').bind(nowIso(), row.telegram_user_id).run();
  return row;
}

async function csrfValid(request: Request, env: MiniEnv, session: MiniSession) {
  const token = text(request.headers.get('X-CSRF-Token'), 200);
  return Boolean(token) && (await sha256(token)) === String(session.csrf_hash);
}

function userPayload(session: MiniSession) {
  return {
    id: session.telegram_user_id,
    username: session.username,
    firstName: session.first_name,
    lastName: session.last_name,
    timezone: session.timezone || DEFAULT_TIMEZONE,
    notificationsEnabled: Number(session.notifications_enabled) === 1,
    chatConnected: Boolean(session.chat_id),
  };
}

async function createSession(env: MiniEnv, user: TelegramIdentity) {
  const token = `${id()}${id()}`;
  const csrfToken = id();
  const timestamp = nowIso();
  await env.DB.prepare(`INSERT INTO telegram_sessions
    (id, telegram_user_id, token_hash, csrf_hash, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id(), user.id, await sha256(`${env.SESSION_PEPPER ?? ''}:mini:${token}`), await sha256(csrfToken), new Date(Date.now() + SESSION_TTL_MS).toISOString(), timestamp, timestamp).run();
  const row = await env.DB.prepare(`SELECT u.* FROM telegram_users u WHERE u.telegram_user_id = ?`).bind(user.id).first<MiniSession>();
  return { token, csrfToken, user: row ? userPayload(row) : { id: user.id, username: user.username, firstName: user.firstName, lastName: user.lastName, timezone: DEFAULT_TIMEZONE, notificationsEnabled: true, chatConnected: false } };
}

async function eventExcluded(db: D1Database, eventId: string, date: string, row?: Row) {
  if (legacyExcludedDates(row ?? {}).includes(date)) return true;
  return Boolean(await db.prepare('SELECT 1 FROM calendar_event_exclusions WHERE event_id = ? AND occurrence_date = ?').bind(eventId, date).first());
}

async function participantCounts(db: D1Database, eventId: string, occurrenceDate: string) {
  const row = await db.prepare(`SELECT
    SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
    SUM(CASE WHEN status = 'waitlist' THEN 1 ELSE 0 END) AS waitlist
    FROM game_participants WHERE event_id = ? AND occurrence_date = ?`).bind(eventId, occurrenceDate).first<Row>();
  return { confirmed: Number(row?.confirmed ?? 0), waitlist: Number(row?.waitlist ?? 0) };
}

async function miniEvents(env: MiniEnv, userId: string, from: string, to: string, tagFilter = '') {
  const { results } = await env.DB.prepare(`SELECT * FROM calendar_events
    WHERE archived = 0 AND event_date <= ? ORDER BY event_date, start_time, id`).bind(to).all();
  const participantRows = await env.DB.prepare(`SELECT event_id, occurrence_date, status FROM game_participants
    WHERE telegram_user_id = ? AND occurrence_date BETWEEN ? AND ?`).bind(userId, from, to).all();
  const participantMap = new Map(participantRows.results.map((row) => {
    const value = row as Row;
    return [`${String(value.event_id)}:${String(value.occurrence_date)}`, String(value.status)];
  }));
  const output: unknown[] = [];
  for (const raw of results) {
    const row = raw as Row;
    const eventId = String(row.id);
    const tags = await readEventTags(env.DB, eventId);
    if (tagFilter && !tags.some((tag) => tag.slug === tagFilter)) continue;
    const capacity = await readMiniCapacity(env.DB, eventId);
    const firstDate = String(row.event_date) > from ? String(row.event_date) : from;
    for (let date = firstDate; date <= to; date = addDays(date, 1)) {
      if (!occursOn(row, date) || await eventExcluded(env.DB, eventId, date, row)) continue;
      const counts = await participantCounts(env.DB, eventId, date);
      output.push({
        eventId,
        occurrenceDate: date,
        title: String(row.title || 'Игра'),
        startTime: String(row.start_time || 'Время уточняется'),
        status: String(row.status || 'available'),
        system: String(row.system || ''),
        format: String(row.format || ''),
        location: String(row.location || ''),
        description: String(row.description || ''),
        price: String(row.price || ''),
        playerPrep: String(row.player_prep || ''),
        tags,
        capacity,
        signupCount: counts.confirmed,
        waitlistCount: counts.waitlist,
        signupStatus: participantMap.get(`${eventId}:${date}`) ?? null,
        canRsvp: ['available', 'waiting'].includes(String(row.status)),
      });
    }
  }
  return output;
}

async function miniTags(env: MiniEnv, userId: string) {
  const { results } = await env.DB.prepare(`SELECT t.tag, MAX(t.label) AS label
    FROM calendar_event_tags t JOIN calendar_events e ON e.id = t.event_id
    WHERE e.archived = 0 GROUP BY t.tag ORDER BY t.tag`).all();
  const subscriptions = await env.DB.prepare('SELECT tag FROM telegram_tag_subscriptions WHERE telegram_user_id = ? ORDER BY tag').bind(userId).all();
  return {
    tags: results.map((row) => ({ slug: String((row as Row).tag), label: String((row as Row).label || tagLabel(String((row as Row).tag))) })),
    selected: subscriptions.results.map((row) => String((row as Row).tag)),
  };
}

async function updateProfile(env: MiniEnv, session: MiniSession, body: Row) {
  const tags = normalizeTags(body.tags);
  const timezone = safeTimezone(body.timezone, String(session.timezone || DEFAULT_TIMEZONE));
  const notificationsEnabled = Object.prototype.hasOwnProperty.call(body, 'notificationsEnabled')
    ? body.notificationsEnabled === false ? 0 : 1
    : Number(session.notifications_enabled) === 1 ? 1 : 0;
  const timestamp = nowIso();
  const statements = [
    env.DB.prepare('UPDATE telegram_users SET timezone = ?, notifications_enabled = ?, updated_at = ?, last_seen_at = ? WHERE telegram_user_id = ?').bind(timezone, notificationsEnabled, timestamp, timestamp, session.telegram_user_id),
    env.DB.prepare('DELETE FROM telegram_tag_subscriptions WHERE telegram_user_id = ?').bind(session.telegram_user_id),
  ];
  for (const tag of tags) statements.push(env.DB.prepare(`INSERT INTO telegram_tag_subscriptions (telegram_user_id, tag, created_at, updated_at)
    VALUES (?, ?, ?, ?)`).bind(session.telegram_user_id, tag, timestamp, timestamp));
  await env.DB.batch(statements);
  const fresh = await env.DB.prepare('SELECT u.* FROM telegram_users u WHERE u.telegram_user_id = ?').bind(session.telegram_user_id).first<MiniSession>();
  return { user: fresh ? userPayload(fresh) : userPayload(session), tags };
}

async function rsvp(env: MiniEnv, session: MiniSession, body: Row) {
  const eventId = text(body.eventId, 100);
  const occurrenceDate = text(body.occurrenceDate, 10);
  const action = text(body.action, 20) || 'join';
  if (!eventId || !validDate(occurrenceDate) || !['join', 'cancel'].includes(action)) return json({ error: 'Укажите игру, дату и действие.' }, 400);
  if (occurrenceDate < todayInTimezone(safeTimezone(session.timezone))) return json({ error: 'Нельзя изменить запись на прошедшую дату.' }, 409);
  const row = await env.DB.prepare('SELECT * FROM calendar_events WHERE id = ? AND archived = 0').bind(eventId).first<Row>();
  if (!row || !occursOn(row, occurrenceDate) || await eventExcluded(env.DB, eventId, occurrenceDate, row)) return json({ error: 'Эта встреча больше недоступна.' }, 404);
  const existing = await env.DB.prepare(`SELECT status FROM game_participants
    WHERE event_id = ? AND occurrence_date = ? AND telegram_user_id = ?`).bind(eventId, occurrenceDate, session.telegram_user_id).first<Row>();
  if (action === 'cancel') {
    if (existing && String(existing.status) !== 'cancelled') {
      await env.DB.prepare(`UPDATE game_participants SET status = 'cancelled', updated_at = ?
        WHERE event_id = ? AND occurrence_date = ? AND telegram_user_id = ?`).bind(nowIso(), eventId, occurrenceDate, session.telegram_user_id).run();
      if (String(existing.status) === 'confirmed') {
        const capacity = await readMiniCapacity(env.DB, eventId);
        if (capacity !== null) {
          const countsBeforePromotion = await participantCounts(env.DB, eventId, occurrenceDate);
          const openSlots = Math.max(capacity - countsBeforePromotion.confirmed, 0);
          if (openSlots > 0) {
            const { results: waitlist } = await env.DB.prepare(`SELECT p.telegram_user_id, u.chat_id, u.notifications_enabled
              FROM game_participants p JOIN telegram_users u ON u.telegram_user_id = p.telegram_user_id
              WHERE p.event_id = ? AND p.occurrence_date = ? AND p.status = 'waitlist'
              ORDER BY p.created_at, p.telegram_user_id LIMIT ?`).bind(eventId, occurrenceDate, openSlots).all();
            for (const candidate of waitlist) {
              const candidateRow = candidate as Row;
              await env.DB.prepare(`UPDATE game_participants SET status = 'confirmed', updated_at = ?
                WHERE event_id = ? AND occurrence_date = ? AND telegram_user_id = ? AND status = 'waitlist'`)
                .bind(nowIso(), eventId, occurrenceDate, String(candidateRow.telegram_user_id)).run();
              await sendPromotionNotice(env, candidateRow, row, occurrenceDate);
            }
          }
        }
      }
    }
  } else {
    if (!['available', 'waiting'].includes(String(row.status))) return json({ error: 'Запись на эту игру закрыта.' }, 409);
    if (existing && ['confirmed', 'waitlist'].includes(String(existing.status))) return json({ ok: true, status: String(existing.status) });
    const capacity = await readMiniCapacity(env.DB, eventId);
    const timestamp = nowIso();
    await env.DB.prepare(`INSERT INTO game_participants (event_id, occurrence_date, telegram_user_id, status, created_at, updated_at)
      VALUES (?, ?, ?, CASE WHEN ? = 'waiting' OR (? IS NOT NULL AND
        (SELECT COUNT(*) FROM game_participants WHERE event_id = ? AND occurrence_date = ? AND status = 'confirmed') >= ?)
        THEN 'waitlist' ELSE 'confirmed' END, ?, ?)
      ON CONFLICT(event_id, occurrence_date, telegram_user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`)
      .bind(eventId, occurrenceDate, session.telegram_user_id, String(row.status), capacity, eventId, occurrenceDate, capacity, timestamp, timestamp).run();
  }
  const state = await env.DB.prepare(`SELECT status FROM game_participants WHERE event_id = ? AND occurrence_date = ? AND telegram_user_id = ?`).bind(eventId, occurrenceDate, session.telegram_user_id).first<Row>();
  const counts = await participantCounts(env.DB, eventId, occurrenceDate);
  return json({ ok: true, status: state ? String(state.status) : 'cancelled', signupCount: counts.confirmed, waitlistCount: counts.waitlist });
}

function appButton(env: MiniEnv) {
  const url = env.MINI_APP_URL || 'https://sait-madmuaziel-niks-final.pages.dev/mini';
  return { inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url } }]] };
}

async function telegramApi(env: MiniEnv, method: string, payload: Row) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({})) as Row;
  if (!response.ok || data.ok === false) {
    const error = new Error(String(data.description || `Telegram API ${response.status}`)) as Error & { status?: number; retryAfter?: number };
    error.status = Number(data.error_code) || response.status;
    const parameters = isRecord(data.parameters) ? data.parameters : null;
    error.retryAfter = parameters ? Number(parameters.retry_after || 0) : undefined;
    throw error;
  }
  return data;
}

async function sendPromotionNotice(env: MiniEnv, user: Row, event: Row, occurrenceDate: string) {
  if (!env.TELEGRAM_BOT_TOKEN || !user.chat_id || Number(user.notifications_enabled) !== 1) return;
  try {
    await telegramApi(env, 'sendMessage', {
      chat_id: String(user.chat_id),
      text: `Место освободилось: вы записаны на игру «${String(event.title || 'Игра')}» ${occurrenceDate}${event.start_time ? ` в ${String(event.start_time)}` : ''}.`,
      reply_markup: appButton(env),
    });
  } catch (error) {
    const typed = error as Error & { status?: number };
    if (typed.status === 403) await env.DB.prepare('UPDATE telegram_users SET notifications_enabled = 0, updated_at = ? WHERE telegram_user_id = ?').bind(nowIso(), String(user.telegram_user_id)).run();
    console.error(JSON.stringify({ message: 'telegram promotion notice failed', userId: String(user.telegram_user_id), eventId: String(event.id), error: typed.message }));
  }
}

async function rememberChat(env: MiniEnv, message: Row) {
  const identity = normalizeTelegramUser(message.from);
  const chat = isRecord(message.chat) ? message.chat : null;
  if (!identity || !chat || (String(chat.type) !== 'private')) return null;
  const chatId = typeof chat.id === 'number' && Number.isSafeInteger(chat.id) ? String(chat.id) : text(chat.id, 40);
  if (!chatId) return null;
  await upsertTelegramUser(env.DB, identity, chatId);
  return { identity, chatId };
}

async function processTelegramMessage(env: MiniEnv, message: Row) {
  const saved = await rememberChat(env, message);
  if (!saved || !env.TELEGRAM_BOT_TOKEN) return;
  const command = text(message.text, 100).split(/\s+/)[0].toLowerCase().split('@')[0];
  if (command === '/stop') {
    await env.DB.prepare('UPDATE telegram_users SET notifications_enabled = 0, updated_at = ? WHERE telegram_user_id = ?').bind(nowIso(), saved.identity.id).run();
    await telegramApi(env, 'sendMessage', { chat_id: saved.chatId, text: 'Напоминания выключены. Вернуться можно из мини‑аппа или командой /notify.' });
    return;
  }
  if (command === '/notify') {
    await env.DB.prepare('UPDATE telegram_users SET notifications_enabled = 1, updated_at = ? WHERE telegram_user_id = ?').bind(nowIso(), saved.identity.id).run();
    await telegramApi(env, 'sendMessage', { chat_id: saved.chatId, text: 'Напоминания включены. Я сообщу о ваших играх и подходящих тегах.' });
    return;
  }
  await telegramApi(env, 'sendMessage', {
    chat_id: saved.chatId,
    text: command === '/start' || command === '/app'
      ? 'Привет! Здесь можно выбрать игру, подписаться на теги и отметить участие.'
      : 'Откройте мини‑апп, чтобы выбрать игру и настроить напоминания.',
    reply_markup: appButton(env),
  });
}

export async function handleTelegramWebhook(request: Request, env: MiniEnv) {
  const expectedSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!env.TELEGRAM_BOT_TOKEN || !expectedSecret) return json({ error: 'Telegram webhook is not configured.' }, 503);
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== expectedSecret) return json({ error: 'Forbidden' }, 403);
  const body = await readBody(request);
  if (!body) return json({ error: 'Некорректное обновление.' }, 400);
  const updateId = Number(body.update_id);
  if (!Number.isInteger(updateId) || updateId < 0) return json({ error: 'Некорректный update_id.' }, 400);
  const inserted = await env.DB.prepare('INSERT OR IGNORE INTO telegram_updates (update_id, received_at) VALUES (?, ?)').bind(updateId, nowIso()).run();
  if (!inserted.meta.changes) return json({ ok: true, duplicate: true });
  try {
    if (isRecord(body.message)) await processTelegramMessage(env, body.message);
  } catch (error) {
    console.error(JSON.stringify({ message: 'telegram webhook failed', error: error instanceof Error ? error.message : String(error) }));
    const status = Number((error as Error & { status?: number }).status || 0);
    if (!status || ![400, 403].includes(status)) {
      await env.DB.prepare('DELETE FROM telegram_updates WHERE update_id = ?').bind(updateId).run();
      return json({ error: 'Временная ошибка обработки обновления.' }, 503, { 'Retry-After': '30' });
    }
  }
  return json({ ok: true });
}

async function claimDelivery(env: MiniEnv, userId: string, eventId: string, occurrenceDate: string, kind: string) {
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO notification_deliveries
    (telegram_user_id, event_id, occurrence_date, kind, sent_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(userId, eventId, occurrenceDate, kind, nowIso()).run();
  return Number(result.meta.changes) === 1;
}

async function sendReminder(env: MiniEnv, user: Row, event: Row, occurrenceDate: string, kind: string, status: string) {
  const userId = String(user.telegram_user_id);
  const eventId = String(event.id);
  if (!await claimDelivery(env, userId, eventId, occurrenceDate, kind)) return false;
  const dateLabel = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(dateUtc(occurrenceDate)));
  const prefix = kind === 'event_today' ? 'Сегодня' : 'Завтра';
  const waitlist = status === 'waitlist' ? '\nВы в листе ожидания.' : '';
  try {
    await telegramApi(env, 'sendMessage', {
      chat_id: String(user.chat_id),
      text: `${prefix}, ${dateLabel}, игра «${String(event.title || 'Игра')}»${event.start_time ? ` в ${String(event.start_time)}` : ''}.${waitlist}\nОткройте мини‑апп, чтобы посмотреть детали.`,
      reply_markup: appButton(env),
    });
    return true;
  } catch (error) {
    await env.DB.prepare('DELETE FROM notification_deliveries WHERE telegram_user_id = ? AND event_id = ? AND occurrence_date = ? AND kind = ?').bind(userId, eventId, occurrenceDate, kind).run();
    const typed = error as Error & { status?: number };
    if (typed.status === 403) await env.DB.prepare('UPDATE telegram_users SET notifications_enabled = 0, updated_at = ? WHERE telegram_user_id = ?').bind(nowIso(), userId).run();
    console.error(JSON.stringify({ message: 'telegram reminder failed', userId, eventId, error: typed.message }));
    return false;
  }
}

export async function sendScheduledReminders(env: MiniEnv) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const timeZone = safeTimezone(env.GAME_TIMEZONE, DEFAULT_TIMEZONE);
  const today = todayInTimezone(timeZone);
  const tomorrow = addDays(today, 1);
  const localMinutes = minutesInTimezone(timeZone);
  const { results } = await env.DB.prepare(`SELECT * FROM calendar_events
    WHERE archived = 0 AND event_date <= ? ORDER BY event_date, start_time, id`).bind(tomorrow).all();
  let sent = 0;
  for (const raw of results) {
    const event = raw as Row;
    const eventId = String(event.id);
    const tags = await readEventTags(env.DB, eventId);
    const status = String(event.status || 'available');
    for (const [date, kind] of [[today, 'event_today'], [tomorrow, 'event_tomorrow']] as const) {
      if (kind === 'event_today' && localMinutes < 9 * 60) continue;
      if (kind === 'event_tomorrow' && localMinutes < 18 * 60) continue;
      if (!occursOn(event, date) || await eventExcluded(env.DB, eventId, date, event)) continue;
      const participants = await env.DB.prepare(`SELECT p.status, u.* FROM game_participants p
        JOIN telegram_users u ON u.telegram_user_id = p.telegram_user_id
        WHERE p.event_id = ? AND p.occurrence_date = ? AND p.status IN ('confirmed', 'waitlist')
          AND u.notifications_enabled = 1 AND u.chat_id IS NOT NULL`).bind(eventId, date).all();
      const participantIds = new Set<string>();
      for (const row of participants.results) {
        const user = row as Row;
        participantIds.add(String(user.telegram_user_id));
        if (await sendReminder(env, user, event, date, kind, String(user.status))) sent += 1;
        if (sent >= 100) return;
      }
      if (tags.length === 0 || ['closed', 'day_off'].includes(status)) continue;
      const tagRows = await env.DB.prepare(`SELECT DISTINCT u.* FROM telegram_tag_subscriptions s
        JOIN telegram_users u ON u.telegram_user_id = s.telegram_user_id
        JOIN calendar_event_tags t ON t.tag = s.tag AND t.event_id = ?
        WHERE u.notifications_enabled = 1 AND u.chat_id IS NOT NULL`).bind(eventId).all();
      for (const rawUser of tagRows.results) {
        const user = rawUser as Row;
        if (participantIds.has(String(user.telegram_user_id))) continue;
        if (await sendReminder(env, user, event, date, kind, 'tag')) sent += 1;
        if (sent >= 100) return;
      }
    }
  }
}

export async function handleMiniRequest(request: Request, env: MiniEnv) {
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/api/mini/session') {
    if (sessionRateLimited(request)) return json({ error: 'Слишком много попыток. Откройте приложение через минуту.' }, 429, { 'Retry-After': '60' });
    const body = await readBody(request);
    const initData = body ? text(body.initData, 10000) : '';
    const user = env.TELEGRAM_BOT_TOKEN ? await validateInitData(initData, env.TELEGRAM_BOT_TOKEN) : null;
    if (!user) return json({ error: 'Откройте мини‑апп из Telegram заново.' }, 401);
    await upsertTelegramUser(env.DB, user);
    const session = await createSession(env, user);
    return json(session, 200, { 'Set-Cookie': `mini_session=${session.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}` });
  }

  const session = await readMiniSession(request, env);
  if (!session) return json({ error: 'Сессия мини‑аппа истекла. Откройте его из Telegram ещё раз.' }, 401);

  if (request.method === 'GET' && url.pathname === '/api/mini/me') {
    const tags = await miniTags(env, session.telegram_user_id);
    return json({ user: userPayload(session), tags: tags.selected });
  }
  if (request.method === 'GET' && url.pathname === '/api/mini/tags') return json(await miniTags(env, session.telegram_user_id));
  if (request.method === 'GET' && url.pathname === '/api/mini/events') {
    const today = todayInTimezone(safeTimezone(session.timezone));
    const from = validDate(url.searchParams.get('from')) ? String(url.searchParams.get('from')) : today;
    const requestedTo = validDate(url.searchParams.get('to')) ? String(url.searchParams.get('to')) : addDays(from, 30);
    const to = dateUtc(requestedTo) - dateUtc(from) > 45 * 86400000 ? addDays(from, 45) : requestedTo;
    return json({ events: await miniEvents(env, session.telegram_user_id, from, to, normalizeTag(url.searchParams.get('tag'))) });
  }
  if (request.method === 'GET' && url.pathname === '/api/mini/games') {
    const today = todayInTimezone(safeTimezone(session.timezone));
    const events = await miniEvents(env, session.telegram_user_id, today, addDays(today, 90));
    const tagFilter = normalizeTag(url.searchParams.get('tag'));
    return json({ events: events.filter((event) => isRecord(event) && ['confirmed', 'waitlist'].includes(String(event.signupStatus)) && (!tagFilter || (Array.isArray(event.tags) && event.tags.some((tag) => isRecord(tag) && String(tag.slug) === tagFilter)))) });
  }
  if (request.method === 'PATCH' && url.pathname === '/api/mini/me') {
    if (!await csrfValid(request, env, session)) return json({ error: 'Недействительный CSRF-токен.' }, 403);
    const body = await readBody(request);
    return body ? json(await updateProfile(env, session, body)) : json({ error: 'Некорректные настройки.' }, 400);
  }
  if (request.method === 'POST' && url.pathname === '/api/mini/rsvp') {
    if (!await csrfValid(request, env, session)) return json({ error: 'Недействительный CSRF-токен.' }, 403);
    const body = await readBody(request);
    return body ? rsvp(env, session, body) : json({ error: 'Некорректная запись.' }, 400);
  }
  return json({ error: 'Not found' }, 404);
}
