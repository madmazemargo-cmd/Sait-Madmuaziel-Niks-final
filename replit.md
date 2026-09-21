# Мадмуазель Никс

Сайт мастера настольных ролевых игр с каталогом систем, календарём и формой заявки.

## Запуск

Требуются Node.js 22+ и pnpm. Из корня репозитория выполните `corepack enable`, затем `pnpm install --frozen-lockfile`. API запускается командой `pnpm --filter @workspace/api-server run dev`, фронтенд — `pnpm --filter @workspace/nyx-dnd-site run dev`. Полная проверка выполняется через `pnpm run typecheck`, production-сборка — через `pnpm run build`.

API по умолчанию слушает порт 5000, а Vite передаёт туда запросы `/api`. Переменные `CALENDAR_SOURCE_URL` и `APPLICATIONS_SOURCE_URL` позволяют заменить внешний источник календаря и заявок. В production обязательно задайте `ALLOWED_ORIGINS` как список разрешённых адресов сайта через запятую. Если API находится за доверенным reverse proxy, задайте точное число его переходов в `TRUST_PROXY_HOPS`; без этого заголовки `X-Forwarded-For` не используются. `DATABASE_URL` нужен только пакетам базы данных.

## Структура

Основной фронтенд находится в `artifacts/nyx-dnd-site`, API — в `artifacts/api-server`, контракт OpenAPI — в `lib/api-spec`, сгенерированные схемы и клиент — в `lib/api-zod` и `lib/api-client-react`. Публичные изображения, sitemap и robots.txt находятся в `artifacts/nyx-dnd-site/public`.

## Публикация без Replit

Основной рекомендуемый вариант — Cloudflare Pages для фронтенда и Cloudflare Worker для API. Инструкция находится в `cloudflare/PAGES_SETUP.md`. Pages собирает `artifacts/nyx-dnd-site` в `artifacts/nyx-dnd-site/dist/public`, а Worker предоставляет совместимые маршруты `/api/healthz`, `/api/calendar` и `/api/applications`.

Для локального запуска API по-прежнему используйте `pnpm --filter @workspace/api-server run dev`, а фронтенда — `pnpm --filter @workspace/nyx-dnd-site run dev`. Для Pages задайте `VITE_API_BASE_URL` равным URL опубликованного Worker. Фронтенд продолжает использовать те же `/api/...` пути, поэтому наполнение и дизайн не меняются.

## Перед публикацией

Проверьте публичный домен одновременно в `index.html`, `public/robots.txt`, `public/sitemap.xml`, `cloudflare/api-worker/wrangler.toml` и адресах внешних источников. Хостинг фронтенда должен возвращать `index.html` для маршрутов `/games`, `/calendar` и `/anketa`.
