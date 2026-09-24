import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { database } from '../../lib/db.mjs';
import { buildAssetSearch } from '../../lib/search.mjs';
import { fallbackSearchQuery } from '../../lib/search-query.mjs';

// No image uploads, add-ons or paid model calls. All fixtures are transaction-local.
process.loadEnvFile('.env.local');
const sql = database();
const id = number => `00000000-0000-4000-9000-${String(number).padStart(12, '0')}`;
const project = id(1), otherProject = id(2), site = id(3), otherSite = id(4);
const context = { name: 'Search check', start_date: '2026-01-01', activities: ['community_participation', 'tree_plantation', 'infrastructure'], sites: [{ id: site, name: 'Riverbank' }] };
const examples = [
  'Show me evidence of community participation during the river restoration campaign between January and March.',
  'Find photos showing volunteers planting trees near the river.',
  'Show infrastructure work completed in March.',
];
const filters = examples.map(query => fallbackSearchQuery(query, context));
const statements = [];
const add = (text, values = []) => { const index = statements.length; statements.push(sql.query(text, values)); return index; };
const search = filter => { const statement = buildAssetSearch(project, filter); return add(statement.text, statement.values); };
add('CREATE TEMP TABLE projects (LIKE public.projects INCLUDING DEFAULTS) ON COMMIT DROP');
add('CREATE TEMP TABLE sites (LIKE public.sites INCLUDING DEFAULTS) ON COMMIT DROP');
add('CREATE TEMP TABLE assets (LIKE public.assets INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING CONSTRAINTS) ON COMMIT DROP');
add('INSERT INTO projects (id, name) VALUES ($1, $2), ($3, $4)', [project, 'Search check', otherProject, 'Other project']);
add('INSERT INTO sites (id, project_id, name) VALUES ($1, $2, $3), ($4, $2, $5)', [site, project, 'Riverbank', otherSite, 'Other bank']);
const insert = (n, activity, captured, options = {}) => add(`INSERT INTO assets
  (id,project_id,site_id,cloudinary_asset_id,cloudinary_public_id,resource_type,caption,cld_caption,cld_tags,signals,activity,captured_at,status)
  VALUES ($1,$2,$3,$4,$4,'image',$5,$6,$7,$8,$9,$10,$11)`,
  [id(n), options.project ?? project, options.site ?? site, `search-fixture-${n}`, options.caption ?? activity.replaceAll('_', ' '), options.cld_caption ?? null,
    options.tags ?? [], options.signals ?? [], activity, captured, options.status ?? 'accepted']);
insert(10, 'community_participation', '2026-01-01T00:00:00Z', { caption: 'Community participation volunteers crowd' });
insert(11, 'community_participation', '2026-03-31T23:59:59.999Z', { caption: 'Community participation volunteers crowd '.repeat(20) });
insert(12, 'community_participation', '2026-02-12T12:00:00Z', { caption: 'Community participation volunteers crowd '.repeat(30), status: 'review' });
insert(13, 'community_participation', '2025-12-31T23:59:59.999Z');
insert(14, 'community_participation', '2026-04-01T00:00:00Z');
insert(15, 'community_participation', null);
insert(16, 'community_participation', '2026-02-01T00:00:00Z', { project: otherProject });
insert(20, 'tree_plantation', '2026-02-01T00:00:00Z', { caption: 'Volunteers planting trees near the river', signals: ['people_present', 'water_body', 'saplings'] });
insert(21, 'tree_plantation', '2026-02-01T00:00:00Z', { caption: 'Saplings', site: otherSite });
insert(30, 'infrastructure', '2026-03-01T00:00:00Z', { caption: 'Completed riverbank construction' });
insert(31, 'infrastructure', '2026-03-31T23:59:59.999Z', { caption: null, cld_caption: 'Repaired structures', tags: ['equipment'] });
insert(32, 'infrastructure', '2026-04-01T00:00:00Z');
const exampleIndexes = filters.map(search);
const siteIndex = search({ ...filters[1], site });
const onlySignals = search({ keywords: ['people_present'], date_from: null, date_to: null, activity: null, site: null });
const onlyTags = search({ keywords: ['equipment'], date_from: null, date_to: null, activity: null, site: null });
const onlyCldCaption = search({ keywords: ['repaired'], date_from: null, date_to: null, activity: null, site: null });
const injectionIndex = search({ keywords: ["zzzz'); DROP TABLE assets; --"], date_from: null, date_to: null, activity: null, site: null });
add("UPDATE assets SET caption = 'zebracrossing' WHERE id = $1", [id(21)]);
const updatedIndex = search({ keywords: ['zebracrossing'], date_from: null, date_to: null, activity: null, site: null });
// Execute the exact cached live-LLM filters when the optional three-call probe exists.
let cachedIndexes = [];
try {
  const probe = JSON.parse(await fs.readFile('artifacts/search/llm-probe.json', 'utf8'));
  const entries = Array.isArray(probe) ? probe : probe.results;
  if (Array.isArray(entries) && entries.length === 3 && entries.every(entry => entry.filters)) cachedIndexes = entries.map(entry => search(entry.filters));
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const results = await sql.transaction(statements);
const ids = index => results[index].map(row => row.id);
assert.deepEqual(ids(exampleIndexes[0]), [id(11), id(10), id(12)]);
assert.deepEqual(new Set(ids(exampleIndexes[1])), new Set([id(20), id(21)]));
assert.deepEqual(new Set(ids(exampleIndexes[2])), new Set([id(30), id(31)]));
assert.deepEqual(ids(siteIndex), [id(20)]);
assert.deepEqual(ids(onlySignals), [id(20)]);
assert.ok(results[onlySignals][0].why_matched.some(hit => hit.field === 'signals' && hit.value === 'people_present'));
assert.deepEqual(ids(onlyTags), [id(31)]);
assert.ok(results[onlyTags][0].why_matched.some(hit => hit.field === 'cld_tags'));
assert.deepEqual(ids(onlyCldCaption), [id(31)]);
assert.ok(results[onlyCldCaption][0].why_matched.some(hit => hit.field === 'cld_caption'));
assert.deepEqual(ids(injectionIndex), []);
assert.deepEqual(ids(updatedIndex), [id(21)]);
for (let i = 0; i < cachedIndexes.length; i++) assert.deepEqual(new Set(ids(cachedIndexes[i])), new Set(ids(exampleIndexes[i])));
const schema = await sql`SELECT a.attgenerated, pg_get_indexdef(i.indexrelid) AS indexdef FROM pg_attribute a
  JOIN pg_index i ON i.indrelid = a.attrelid JOIN pg_class idx ON idx.oid = i.indexrelid
  WHERE a.attrelid = 'public.assets'::regclass AND a.attname = 'search_vector' AND idx.relname = 'assets_search_vector_idx'`;
assert.equal(schema[0]?.attgenerated, 's');
assert.match(schema[0]?.indexdef, /USING gin \(search_vector\)/);
console.log(`Search checks passed: three example queries, accepted-first/rank order, UTC capture boundaries, project/site filters, field explanations, injection, generated-vector update and stored GIN schema. ${cachedIndexes.length} cached LLM queries checked. Temporary fixtures dropped; no model or media calls.`);
