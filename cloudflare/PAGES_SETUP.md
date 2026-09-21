# Размещение сайта в Cloudflare Pages

Этот проект разделён на две части: React-фронтенд в `artifacts/nyx-dnd-site` и API Worker в `cloudflare/api-worker`. Дизайн и наполнение фронтенда не меняются при переносе.

## 1. Создайте Pages-проект

В Cloudflare откройте **Workers & Pages → Create application → Pages → Connect to Git** и выберите репозиторий `madmazemargo-cmd/Sait-Madmuaziel-Niks-new`.

Параметры сборки:

- Framework preset: `None` или `Vite`;
- Build command: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @workspace/nyx-dnd-site run build`;
- Build output directory: `artifacts/nyx-dnd-site/dist/public`;
- Root directory: `/`;
- Environment variable `BASE_PATH`: `/`;
- Environment variable `VITE_API_BASE_URL`: URL опубликованного API Worker, например `https://madmuazelle-niks-api.<account>.workers.dev`.

После первого деплоя Cloudflare выдаст бесплатный адрес вида `https://<project>.pages.dev`. Этот адрес нужно указать в `cloudflare/api-worker/wrangler.toml` в переменной `ALLOWED_ORIGIN`, затем повторно развернуть Worker.

## 2. Разверните API Worker

Установите Node.js 22+ и выполните из папки `cloudflare/api-worker`:

```bash
pnpm install
pnpm exec wrangler login
pnpm run typecheck
pnpm run deploy
```

В `wrangler.toml` замените `ALLOWED_ORIGIN` на фактический Pages URL. Если внешний календарь или endpoint заявок изменятся, задайте их в Cloudflare как переменные `CALENDAR_SOURCE_URL` и `APPLICATIONS_SOURCE_URL`.

## 3. Проверьте Worker

Подставьте выданный Worker URL:

```bash
curl https://<worker>.workers.dev/api/healthz
curl https://<worker>.workers.dev/api/calendar
```

Первый запрос должен вернуть `{"status":"ok"}`. Второй должен вернуть объект с массивом `events`.

## 4. Проверьте Pages

Откройте Pages URL и проверьте главную страницу, `/games`, `/calendar` и `/anketa`. В DevTools → Network запросы должны идти к `VITE_API_BASE_URL` с путями `/api/calendar` и `/api/applications`.

## 5. Домен позже

Когда появится собственный домен, его нужно добавить в Pages и заменить адреса в SEO-файлах:

- `artifacts/nyx-dnd-site/index.html`;
- `artifacts/nyx-dnd-site/public/robots.txt`;
- `artifacts/nyx-dnd-site/public/sitemap.xml`;
- `cloudflare/api-worker/wrangler.toml` (`ALLOWED_ORIGIN`).
