ALTER TABLE assets ADD COLUMN IF NOT EXISTS location_source text CHECK (location_source IN ('capture_page','exif','user'));
ALTER TABLE assets ADD COLUMN IF NOT EXISTS analysis_tier text NOT NULL DEFAULT 'bulk' CHECK (analysis_tier IN ('bulk','showcase','demo'));
ALTER TABLE assets ADD COLUMN IF NOT EXISTS analysis_result jsonb;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS analysis_attempts jsonb NOT NULL DEFAULT '[]';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS analysis_error jsonb;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS analysis_started_at timestamptz;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS analysis_completed_at timestamptz;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS metadata_synced_at timestamptz;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS metadata_sync_error text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS manual_reviewed_at timestamptz;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS frame_offset double precision;
COMMENT ON COLUMN assets.quality_score IS 'Cloudinary quality_analysis.focus, not an AI confidence score';
UPDATE assets SET quality_score = (raw_cloudinary #>> '{quality_analysis,focus}')::double precision WHERE jsonb_typeof(raw_cloudinary #> '{quality_analysis,focus}') = 'number';
CREATE TABLE IF NOT EXISTS analysis_budget (name text PRIMARY KEY, remaining integer NOT NULL CHECK (remaining >= 0), measured_at timestamptz NOT NULL DEFAULT now());
INSERT INTO analysis_budget (name, remaining) VALUES ('ai_vision', 84172) ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS assets_review_idx ON assets(project_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS assets_video_frame_idx ON assets(parent_asset_id, frame_offset) WHERE parent_asset_id IS NOT NULL;
UPDATE assets SET analysis_result = jsonb_build_object(
  'caption', btrim(caption), 'activity', activity, 'relevant_to_project', relevant,
  'category', category, 'signals', to_jsonb(signals), 'reason', btrim(reason), 'analysis_source', analysis_source),
  analysis_completed_at = COALESCE(analysis_completed_at, now())
WHERE analysis_result IS NULL AND analysis_source IS NOT NULL
  AND length(btrim(caption)) BETWEEN 1 AND 500 AND length(btrim(reason)) BETWEEN 1 AND 700
  AND activity IN ('river_cleanup','waste_removal','tree_plantation','infrastructure','community_participation','other')
  AND category = CASE activity WHEN 'infrastructure' THEN 'infrastructure' WHEN 'community_participation' THEN 'community_activity' WHEN 'other' THEN 'other' ELSE 'environmental_activity' END
  AND signals <@ ARRAY['people_present','crowd','water_body','waste_visible','cleanup_tools','vegetation','infrastructure','bare_soil','equipment','saplings']::text[]
  AND cardinality(signals) <= 10 AND array_position(signals, NULL) IS NULL
  AND cardinality(signals) = (SELECT count(DISTINCT signal) FROM unnest(signals) AS signal);
UPDATE assets SET analysis_completed_at = COALESCE(analysis_completed_at, now()),
  analysis_error = '{"message":"Legacy stored analysis is invalid, manual review required without re-analysis"}'::jsonb,
  status = CASE WHEN manual_reviewed_at IS NULL THEN 'review' ELSE status END,
  status_reason = CASE WHEN manual_reviewed_at IS NULL THEN 'Legacy stored analysis needs human review' ELSE status_reason END
WHERE analysis_source IS NOT NULL AND analysis_result IS NULL;
