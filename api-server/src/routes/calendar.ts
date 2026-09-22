import { Router, type IRouter } from "express";
import { GetCalendarResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const calendarSourceUrl =
  process.env.CALENDAR_SOURCE_URL ??
  "https://dndmaster.dndmaster.workers.dev/api/calendar";
const sourceTimeoutMs = 8_000;

router.get("/calendar", async (_req, res): Promise<void> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), sourceTimeoutMs);

  try {
    const response = await fetch(calendarSourceUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    const payload: unknown = await response.json();
    if (!response.ok) {
      res.status(502).json({ error: "Календарь временно недоступен." });
      return;
    }

    const parsed = GetCalendarResponse.safeParse(payload);
    if (!parsed.success) {
      res.status(502).json({ error: "Источник календаря вернул неверные данные." });
      return;
    }

    res.set("Cache-Control", "no-store");
    res.json(parsed.data);
  } catch {
    res.status(502).json({ error: "Не удалось загрузить актуальный календарь." });
  } finally {
    clearTimeout(timeout);
  }
});

export default router;