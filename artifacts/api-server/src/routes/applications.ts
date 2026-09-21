import { Router, type IRouter } from "express";
import {
  GetApplicationSelectionResponse,
  SubmitApplicationBody,
  SubmitApplicationResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const applicationsSourceUrl =
  process.env.APPLICATIONS_SOURCE_URL ??
  "https://dndmaster.dndmaster.workers.dev/api/applications";
const sourceTimeoutMs = 10_000;
const applicationWindowMs = 15 * 60 * 1000;
const applicationLimit = 5;
const applicationAttempts = new Map<string, { count: number; resetAt: number }>();

function requestKey(ip: string | undefined) {
  return ip || "unknown";
}

function isRateLimited(key: string) {
  const now = Date.now();
  const current = applicationAttempts.get(key);
  if (!current || current.resetAt <= now) {
    applicationAttempts.set(key, { count: 1, resetAt: now + applicationWindowMs });
    return false;
  }
  current.count += 1;
  return current.count > applicationLimit;
}

function pruneAttempts() {
  const now = Date.now();
  for (const [key, value] of applicationAttempts) {
    if (value.resetAt <= now) applicationAttempts.delete(key);
  }
}

function sourceRequest(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), sourceTimeoutMs);

  return fetch(url, {
    ...init,
    cache: "no-store",
    signal: controller.signal,
    headers: {
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  }).finally(() => clearTimeout(timeout));
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  return response.json();
}

router.get("/applications", async (req, res): Promise<void> => {
  const event = typeof req.query.event === "string" ? req.query.event : "";
  const date = typeof req.query.date === "string" ? req.query.date : "";
  if (!event || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "Укажите игру и дату." });
    return;
  }

  try {
    const url = new URL(applicationsSourceUrl);
    url.searchParams.set("event", event);
    url.searchParams.set("date", date);
    const response = await sourceRequest(url.toString(), { method: "GET" });
    const payload = await readJson(response);
    if (!response.ok) {
      res.status(response.status === 404 ? 404 : 502).json(
        payload && typeof payload === "object" && "error" in payload
          ? payload
          : { error: "Не удалось проверить выбранную игру." },
      );
      return;
    }

    const parsed = GetApplicationSelectionResponse.safeParse(payload);
    if (!parsed.success) {
      res.status(502).json({ error: "Источник заявок вернул неверные данные." });
      return;
    }

    if (parsed.data.game.date !== date) {
      res.status(409).json({ error: "Выбранная дата больше недоступна. Вернитесь в календарь и выберите актуальную игру." });
      return;
    }

    res.set("Cache-Control", "no-store");
    res.json(parsed.data);
  } catch {
    res.status(502).json({ error: "Не удалось проверить выбранную игру." });
  }
});

router.post("/applications", async (req, res): Promise<void> => {
  const parsed = SubmitApplicationBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.consent) {
    res.status(400).json({ ok: false, error: "Проверьте обязательные поля и согласие." });
    return;
  }

  if (parsed.data.website?.trim()) {
    res.status(202).json({ ok: true, notice: "Заявка принята." });
    return;
  }

  const name = parsed.data.name.trim();
  const contact = parsed.data.contact.trim();
  if (!name || name.length > 100 || !contact || contact.length > 120) {
    res.status(400).json({ ok: false, error: "Проверьте имя и контакт для связи." });
    return;
  }

  pruneAttempts();
  if (isRateLimited(requestKey(req.ip))) {
    res.set("Retry-After", "900");
    res.status(429).json({ ok: false, error: "Слишком много заявок. Попробуйте снова через 15 минут." });
    return;
  }

  try {
    const response = await sourceRequest(applicationsSourceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...parsed.data,
        name,
        contact,
        players: String(parsed.data.players),
      }),
    });
    const payload = await readJson(response);
    const upstreamPayload =
      payload && typeof payload === "object" ? payload : { ok: false };
    const responseSchema = SubmitApplicationResponse.safeParse(upstreamPayload);

    if (!responseSchema.success) {
      res.status(response.ok ? 502 : response.status).json({
        ok: false,
        error: "Мастер не смог принять заявку. Попробуйте ещё раз.",
      });
      return;
    }

    res.status(response.status).json(responseSchema.data);
  } catch {
    res.status(502).json({
      ok: false,
      error: "Сервис заявок временно недоступен. Попробуйте ещё раз через минуту.",
    });
  }
});

export default router;
