ALTER TABLE assets ADD COLUMN IF NOT EXISTS manual_site_reviewed_at timestamptz;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS duplicate_checked_at timestamptz;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS checklist_reasons jsonb;
ALTER TABLE review_events ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'status';
ALTER TABLE review_events ADD COLUMN IF NOT EXISTS from_site_id uuid REFERENCES sites(id);
ALTER TABLE review_events ADD COLUMN IF NOT EXISTS to_site_id uuid REFERENCES sites(id);
