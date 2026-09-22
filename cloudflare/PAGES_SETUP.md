# Размещение сайта в Cloudflare Pages

Этот проект разделён на две части: React-фронтенд в `artifacts/nyx-dnd-site` и API Worker в `cloudflare/api-worker`. Дизайн и наполнение фронтенда не меняются при переносе.

## 1. Создайте Pages-проект

В Cloudflare откройте **Workers & Pages → Create application → Pages → Connect to Git** и выберите репозиторий `madmazemargo-cmd/Sait-Madmuaziel-Niks-final`.

Параметры сборки:

- Framework preset: `None` или `Vite`;
- Build command: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @workspace/nyx-dnd-site run build`;
- Build output directory: `artifacts/nyx-dnd-site/dist/public`;
- Root directory: `/`;
- Environment variable `BASE_PATH`: `/`;
- `VITE_API_BASE_URL` для Pages не нужен: календарь, каталог и заявки проксируются однодоменной Pages Function из `/functions/api/[[path]].js`.

После деплоя Cloudflare выдаст адрес вида `https://<project>.pages.dev`. Pages Function работает на том же адресе, поэтому отдельная настройка CORS для фронтенда не нужна.

## 2. Отдельный API Worker (необязательно)

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

Откройте Pages URL и проверьте главную страницу, `/games`, `/calendar` и `/anketa`. В DevTools → Network запросы должны идти на тот же Pages-домен по путям `/api/calendar`, `/api/catalog` и `/api/applications` и возвращать JSON, а не HTML-страницу.

## 5. Домен позже

Когда появится собственный домен, его нужно добавить в Pages и заменить адреса в SEO-файлах:

- `artifacts/nyx-dnd-site/index.html`;
- `artifacts/nyx-dnd-site/public/robots.txt`;
- `artifacts/nyx-dnd-site/public/sitemap.xml`;
- `cloudflare/api-worker/wrangler.toml` (`ALLOWED_ORIGIN`).
