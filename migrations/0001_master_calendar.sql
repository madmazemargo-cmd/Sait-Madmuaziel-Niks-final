CREATE TABLE IF NOT EXISTS master_users (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 310000,
  role TEXT NOT NULL DEFAULT 'master' CHECK (role IN ('master', 'admin')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS master_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES master_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_master_sessions_token ON master_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_master_sessions_expiry ON master_sessions(expires_at);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'available',
  seats INTEGER,
  description TEXT NOT NULL DEFAULT '',
  system TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  experience TEXT NOT NULL DEFAULT '',
  age TEXT NOT NULL DEFAULT '',
  player_prep TEXT NOT NULL DEFAULT '',
  recurrence TEXT NOT NULL DEFAULT 'none',
  recurrence_until TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(event_date, sort_order);

CREATE TABLE IF NOT EXISTS calendar_event_exclusions (
  event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, occurrence_date)
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE,
  event_id TEXT,
  occurrence_date TEXT,
  event_revision TEXT,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  players INTEGER NOT NULL,
  format TEXT NOT NULL DEFAULT '',
  place TEXT NOT NULL DEFAULT '',
  experience TEXT NOT NULL DEFAULT '',
  system TEXT NOT NULL DEFAULT '',
  genres TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT '',
  wishes TEXT NOT NULL DEFAULT '',
  schedule TEXT NOT NULL DEFAULT '',
  boundaries TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_applications_created ON applications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status, created_at DESC);
