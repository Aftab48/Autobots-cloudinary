ALTER TABLE assets ADD COLUMN IF NOT EXISTS pipeline_requested_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', now());
ALTER TABLE assets ADD COLUMN IF NOT EXISTS pipeline_completed_at timestamptz;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS pipeline_error jsonb;
UPDATE assets SET pipeline_completed_at = pipeline_requested_at WHERE pipeline_state = 'classified' AND pipeline_completed_at IS NULL;
CREATE INDEX IF NOT EXISTS assets_processing_recovery_idx ON assets(project_id, pipeline_state, pipeline_requested_at);
