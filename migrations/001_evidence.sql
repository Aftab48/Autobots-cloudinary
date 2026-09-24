CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  organization text, campaign_type text, location text, start_date date, end_date date,
  description text, activities text[] NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id),
  name text NOT NULL, lat double precision, lng double precision
);
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id),
  site_id uuid REFERENCES sites(id), cloudinary_asset_id text NOT NULL UNIQUE,
  cloudinary_public_id text NOT NULL, version bigint, resource_type text NOT NULL CHECK (resource_type IN ('image','video')),
  parent_asset_id uuid REFERENCES assets(id), width integer, height integer, bytes bigint, format text,
  captured_at timestamptz, capture_source text CHECK (capture_source IN ('capture_page','exif','user','upload_time')),
  lat double precision, lng double precision, exif jsonb, quality_score double precision,
  etag text, phash text, duplicate_of uuid REFERENCES assets(id),
  cld_tags text[] NOT NULL DEFAULT '{}', cld_caption text,
  caption text, activity text, category text, relevant boolean, signals text[] NOT NULL DEFAULT '{}', reason text,
  analysis_source text CHECK (analysis_source IN ('cloudinary_ai_vision','llm_fallback')), ai_vision_raw jsonb,
  checklist jsonb, pipeline_state text NOT NULL DEFAULT 'uploaded' CHECK (pipeline_state IN ('uploaded','analyzing','classified','failed')),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','accepted','review','rejected')), status_reason text,
  raw_cloudinary jsonb NOT NULL DEFAULT '{}', cloudinary_events jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_project_created_idx ON assets(project_id, created_at DESC);
CREATE TABLE IF NOT EXISTS review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), asset_id uuid NOT NULL REFERENCES assets(id),
  reviewer text NOT NULL, from_status text NOT NULL, to_status text NOT NULL, note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id),
  site_id uuid REFERENCES sites(id), before_asset_id uuid NOT NULL REFERENCES assets(id),
  after_asset_id uuid NOT NULL REFERENCES assets(id), composite_url text, changes jsonb, answers jsonb,
  analysis_source text CHECK (analysis_source IN ('cloudinary_ai_vision','llm_fallback')),
  created_at timestamptz NOT NULL DEFAULT now(), CHECK (before_asset_id <> after_asset_id)
);
CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES projects(id),
  period_start date, period_end date, stats jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES reports(id),
  text text NOT NULL, position integer NOT NULL
);
CREATE TABLE IF NOT EXISTS claim_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), claim_id uuid NOT NULL REFERENCES claims(id),
  asset_id uuid REFERENCES assets(id), comparison_id uuid REFERENCES comparisons(id), derived_url text,
  CHECK (num_nonnulls(asset_id, comparison_id) = 1)
);
INSERT INTO projects (id, name, organization, description)
VALUES ('00000000-0000-4000-8000-000000000002', 'Evidence ingestion', 'PS02', 'Step 2 upload and raw evidence verification. API fixtures are not campaign evidence.')
ON CONFLICT (id) DO NOTHING;
