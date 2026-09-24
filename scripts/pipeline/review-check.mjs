import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { getAsset, listReviewEvents } from '../../lib/db.mjs';
import { getCloudinary } from '../../lib/cloudinary.mjs';

process.loadEnvFile('.env.local');
if (!process.argv.includes('--run')) throw new Error('Pass --run for the bounded review API check (no AI calls).');
const base = 'http://localhost:3000';
const summary = JSON.parse(await fs.readFile('artifacts/pipeline/summary.json', 'utf8'));
const original = summary.assets.find(a => a.role === 'original');
const before = await getAsset(original.id);
assert.equal(before.status, 'review');
const history = await listReviewEvents(original.id);
const post = (body, origin = base) => fetch(`${base}/api/assets/${original.id}/review`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
});
assert.equal((await post({ status: 'accepted', reviewer: '', note: '' })).status, 400);
assert.equal((await post({ status: 'accepted', reviewer: 'Pipeline check', note: 'Blocked cross-origin request' }, 'https://unrelated.invalid')).status, 403);
assert.equal((await listReviewEvents(original.id)).length, history.length);
for (const status of ['accepted', 'review']) {
  const r = await post({ status, reviewer: 'Pipeline integration check', note: status === 'accepted'
    ? 'Temporary approval to verify ReviewEvent logging; this fixture is not campaign evidence.'
    : 'Returned to REVIEW: no GPS or site, and project date bounds are not configured.' });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).metadataPending, false);
}
const events = await listReviewEvents(original.id);
assert.equal(events.length, history.length + 2);
assert.deepEqual(events.slice(0, 2).map(e => [e.from_status, e.to_status]), [['accepted', 'review'], ['review', 'accepted']]);
const after = await getAsset(original.id);
assert.deepEqual(after.analysis_attempts, before.analysis_attempts);
assert.equal(after.status, 'review');
// Signed replay checks webhook integration and manual/cache preservation; no new uploads.
const fixture = JSON.parse(await fs.readFile('artifacts/pipeline/upload-original.json', 'utf8'));
const raw = JSON.stringify({ ...fixture.response, notification_type: 'upload' });
const timestamp = String(Math.floor(Date.now() / 1000));
const cld = getCloudinary();
const signature = cld.utils.webhook_signature(raw, timestamp, { api_secret: cld.config().api_secret });
const webhook = await fetch(`${base}/api/cloudinary/webhook`, { method: 'POST', headers: {
  'Content-Type': 'application/json', 'x-cld-timestamp': timestamp, 'x-cld-signature': signature,
}, body: raw });
assert.equal(webhook.status, 200, await webhook.clone().text());
let settled;
for (let i = 0; i < 30; i++) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  settled = await getAsset(original.id);
  if (settled.pipeline_state === 'classified' && settled.processing_started_at !== after.processing_started_at) break;
}
assert.equal(settled.pipeline_state, 'classified');
assert.notEqual(settled.processing_started_at, after.processing_started_at);
assert.equal(settled.status, 'review');
assert.equal(settled.status_reason, after.status_reason);
assert.deepEqual(settled.analysis_attempts, before.analysis_attempts);
assert.equal((await listReviewEvents(original.id)).length, events.length);
const remote = await cld.api.resource(original.cloudinary_public_id, { metadata: true });
assert.equal(remote.metadata.review_status, 'review');
for (const path of ['/review', '/evidence']) {
  const response = await fetch(base + path);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes(original.id) && html.includes('Trust checklist') && html.includes('Pipeline integration check'));
}
await fs.writeFile('artifacts/pipeline/review-check.json', JSON.stringify({ checked_at: new Date().toISOString(),
  asset_id: original.id, events: events.slice(0, 2), signed_webhook_replay: true,
  manual_override_preserved: true, analysis_cache_preserved: true, cloudinary_metadata_verified: true,
  invalid_review_rejected: true, cross_origin_rejected: true,
}, null, 2) + '\n');
console.log('Review API, two audit events, signed webhook/cache preservation and rendered queue passed. No AI calls.');
