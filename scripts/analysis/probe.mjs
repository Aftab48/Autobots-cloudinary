// Explicit bounded evaluation: six signed core uploads, six LLM assets, two AI Vision assets.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { z } from 'zod';
import { getCloudinary } from '../../lib/cloudinary.mjs';
import {
  buildTaggingBodies, buildQuestionBody, buildFallbackMessages, fallbackSchema,
  LLM_SETTINGS, normalizeVision, analyzeWithFallback,
} from '../../lib/analysis-prompts.mjs';

if (process.argv.length !== 3 || !['--upload', '--run'].includes(process.argv[2])) {
  throw new Error('Explicit live probe: node scripts/analysis/probe.mjs --upload|--run');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.loadEnvFile(path.join(root, '.env.local'));
const output = path.join(root, 'artifacts/analysis-prompts');
await fs.mkdir(output, { recursive: true });
const required = (name) => { const v = process.env[name]?.trim(); if (!v) throw new Error(`Missing ${name}`); return v; };
const config = new URL(required('CLOUDINARY_URL'));
const secrets = [process.env.CLOUDINARY_URL, process.env.OPENROUTER_API_KEY, process.env.DATABASE_URL, decodeURIComponent(config.username), decodeURIComponent(config.password)].filter(Boolean);
const clean = (value) => JSON.parse(secrets.reduce((s, secret) => s.replaceAll(secret, '[REDACTED]'), JSON.stringify(value, (_, v) => v instanceof Error ? { name: v.name, message: v.message, status: v.status ?? v.http_code, error: v.error } : v)));
const digest = (value) => createHash('sha256').update(value).digest('hex');
async function read(name) { try { return JSON.parse(await fs.readFile(path.join(output, `${name}.json`), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function save(name, value) { const file = path.join(output, `${name}.json`); await fs.writeFile(`${file}.tmp`, JSON.stringify(clean(value), null, 2)); await fs.rename(`${file}.tmp`, file); }

const fixtures = [
  ['cleanup', 'data/openverse/river-cleanup-volunteers/67eaf057-adee-4aac-b00d-b7cd12b3afb8.jpg', true, 'People bagging visible waste on a boat at the riverbank'],
  ['planting', 'data/openverse/tree-planting-volunteers/6058d6e6-f847-4cd8-b06a-660e54a8aa33.jpg', true, 'People kneeling at a planted young tree and exposed soil'],
  ['community', 'data/openverse/community-cleanup-drive/ae0e7830-81aa-4832-a0d1-5262bf4eaa2d.jpg', true, 'Organized group with collected bags, gloves and litter pickers'],
  ['waste-removal', 'data/openverse/beach-cleanup/03cf525b-bb64-4899-b2e6-d833742c471e.jpg', true, 'Gloved people collecting litter into a black bag'],
  ['river-bags', 'data/openverse/river-cleanup-volunteers/8f091bc2-5ce8-459c-bd0b-b408d45caf9e.jpg', true, 'People handling collected bags between boats on the river'],
  ['irrelevant', 'data/rejected/tree-planting-volunteers/4723b8e6-09d7-4b96-a814-73bf7b40f36e.jpg', false, 'Bird portrait; moved to rejected by existing dataset curation'],
].map(([id, file, expected_relevance, visual_selection_reason]) => ({ id, file, expected_relevance, visual_selection_reason }));
const sourceState = JSON.parse(await fs.readFile(path.join(root, 'data/collection-state.json'), 'utf8'));
for (const f of fixtures) {
  f.sha256 = digest(await fs.readFile(path.join(root, f.file)));
  const source = sourceState.originals.find((r) => r.openverse_id === path.parse(f.file).name);
  assert.ok(source && source.sha256 === f.sha256, `Missing or changed source ${f.id}`);
  f.provenance = { openverse_id: source.openverse_id, source_url: source.source_url, creator: source.creator, license: source.license, license_version: source.license_version, attribution: source.attribution };
}
const cloudinary = getCloudinary();
const preset = await cloudinary.api.upload_preset('ps02_core');
assert.equal(preset.unsigned, false, 'Core preset must require signed uploads');
for (const key of ['detection', 'categorization', 'auto_tagging', 'background_removal', 'eval', 'on_success', 'moderation', 'ocr', 'raw_convert', 'eager', 'transformation']) {
  assert.ok(!preset.settings[key], `Unexpected core preset option: ${key}`);
}
await save('preset-verification', { name: preset.name, unsigned: preset.unsigned, settings: preset.settings });
const assets = [];
for (const fixture of fixtures) {
  let upload = await read(`upload-${fixture.id}`);
  const publicId = `ps02/prompt-tests/${fixture.provenance.openverse_id}-${fixture.sha256.slice(0, 12)}`;
  if (upload) assert.equal(upload.fixture.sha256, fixture.sha256, 'Fixture changed; inspect prior upload');
  else {
    let response;
    try { response = await cloudinary.api.resource(publicId, { resource_type: 'image', type: 'upload' }); }
    catch (e) { if ((e.http_code ?? e.error?.http_code) !== 404) throw e; }
    const options = { upload_preset: 'ps02_core', resource_type: 'image', public_id: publicId, asset_folder: 'ps02/prompt-tests', overwrite: false, context: { purpose: 'bounded-prompt-evaluation', openverse_id: fixture.provenance.openverse_id } };
    if (!response) response = await cloudinary.uploader.upload(path.join(root, fixture.file), options);
    upload = { fixture, options, response };
    await save(`upload-${fixture.id}`, upload);
  }
  assert.equal(upload.response.public_id, publicId);
  const url = cloudinary.url(publicId, { secure: true, version: upload.response.version, crop: 'limit', width: 1024, format: 'jpg' });
  assets.push({ ...fixture, asset_id: upload.response.asset_id, public_id: publicId, delivery_url: url });
  console.log(`Core upload ready: ${fixture.id}`);
}
await save('fixtures', { notice: 'Five visually selected relevant activity examples and one irrelevant bird. These do not prove participation in a specific Kolkata project.', assets });
if (process.argv[2] === '--upload') process.exit(0);

const model = required('LLM_MODEL_VISION');
assert.ok(!model.includes(','), 'Use one environment-supplied vision model, not a benchmark model list');
const client = new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: required('OPENROUTER_API_KEY'), timeout: 90000, maxRetries: 0 });
const promptHash = digest(await fs.readFile(path.join(root, 'lib/analysis-prompts.mjs')));
let llmCalls = 0, visionCalls = 0;
// Cache every attempted paid request, including errors. Never silently re-spend after a crash or rerun.
async function paid(name, body, call) {
  const fingerprint = digest(JSON.stringify(body));
  let result = await read(name);
  if (result) assert.deepEqual(result.request, body, 'Prompt/request changed since paid result; review cache rather than automatically repeating analysis');
  else {
    await save(name, { fingerprint, request: body, state: 'started' });
    try { result = { fingerprint, request: body, ok: true, response: await call() }; }
    catch (error) { result = { fingerprint, request: body, ok: false, error: clean(error) }; }
    await save(name, result);
  }
  if (result.state === 'started') throw new Error(`Ambiguous prior request ${name}; inspect service outcome before any repeat`);
  if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
  return result.response;
}
async function runLlm(asset, attempt = 0) {
  const body = { model, messages: buildFallbackMessages(asset.delivery_url), ...LLM_SETTINGS,
    response_format: { type: 'json_schema', json_schema: { name: 'asset_analysis', strict: true, schema: z.toJSONSchema(fallbackSchema, { target: 'draft-7' }) } } };
  const response = await paid(`llm-${asset.id}-${attempt}`, body, async () => {
    assert.ok(++llmCalls <= 12, 'Six LLM assets with at most one malformed-output retry each');
    return client.chat.completions.create(body);
  });
  if (response.choices?.[0]?.finish_reason !== 'stop') return ''; // Invalid result: bounded validation retry.
  return response.choices[0].message.content;
}
const results = [];
for (const asset of assets) {
  const result = await analyzeWithFallback({ runVision: async () => { throw new Error('Explicit six-image LLM-path evaluation'); }, runLlm: ({ attempt }) => runLlm(asset, attempt) });
  results.push({ id: asset.id, expected_relevance: asset.expected_relevance, ...result });
  await save('llm-results', { model, promptHash, results });
  console.log(`LLM ${asset.id}: ${result.status}; relevance=${result.analysis?.relevant_to_project}; activity=${result.analysis?.activity}`);
}
assert.equal(results.length, 6);
assert.ok(results.every((r) => r.analysis), 'LLM failures saved; inspect before running Vision');
const expectedActivities = ['river_cleanup', 'tree_plantation', 'community_participation', 'waste_removal', 'river_cleanup', 'other'];
for (const [i, row] of results.entries()) {
  assert.equal(row.analysis.relevant_to_project, row.expected_relevance, `Unexpected relevance for ${row.id}`);
  assert.equal(row.analysis.activity, expectedActivities[i], `Unexpected activity for ${row.id}`);
}
const auth = 'Basic ' + Buffer.from(`${decodeURIComponent(config.username)}:${decodeURIComponent(config.password)}`).toString('base64');
async function visionRequest(asset, endpoint, body, index) {
  return paid(`vision-${asset.id}-${index}`, { endpoint, ...body }, async () => {
    assert.ok(++visionCalls <= 6, 'Only two Vision assets with three calls each are allowed');
    const r = await fetch(`https://api.cloudinary.com/v2/analysis/${config.hostname}/analyze/${endpoint}`, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000),
    });
    const response = await r.json();
    if (!r.ok || response.error) throw Object.assign(new Error(`Cloudinary AI Vision HTTP ${r.status}`), { status: r.status, error: response });
    return response;
  });
}
const primary = [];
for (const asset of assets.slice(0, 2)) {
  const result = await analyzeWithFallback({
    runVision: async () => {
      const tagged = [];
      for (const [i, body] of buildTaggingBodies(asset.delivery_url).entries()) tagged.push(await visionRequest(asset, 'ai_vision_tagging', body, i));
      const general = await visionRequest(asset, 'ai_vision_general', buildQuestionBody(asset.delivery_url), 2);
      return normalizeVision(tagged, general);
    },
    runLlm: async () => JSON.stringify(results.find((r) => r.id === asset.id).analysis),
  });
  primary.push({ id: asset.id, ...result });
  await save('vision-results', { promptHash, notice: 'On live Vision failure, reuse the already validated live LLM result for the same asset; no extra paid LLM call.', results: primary });
  console.log(`Vision ${asset.id}: ${result.status}; source=${result.analysis?.analysis_source}`);
}
const faults = [];
for (const error of [
  Object.assign(new Error('Injected subscription failure'), { status: 403, error: { error: { code: 'MA_00007', message: 'account does not have an active subscription for feature' } } }),
  Object.assign(new Error('Injected rate/quota limit'), { status: 429, error: { error: { message: 'quota exceeded' } } }),
  Object.assign(new Error('Injected exhausted quota'), { status: 400, error: { error: { category: 'quota_error', message: 'AI Vision token quota exhausted' } } }),
]) {
  let fallbackCalls = 0;
  const result = await analyzeWithFallback({ runVision: async () => { throw error; }, runLlm: async () => { fallbackCalls++; return JSON.stringify(results[0].analysis); } });
  assert.equal(fallbackCalls, 1); assert.equal(result.analysis.analysis_source, 'llm_fallback'); assert.equal(result.visionError, error);
  faults.push({ injected_status: error.status, fallbackCalls, ...result });
}
await save('fallback-fault-tests', { notice: 'Offline fault injection using a validated live LLM response; no real quota exhaustion or additional service requests.', results: faults });
const billed = [];
for (const name of await fs.readdir(output)) if (/^(vision|llm)-.*-\d\.json$/.test(name)) {
  const r = JSON.parse(await fs.readFile(path.join(output, name), 'utf8'));
  if (name.startsWith('vision')) for (const q of r.response?.limits?.addons_quota ?? []) if (q.type === 'ai_vision') billed.push({ file: name, ...q });
}
await save('summary', { model, promptHash, llm_new_requests: llmCalls, vision_new_requests: visionCalls, llm: results, vision: primary, fault_tests: faults.length, ai_vision_usage: billed, ai_vision_total_tokens: billed.reduce((n, q) => n + q.used_by_request, 0) });
console.log('Bounded evaluation complete. Evidence: artifacts/analysis-prompts/summary.json');
