ALTER TABLE catalog_items
  ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'published'
  CHECK (publication_status IN ('draft', 'published', 'archived'));

UPDATE catalog_items
SET publication_status = CASE WHEN published = 1 THEN 'published' ELSE 'draft' END;

CREATE INDEX IF NOT EXISTS idx_catalog_items_public_status
  ON catalog_items (publication_status, sort_order, updated_at);

ALTER TABLE applications ADD COLUMN utm_source TEXT;
ALTER TABLE applications ADD COLUMN utm_medium TEXT;
ALTER TABLE applications ADD COLUMN utm_campaign TEXT;
ALTER TABLE applications ADD COLUMN utm_content TEXT;
ALTER TABLE applications ADD COLUMN utm_term TEXT;
