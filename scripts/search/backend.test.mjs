import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSearchQuery, buildAssetSearch, presentSearchAsset, SearchInputError } from '../../lib/search.mjs';

const context = { start_date: '2026-01-01', activities: ['community_participation', 'tree_plantation', 'infrastructure'], sites: [] };
const query = 'Show infrastructure work completed in March.';
const env = { OPENROUTER_API_KEY: 'test-only', LLM_MODEL_TEXT: 'test-only' };
const client = create => ({ chat: { completions: { create } } });

test('absent configuration, disabled LLM, provider outage and invalid JSON use fallback', async () => {
  const expected = await resolveSearchQuery(query, context, { env: {} });
  assert.equal(expected.mode, 'fallback');
  assert.equal(expected.filters.activity, 'infrastructure');
  assert.equal(expected.filters.date_to, '2026-03-31');
  for (const options of [
    { env, useLlm: false, client: client(() => { throw Error('Must not call'); }) },
    { env, client: client(async () => { throw Error('Unavailable'); }) },
    { env, client: client(async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{bad json' } }] })) },
    { env, client: client(async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...expected.filters, site: 'unknown-site' }) } }] })) },
    { env, client: client(async () => ({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(expected.filters) } }] })) },
  ]) assert.deepEqual(await resolveSearchQuery(query, context, options), expected);
});

test('validated LLM filters use env model and constrained request', async () => {
  const filters = (await resolveSearchQuery(query, context, { env: {} })).filters;
  const result = await resolveSearchQuery(query, context, { env, client: client(async request => {
    assert.equal(request.model, env.LLM_MODEL_TEXT);
    assert.equal(request.temperature, 0);
    assert.equal(request.response_format.type, 'json_object');
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(filters) } }] };
  }) });
  assert.deepEqual(result, { filters, mode: 'llm' });
  await assert.rejects(resolveSearchQuery('x'.repeat(1001), context, { env: {} }), SearchInputError);
});

test('user terms are parameters, OR construction uses PostgreSQL tokenizer', () => {
  const attack = "x'); DROP TABLE assets; --";
  const statement = buildAssetSearch('id', { keywords: [attack], date_from: null, date_to: null, activity: null, site: null });
  assert.ok(!statement.text.includes(attack));
  assert.deepEqual(statement.values[1], [attack]);
  assert.match(statement.text, /plainto_tsquery\('english', keyword\)/);
  assert.match(statement.text, /ORDER BY \(a.status = 'accepted'\) DESC, search_rank DESC/);
});

test('result exposes actual field hits and nongenerative delivery URLs, no internal rank', () => {
  const seen = [];
  const item = presentSearchAsset({ id: '1', search_rank: 0.95, cloudinary_public_id: 'fixture', version: 1, resource_type: 'image',
    captured_at: '2026-03-31T23:59:59Z', activity: 'infrastructure', site_name: 'Riverbank', why_matched: [{ field: 'caption', value: 'Construction' }] },
  { date_from: '2026-03-01', date_to: '2026-03-31', site: 'site', activity: 'infrastructure' },
  { url: (id, options) => { seen.push(options); return `https://example.invalid/${id}`; } });
  assert.equal('search_rank' in item, false);
  assert.deepEqual(item.why_matched.map(hit => hit.field), ['caption', 'date', 'site', 'activity']);
  assert.equal(seen[1].crop, 'limit');
  assert.equal(seen[1].format, 'jpg');
});
