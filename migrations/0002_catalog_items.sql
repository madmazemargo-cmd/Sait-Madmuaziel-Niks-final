CREATE TABLE IF NOT EXISTS catalog_items (
  id TEXT PRIMARY KEY,
  system_key TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  age TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  game_type TEXT NOT NULL DEFAULT 'oneshot' CHECK (game_type IN ('campaign', 'oneshot')),
  status TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_items_public
  ON catalog_items (published, sort_order, updated_at);

-- The production database already has catalog records from the earlier
-- calendar service. Keep those records visible after switching the API to
-- the revisioned catalog table; the source table remains untouched.
CREATE TABLE IF NOT EXISTS game_catalog_items (
  id TEXT PRIMARY KEY NOT NULL,
  game_type TEXT NOT NULL CHECK (game_type IN ('campaign', 'oneshot')),
  system_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO catalog_items (
  id, system_key, title, description, image_url, age, format, price,
  game_type, status, sort_order, published, revision, created_at, updated_at
)
SELECT
  id, system_key, title, description, image_url, '', format, price,
  game_type, status, sort_order, published, 1, created_at, updated_at
FROM game_catalog_items;
