import assert from 'node:assert/strict';

// Read-only checks against an already-running development server. No model calls.
const base = process.env.LOCAL_TEST_URL || 'http://localhost:3000';
const api = await fetch(`${base}/api/projects/00000000-0000-4000-8000-000000000002/search?llm=off`);
assert.equal(api.status, 200);
const { results } = await api.json();
const asset = results.find(row => row.status === 'review') || results[0];
assert.ok(asset, 'A stored asset is required for this read-only smoke check');
const pages = ['/', '/evidence', '/review', '/search', '/upload?test=core', `/evidence/${asset.id}`, '/search?q=people&llm=off'];
const rendered = new Map();
for (const path of pages) {
  const response = await fetch(base + path);
  assert.equal(response.status, 200, path);
  const html = await response.text();
  rendered.set(path, html);
  assert.equal((html.match(/<nav[^>]*aria-label="Project navigation"/g) || []).length, 1, `${path}: shared navigation`);
  for (const href of ['/', '/evidence', '/review', '/search', '/upload']) assert.ok(html.includes(`href="${href}"`), `${path}: ${href}`);
}
assert.ok(rendered.get('/').includes('Activity breakdown'));
assert.ok(rendered.get('/').includes('Project timeline'));
assert.ok(rendered.get('/').includes('action="/search"'));
const detail = rendered.get(`/evidence/${asset.id}`);
for (const text of ['Trust checklist', 'AI assessment', 'Transformation', 'Original']) assert.ok(detail.toLowerCase().includes(text.toLowerCase()), text);
assert.ok(rendered.get('/search?q=people&llm=off').includes(`/evidence/${asset.id}`));
assert.ok(rendered.get('/search?q=people&llm=off').includes('Evidence status and pipeline state'));
const beyondEnd = await (await fetch(`${base}/evidence?page=9999`)).text();
assert.ok(beyondEnd.includes('No assets on this page.'), 'Out-of-range pages retain the real total');
const filtered = await (await fetch(`${base}/evidence?status=${asset.status}`)).text();
assert.ok(filtered.includes(`/evidence/${asset.id}`));
for (const other of results.filter(row => row.status !== asset.status)) assert.ok(!filtered.includes(`/evidence/${other.id}`), 'Status filter excludes unrelated statuses');
for (const query of ['status=not-a-status', 'from=2026-03-31&to=2026-03-01', 'from=2026-02-30']) {
  const response = await fetch(`${base}/evidence?${query}`);
  const html = await response.text();
  assert.ok(html.includes('Check your filters'), query);
}
const missing = await fetch(`${base}/evidence/00000000-0000-4000-8000-000000000999`);
assert.equal(missing.status, 404);
const states = await fetch(`${base}/api/assets/states?ids=${results.map(row => row.id).join(',')}`);
assert.equal(states.status, 200);
assert.equal(states.headers.get('cache-control'), 'no-store');
const stateRows = (await states.json()).assets;
assert.equal(stateRows.length, results.length);
for (const row of stateRows) assert.deepEqual(Object.keys(row).sort(), ['id', 'pipeline_state', 'status']);
assert.equal((await fetch(`${base}/api/assets/states?ids=invalid`)).status, 400);
console.log(`Rendered page checks passed: ${pages.length} pages, shared navigation, dashboard, detail trace/checklist, search links/badges, invalid filters, missing detail and read-only states endpoint. No AI/media/review writes.`);
