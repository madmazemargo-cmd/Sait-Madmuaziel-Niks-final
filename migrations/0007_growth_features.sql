CREATE TABLE IF NOT EXISTS application_status_history (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('new', 'contacted', 'confirmed', 'attended', 'repeat_sale')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_application_status_history_application
  ON application_status_history(application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  game TEXT NOT NULL DEFAULT '',
  review_text TEXT NOT NULL,
  rating INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  publication_consent INTEGER NOT NULL DEFAULT 0 CHECK (publication_consent IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_publication
  ON reviews(status, publication_consent, created_at DESC);
