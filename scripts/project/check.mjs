import assert from 'node:assert/strict';
import { database } from '../../lib/db.mjs';
import { projectId } from '../../lib/cloudinary.mjs';
import { buildEvidenceQuery, parseEvidenceFilters, getDashboard } from '../../lib/project-views.mjs';

// Only temporary fixture tables; no permanent data, media or AI calls.
process.loadEnvFile('.env.local');
const sql = database();
const id = n => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
const site = id(500), otherSite = id(501), otherProject = id(502);
const statements = [];
const add = (text, values = []) => { const index = statements.length; statements.push(sql.query(text, values)); return index; };
add('CREATE TEMP TABLE projects (LIKE public.projects INCLUDING DEFAULTS) ON COMMIT DROP');
add('CREATE TEMP TABLE sites (LIKE public.sites INCLUDING DEFAULTS) ON COMMIT DROP');
add('CREATE TEMP TABLE assets (LIKE public.assets INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING CONSTRAINTS) ON COMMIT DROP');
add('INSERT INTO projects(id,name,activities) VALUES ($1, $2, $3), ($4, $5, $3)', [projectId, 'UI test project', ['waste_removal', 'tree_plantation', 'infrastructure'], otherProject, 'Other project']);
add('INSERT INTO sites(id,project_id,name) VALUES ($1,$2,$3),($4,$2,$5)', [site, projectId, 'Site A', otherSite, 'Site B']);
for (let n = 1; n <= 30; n++) {
  add(`INSERT INTO assets(id,project_id,site_id,cloudinary_asset_id,cloudinary_public_id,resource_type,status,pipeline_state,activity,captured_at)
    VALUES($1,$2,$3,$4,$4,'image','accepted','classified','waste_removal','2026-03-15T12:00:00Z')`, [id(n), projectId, n === 30 ? otherSite : site, `ui-fixture-${n}`]);
}
for (const [n, status, activity, captured, type, parent] of [
  [100, 'review', 'tree_plantation', '2026-03-31T23:59:59.999Z', 'image', null],
  [101, 'rejected', 'infrastructure', '2026-04-01T00:00:00Z', 'image', null],
  [102, 'processing', null, null, 'image', null],
  [103, 'accepted', 'infrastructure', '2026-03-01T00:00:00Z', 'video', null],
  [104, 'accepted', 'infrastructure', '2026-03-01T00:00:00Z', 'image', id(103)],
]) {
  add(`INSERT INTO assets(id,project_id,site_id,cloudinary_asset_id,cloudinary_public_id,resource_type,status,pipeline_state,activity,captured_at,parent_asset_id)
    VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10)`, [id(n), projectId, site, `ui-fixture-${n}`, type, status, status === 'processing' ? 'uploaded' : 'classified', activity, captured, parent]);
}
add(`INSERT INTO assets(id,project_id,cloudinary_asset_id,cloudinary_public_id,resource_type,status)
  VALUES($1,$2,'other-fixture','other-fixture','image','accepted')`, [id(105), otherProject]);
const queryIndex = params => { const statement = buildEvidenceQuery(parseEvidenceFilters(params)); return add(statement.text, statement.values); };
const all = queryIndex({}), page2 = queryIndex({ page: '2' });
const combined = queryIndex({ status: 'review', activity: 'tree_plantation', site, from: '2026-03-31', to: '2026-03-31' });
const startBoundary = queryIndex({ from: '2026-03-01', to: '2026-03-01' });
const siteB = queryIndex({ site: otherSite });
const april = queryIndex({ from: '2026-04-01', to: '2026-04-01' });
const recorded = [];
await getDashboard({ query: async (text, values) => { recorded.push({ text, values }); return []; } });
const dashboard = recorded.map(statement => add(statement.text, statement.values));
const rows = await sql.transaction(statements);
assert.equal(rows[all].length, 24);
assert.equal(rows[all][0].filtered_total, 35);
assert.equal(rows[page2].length, 11);
assert.equal(new Set([...rows[all], ...rows[page2]].map(row => row.id)).size, 35);
assert.deepEqual(rows[combined].map(row => row.id), [id(100)]);
assert.deepEqual(new Set(rows[startBoundary].map(row => row.id)), new Set([id(103), id(104)]));
assert.deepEqual(rows[siteB].map(row => row.id), [id(30)]);
assert.deepEqual(rows[april].map(row => row.id), [id(101)]);
const resultFor = fragment => rows[dashboard[recorded.findIndex(statement => statement.text.includes(fragment))]];
assert.deepEqual(Object.fromEntries(resultFor('GROUP BY status').map(row => [row.status, row.count])), { accepted: 32, processing: 1, rejected: 1, review: 1 });
const activities = resultFor('GROUP BY activity');
assert.equal(activities.find(row => row.activity === 'waste_removal').accepted, 30);
assert.equal(activities.find(row => row.activity === 'tree_plantation').review, 1);
assert.equal(activities.find(row => row.activity === 'infrastructure').accepted, 2);
const timeline = resultFor('AS day');
assert.equal(timeline.find(row => row.day === null).photos, 1);
assert.equal(timeline.find(row => row.day === '2026-03-15').photos, 30);
assert.deepEqual(Object.fromEntries(['photos','videos','frames'].map(key => [key, timeline.find(row => row.day === '2026-03-01')[key]])), { photos: 0, videos: 1, frames: 1 });
assert.deepEqual(resultFor('AS assets')[0], { assets: 35, frames: 1, processing: 1 });
console.log('Project queries passed: 35 scoped fixtures, pagination, combined filters, UTC bounds, full-project aggregates, separate review counts, undated timeline and derived-frame distinction. Temporary tables dropped; no AI/media calls.');
