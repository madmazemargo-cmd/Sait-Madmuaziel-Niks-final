# Telegram Mini App для Никс

В репозитории уже есть первый рабочий вертикальный срез ассистента мастера:

- `/mini` — мобильный Telegram Mini App;
- `/api/mini/session` — проверка подписанного `initData` и короткая сессия;
- `/api/mini/events`, `/api/mini/games`, `/api/mini/tags` — календарь, мои записи и теги;
- `/api/mini/rsvp` и `PATCH /api/mini/me` — запись/отмена, подписки и уведомления;
- `/api/telegram/webhook` — `/start`, `/app`, `/notify`, `/stop`;
- Worker Cron каждые пять минут отправляет напоминания на сегодня и завтра.

Публичные `/calendar` и `/anketa` остаются без изменений. Теги и лимит участников мини‑аппа настраиваются в `/master/calendar`.

## 1. Миграция D1

Из корня репозитория применить миграции к той же базе, которая указана в `cloudflare/api-worker/wrangler.toml`:

```bash
pnpm exec wrangler d1 migrations list dndmaster-calendar --remote --config cloudflare/api-worker/wrangler.toml
pnpm exec wrangler d1 migrations apply dndmaster-calendar --remote --config cloudflare/api-worker/wrangler.toml
```

`0003_telegram_mini_app.sql` создаёт Telegram-профили/сессии, теги, подписки, записи на конкретные даты и журнал доставок. Миграция идемпотентна, но перед первым применением всё равно проверьте имя базы и аккаунт Wrangler.

## 2. Секреты Worker

Команды выполняются из `cloudflare/api-worker`:

```bash
pnpm exec wrangler secret put TELEGRAM_BOT_TOKEN
pnpm exec wrangler secret put TELEGRAM_WEBHOOK_SECRET
pnpm exec wrangler secret put APPLICATION_NOTIFY_CHAT_ID
pnpm exec wrangler secret put SESSION_PEPPER
```

`TELEGRAM_WEBHOOK_SECRET` — случайная строка длиной не менее 32 символов. Токен Telegram никогда не добавляется в Git и не передаётся во фронтенд.
`APPLICATION_NOTIFY_CHAT_ID` — числовой ID личного чата мастера или рабочего чата, куда отправляются новые заявки с веб-формы.

В `wrangler.toml` уже указаны:

```toml
MINI_APP_URL = "https://sait-madmuaziel-niks-final.pages.dev/mini"
GAME_TIMEZONE = "Europe/Moscow"

[triggers]
crons = ["*/5 * * * *"]
```

Если Pages URL изменится, обновите `MINI_APP_URL` и `ALLOWED_ORIGIN`. В Pages build environment добавьте `VITE_TELEGRAM_BOT_URL` со ссылкой на бота, например `https://t.me/<имя_бота>`; без неё запасная ссылка ведёт на текущий Telegram-контакт сайта.

## 3. Webhook и меню бота

После миграции и добавления секретов задеплойте Worker:

```bash
pnpm run deploy
```

Затем один раз зарегистрируйте webhook и кнопку Mini App (подставьте реальное имя бота и тот же secret):

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://madmuazelle-niks-api.dndmaster.workers.dev/api/telegram/webhook","secret_token":"<WEBHOOK_SECRET>","allowed_updates":["message"]}'

curl -X POST "https://api.telegram.org/bot<TOKEN>/setChatMenuButton" \
  -H "Content-Type: application/json" \
  -d '{"menu_button":{"type":"web_app","text":"Открыть мини‑апп","web_app":{"url":"https://sait-madmuaziel-niks-final.pages.dev/mini"}}}'
```

Фактический Worker host берите из Pages Function `functions/api/[[path]].js` и Cloudflare Dashboard. Telegram сможет отправлять напоминания только пользователю, который хотя бы один раз открыл чат с ботом и нажал `/start`.

## 4. Деплой Pages

Pages должен собирать `artifacts/nyx-dnd-site` командой из `cloudflare/PAGES_SETUP.md`. После публикации проверьте:

```bash
curl https://sait-madmuaziel-niks-final.pages.dev/api/healthz
curl -i -X POST -H "Content-Type: application/json" -d "{}" https://sait-madmuaziel-niks-final.pages.dev/api/mini/session
```

Второй запрос без `initData` должен вернуть `401`, а не создать пользователя. В Telegram откройте бота, нажмите `/start`, затем кнопку Mini App. В кабинете мастера создайте игру, заполните «Теги для уведомлений» и, при необходимости, «Лимит участников в мини‑аппе».

## 5. Поведение уведомлений

Каждый запуск cron идемпотентен: ключ `(telegram_user_id, event_id, occurrence_date, kind)` хранится в `notification_deliveries`, поэтому повторная доставка одной и той же игры не создаёт дубль. Подтверждённые участники получают напоминание независимо от тегов; остальные игроки получают его только при совпадении подписанного тега. Ошибка `403` от Telegram автоматически выключает уведомления для этого профиля.

Сейчас cron отправляет напоминание о сегодняшней игре после 09:00 по `GAME_TIMEZONE` и о завтрашней игре после 18:00. Изменения/отмены, дайджесты и расширенные роли мастера лучше добавлять отдельными итерациями после проверки MVP на тестовом боте.
