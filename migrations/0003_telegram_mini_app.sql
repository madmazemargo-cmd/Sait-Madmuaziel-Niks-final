-- Telegram Mini App identity, subscriptions, RSVPs, and idempotent notifications.
-- Telegram IDs are stored as TEXT because Telegram may exceed JavaScript's safe integer range.

CREATE TABLE IF NOT EXISTS telegram_users (
  telegram_user_id TEXT PRIMARY KEY,
  chat_id TEXT,
  username TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
  notifications_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_users_chat ON telegram_users(chat_id);

CREATE TABLE IF NOT EXISTS telegram_sessions (
  id TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL REFERENCES telegram_users(telegram_user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_telegram_sessions_token ON telegram_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_telegram_sessions_expiry ON telegram_sessions(expires_at);

CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id INTEGER PRIMARY KEY,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_event_tags (
  event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_tags_tag ON calendar_event_tags(tag, event_id);

CREATE TABLE IF NOT EXISTS telegram_tag_subscriptions (
  telegram_user_id TEXT NOT NULL REFERENCES telegram_users(telegram_user_id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (telegram_user_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_telegram_tag_subscriptions_tag
  ON telegram_tag_subscriptions(tag, telegram_user_id);

CREATE TABLE IF NOT EXISTS game_participants (
  event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL,
  telegram_user_id TEXT NOT NULL REFERENCES telegram_users(telegram_user_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'waitlist', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_id, occurrence_date, telegram_user_id)
);

CREATE INDEX IF NOT EXISTS idx_game_participants_occurrence
  ON game_participants(event_id, occurrence_date, status);
CREATE INDEX IF NOT EXISTS idx_game_participants_user
  ON game_participants(telegram_user_id, occurrence_date, status);

CREATE TABLE IF NOT EXISTS calendar_event_mini_settings (
  event_id TEXT PRIMARY KEY REFERENCES calendar_events(id) ON DELETE CASCADE,
  capacity INTEGER,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_mini_settings_capacity
  ON calendar_event_mini_settings(capacity);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  telegram_user_id TEXT NOT NULL REFERENCES telegram_users(telegram_user_id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (telegram_user_id, event_id, occurrence_date, kind)
);
