import { database, getAsset, storeNotification } from './db.mjs';
import { getCloudinary, assetFolder, projectId } from './cloudinary.mjs';
import { analysisSchema, validateFallback } from './analysis-prompts.mjs';
import { callLlm, callVision, safeError } from './pipeline-providers.mjs';
import { chooseAnalysisPath, restoreLegacyAnalysis, restoreRecordedAnalysis, framesNeedReview, resolveCapture, trustDecision, validateProjectActivity, QUALITY, VISION_RESERVATION } from './pipeline-rules.mjs';

// The public upload signature never accepts analysis_tier. Showcase/demo is a
// server-owned designation from the signed preset marker or the one-asset CLI,
// never inferred from image text or arbitrary widget context.
export async function mirrorAsset(id, retries = 2) {
  const sql = database(), asset = await getAsset(id);
  if (!asset) return null;
  try {
    await getCloudinary().uploader.update_metadata({ project: asset.project_id, site: asset.site_id ?? '', activity: asset.activity ?? 'other', review_status: asset.status }, [asset.cloudinary_public_id], { resource_type: asset.resource_type });
    const latest = await getAsset(id);
    if (['site_id', 'activity', 'status'].some(key => latest[key] !== asset[key])) {
      if (retries > 0) return mirrorAsset(id, retries - 1);
      throw new Error('Asset changed during metadata sync; mirror needs retry');
    }
    await sql`UPDATE assets SET metadata_synced_at = now(), metadata_sync_error = NULL WHERE id = ${id}`;
    return true;
  } catch (error) {
    await sql`UPDATE assets SET metadata_sync_error = ${safeError(error).message} WHERE id = ${id}`;
    return false;
  }
}

// Serialize grouping per project. The recursive statement takes a fresh READ
// COMMITTED snapshot AFTER acquiring the lock, avoiding stale canonical updates.
export async function groupDuplicates(id) {
  const sql = database();
  const grouped = sql`WITH RECURSIVE family(id) AS (
    SELECT id FROM assets WHERE id = ${id} AND project_id = ${projectId}
    UNION
    SELECT b.id FROM family f JOIN assets a ON a.id = f.id JOIN assets b ON b.project_id = a.project_id
      AND b.resource_type = a.resource_type AND b.parent_asset_id IS NOT DISTINCT FROM a.parent_asset_id
      AND (b.id = a.id OR (a.etag IS NOT NULL AND a.etag <> '' AND a.etag = b.etag)
        OR CASE WHEN a.phash ~ '^[a-fA-F0-9]{16}$' AND b.phash ~ '^[a-fA-F0-9]{16}$'
          THEN bit_count(('x' || a.phash)::bit(64) # ('x' || b.phash)::bit(64)) <= 6 ELSE false END)
  ), canonical AS (
    SELECT a.id FROM assets a JOIN family f ON f.id = a.id
    ORDER BY CASE WHEN quality_score >= ${QUALITY.reviewFocus} THEN 2 WHEN quality_score >= ${QUALITY.rejectFocus} THEN 1 ELSE 0 END DESC,
      (width::bigint * height::bigint) DESC NULLS LAST, quality_score DESC NULLS LAST,
      captured_at ASC NULLS LAST, created_at ASC, a.id ASC LIMIT 1
  ) UPDATE assets a SET duplicate_of = CASE WHEN a.id = c.id THEN NULL ELSE c.id END
    FROM family f CROSS JOIN canonical c WHERE a.id = f.id RETURNING a.id`;
  const results = await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`, grouped,
  ], { isolationLevel: 'ReadCommitted' });
  return results[1];
}

async function classify(id, project, claim = null) {
  const sql = database(), asset = await getAsset(id);
  // Always derive video usability from stored children, including regrouped peers.
  const frameFailure = asset.resource_type === 'video' && framesNeedReview(await sql`SELECT checklist, analysis_result FROM assets WHERE parent_asset_id = ${id}`);
  const decision = trustDecision(asset, project, { frameFailure });
  await sql`UPDATE assets SET checklist = ${JSON.stringify(decision.checklist)}::jsonb,
    status = CASE WHEN manual_reviewed_at IS NULL THEN ${decision.status} ELSE status END,
    status_reason = CASE WHEN manual_reviewed_at IS NULL THEN ${decision.status_reason} ELSE status_reason END,
    pipeline_state = CASE WHEN ${claim !== null} THEN 'classified' ELSE pipeline_state END,
    pipeline_error = CASE WHEN ${claim !== null} THEN NULL ELSE pipeline_error END,
    pipeline_completed_at = CASE WHEN ${claim !== null} THEN ${claim?.pipeline_requested_at ?? null}::timestamptz ELSE pipeline_completed_at END
    WHERE id = ${id} AND (
      (${claim !== null} AND processing_started_at = ${claim?.processing_started_at ?? null})
      OR (${claim === null} AND pipeline_state <> 'analyzing'
        AND (pipeline_state <> 'uploaded' OR ${decision.status} = 'rejected'))
    )`;
  return decision;
}

async function beginAttempt(id, provider, attempt, sql = database()) {
  const rows = await sql`UPDATE assets SET analysis_started_at = COALESCE(analysis_started_at, now()),
    analysis_attempts = analysis_attempts || jsonb_build_array(jsonb_build_object('provider', ${provider}::text, 'attempt', ${attempt}::integer, 'state', 'started', 'at', now()))
    WHERE id = ${id} AND analysis_result IS NULL AND analysis_completed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(analysis_attempts) e WHERE e->>'provider' = ${provider} AND (e->>'attempt')::integer = ${attempt})
    RETURNING id`;
  if (!rows.length) throw new Error('Stored or ambiguous prior analysis attempt; not re-calling provider');
}
async function endAttempt(id, provider, attempt, data, sql = database()) {
  await sql`UPDATE assets SET analysis_attempts = (SELECT jsonb_agg(CASE WHEN e->>'provider' = ${provider} AND (e->>'attempt')::integer = ${attempt} THEN e || ${JSON.stringify(data)}::jsonb ELSE e END) FROM jsonb_array_elements(analysis_attempts) e) WHERE id = ${id}`;
}
async function saveAnalysis(id, analysis, sql = database()) {
  analysisSchema.parse(analysis);
  await sql`UPDATE assets SET analysis_result = ${JSON.stringify(analysis)}::jsonb,
    caption = ${analysis.caption}, activity = ${analysis.activity}, relevant = ${analysis.relevant_to_project}, category = ${analysis.category},
    signals = ${analysis.signals}, reason = ${analysis.reason}, analysis_source = ${analysis.analysis_source}, analysis_completed_at = now()
    WHERE id = ${id} AND analysis_result IS NULL`;
}
// Dependencies are injectable for fault tests; production always uses the real
// database/providers. Persistence failures must escape, never trigger paid retries.
export async function analyze(asset, project, forceLlm, { sql = database(), runLlm = callLlm, runVision = callVision } = {}) {
  if (asset.analysis_result) return;
  if (!asset.analysis_result && asset.analysis_source) {
    const legacy = restoreLegacyAnalysis(asset);
    if (legacy.analysis) await saveAnalysis(asset.id, legacy.analysis, sql);
    else await sql`UPDATE assets SET analysis_error = ${JSON.stringify({ message: legacy.error })}::jsonb, analysis_completed_at = COALESCE(analysis_completed_at, now()) WHERE id = ${asset.id}`;
    return;
  }
  const recovered = restoreRecordedAnalysis(asset, project);
  if (recovered) {
    await saveAnalysis(asset.id, recovered, sql);
    await sql`UPDATE assets SET analysis_error = NULL WHERE id = ${asset.id}`;
    return;
  }
  if (asset.analysis_completed_at) return;
  // An interrupted attempt is reviewable, never silently re-spent.
  if (asset.analysis_attempts.length) {
    await sql`UPDATE assets SET analysis_error = ${JSON.stringify({ message: 'Prior analysis attempt exists without a stored result; manual inspection required' })}::jsonb, analysis_completed_at = now() WHERE id = ${asset.id}`;
    return;
  }
  const [budget] = await sql`SELECT remaining FROM analysis_budget WHERE name = 'ai_vision'`;
  let path = chooseAnalysisPath(asset, { forceLlm, enabled: process.env.AI_VISION_ENABLED === 'true', remaining: budget?.remaining ?? 0 });
  if (path === 'cloudinary_ai_vision') {
    const reserved = await sql`UPDATE analysis_budget SET remaining = remaining - ${VISION_RESERVATION} WHERE name = 'ai_vision' AND remaining >= ${VISION_RESERVATION} RETURNING remaining`;
    if (!reserved.length) path = 'llm_fallback';
  }
  const errors = [];
  if (path === 'cloudinary_ai_vision') {
    await beginAttempt(asset.id, path, 0, sql);
    let response;
    try { response = await runVision(asset, project); }
    catch (error) {
      errors.push({ provider: path, ...safeError(error) });
      await endAttempt(asset.id, path, 0, { state: 'failed', error: safeError(error) }, sql);
      if (error.response) await sql`UPDATE assets SET ai_vision_raw = ${JSON.stringify(safeError(error).response)}::jsonb WHERE id = ${asset.id}`;
      if ([400, 403, 429].includes(error.status)) await sql`UPDATE analysis_budget SET remaining = 0 WHERE name = 'ai_vision'`;
    }
    if (response) {
      // Save raw output before validation, so recovery can normalize it for free.
      await sql`UPDATE assets SET ai_vision_raw = ${JSON.stringify(response.raw)}::jsonb WHERE id = ${asset.id}`;
      const usage = response.raw.limits?.addons_quota?.find(q => q.type === 'ai_vision');
      if (Number.isFinite(usage?.used_by_request)) await sql`UPDATE analysis_budget SET remaining = GREATEST(0, LEAST(remaining + ${VISION_RESERVATION} - ${usage.used_by_request}, ${Number.isFinite(usage.remaining) ? usage.remaining : 100000})), measured_at = now() WHERE name = 'ai_vision'`;
      let normalized;
      try { normalized = validateProjectActivity(response.normalize(), project); }
      catch (error) {
        errors.push({ provider: path, ...safeError(error) });
        await endAttempt(asset.id, path, 0, { state: 'invalid', usage, error: safeError(error) }, sql);
      }
      if (normalized) {
        await endAttempt(asset.id, path, 0, { state: 'completed', usage }, sql);
        await saveAnalysis(asset.id, normalized, sql);
        return;
      }
    }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    await beginAttempt(asset.id, 'llm_fallback', attempt, sql);
    let response;
    try { response = await runLlm(asset, project, attempt); }
    catch (error) {
      errors.push({ provider: 'llm_fallback', ...safeError(error) });
      await endAttempt(asset.id, 'llm_fallback', attempt, { state: 'failed', error: safeError(error) }, sql);
      break;
    }
    await endAttempt(asset.id, 'llm_fallback', attempt, { state: 'returned', usage: response.usage, content: response.content }, sql);
    let normalized;
    try { normalized = validateProjectActivity(validateFallback(response.content), project); }
    catch (error) {
      errors.push({ provider: 'llm_fallback', ...safeError(error) });
      await endAttempt(asset.id, 'llm_fallback', attempt, { state: 'invalid', usage: response.usage, content: response.content, error: safeError(error) }, sql);
      continue; // Only validation failures authorize another paid attempt.
    }
    await endAttempt(asset.id, 'llm_fallback', attempt, { state: 'completed' }, sql);
    await saveAnalysis(asset.id, normalized, sql);
    break;
  }
  await sql`UPDATE assets SET analysis_completed_at = COALESCE(analysis_completed_at, now()), analysis_error = ${errors.length ? JSON.stringify(errors) : null}::jsonb WHERE id = ${asset.id}`;
}

async function videoFrames(asset, forceLlm) {
  const sql = database(), cloudinary = getCloudinary(), duration = Number(asset.raw_cloudinary.duration);
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const frames = [];
  for (const fraction of [0.1, 0.5, 0.9]) {
    const offset = Math.round(duration * fraction * 1000) / 1000;
    let [frame] = await sql`SELECT * FROM assets WHERE parent_asset_id = ${asset.id} AND frame_offset = ${offset}`;
    if (!frame) {
      const source = cloudinary.url(asset.cloudinary_public_id, { resource_type: 'video', version: asset.version, start_offset: offset, format: 'jpg', secure: true });
      const uploaded = await cloudinary.uploader.upload(source, { upload_preset: 'ps02_core', public_id: `${asset.cloudinary_public_id}-frame-${offset}`, asset_folder: assetFolder, overwrite: false, context: { source_asset_id: asset.id, source_url: source, frame_offset: String(offset) } });
      const id = await storeNotification(uploaded);
      await sql`UPDATE assets SET parent_asset_id = ${asset.id}, frame_offset = ${offset}, analysis_tier = 'bulk' WHERE id = ${id}`;
      frame = await getAsset(id);
    }
    await processAsset(frame.id, { forceLlm });
    frames.push(await getAsset(frame.id));
  }
  return frames;
}

export async function processAsset(id, { forceLlm = false } = {}) {
  const sql = database();
  const [claimed] = await sql`UPDATE assets SET pipeline_state = 'analyzing', processing_started_at = date_trunc('milliseconds', clock_timestamp()), pipeline_error = NULL WHERE id = ${id} AND project_id = ${projectId}
    AND (pipeline_state <> 'analyzing' OR processing_started_at IS NULL OR processing_started_at < now() - interval '15 minutes') RETURNING *`;
  if (!claimed) return { state: 'busy_or_missing' };
  try {
    const [project] = await sql`SELECT * FROM projects WHERE id = ${claimed.project_id}`;
    const sites = await sql`SELECT * FROM sites WHERE project_id = ${claimed.project_id}`;
    const parent = claimed.parent_asset_id ? await getAsset(claimed.parent_asset_id) : null;
    const capture = parent ? { captured_at: parent.captured_at, capture_source: parent.capture_source, lat: parent.lat, lng: parent.lng, location_source: parent.location_source, site_id: parent.site_id } : resolveCapture(claimed, sites);
    await sql`UPDATE assets SET captured_at = ${capture.captured_at}, capture_source = ${capture.capture_source}, lat = ${capture.lat}, lng = ${capture.lng}, location_source = ${capture.location_source}, site_id = ${capture.site_id} WHERE id = ${id}`;
    await groupDuplicates(id);
    const resolved = await getAsset(id);
    const alreadyRejected = trustDecision(resolved, project).status === 'rejected';
    if (!alreadyRejected && claimed.resource_type === 'video') {
      const cached = chooseAnalysisPath(resolved) === 'cached';
      const frames = cached ? await sql`SELECT * FROM assets WHERE parent_asset_id = ${id} ORDER BY frame_offset` : await videoFrames(claimed, forceLlm);
      if (frames.length === 3 && frames.every(f => typeof f.quality_score === 'number')) await sql`UPDATE assets SET quality_score = ${Math.min(...frames.map(f => f.quality_score))} WHERE id = ${id}`;
      const representative = frames.find(f => f.analysis_result && f.checklist?.sharp_enough) ?? frames.find(f => f.analysis_result);
      if (cached && !resolved.analysis_result && resolved.analysis_source) await analyze(resolved, project, forceLlm);
      else if (!cached && representative) await saveAnalysis(id, representative.analysis_result);
    } else if (!alreadyRejected) await analyze(resolved, project, forceLlm);
    const family = await groupDuplicates(id);
    for (const member of family) {
      // Do not classify an unrelated in-flight family member before its analysis.
      const current = await getAsset(member.id);
      if (member.id !== id && current.pipeline_state === 'analyzing') continue;
      await classify(member.id, project, member.id === id ? claimed : null);
      await mirrorAsset(member.id);
    }
    return { state: 'classified', asset: await getAsset(id) };
  } catch (error) {
    const clean = safeError(error);
    await sql`UPDATE assets SET pipeline_state = 'failed', status = CASE WHEN manual_reviewed_at IS NULL THEN 'review' ELSE status END,
      status_reason = CASE WHEN manual_reviewed_at IS NULL THEN 'Pipeline failed; human review required' ELSE status_reason END,
      pipeline_error = ${JSON.stringify(clean)}::jsonb WHERE id = ${id} AND processing_started_at = ${claimed.processing_started_at}`;
    return { state: 'failed', error: clean };
  }
}

export async function reviewAsset(id, { status, reviewer, note }) {
  if (!['processing', 'accepted', 'review', 'rejected'].includes(status)) throw new Error('Invalid review status');
  if (typeof reviewer !== 'string' || !reviewer.trim() || reviewer.trim().length > 100) throw new Error('Reviewer must contain 1–100 characters');
  if (typeof note !== 'string' || !note.trim() || note.trim().length > 2000) throw new Error('Review note must contain 1–2000 characters');
  const sql = database();
  const rows = await sql`WITH prior AS (SELECT * FROM assets WHERE id = ${id} AND project_id = ${projectId} FOR UPDATE),
    changed AS (UPDATE assets a SET status = ${status}, status_reason = ${note.trim()}, manual_reviewed_at = now() FROM prior p WHERE a.id = p.id RETURNING a.id, p.status AS from_status),
    logged AS (INSERT INTO review_events (asset_id, reviewer, from_status, to_status, note) SELECT id, ${reviewer.trim()}, from_status, ${status}, ${note.trim()} FROM changed RETURNING id)
    SELECT * FROM logged`;
  if (!rows.length) return null;
  await mirrorAsset(id);
  return getAsset(id);
}
