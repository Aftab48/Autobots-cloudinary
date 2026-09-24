import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEvidenceFilters, buildEvidenceQuery, listEvidence, getAssetStates, getEvidenceDetail, EvidenceInputError, PAGE_SIZE, assetMedia } from '../../lib/project-views.mjs';

const id = '00000000-0000-4000-8000-000000000002';
test('evidence filters normalize blanks and validate inclusive dates', () => {
  assert.deepEqual(parseEvidenceFilters({ status: '', from: '2024-02-29', to: '2024-03-01', page: '2' }), { status: null, activity: null, site: null, from: '2024-02-29', to: '2024-03-01', page: 2 });
  for (const params of [{ from: '2025-02-29' }, { from: '2024-03-02', to: '2024-03-01' }, { status: 'verified' }, { status: ['review', 'accepted'] }, { activity: "x' OR 1=1" }, { site: 'not-a-uuid' }, { page: '0' }, { page: '1.5' }, { page: '9999999' }, { from: '0000-01-01' }]) assert.throws(() => parseEvidenceFilters(params), EvidenceInputError);
});
test('evidence query binds filters, stable paging, inclusive UTC end date', () => {
  const filters = parseEvidenceFilters({ status: 'review', activity: 'tree_plantation', site: id, from: '2026-01-01', to: '2026-03-31', page: '3' });
  const query = buildEvidenceQuery(filters);
  assert.deepEqual(query.values, [id, 'review', 'tree_plantation', id, '2026-01-01', '2026-03-31', PAGE_SIZE, 48]);
  assert.match(query.text, /captured_at < \(\(\$6::date \+ 1\)::timestamp AT TIME ZONE 'UTC'\)/);
  assert.match(query.text, /ORDER BY a.created_at DESC, a.id ASC LIMIT \$7 OFFSET \$8/);
  assert.equal(query.text.includes('tree_plantation'), false);
});
test('empty later page preserves count and only issues extra read when needed', async () => {
  const calls = [];
  const result = await listEvidence({ page: '3' }, { query: async (text, values) => { calls.push({ text, values }); return calls.length === 1 ? [] : [{ filtered_total: 25 }]; } });
  assert.equal(result.total, 25);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].values.length, 6);
  assert.doesNotMatch(calls[1].text, /LIMIT|OFFSET/);
});
test('pipeline state reads are batched, scoped, bounded and omit private data', async () => {
  const calls = [];
  const sql = { query: async (text, values) => { calls.push({ text, values }); return [{ id, status: 'processing', pipeline_state: 'analyzing' }]; } };
  assert.deepEqual(await getAssetStates([], sql), []);
  assert.equal(calls.length, 0);
  assert.equal((await getAssetStates([id], sql))[0].pipeline_state, 'analyzing');
  assert.deepEqual(calls[0].values, [id, [id]]);
  assert.match(calls[0].text, /^SELECT id, status, pipeline_state FROM/);
  await assert.rejects(getAssetStates(Array(101).fill(id), sql), EvidenceInputError);
  await assert.rejects(getAssetStates(['bad'], sql), EvidenceInputError);
  assert.equal(calls.length, 1);
});
test('malformed evidence IDs do not reach the database', async () => {
  assert.equal(await getEvidenceDetail('bad', { query: () => { throw new Error('must not call'); } }), null);
});
test('preview URL uses bounded Cloudinary transformation and pins original version', () => {
  const calls = [];
  const urls = assetMedia({ cloudinary_public_id: 'evidence/test', resource_type: 'video', version: 123 }, { url: (publicId, options) => { calls.push({ publicId, options }); return `url-${calls.length}`; } });
  assert.deepEqual(urls, { original: 'url-1', preview: 'url-2' });
  assert.deepEqual(calls[0].options, { secure: true, resource_type: 'video', version: 123 });
  assert.deepEqual(calls[1].options, { secure: true, resource_type: 'video', version: 123, crop: 'limit', width: 640, height: 420, format: 'jpg', quality: 'auto' });
});
