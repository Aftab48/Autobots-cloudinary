// Explicit, quota-consuming probe: eight calls, three existing fixtures, no uploads/retries.
import assert from 'node:assert/strict';
import { required, read, record, save, safety, normalizeVision, strictAnswer } from './common.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--run') {
  throw new Error('Manual quota-consuming probe only: node scripts/day1/ai-vision-rerun.mjs --run');
}
const config = new URL(required('CLOUDINARY_URL'));
const auth = 'Basic ' + Buffer.from(`${decodeURIComponent(config.username)}:${decodeURIComponent(config.password)}`).toString('base64');
const base = `https://api.cloudinary.com/v2/analysis/${config.hostname}/analyze/`;
const manifest = await read('manifest');
const jobs = [
  ['tagging-corrected-fixture-1', 'fixture-1', 'ai_vision_tagging'],
  ['questions-fixture-1', 'fixture-1', 'ai_vision_general'],
  ['tagging-corrected-fixture-2', 'fixture-2', 'ai_vision_tagging'],
  ['questions-fixture-2', 'fixture-2', 'ai_vision_general'],
  ['tagging-corrected-fixture-3', 'fixture-3', 'ai_vision_tagging'],
  ['questions-fixture-3', 'fixture-3', 'ai_vision_general'],
  ['pair-before', 'fixture-1', 'ai_vision_general'],
  ['pair-after', 'fixture-2', 'ai_vision_general'],
];
// Validate every local input before making any paid call. Never create missing fixtures.
const requests = await Promise.all(jobs.map(async ([name, fixture, endpoint]) => {
  const asset = manifest.assets.find(a => a.id === fixture);
  assert.ok(asset?.asset_id && asset?.public_id, `Missing existing ${fixture}`);
  const { request } = await read(name);
  assert.equal(request.url, base + endpoint);
  const source = new URL(request.body.source.uri);
  assert.equal(source.origin, 'https://res.cloudinary.com');
  assert.ok(source.pathname.startsWith(`/${config.hostname}/image/upload/`));
  assert.ok(source.pathname.endsWith(`/v${asset.version}/${asset.public_id}.jpg`));
  if (request.body.tag_definitions) {
    for (const tag of request.body.tag_definitions) {
      assert.match(tag.name, /^[a-z0-9-]+$/);
      if (!tag.description.includes(safety)) tag.description += ' ' + safety;
    }
  }
  return { name, fixture, asset_id: asset.asset_id, request };
}));

const run = new Date().toISOString();
const prefix = `ai-vision-${run.replace(/[:.]/g, '-')}`;
const results = [];
for (const job of requests) {
  let http_status;
  const result = await record(`${prefix}-${job.name}`, job.request, async () => {
    const response = await fetch(job.request.url, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(job.request.body), signal: AbortSignal.timeout(90000),
    });
    http_status = response.status;
    const body = await response.json();
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status; error.error = body; throw error;
    }
    return body;
  });
  Object.assign(result, { run, http_status, fixture: job.fixture, asset_id: job.asset_id });
  await save(`${prefix}-${job.name}`, result);
  results.push({ name: job.name, ...result });
  console.log(JSON.stringify({ name: job.name, http_status, limits: result.response?.limits }));
  // Stop after any error; do not spend quota retrying or cascading failures.
  if (!result.ok) break;
}
await save(`${prefix}-summary`, { run, notice: 'Only AI Vision; three existing unrelated fixtures, no new uploads.', results });
assert.equal(results.length, 8, 'Probe stopped early; inspect saved evidence before any manual retry');
assert.ok(results.every(r => r.ok), 'AI Vision failure; no automatic retries');
// Offline validation of the captured responses; no additional service calls.
const normalized = [0, 2, 4].map(i => ({ fixture: results[i].fixture, analysis: normalizeVision(results[i].response, results[i + 1].response) }));
const choices = [['none', 'some', 'a lot'], ['none', 'some', 'a lot'], ['none', 'a few', 'many'], ['no', 'yes']];
const pair = results.slice(6).map(r => ({ fixture: r.fixture, answers: r.response.data.analysis.responses.map((v, i) => strictAnswer(v.value, choices[i])) }));
await save(`${prefix}-validation`, { normalized, pair, notice: 'Unrelated images; no real before/after or impact claim.' });
console.log(`Evidence prefix: artifacts/day1/${prefix}; normalized ${normalized.length} assets.`);
