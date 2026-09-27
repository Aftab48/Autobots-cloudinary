import test from 'node:test';
import assert from 'node:assert/strict';
process.env.CLOUDINARY_URL = 'cloudinary://key:secret@demo'; // Offline: URL building only.
const { compareAnswers, compositeUrl, createComparison, ComparisonInputError } = await import('../../lib/comparisons.mjs');

const P = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b', A = '00000000-0000-4000-8000-00000000000c';
const answers = (vegetation, visible_waste, human_activity, tree_presence) => ({ vegetation, visible_waste, human_activity, tree_presence });

test('none < some < a lot and no < yes give more / less / same per category', () => {
  assert.deepEqual(compareAnswers(answers('none', 'a lot', 'some', 'no'), answers('some', 'none', 'some', 'yes')),
    { vegetation: 'more', visible_waste: 'less', human_activity: 'same', tree_presence: 'more' });
  assert.deepEqual(compareAnswers(answers('a lot', 'none', 'a lot', 'yes'), answers('none', 'a lot', 'some', 'no')),
    { vegetation: 'less', visible_waste: 'more', human_activity: 'less', tree_presence: 'less' });
  assert.deepEqual(compareAnswers(answers('some', 'some', 'none', 'yes'), answers('some', 'some', 'none', 'yes')),
    { vegetation: 'same', visible_waste: 'same', human_activity: 'same', tree_presence: 'same' });
  assert.throws(() => compareAnswers(answers('a few', 'some', 'none', 'no'), answers('some', 'some', 'none', 'no')), /vegetation/);
  assert.throws(() => compareAnswers(answers('some', 'some', 'none', 'some'), answers('some', 'some', 'none', 'no')), /tree_presence/);
});

test('composite follows the plan chain with colon folders and dated labels', () => {
  const url = compositeUrl({ cloudinary_public_id: 'b1', version: 7, captured_at: new Date('2026-01-08T03:50:00Z') }, { cloudinary_public_id: 'ps02/x/a1', captured_at: null });
  assert.match(url, /\/image\/upload\/c_fill,h_600,w_800\/c_pad,g_west,h_600,w_1600\/l_ps02:x:a1\/c_fill,h_600,w_800\/fl_layer_apply,g_east\//);
  assert.match(url, /l_text:Arial_36_bold:BEFORE%202026-01-08\/fl_layer_apply,g_north_west,x_20,y_20\//);
  assert.match(url, /l_text:Arial_36_bold:AFTER%20undated\/fl_layer_apply,g_north_east,x_20,y_20\/v7\/b1\.jpg/);
  assert.doesNotMatch(url, /e_gen|e_background|e_restore|e_fill/);
});

function fakeSql({ existing = null, assets = [] } = {}) {
  const log = [];
  const run = async (text, values) => {
    log.push({ text, values });
    if (text.includes('analysis_budget')) return [{ remaining: 100000 }];
    if (text.startsWith('SELECT * FROM comparisons')) return existing ? [existing] : [];
    if (text.startsWith('SELECT a.* FROM assets')) return assets;
    if (text.startsWith('INSERT INTO comparisons')) return [{ id: 'new', changes: JSON.parse(values[5]), answers: JSON.parse(values[6]), analysis_source: values[7] }];
    throw new Error(`Unexpected query: ${text}`);
  };
  const sql = (strings, ...values) => run(strings.join('?'), values);
  sql.query = run;
  return { sql, log };
}
const photo = (id, captured_at, site_id = 's') => ({ id, cloudinary_public_id: id, version: 1, resource_type: 'image', site_id, captured_at });
const pair = { before: answers('some', 'a lot', 'none', 'no'), after: answers('a lot', 'some', 'some', 'yes') };
const noCall = () => assert.fail('provider must not be called');

test('an existing pair is returned without any provider call', async () => {
  const { sql } = fakeSql({ existing: { id: 'old' } });
  assert.deepEqual(await createComparison(P, B, A, { sql, runLlm: noCall, runVision: noCall }), { comparison: { id: 'old' }, created: false });
});

test('ineligible, reversed or malformed pairs are refused before any provider call', async () => {
  for (const [assets, ids] of [[[photo(B, '2026-01-01')], [B, A]], [[photo(B, '2026-06-01'), photo(A, '2026-01-01')], [B, A]], [[], [B, B]], [[], ['x', A]]]) {
    await assert.rejects(createComparison(P, ...ids, { sql: fakeSql({ assets }).sql, runLlm: noCall, runVision: noCall }), ComparisonInputError);
  }
});

test('AI Vision disabled: one LLM call, changes derived in code, source recorded', async () => {
  delete process.env.AI_VISION_ENABLED;
  const { sql, log } = fakeSql({ assets: [photo(A, '2026-06-08'), photo(B, '2026-01-08')] });
  let calls = 0;
  const { comparison, created } = await createComparison(P, B, A, { sql, runVision: noCall, runLlm: async () => { calls++; return { content: JSON.stringify(pair) }; } });
  assert.equal(calls, 1);
  assert.equal(created, true);
  assert.equal(comparison.analysis_source, 'llm_fallback');
  assert.deepEqual(comparison.changes, { vegetation: 'more', visible_waste: 'less', human_activity: 'more', tree_presence: 'more' });
  assert.deepEqual({ before: comparison.answers.before, after: comparison.answers.after }, pair);
  assert.ok(!log.some(q => q.text.includes('analysis_budget')));
});

test('AI Vision parse error falls back to one LLM call and records why', async () => {
  process.env.AI_VISION_ENABLED = 'true';
  try {
    const { sql } = fakeSql({ assets: [photo(B, '2026-01-08'), photo(A, '2026-06-08')] });
    let vision = 0, llm = 0;
    const runVision = async () => { vision++; return { raw: {}, normalize: () => { throw Object.assign(new Error('bad'), { code: 'AI_VISION_PARSE_ERROR', field: 'vegetation' }); } }; };
    const { comparison } = await createComparison(P, B, A, { sql, runVision, runLlm: async () => { llm++; return { content: JSON.stringify(pair) }; } });
    assert.deepEqual([vision, llm], [1, 1]);
    assert.equal(comparison.analysis_source, 'llm_fallback');
    assert.equal(comparison.answers.errors[0].field, 'vegetation');
  } finally { delete process.env.AI_VISION_ENABLED; }
});
