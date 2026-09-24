import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAnalysisPath, hashDistance, resolveCapture, restoreLegacyAnalysis, trustDecision, validateProjectActivity } from '../../lib/pipeline-rules.mjs';

const project = { activities: ['river_cleanup'], start_date: '2026-01-01', end_date: '2026-12-31' };
const analysis = { activity: 'river_cleanup', relevant_to_project: true };
const asset = { resource_type: 'image', bytes: 10000, quality_score: 1, width: 1024, height: 768, captured_at: '2026-09-24T12:00:00Z', lat: 22.5, lng: 88.3, analysis_result: analysis };

test('capture resolution uses independent date and location priorities, including zero coordinates', () => {
  const result = resolveCapture({ raw_cloudinary: { context: { custom: { capture_time: '2026-09-24T12:00:00Z', capture_lat: '0', capture_lng: '0', batch_date: '2026-01-01' } } }, exif: { DateTimeOriginal: '2020:01:01 00:00:00', GPSLatitude: 20, GPSLongitude: 30 } });
  assert.equal(result.capture_source, 'capture_page');
  assert.equal(result.location_source, 'capture_page');
  assert.equal(result.lat, 0); assert.equal(result.lng, 0);
  const mixed = resolveCapture({ raw_cloudinary: { context: { custom: { capture_time: '2026-09-24T12:00:00Z', capture_lat: '999', capture_lng: '0' } } }, exif: { GPSLatitude: '22/1,30/1,0/1', GPSLongitude: '88/1,15/1,0/1', GPSLatitudeRef: 'S' } });
  assert.equal(mixed.capture_source, 'capture_page'); assert.equal(mixed.location_source, 'exif');
  assert.equal(mixed.lat, -22.5); assert.equal(mixed.lng, 88.25);
});
test('invalid metadata falls through to user site/date, then upload time without inventing GPS', () => {
  const sites = [{ id: 'a', name: 'Site A', lat: 1, lng: 2 }];
  const user = resolveCapture({ exif: { DateTimeOriginal: 'nonsense' }, raw_cloudinary: { context: { custom: { batch_date: '2026-04-01', site_id: 'a' } }, created_at: '2026-09-24T00:00:00Z' } }, sites);
  assert.equal(user.capture_source, 'user'); assert.equal(user.site_id, 'a'); assert.equal(user.location_source, 'user');
  const absent = resolveCapture({ created_at: new Date('2026-09-24T00:00:00Z'), raw_cloudinary: { context: { custom: { site_id: 'foreign-project-site' } } } }, sites);
  assert.equal(absent.capture_source, 'upload_time'); assert.equal(absent.lat, null); assert.equal(absent.site_id, null);
  const impossible = resolveCapture({ raw_cloudinary: { created_at: '2026-09-24T00:00:00Z' }, exif: { DateTimeOriginal: '2026:02:30 12:00:00', GPSLatitude: '22 deg 30\' 0" S', GPSLongitude: '88.25 W' } });
  assert.equal(impossible.capture_source, 'upload_time'); assert.equal(impossible.lat, -22.5); assert.equal(impossible.lng, -88.25);
});
test('hard failures reject despite otherwise passing evidence', () => {
  assert.equal(trustDecision(asset, project).status, 'accepted');
  for (const patch of [{ quality_score: 0.06148 }, { duplicate_of: 'original' }, { bytes: 0 }, { analysis_result: { ...analysis, relevant_to_project: false } }]) {
    assert.equal(trustDecision({ ...asset, ...patch }, project).status, 'rejected');
  }
});
test('no GPS/site, unknown focus, out-of-range date and uncertain activity require review', () => {
  for (const patch of [{ lat: null, lng: null }, { quality_score: null }, { quality_score: 0.4 }, { captured_at: '2025-12-31' }, { analysis_result: { ...analysis, activity: 'other' } }, { width: 100 }, { analysis_result: null }]) {
    assert.equal(trustDecision({ ...asset, ...patch }, project).status, 'review');
  }
  assert.equal(trustDecision(asset, { ...project, start_date: null }).status, 'review');
  assert.equal(trustDecision({ ...asset, captured_at: '2026-12-31T23:59:59Z' }, project).status, 'accepted');
  assert.equal(trustDecision({ ...asset, lat: null, lng: null, site_id: 'known-site' }, project).status, 'accepted');
});
test('video frame usability is a soft failure', () => {
  assert.equal(trustDecision({ ...asset, resource_type: 'video', quality_score: 0.01 }, project, { frameFailure: true }).status, 'review');
});
test('pHash uses all 64 bits and does not match malformed or absent hashes', () => {
  assert.equal(hashDistance('56a5bb48efae4051', '56b5bb48ebae4051'), 2);
  assert.equal(hashDistance('0000000000000000', 'ffffffffffffffff'), 64);
  assert.equal(hashDistance('8000000000000000', '0000000000000000'), 1);
  for (const h of [null, '', 'not-a-hash', 'ffff', 'g'.repeat(16)]) assert.equal(hashDistance(h, '0000000000000000'), null);
});
test('paid path selection requires trusted tier, opt-in and sufficient remaining budget; cache wins', () => {
  const eligible = { enabled: true, remaining: 5000 };
  assert.equal(chooseAnalysisPath({ analysis_tier: 'showcase' }, eligible), 'cloudinary_ai_vision');
  assert.equal(chooseAnalysisPath({ analysis_tier: 'demo' }, eligible), 'cloudinary_ai_vision');
  for (const options of [{ ...eligible, forceLlm: true }, { ...eligible, enabled: false }, { ...eligible, remaining: 1000 }]) assert.equal(chooseAnalysisPath({ analysis_tier: 'showcase' }, options), 'llm_fallback');
  assert.equal(chooseAnalysisPath({ analysis_tier: 'bulk' }, eligible), 'llm_fallback');
  assert.equal(chooseAnalysisPath({ analysis_tier: 'bulk', raw_cloudinary: { context: { custom: { analysis_tier: 'showcase' } } } }, eligible), 'llm_fallback');
  assert.equal(chooseAnalysisPath({ analysis_result: analysis, analysis_tier: 'showcase' }, eligible), 'cached');
  assert.equal(chooseAnalysisPath({ analysis_completed_at: '2026-09-24', analysis_tier: 'showcase' }, eligible), 'cached');
});
test('normalized analysis rejects globally valid activities excluded by the project', () => {
  assert.throws(() => validateProjectActivity({ activity: 'tree_plantation' }, project), /outside/);
  assert.equal(validateProjectActivity(analysis, project), analysis);
  assert.equal(validateProjectActivity({ activity: 'other' }, project).activity, 'other');
});
test('legacy seven-column results restore without paid analysis; invalid legacy rows remain cache-blocked', () => {
  const legacy = { caption: 'People collect litter beside water.', activity: 'river_cleanup', relevant: true, category: 'environmental_activity', signals: ['people_present', 'water_body'], reason: 'Visible litter collection matches cleanup.', analysis_source: 'llm_fallback' };
  const restored = restoreLegacyAnalysis(legacy);
  assert.equal(restored.analysis.relevant_to_project, true);
  assert.equal(restored.error, null);
  for (const patch of [{}, { caption: null }, { signals: ['water_body', 'water_body'] }, { category: 'other' }, { activity: 'unknown' }]) {
    const row = { ...legacy, ...patch, analysis_tier: 'showcase' };
    assert.equal(chooseAnalysisPath(row, { enabled: true, remaining: 100000 }), 'cached');
    if (Object.keys(patch).length) {
      assert.equal(restoreLegacyAnalysis(row).analysis, null);
      assert.match(restoreLegacyAnalysis(row).error, /manual review/);
    }
  }
});
