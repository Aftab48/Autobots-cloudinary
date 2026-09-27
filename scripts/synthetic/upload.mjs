import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { database, getAsset, storeNotification } from '../../lib/db.mjs';
import { getCloudinary } from '../../lib/cloudinary.mjs';
import { processAsset } from '../../lib/pipeline.mjs';
import { safeError } from '../../lib/pipeline-providers.mjs';
import { output, readShots, readJson, writeJson, sha256 } from './common.mjs';

// Deliberately no generic upload loop or arbitrary input flag: these are the
// only three fixtures authorized for this live check. Cached uploads are reused.
const allowed = ['A-main-before', 'EDGE-01-no-gps', 'EDGE-03-outside-date'];
const stateFile = path.join(output, 'upload-state.json');
const reportFile = path.join(output, 'pipeline-verification.json');
// Observed Cloudinary media_metadata formats GPS seconds to two decimals.
// Permit only half that rounding unit; local EXIF validation stays at 1e-8 degrees.
const gpsToleranceDegrees = 0.005 / 3600 + 1e-9;
const close = (actual, expected) => expected == null ? actual == null : actual != null && Math.abs(actual - expected) <= gpsToleranceDegrees;

async function main() {
  if (process.argv.slice(2).join(' ') !== '--run') throw new Error('Usage: node scripts/synthetic/upload.mjs --run (exactly three core fixtures)');
  process.env.AI_VISION_ENABLED = 'false';
  const { verifyDataset } = await import('./verify.mjs');
  await verifyDataset();
  const dataset = await readShots();
  const prepared = await readJson(path.join(output, 'preparation-report.json'));
  const sql = database(), cloudinary = getCloudinary();
  const preset = await cloudinary.api.upload_preset('ps02_core');
  if (preset.unsigned !== false || ['detection','categorization','auto_tagging','background_removal','moderation','ocr'].some(k => preset.settings?.[k])) throw new Error('ps02_core must be signed and have no add-ons');
  const state = await readJson(stateFile, { project_id: randomUUID(), uploads: {} });
  if (Object.keys(state.uploads).some(id => !allowed.includes(id))) throw new Error('Unexpected fixture in upload state');
  await writeJson(stateFile, state);
  // Keep synthetic fixtures clearly separated from actual field evidence.
  await sql`INSERT INTO projects (id, name, organization, campaign_type, location, start_date, end_date, description, activities)
    VALUES (${state.project_id}, 'SYNTHETIC TEST - River Restoration Kolkata', 'PS02 Synthetic', 'Environmental Restoration', 'Kolkata',
      ${dataset.project.start_date}, ${dataset.project.end_date}, 'Synthetic pipeline test fixtures: riverbank cleanup, waste removal, tree planting, restoration infrastructure and community participation. Not real field evidence.', ${dataset.project.activities})
    ON CONFLICT (id) DO NOTHING`;
  const [{ remaining: visionBefore }] = await sql`SELECT remaining FROM analysis_budget WHERE name = 'ai_vision'`;
  const results = [];
  for (const shotId of allowed) {
    const shot = dataset.shots.find(s => s.id === shotId);
    const item = prepared.files.find(f => f.shot_id === shotId);
    if (!item) throw new Error(`Missing prepared fixture: ${shotId}`);
    const localFile = path.join(output, item.file);
    const bytes = await fs.readFile(localFile);
    const hash = sha256(bytes);
    let stored = state.uploads[shotId];
    if (stored && stored.sha256 !== hash) throw new Error(`Uploaded fixture changed: ${shotId}; no new upload permitted`);
    if (!stored) {
      stored = state.uploads[shotId] = { sha256: hash, public_id: `ps02/synthetic-tests/${state.project_id}/${shotId}`, state: 'started' };
      await writeJson(stateFile, state);
      const response = await cloudinary.uploader.upload(localFile, {
        upload_preset: 'ps02_core', resource_type: 'image', overwrite: false,
        public_id: stored.public_id, asset_folder: `ps02/${state.project_id}`,
        context: { project: state.project_id, ps02_analysis_tier: 'bulk' },
        tags: ['ps02_synthetic', 'synthetic_test_data'],
      });
      stored.response = response;
      stored.state = 'uploaded';
      await writeJson(stateFile, state);
    }
    if (!stored.response) throw new Error(`Ambiguous previous upload for ${shotId}. Inspect remote public_id; do not upload again.`);
    if (!stored.asset_id) {
      stored.asset_id = await storeNotification(stored.response);
      if (!stored.asset_id) throw new Error('Upload could not be associated with synthetic project');
      await writeJson(stateFile, state);
    }
    let asset = await getAsset(stored.asset_id);
    if (asset.analysis_tier !== 'bulk') throw new Error('Synthetic test must remain bulk tier');
    if (asset.pipeline_state !== 'classified') {
      let result = await processAsset(asset.id, { forceLlm: true });
      // A signed webhook may have claimed this same asset. It uses bulk tier;
      // wait for it instead of scheduling a second paid analysis.
      const until = Date.now() + 180000;
      while (result.state === 'busy_or_missing' && Date.now() < until) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        asset = await getAsset(asset.id);
        if (asset.pipeline_state !== 'analyzing') break;
      }
    }
    asset = await getAsset(asset.id);
    const checks = {
      classified: asset.pipeline_state === 'classified',
      capture_source_exif: asset.capture_source === 'exif',
      capture_time: new Date(asset.captured_at).getTime() === new Date(shot.capture_datetime_ist).getTime(),
      latitude: close(asset.lat, shot.gps?.lat), longitude: close(asset.lng, shot.gps?.lng),
      location_source: asset.location_source === (shot.gps ? 'exif' : null),
      status: asset.status.toUpperCase() === shot.expected_pipeline_result.status,
      no_ai_vision: (asset.analysis_attempts ?? []).every(a => a.provider !== 'cloudinary_ai_vision') && asset.analysis_source !== 'cloudinary_ai_vision',
    };
    results.push({ shot_id: shotId, file: item.file, asset_id: asset.id, public_id: stored.public_id,
      expected_status: shot.expected_pipeline_result.status, actual_status: asset.status.toUpperCase(),
      capture_source: asset.capture_source, captured_at: asset.captured_at, lat: asset.lat, lng: asset.lng,
      expected_gps: shot.gps, gps_tolerance_degrees: gpsToleranceDegrees,
      location_source: asset.location_source, status_reason: asset.status_reason, checklist: asset.checklist,
      analysis_source: asset.analysis_source, analysis_attempts: asset.analysis_attempts, exif: asset.exif, checks,
      passed: Object.values(checks).every(Boolean) });
    console.log(JSON.stringify({ shot_id: shotId, status: asset.status, capture_source: asset.capture_source, captured_at: asset.captured_at, lat: asset.lat, lng: asset.lng, checks }));
    await writeJson(reportFile, { project_id: state.project_id, checked_at: new Date().toISOString(), results });
  }
  const [{ remaining: visionAfter }] = await sql`SELECT remaining FROM analysis_budget WHERE name = 'ai_vision'`;
  const report = { project_id: state.project_id, checked_at: new Date().toISOString(),
    upload_count: Object.keys(state.uploads).length,
    gps_precision_note: 'Cloudinary returns DMS with seconds rounded to 0.01 arcsecond; GPS comparisons allow half a rounding unit per coordinate. Original JPEG EXIF matches manifest at 1e-8 degrees.',
    ai_vision_budget_before: visionBefore, ai_vision_budget_after: visionAfter,
    ai_vision_budget_unchanged: visionBefore === visionAfter, results,
    passed: visionBefore === visionAfter && results.every(r => r.passed) };
  await writeJson(reportFile, report);
  if (!report.passed) process.exitCode = 1;
}
async function runLocked() {
  const lockFile = path.join(output, '.upload.lock');
  const lock = await fs.open(lockFile, 'wx').catch(() => { throw new Error('Upload lock exists; check for an active uploader before removing a stale lock'); });
  try { await main(); } finally { await lock.close(); await fs.unlink(lockFile); }
}
runLocked().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
