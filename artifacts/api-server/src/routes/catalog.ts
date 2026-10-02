import { Router, type IRouter } from "express";
import { apiEndpoint } from "../config";

const router: IRouter = Router();
const catalogSourceUrl =
  process.env.CATALOG_SOURCE_URL ??
  apiEndpoint("catalog");
const sourceTimeoutMs = 8_000;

function isCatalogPayload(payload: unknown): payload is { items: unknown[] } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    Array.isArray((payload as { items?: unknown }).items)
  );
}

router.get("/catalog", async (_req, res): Promise<void> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), sourceTimeoutMs);

  try {
    const response = await fetch(catalogSourceUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const payload: unknown = await response.json();

    if (!response.ok || !isCatalogPayload(payload)) {
      res.status(502).json({ error: "Каталог временно недоступен." });
      return;
    }

    res.set("Cache-Control", "no-store");
    res.json(payload);
  } catch {
    res.status(502).json({ error: "Не удалось загрузить каталог игр." });
  } finally {
    clearTimeout(timeout);
  }
});

export default router;
