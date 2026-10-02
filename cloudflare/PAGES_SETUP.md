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
- Environment variable `SITE_URL`: the exact public Pages URL, for example `https://<project>.pages.dev`;
- Environment variable `API_ORIGIN`: the exact Worker URL, for example `https://madmuazelle-niks-api.dndmaster.workers.dev`;
- `VITE_API_BASE_URL` для Pages не нужен: календарь, каталог и заявки проксируются однодоменной Pages Function из `/functions/api/[[path]].js`.

После деплоя Cloudflare выдаст адрес вида `https://<project>.pages.dev`. Pages Function работает на том же адресе, поэтому отдельная настройка CORS для фронтенда не нужна.

## 2. API Worker и D1 (обязательно для календаря, каталога и кабинета мастера)

Установите Node.js 22+ и выполните из папки `cloudflare/api-worker`:

```bash
corepack enable
pnpm install --ignore-workspace
pnpm exec wrangler login
pnpm run typecheck
```

Для кабинета мастера задайте отдельный секрет сессий (значение не хранится в репозитории):

```bash
pnpm exec wrangler secret put SESSION_PEPPER
```

Web-заявки пока сохраняются только в D1 и отображаются в `/master/applications`. Автоматическая отправка новых заявок в Telegram отложена; `TELEGRAM_BOT_TOKEN` используется только функциями Telegram Mini App и webhook.

Перед деплоем проверьте, что `wrangler.toml` указывает на нужную D1-базу (`dndmaster-calendar`). Для миграций вернитесь в корень репозитория и примените файлы из папки `migrations`:

```bash
pnpm exec wrangler d1 migrations apply dndmaster-calendar --remote --config cloudflare/api-worker/wrangler.toml
```

В существующей базе уже есть календарь и legacy-таблица `game_catalog_items`. Миграции `0001_master_calendar.sql` и `0002_catalog_items.sql` рассчитаны на эту схему: они не требуют пересоздания календаря, создают новую revision-таблицу каталога и переносят в неё существующие карточки с их статусом публикации. Перед применением можно проверить список pending-миграций без записи:

```bash
pnpm exec wrangler d1 migrations list dndmaster-calendar --remote --config cloudflare/api-worker/wrangler.toml
```

Сначала примените миграции, затем задеплойте Worker (`pnpm run deploy` из `cloudflare/api-worker`), чтобы новый `/api/catalog` сразу видел таблицу `catalog_items`. Не удаляйте legacy-таблицу до проверки витрины и мастерского CRUD.

Миграция `0004_calendar_catalog_link.sql` добавляет связь календарной встречи с карточкой каталога. Она позволяет показывать в подробностях календаря обложку и описание выбранной игры; примените её вместе с остальными ожидающими миграциями до деплоя Worker.

Также замените `ALLOWED_ORIGIN` на фактический Pages URL, если адрес Pages отличается от указанного в конфигурации. Календарь, каталог и заявки читаются из привязанной D1-базы.

## 3. Проверьте Worker

Подставьте выданный Worker URL:

```bash
curl https://<worker>.workers.dev/api/healthz
curl https://<worker>.workers.dev/api/calendar
```

Первый запрос должен вернуть `{"status":"ok"}`. Второй должен вернуть объект с массивом `events`.

## 4. Проверьте Pages

Откройте Pages URL и проверьте главную страницу, `/games`, `/calendar`, `/anketa` и после входа `/master/catalog`. В DevTools → Network запросы должны идти на тот же Pages-домен по путям `/api/calendar`, `/api/catalog` и `/api/applications` и возвращать JSON, а не HTML-страницу.

## 5. Домен позже

Когда появится собственный домен, его нужно добавить в Pages и заменить адреса в SEO-файлах:

- `artifacts/nyx-dnd-site/index.html`;
- `artifacts/nyx-dnd-site/public/robots.txt`;
- `artifacts/nyx-dnd-site/public/sitemap.xml`;
- `cloudflare/api-worker/wrangler.toml` (`ALLOWED_ORIGIN`).

## 6. Telegram Mini App

После базовой настройки Pages и Worker выполните шаги из [`TELEGRAM_MINI_APP.md`](../TELEGRAM_MINI_APP.md): примените миграцию `0003_telegram_mini_app.sql`, задайте Telegram-секреты, задеплойте Worker с cron и зарегистрируйте webhook. Само приложение доступно на `/mini`, а новые API-маршруты проксируются той же Pages Function.
