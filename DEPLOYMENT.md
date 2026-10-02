# Публикация сайта

## Быстрая проверка

Публичная версия проекта уже доступна по адресу:

`https://sait-madmuaziel-niks-final.pages.dev`

Для локальной разработки из корня репозитория:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Сайт откроется на `http://localhost:5173`, API будет доступен через тот же Vite-прокси.

## Отдельный сервер через Docker

Образ запускает API и собранный фронтенд на одном порту. На сервере с установленными Docker и Git выполните:

```bash
git clone <адрес-репозитория> site
cd site
docker build --build-arg SITE_URL=https://example.ru -t madmuazelle-niks .
docker run -d --name madmuazelle-niks --restart unless-stopped \
  -p 8080:8080 \
  -e ALLOWED_ORIGINS=https://example.ru \
  -e API_ORIGIN=https://madmuazelle-niks-api.dndmaster.workers.dev \
  madmuazelle-niks
```

Проверка сервера:

```bash
curl http://127.0.0.1:8080/api/healthz
```

Ответ должен быть `{"status":"ok"}`. Перед сайтом нужен HTTPS reverse proxy (например, Caddy или Nginx), который направляет домен на `127.0.0.1:8080`. В DNS домена создайте A-запись на IP сервера.

При смене домена передайте его в `SITE_URL` во время `docker build`. Тогда в собранных `index.html`, `robots.txt` и `sitemap.xml` будут правильные canonical и адрес sitemap. После публикации добавьте `https://example.ru/sitemap.xml` в Google Search Console и Яндекс Вебмастер.

## Без Docker

Нужны Node.js 22+ и pnpm:

```bash
corepack enable
pnpm install --frozen-lockfile
SITE_URL=https://example.ru pnpm run build:production
PORT=8080 NODE_ENV=production ALLOWED_ORIGINS=https://example.ru API_ORIGIN=https://madmuazelle-niks-api.dndmaster.workers.dev pnpm start
```

На Windows переменные окружения задаются так:

```powershell
$env:SITE_URL = "https://example.ru"
$env:PORT = "8080"
$env:NODE_ENV = "production"
$env:ALLOWED_ORIGINS = "https://example.ru"
$env:API_ORIGIN = "https://madmuazelle-niks-api.dndmaster.workers.dev"
pnpm run build:production
pnpm start
```
