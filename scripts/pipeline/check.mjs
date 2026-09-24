import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { database, getAsset, storeNotification } from '../../lib/db.mjs';
import { getCloudinary } from '../../lib/cloudinary.mjs';
import { processAsset } from '../../lib/pipeline.mjs';

if (!process.argv.includes('--run')) throw new Error('Live check requires --run; it uses only the four cached pipeline fixtures.');
process.loadEnvFile('.env.local');
process.env.AI_VISION_ENABLED = 'false';
const fixtures = JSON.parse(await fs.readFile('artifacts/pipeline/fixtures.json', 'utf8'));
assert.deepEqual(fixtures.map(f => f.role), ['original', 'exact_duplicate', 'near_duplicate', 'heavy_blur']);
const sql = database(), cld = getCloudinary();
const [{ remaining: visionBefore }] = await sql`SELECT remaining FROM analysis_budget WHERE name = 'ai_vision'`;
// Store the complete family before processing so duplicate/blur hard failures cost no LLM call.
for (const fixture of fixtures) {
  fixture.id = await storeNotification(fixture.response);
  assert.ok(fixture.id);
  const a = await getAsset(fixture.id);
  assert.equal(a.analysis_tier, 'bulk');
  assert.equal(a.quality_score, fixture.response.quality_analysis.focus);
}
const before = await sql`SELECT id, analysis_attempts FROM assets WHERE id = ANY(${fixtures.map(f => f.id)}::uuid[])`;
for (const fixture of fixtures) {
  const result = await processAsset(fixture.id, { forceLlm: true });
  assert.equal(result.state, 'classified', JSON.stringify(result));
  console.log(`${fixture.role}: ${result.asset.status} — ${result.asset.status_reason}`);
}
const assets = await Promise.all(fixtures.map(f => getAsset(f.id)));
const [original, exact, near, blur] = assets;
assert.equal(original.status, 'review');
assert.equal(original.checklist.has_location, false);
assert.equal(original.analysis_source, 'llm_fallback');
assert.equal(original.analysis_result.relevant_to_project, true);
assert.equal(original.duplicate_of, null);
assert.equal(exact.duplicate_of, original.id);
assert.equal(near.duplicate_of, original.id);
assert.equal(exact.status, 'rejected');
assert.equal(near.status, 'rejected');
assert.equal(blur.status, 'rejected');
assert.match(blur.status_reason, /blurry/i);
for (const asset of assets) {
  assert.ok(asset.analysis_attempts.every(a => a.provider === 'llm_fallback'));
  assert.equal(asset.metadata_sync_error, null);
  const remote = await cld.api.resource(asset.cloudinary_public_id, { resource_type: 'image', metadata: true });
  assert.equal(remote.metadata.project, asset.project_id);
  assert.equal(remote.metadata.review_status, asset.status);
  assert.equal(remote.metadata.activity, asset.activity ?? 'other');
}
// Reprocess the same assets to verify persisted analysis is reused, with no new provider attempts.
for (const asset of assets) await processAsset(asset.id, { forceLlm: true });
const repeated = await Promise.all(fixtures.map(f => getAsset(f.id)));
for (let i = 0; i < assets.length; i++) assert.deepEqual(repeated[i].analysis_attempts, assets[i].analysis_attempts);
const [{ remaining: visionAfter }] = await sql`SELECT remaining FROM analysis_budget WHERE name = 'ai_vision'`;
assert.equal(visionAfter, visionBefore);
const summary = {
  checked_at: new Date().toISOString(), vision_tokens: 0, vision_budget_before: visionBefore, vision_budget_after: visionAfter,
  new_llm_attempts: assets.reduce((sum, a) => sum + a.analysis_attempts.length - before.find(b => b.id === a.id).analysis_attempts.length, 0),
  cache_reuse_verified: true, cloudinary_metadata_verified: true,
  assets: fixtures.map((f, i) => ({ role: f.role, file: f.file, id: f.id,
    cloudinary_public_id: assets[i].cloudinary_public_id, delivery_url: f.response.secure_url,
    focus: assets[i].quality_score, phash: assets[i].phash, duplicate_of: assets[i].duplicate_of,
    status: assets[i].status, status_reason: assets[i].status_reason, checklist: assets[i].checklist,
    analysis_source: assets[i].analysis_source, attempts: assets[i].analysis_attempts,
  })),
};
await fs.writeFile('artifacts/pipeline/summary.json', JSON.stringify(summary, null, 2) + '\n');
console.log(`All three stop conditions passed. ${summary.new_llm_attempts} new LLM attempt(s), zero AI Vision tokens.`);
