// Explicit fault simulation on ONE previously analyzed pipeline fixture. No new
// uploads or AI requests; outbound model requests are blocked even on regression.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { database, getAsset } from '../../lib/db.mjs';
import { processAsset } from '../../lib/pipeline.mjs';
import { listRecoverableAssets } from '../../lib/pipeline-recovery.mjs';

if (!process.argv.includes('--run')) throw new Error('Pass --run for the cached-fixture recovery check.');
process.loadEnvFile('.env.local');
process.env.AI_VISION_ENABLED = 'false';
const summary = JSON.parse(await fs.readFile('artifacts/pipeline/summary.json', 'utf8'));
const id = summary.assets.find(a => a.role === 'original').id;
const before = await getAsset(id);
const peerId = summary.assets.find(a => a.role === 'near_duplicate').id;
const peerBefore = await getAsset(peerId);
assert.equal(peerBefore.duplicate_of, id);
assert.ok(before.cloudinary_public_id.startsWith('ps02/pipeline-tests/01-original-'));
assert.ok(before.analysis_result && before.analysis_attempts.some(a => a.content));
assert.notEqual(before.pipeline_state, 'analyzing');
let forbiddenRequests = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = String(input?.url ?? input);
  if (url.includes('openrouter.ai') || url.includes('/analyze/ai_vision')) {
    forbiddenRequests++;
    throw new Error('AI requests are forbidden by the recovery check');
  }
  return realFetch(input, options);
};
const sql = database();
let passed = false;
try {
  // A peer's own failed/pending job must not be acknowledged by regrouping.
  await sql`UPDATE assets SET pipeline_state = 'failed',
    pipeline_requested_at = '2001-01-01T00:00:00Z', pipeline_completed_at = '2000-01-01T00:00:00Z',
    pipeline_error = '{"message":"Injected peer outage"}'::jsonb WHERE id = ${peerId}`;
  const reasons = [];
  for (const state of ['uploaded', 'failed', 'classified']) {
    await sql`UPDATE assets SET pipeline_state = ${state},
      pipeline_requested_at = date_trunc('milliseconds', now() - interval '16 minutes'),
      pipeline_completed_at = NULL, metadata_synced_at = NULL WHERE id = ${id}`;
    const found = (await listRecoverableAssets(1000)).find(a => a.id === id);
    assert.ok(found, `Missing recovery entry for ${state}`);
    reasons.push(found.recovery_reason);
  }
  // Simulate death after the provider output was saved, before normalization,
  // plus a legacy/null job timestamp that previously could never be reclaimed.
  await sql`UPDATE assets SET pipeline_state = 'analyzing', processing_started_at = NULL,
    analysis_result = NULL, analysis_source = NULL, analysis_completed_at = NULL WHERE id = ${id}`;
  assert.equal((await listRecoverableAssets(1000)).find(a => a.id === id)?.recovery_reason, 'stale_job');
  const result = await processAsset(id, { forceLlm: true });
  assert.equal(result.state, 'classified', JSON.stringify(result));
  const after = await getAsset(id);
  assert.deepEqual(after.analysis_result, before.analysis_result);
  assert.deepEqual(after.analysis_attempts, before.analysis_attempts);
  assert.equal(after.status, before.status);
  assert.equal(after.status_reason, before.status_reason);
  assert.equal(after.metadata_sync_error, null);
  assert.ok(after.metadata_synced_at);
  const peerAfter = await getAsset(peerId);
  assert.equal(peerAfter.pipeline_state, 'failed');
  assert.deepEqual(peerAfter.pipeline_error, { message: 'Injected peer outage' });
  assert.equal(new Date(peerAfter.pipeline_completed_at).getUTCFullYear(), 2000);
  assert.ok(!(await listRecoverableAssets(1000)).some(a => a.id === id));
  assert.equal(forbiddenRequests, 0);
  passed = true;
  await fs.mkdir('artifacts/security-review', { recursive: true });
  await fs.writeFile('artifacts/security-review/recovery-check.json', JSON.stringify({
    checked_at: new Date().toISOString(), asset_id: id, discovered_states: reasons.concat('stale_job'),
    normalized_output_restored: true, cached_attempts_unchanged: true, manual_review_preserved: true,
    metadata_synced: true, peer_job_not_acknowledged_by_regrouping: true, ai_requests: 0,
  }, null, 2) + '\n');
  console.log('Recovery discovery and rerun passed: saved analysis restored, manual decision preserved, zero AI requests.');
} finally {
  globalThis.fetch = realFetch;
  await sql`UPDATE assets SET pipeline_state = ${peerBefore.pipeline_state},
    pipeline_requested_at = ${peerBefore.pipeline_requested_at}, pipeline_completed_at = ${peerBefore.pipeline_completed_at},
    pipeline_error = ${JSON.stringify(peerBefore.pipeline_error)}::jsonb WHERE id = ${peerId}`;
  if (!passed) {
    // Restore only the controlled fixture fields changed by this test.
    await sql`UPDATE assets SET pipeline_state = ${before.pipeline_state}, processing_started_at = ${before.processing_started_at},
      pipeline_requested_at = ${before.pipeline_requested_at}, pipeline_completed_at = ${before.pipeline_completed_at},
      pipeline_error = ${JSON.stringify(before.pipeline_error)}::jsonb,
      analysis_result = ${JSON.stringify(before.analysis_result)}::jsonb, analysis_source = ${before.analysis_source},
      analysis_completed_at = ${before.analysis_completed_at}, analysis_error = ${JSON.stringify(before.analysis_error)}::jsonb,
      analysis_attempts = ${JSON.stringify(before.analysis_attempts)}::jsonb,
      metadata_synced_at = ${before.metadata_synced_at}, metadata_sync_error = ${before.metadata_sync_error}
      WHERE id = ${id}`;
  }
}
