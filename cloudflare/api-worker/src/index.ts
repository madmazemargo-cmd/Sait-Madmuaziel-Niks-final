export interface Env {
  CALENDAR_SOURCE_URL?: string;
  APPLICATIONS_SOURCE_URL?: string;
  ALLOWED_ORIGIN?: string;
  RATE_LIMITER?: DurableObjectNamespace;
}

const DEFAULT_CALENDAR_SOURCE_URL = "https://dndmaster.dndmaster.workers.dev/api/calendar";
const DEFAULT_APPLICATIONS_SOURCE_URL = "https://dndmaster.dndmaster.workers.dev/api/applications";
const MAX_BODY_BYTES = 32 * 1024;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const fallbackAttempts = new Map<string, { count: number; resetAt: number }>();

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("Origin");
  const allowed = env.ALLOWED_ORIGIN?.trim();
  return {
    "Access-Control-Allow-Origin": allowed ? (origin === allowed ? allowed : "") : "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function withSecurityHeaders(response: Response, request: Request, env: Env) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) {
    if (value) headers.set(key, value);
  }
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return new Response(response.body, { status: response.status, headers });
}

function clientIp(request: Request) {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

async function checkRateLimit(ip: string, env: Env) {
  if (env.RATE_LIMITER) {
    const id = env.RATE_LIMITER.idFromName(ip);
    const response = await env.RATE_LIMITER.get(id).fetch("https://rate-limit/check", {
      method: "POST",
    });
    return {
      limited: response.status === 429,
      retryAfter: Number(response.headers.get("Retry-After") ?? "900"),
    };
  }

  const now = Date.now();
  const current = fallbackAttempts.get(ip);
  if (!current || current.resetAt <= now) {
    fallbackAttempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { limited: false, retryAfter: 900 };
  }
  current.count += 1;
  return { limited: current.count > RATE_LIMIT, retryAfter: 900 };
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : null;
    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validCalendarPayload(value: unknown) {
  return isRecord(value) && Array.isArray(value.events);
}

function validApplicationResponse(value: unknown) {
  return isRecord(value) && typeof value.ok === "boolean";
}

async function readRequestBody(request: Request) {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";

  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method === "GET" && path === "/api/healthz") {
    return json({ status: "ok" });
  }

  if (request.method === "GET" && path === "/api/calendar") {
    try {
      const result = await fetchJson(
        env.CALENDAR_SOURCE_URL ?? DEFAULT_CALENDAR_SOURCE_URL,
        { method: "GET" },
        8_000,
      );
      if (!result.response.ok || !validCalendarPayload(result.payload)) {
        return json({ error: "Календарь временно недоступен." }, 502);
      }
      return json(result.payload);
    } catch {
      return json({ error: "Не удалось загрузить актуальный календарь." }, 502);
    }
  }

  if (path === "/api/applications" && request.method === "GET") {
    const event = url.searchParams.get("event") ?? "";
    const date = url.searchParams.get("date") ?? "";
    if (!event || !validDate(date)) return json({ error: "Укажите игру и дату." }, 400);

    try {
      const source = new URL(env.APPLICATIONS_SOURCE_URL ?? DEFAULT_APPLICATIONS_SOURCE_URL);
      source.searchParams.set("event", event);
      source.searchParams.set("date", date);
      const result = await fetchJson(source.toString(), { method: "GET" }, 10_000);
      if (!result.response.ok) {
        return json(
          isRecord(result.payload) && typeof result.payload.error === "string"
            ? result.payload
            : { error: "Не удалось проверить выбранную игру." },
          result.response.status === 404 ? 404 : 502,
        );
      }
      if (!isRecord(result.payload) || !isRecord(result.payload.game)) {
        return json({ error: "Источник заявок вернул неверные данные." }, 502);
      }
      if (result.payload.game.date !== date) {
        return json({ error: "Выбранная дата больше недоступна. Вернитесь в календарь и выберите актуальную игру." }, 409);
      }
      return json(result.payload);
    } catch {
      return json({ error: "Не удалось проверить выбранную игру." }, 502);
    }
  }

  if (path === "/api/applications" && request.method === "POST") {
    const body = await readRequestBody(request);
    if (!isRecord(body) || body.consent !== true) {
      return json({ ok: false, error: "Проверьте обязательные поля и согласие." }, 400);
    }
    if (typeof body.website === "string" && body.website.trim()) {
      return json({ ok: true, notice: "Заявка принята." }, 202);
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const contact = typeof body.contact === "string" ? body.contact.trim() : "";
    const players = Number(body.players);
    if (!name || name.length > 100 || !contact || contact.length > 120 || !Number.isInteger(players) || players < 1 || players > 20) {
      return json({ ok: false, error: "Проверьте имя и контакт для связи." }, 400);
    }

    const rate = await checkRateLimit(clientIp(request), env);
    if (rate.limited) {
      return json(
        { ok: false, error: "Слишком много заявок. Попробуйте снова через 15 минут." },
        429,
        { "Retry-After": String(rate.retryAfter) },
      );
    }

    try {
      const result = await fetchJson(
        env.APPLICATIONS_SOURCE_URL ?? DEFAULT_APPLICATIONS_SOURCE_URL,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, name, contact, players: String(players) }),
        },
        10_000,
      );
      if (!validApplicationResponse(result.payload)) {
        return json({ ok: false, error: "Мастер не смог принять заявку. Попробуйте ещё раз." }, result.response.ok ? 502 : result.response.status);
      }
      return json(result.payload, result.response.status);
    } catch {
      return json({ ok: false, error: "Сервис заявок временно недоступен. Попробуйте ещё раз через минуту." }, 502);
    }
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return withSecurityHeaders(await handle(request, env), request, env);
  },
};

export class RateLimiter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(): Promise<Response> {
    const now = Date.now();
    const current = await this.state.storage.get<{ count: number; resetAt: number }>("window");
    if (!current || current.resetAt <= now) {
      await this.state.storage.put("window", { count: 1, resetAt: now + RATE_WINDOW_MS });
      return new Response("ok");
    }
    if (current.count >= RATE_LIMIT) {
      return new Response("limited", { status: 429, headers: { "Retry-After": "900" } });
    }
    await this.state.storage.put("window", { count: current.count + 1, resetAt: current.resetAt });
    return new Response("ok");
  }
}
