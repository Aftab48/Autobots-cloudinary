import { database } from './db.mjs';

export const STALE_MINUTES = 15;

// Read only: discovery never calls a provider or automatically loops over assets.
export async function listRecoverableAssets(limit = 100, projectId = null) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Limit must be an integer from 1 to 1000');
  return database()`WITH candidates AS (
    SELECT id, project_id, status, pipeline_state, created_at, processing_started_at, pipeline_requested_at,
      analysis_source, jsonb_array_length(analysis_attempts) AS recorded_attempts,
      CASE
        WHEN pipeline_state = 'analyzing' AND COALESCE(processing_started_at, pipeline_requested_at, created_at) < now() - interval '15 minutes' THEN 'stale_job'
        WHEN pipeline_state = 'analyzing' THEN NULL
        WHEN pipeline_state = 'failed' THEN 'failed_job'
        WHEN metadata_sync_error IS NOT NULL THEN 'metadata_sync_failed'
        WHEN pipeline_state = 'classified' AND metadata_synced_at IS NULL THEN 'metadata_sync_pending'
        WHEN pipeline_requested_at > COALESCE(pipeline_completed_at, '-infinity'::timestamptz)
          AND pipeline_requested_at < now() - interval '15 minutes' THEN 'pending_job'
        WHEN pipeline_state = 'uploaded' AND created_at < now() - interval '15 minutes' THEN 'never_started'
        WHEN pipeline_state = 'classified' AND status <> 'rejected' AND analysis_result IS NULL
          AND analysis_completed_at IS NULL AND analysis_source IS NULL THEN 'analysis_unfinished'
        ELSE NULL
      END AS recovery_reason
    FROM assets WHERE (${projectId}::uuid IS NULL OR project_id = ${projectId}::uuid)
  ) SELECT * FROM candidates WHERE recovery_reason IS NOT NULL ORDER BY created_at ASC, id ASC LIMIT ${limit}`;
}
