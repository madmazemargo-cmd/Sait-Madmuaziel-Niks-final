ALTER TABLE calendar_events ADD COLUMN catalog_item_id TEXT;

CREATE INDEX IF NOT EXISTS idx_calendar_events_catalog_item
  ON calendar_events (catalog_item_id);
