import test from 'node:test';
import assert from 'node:assert/strict';
// Offline: URL building only, and every LLM call goes to an injected fake client.
Object.assign(process.env, { CLOUDINARY_URL: 'cloudinary://key:secret@demo', OPENROUTER_API_KEY: 'test-key', LLM_MODEL_TEXT: 'test-model' });
const { generateReport, getReport, ReportInputError } = await import('../../lib/reports.mjs');

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = uuid(99), composite = 'https://res.cloudinary.com/demo/image/upload/c_pad,w_1600/composite.jpg';
const evidence = [
  { id: uuid(1), cloudinary_public_id: 'e1', version: 3, resource_type: 'image', caption: 'People collect trash on river steps.', activity: 'river_cleanup', site: 'Site A', date: new Date('2026-02-03T03:45:00Z') },
  { id: uuid(2), cloudinary_public_id: 'e2', version: 4, resource_type: 'image', caption: 'People plant saplings by a river.', activity: 'tree_plantation', site: 'Site C', date: new Date('2026-03-14T03:30:00Z') },
];
const comparisons = [{ id: uuid(10), composite_url: composite, site: 'Site A', before_date: new Date('2026-01-08T03:50:00Z'), after_date: new Date('2026-06-08T03:50:00Z'),
  changes: { vegetation: 'more', visible_waste: 'same', human_activity: 'same', tree_presence: 'same' } }];

function fakeSql({ project = true } = {}) {
  const inserts = [];
  const query = async (text, values) => {
    if (text.includes('FROM projects p')) return project ? [{ media: 5, accepted: 2, review: 1, rejected: 2, processing: 0, duplicates_removed: 1 }] : [];
    if (text.includes("a.status = 'accepted'")) return evidence;
    if (text.includes('FROM comparisons c')) return comparisons;
    if (text.startsWith('WITH r AS (INSERT INTO reports')) { inserts.push(values); return [{ id: 'report-1' }]; }
    throw new Error(`Unexpected query: ${text}`);
  };
  return { sql: { query }, inserts };
}
const fakeClient = (content, calls = []) => ({ chat: { completions: { create: async body => { calls.push(body); return { choices: [{ finish_reason: 'stop', message: { content } }] }; } } } });
const saved = values => ({ period: values.slice(1, 3), stats: JSON.parse(values[3]), claims: JSON.parse(values[4]), sources: JSON.parse(values[5]) });

test('LLM path: uncited and invented-ID sentences are dropped, kept claims persist in order with derived URLs', async () => {
  const { sql, inserts } = fakeSql();
  const calls = [];
  const content = JSON.stringify([
    { text: 'At Site A, the after photo (2026-06-08) shows more vegetation than the before photo (2026-01-08).', sources: ['C1'] },
    { text: 'The river is now much cleaner.', sources: [] },
    { text: 'Photos show saplings being planted.', sources: ['E9'] },
    { text: 'Photos show people collecting trash and planting saplings by the river.', sources: ['E1', 'E2'] },
  ]);
  const { report, claims, dropped } = await generateReport(P, { sql, client: fakeClient(content, calls) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'test-model');
  assert.equal(calls[0].response_format, undefined);
  assert.ok(!calls[0].messages[1].content.includes(uuid(1)), 'the model sees aliases, not UUIDs');
  assert.equal(report.id, 'report-1');
  assert.deepEqual(dropped.map(d => d.reason), ['no sources', 'unknown source IDs: E9']);
  assert.equal(claims.length, 2);
  const { period, stats, claims: rows, sources } = saved(inserts[0]);
  assert.deepEqual(period, ['2026-01-08', '2026-06-08']);
  assert.equal(stats.claims_source, 'llm');
  assert.equal(stats.dropped_claims, 2);
  assert.equal(stats.fallback_reason, undefined);
  assert.deepEqual(stats.media, { media: 5, accepted: 2, review: 1, rejected: 2, processing: 0, duplicates_removed: 1 });
  assert.deepEqual(stats.activities, { river_cleanup: 1, tree_plantation: 1 });
  assert.deepEqual(stats.sites, { 'Site A': 1, 'Site C': 1 });
  assert.deepEqual(rows.map(r => r.position), [0, 1]);
  assert.match(rows[0].text, /more vegetation/);
  assert.deepEqual(sources[0], { position: 0, asset_id: null, comparison_id: uuid(10), derived_url: composite });
  assert.deepEqual(sources.slice(1).map(s => [s.position, s.asset_id, s.comparison_id]), [[1, uuid(1), null], [1, uuid(2), null]]);
  assert.match(sources[1].derived_url, /\/image\/upload\/c_fill,h_300,q_auto,w_400\/v3\/e1\.jpg/);
});

test('template fallback: forced, provider error or zero valid claims; every claim still cited', async () => {
  const noCall = { chat: { completions: { create: () => assert.fail('LLM must not be called') } } };
  const failing = { chat: { completions: { create: async () => { throw new Error('HTTP 500'); } } } };
  const cases = [[{ useLlm: false, client: noCall }, 0, 'LLM not requested'], [{ client: failing }, 0, 'HTTP 500'],
    [{ client: fakeClient(JSON.stringify([{ text: 'Waste fell by 90%.', sources: ['C1'] }])) }, 1, 'No valid cited claims']];
  for (const [options, droppedCount, reason] of cases) {
    const { sql, inserts } = fakeSql();
    await generateReport(P, { sql, ...options });
    const { stats, claims, sources } = saved(inserts[0]);
    assert.deepEqual([stats.claims_source, stats.dropped_claims, stats.fallback_reason], ['template', droppedCount, reason]);
    assert.deepEqual(claims.map(c => c.position), claims.map((_, i) => i));
    assert.ok(claims.length >= 3 && claims.every(c => sources.some(s => s.position === c.position && s.derived_url)));
  }
});

test('unknown or malformed project is refused before any write', async () => {
  const { sql, inserts } = fakeSql({ project: false });
  await assert.rejects(generateReport(P, { sql, useLlm: false }), ReportInputError);
  await assert.rejects(generateReport('nope', { sql, useLlm: false }), ReportInputError);
  assert.equal(inserts.length, 0);
});

test('getReport groups sources under claims in position order and hides other projects\' reports', async () => {
  const R = uuid(50), rows = [
    { id: 'c0', text: 'Comparison sentence.', position: 0, asset_id: null, comparison_id: uuid(10), derived_url: composite },
    { id: 'c1', text: 'Asset sentence.', position: 1, asset_id: uuid(1), comparison_id: null, derived_url: 'thumb-1' },
    { id: 'c1', text: 'Asset sentence.', position: 1, asset_id: uuid(2), comparison_id: null, derived_url: 'thumb-2' },
    { id: 'c2', text: 'Unsourced legacy row.', position: 2, asset_id: null, comparison_id: null, derived_url: null },
  ];
  const sql = own => ({ query: async (text, values) => text.startsWith('SELECT * FROM reports') ? (own ? [{ id: values[0], project_id: values[1] }] : [])
    : text.includes('FROM claims c') && !text.startsWith('WITH') ? rows : [] });
  const { report, claims } = await getReport(R, P, sql(true));
  assert.equal(report.id, R);
  assert.deepEqual(claims.map(c => [c.id, c.position, c.sources.map(s => [s.type, s.id, s.derived_url])]), [
    ['c0', 0, [['comparison', uuid(10), composite]]], ['c1', 1, [['asset', uuid(1), 'thumb-1'], ['asset', uuid(2), 'thumb-2']]], ['c2', 2, []]]);
  assert.equal(await getReport(R, P, sql(false)), null);
  assert.equal(await getReport('nope', P, sql(true)), null);
});
