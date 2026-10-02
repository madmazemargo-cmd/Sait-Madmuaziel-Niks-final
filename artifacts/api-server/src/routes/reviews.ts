import { Router, type IRouter } from "express";
import { apiEndpoint } from "../config";

const router: IRouter = Router();
const reviewsSourceUrl = process.env.REVIEWS_SOURCE_URL ?? apiEndpoint("reviews");
const sourceTimeoutMs = 10_000;

function sourceRequest(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), sourceTimeoutMs);
  return fetch(url, {
    ...init,
    cache: "no-store",
    signal: controller.signal,
    headers: { Accept: "application/json", ...(init.headers ?? {}) },
  }).finally(() => clearTimeout(timeout));
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/json") ? response.json() : null;
}

router.get("/reviews", async (_req, res): Promise<void> => {
  try {
    const response = await sourceRequest(reviewsSourceUrl, { method: "GET" });
    const payload = await readJson(response);
    if (!response.ok || !payload || typeof payload !== "object" || !Array.isArray((payload as { reviews?: unknown }).reviews)) {
      res.status(502).json({ error: "Отзывы временно недоступны." });
      return;
    }
    res.set("Cache-Control", "no-store");
    res.json(payload);
  } catch {
    res.status(502).json({ error: "Не удалось загрузить отзывы." });
  }
});

router.post("/reviews", async (req, res): Promise<void> => {
  try {
    const response = await sourceRequest(reviewsSourceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const payload = await readJson(response);
    res.status(response.status).json(payload && typeof payload === "object" ? payload : { ok: response.ok });
  } catch {
    res.status(502).json({ ok: false, error: "Сервис отзывов временно недоступен." });
  }
});

export default router;
