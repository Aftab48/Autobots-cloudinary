import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../../lib/pipeline.mjs';
import { safeError } from '../../lib/pipeline-providers.mjs';
import { framesNeedReview, trustDecision } from '../../lib/pipeline-rules.mjs';
import { normalizeVision } from '../../lib/analysis-prompts.mjs';
import { parseStuckArgs } from './stuck.mjs';

const project = { activities: ['river_cleanup'], start_date: '2026-01-01', end_date: '2026-12-31' };
const answer = { caption: 'People collect litter beside water.', activity: 'river_cleanup', relevant_to_project: true,
  category: 'environmental_activity', signals: ['people_present', 'water_body'], reason: 'Visible litter collection matches cleanup.', analysis_source: 'llm_fallback' };
const rawVision = { data: { analysis: { responses: ['People collect litter beside water.', 'yes: Visible litter collection matches cleanup.', 'river_cleanup', 'people_present, water_body'].map(value => ({ value })) } } };

// A durable fake database survives successive analyze() invocations. Failures
// are injected at write boundaries, not at the model validation boundary.
function harness(tier = 'bulk') {
  const row = { id: 'fixture', analysis_tier: tier, analysis_attempts: [], analysis_result: null, analysis_completed_at: null };
  const calls = { llm: 0, vision: 0 };
  const h = { row, calls, fail: null, llm: () => JSON.stringify(answer), visionError: null };
  h.sql = async (strings, ...values) => {
    const q = strings.join('?');
    if (h.fail?.(q, values)) throw new Error('Injected database outage');
    if (q.includes('SELECT remaining') || q.includes('UPDATE analysis_budget')) return [{ remaining: 10000 }];
    if (q.includes('SET analysis_started_at')) { row.analysis_attempts.push({ provider: values[0], attempt: values[1], state: 'started' }); return [{ id: row.id }]; }
    if (q.includes('SET analysis_attempts = (')) {
      Object.assign(row.analysis_attempts.find(a => a.provider === values[0] && a.attempt === values[1]), JSON.parse(values[2])); return [];
    }
    if (q.includes('SET ai_vision_raw')) { row.ai_vision_raw = JSON.parse(values[0]); return []; }
    if (q.includes('SET analysis_result')) { row.analysis_result = JSON.parse(values[0]); row.analysis_completed_at = 'saved'; return []; }
    if (q.includes('SET analysis_error = NULL')) { row.analysis_error = null; return []; }
    if (q.includes('SET analysis_completed_at') || q.includes('SET analysis_error')) { row.analysis_completed_at = 'terminal'; return []; }
    throw new Error(`Unexpected database operation: ${q}`);
  };
  h.run = () => analyze(structuredClone(row), project, false, {
    sql: h.sql,
    runLlm: async () => { calls.llm++; return { content: h.llm(), usage: {} }; },
    runVision: async () => { calls.vision++; if (h.visionError) throw h.visionError; return { raw: rawVision, normalize: () => normalizeVision(rawVision) }; },
  });
  return h;
}

test('a DB failure after valid LLM output never causes another paid attempt; restart restores saved content', async () => {
  const h = harness();
  h.fail = q => q.includes('SET analysis_result');
  await assert.rejects(h.run(), /database outage/);
  assert.equal(h.calls.llm, 1);
  assert.equal(h.row.analysis_attempts[0].content, JSON.stringify(answer));
  h.fail = null;
  await h.run();
  assert.deepEqual(h.row.analysis_result, answer);
  assert.equal(h.calls.llm, 1);
});

test('loss before response persistence leaves an ambiguous attempt for review, without automatic re-spend', async () => {
  const h = harness();
  h.fail = q => q.includes('SET analysis_attempts = (');
  await assert.rejects(h.run(), /database outage/);
  h.fail = null;
  await h.run();
  assert.equal(h.calls.llm, 1);
  assert.equal(h.row.analysis_result, null);
  assert.equal(h.row.analysis_completed_at, 'terminal');
});

test('Vision persistence failures never call the LLM; stored raw Vision output restores after restart', async () => {
  const previous = process.env.AI_VISION_ENABLED;
  process.env.AI_VISION_ENABLED = 'true';
  try {
    for (const boundary of ['SET ai_vision_raw', 'SET analysis_result']) {
      const h = harness('showcase');
      h.fail = q => q.includes(boundary);
      await assert.rejects(h.run(), /database outage/);
      assert.deepEqual(h.calls, { llm: 0, vision: 1 });
      h.fail = null;
      await h.run();
      assert.deepEqual(h.calls, { llm: 0, vision: 1 });
      assert.equal(h.row.analysis_result?.analysis_source ?? null, boundary === 'SET analysis_result' ? 'cloudinary_ai_vision' : null);
    }
  } finally { if (previous === undefined) delete process.env.AI_VISION_ENABLED; else process.env.AI_VISION_ENABLED = previous; }
});

test('real provider errors still fall back; malformed LLM output alone permits the bounded repair attempt', async () => {
  const previous = process.env.AI_VISION_ENABLED;
  process.env.AI_VISION_ENABLED = 'true';
  try {
    const h = harness('showcase');
    h.visionError = Object.assign(new Error('Forbidden'), { status: 403 });
    await h.run();
    assert.deepEqual(h.calls, { llm: 1, vision: 1 });
    const invalid = harness();
    invalid.llm = () => 'invalid JSON';
    await invalid.run();
    assert.equal(invalid.calls.llm, 2);
    assert.equal(invalid.row.analysis_result, null);
  } finally { if (previous === undefined) delete process.env.AI_VISION_ENABLED; else process.env.AI_VISION_ENABLED = previous; }
});

test('safeError survives broken configuration, malformed encoding, cycles and hostile getters', () => {
  const prior = process.env.CLOUDINARY_URL;
  try {
    for (const url of ['broken-secret-value', 'cloudinary://key:%GG@example']) {
      process.env.CLOUDINARY_URL = url;
      const circular = {}; circular.self = circular;
      const result = safeError({ message: `Failure: ${url}`, response: circular });
      assert.doesNotThrow(() => JSON.stringify(result));
      assert.ok(!JSON.stringify(result).includes(url));
    }
    assert.doesNotThrow(() => safeError({ get message() { throw new Error('getter'); } }));
  } finally { if (prior === undefined) delete process.env.CLOUDINARY_URL; else process.env.CLOUDINARY_URL = prior; }
});

test('every video classification derives frame failure from stored children, including duplicate peers', () => {
  const good = { checklist: { sharp_enough: true }, analysis_result: answer };
  const frames = [good, good, { ...good, analysis_result: null }];
  assert.equal(framesNeedReview([good, good, good]), false);
  assert.equal(framesNeedReview([]), true);
  const video = { resource_type: 'video', bytes: 1000, width: 1000, height: 800, quality_score: 1,
    analysis_result: answer, captured_at: '2026-09-24', lat: 1, lng: 1 };
  assert.equal(trustDecision(video, project, { frameFailure: framesNeedReview(frames) }).status, 'review');
});

test('stuck discovery is a bounded read-only CLI, with no batch execution option', () => {
  assert.equal(parseStuckArgs([]), 100);
  assert.equal(parseStuckArgs(['--limit', '20']), 20);
  for (const args of [['--run'], ['--all'], ['--limit', '0'], ['--limit', '1001'], ['--limit', 'NaN']]) assert.throws(() => parseStuckArgs(args));
});
