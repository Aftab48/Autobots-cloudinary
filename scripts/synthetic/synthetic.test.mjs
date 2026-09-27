import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { prepareImage, readExif, verifyExif, manifestRow, parseCsv, toCsv } from './metadata.mjs';
import { canGenerate, costSummary, costFromUsage, decodeImage, sha256, parseGenerationArgs, generationAttemptPlan, assertCurrentPairReferences } from './common.mjs';

const model = 'test/offline-image-model';
const shot = { id: 'offline-test', site: 'B', role: 'activity', capture_datetime_ist: '2026-02-03T00:15:00+05:30', metadata: { exif_present: true, DateTimeOriginal: '2026-02-03T00:15:00+05:30', GPSLatitude: 22.6020269, GPSLongitude: 88.3591584 }, expected_pipeline_result: { status: 'ACCEPTED' } };
const raw = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#657f49' } }).png().toBuffer();
const format = { width: 32, height: 24 };

test('EXIF IST offset, synthetic labels, GPS rationals and CSV roundtrip agree', async () => {
  const originalHash = sha256(raw);
  const bytes = await prepareImage(raw, shot, model, format);
  const check = verifyExif(bytes, shot, model);
  assert.equal(check.ok, true, check.errors.join(', '));
  assert.equal(check.actual.datetime_original, '2026:02:03 00:15:00');
  assert.equal(check.actual.offset_time_original, '+05:30');
  assert.equal(new Date(check.actual.capture_date).toISOString(), '2026-02-02T18:45:00.000Z');
  assert.equal(check.actual.latitude_ref, 'N');
  assert.equal(check.actual.longitude_ref, 'E');
  assert.equal(sha256(raw), originalHash, 'original generator bytes remain unchanged');
  const row = manifestRow(shot, model);
  const parsed = parseCsv(toCsv([row]));
  assert.deepEqual(parsed[0], Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v)])));
});

test('no-GPS has date and labels but zero GPS tags', async () => {
  const edge = { ...shot, metadata: { ...shot.metadata, GPSLatitude: null, GPSLongitude: null } };
  const bytes = await prepareImage(raw, edge, model, format);
  assert.equal(verifyExif(bytes, edge, model).ok, true);
  const exif = readExif(bytes);
  assert.equal(exif.gps_tag_count, 0);
  assert.equal(exif.capture_date, shot.capture_datetime_ist);
  assert.equal(exif.labels.Make, 'PS02 Synthetic');
});

test('no-EXIF derivative intentionally excludes identity labels, date and GPS', async () => {
  const edge = { ...shot, metadata: { exif_present: false } };
  const first = await prepareImage(raw, shot, model, format);
  const bytes = await prepareImage(first, edge, model, format);
  const check = verifyExif(bytes, edge, model);
  assert.equal(check.ok, true, check.errors.join(', '));
  assert.equal(check.actual.has_exif, false);
  assert.equal(check.actual.labels.Make, null);
  const row = manifestRow(edge, model);
  assert.equal(row.capture_date, '');
  assert.equal(row.lat, '');
  assert.equal(row.scenario_capture_date, shot.capture_datetime_ist);
  assert.match(row.metadata_exception, /Intentionally no EXIF/);
});

test('western/southern GPS hemispheres roundtrip with references', async () => {
  const edge = { ...shot, metadata: { ...shot.metadata, GPSLatitude: -33.9987654, GPSLongitude: -70.0000001 } };
  const bytes = await prepareImage(raw, edge, model, format);
  assert.equal(verifyExif(bytes, edge, model).ok, true);
  assert.equal(readExif(bytes).latitude_ref, 'S');
  assert.equal(readExif(bytes).longitude_ref, 'W');
});

test('malformed metadata and tampering fail verification', async () => {
  await assert.rejects(prepareImage(raw, { ...shot, metadata: { ...shot.metadata, DateTimeOriginal: '2026-02-03T00:15:00Z' } }, model, format), /Invalid IST/);
  await assert.rejects(prepareImage(raw, { ...shot, metadata: { ...shot.metadata, GPSLatitude: 91 } }, model, format), /Invalid GPS/);
  const bytes = await prepareImage(raw, shot, model, format);
  assert.equal(verifyExif(bytes, shot, 'wrong-model').ok, false);
});

test('resume skips completed but blocks ambiguous charge states; costs never hide unknown attempts', () => {
  assert.equal(canGenerate({ attempts: [] }, 'x'), true);
  assert.equal(canGenerate({ attempts: [{ shot_id: 'x', state: 'completed' }] }, 'x'), false);
  for (const state of ['started', 'failed']) assert.throws(() => canGenerate({ attempts: [{ shot_id: 'x', state }] }, 'x'), /no automatic retry/);
  assert.equal(costFromUsage({ cost: 0.05 }), 0.05);
  assert.equal(costFromUsage({ cost: '0.05' }), null);
  const summary = costSummary({ attempts: [{ shot_id: 'a', cost_usd: 0.07 }, { shot_id: 'b', cost_usd: null }, { shot_id: 'c', kind: 'local_derivative', cost_usd: 0 }] });
  assert.equal(summary.known_generation_cost_usd, 0.07);
  assert.deepEqual(summary.unknown_cost_shots, ['b']);
  assert.equal(summary.generation_attempts, 2);
});

test('image data decode preserves exact bytes and rejects unexpected URLs', () => {
  const result = decodeImage(`data:image/png;base64,${raw.toString('base64')}`);
  assert.deepEqual(result.bytes, raw);
  assert.throws(() => decodeImage('https://example.test/image.png'), /Expected image data URL/);
});

test('strict paid CLI requires explicit single-shot regeneration and rejects unknown arguments', () => {
  assert.deepEqual(parseGenerationArgs(['--run', '--shot', 'A-main-before', '--regenerate']), { all: false, shotId: 'A-main-before', regenerate: true });
  assert.deepEqual(parseGenerationArgs(['--run', '--all']), { all: true, shotId: null, regenerate: false });
  for (const args of [[], ['--all'], ['--run', '--all', '--regenerate'], ['--run', '--shot'], ['--run', '--shot', 'A-main-before', '--all'], ['--run', '--all', '--force'], ['--run', '--all', '--all'], ['--run', '--shot', '--regenerate']]) assert.throws(() => parseGenerationArgs(args));
});

test('explicit regeneration versions raw names, preserves ledger, and cannot bypass ambiguous charges', () => {
  const old = { shot_id: 'before', state: 'completed', raw_file: 'raw/before.png', raw_sha256: 'original', cost_usd: 0.1 };
  const ledger = { attempts: [old] };
  const planned = generationAttemptPlan(ledger, 'before', { regenerate: true });
  assert.deepEqual(planned, { generate: true, version: 2, file_stem: 'before-v2', regenerated_from_sha256: 'original' });
  assert.equal(ledger.attempts.length, 1);
  assert.equal(old.raw_file, 'raw/before.png');
  ledger.attempts.push({ ...old, version: 2, raw_file: 'raw/before-v2.png', raw_sha256: 'updated', cost_usd: 0.2 });
  assert.equal(generationAttemptPlan(ledger, 'before', { regenerate: true }).file_stem, 'before-v3');
  assert.equal(generationAttemptPlan(ledger, 'before').generate, false);
  assert.ok(Math.abs(costSummary(ledger).known_generation_cost_usd - 0.3) < 1e-12);
  assert.throws(() => generationAttemptPlan(ledger, 'missing', { regenerate: true }), /nothing to regenerate/);
  for (const state of ['started', 'failed']) assert.throws(() => generationAttemptPlan({ attempts: [{ ...old, state }] }, 'before', { regenerate: true }), /ambiguous attempt/);
});

test('a regenerated before invalidates its old after until explicitly regenerated', () => {
  const shots = [{ id: 'after', role: 'after', base_shot_id: 'before' }];
  const ledger = { attempts: [{ shot_id: 'before', state: 'completed', raw_sha256: 'v1' }, { shot_id: 'after', state: 'completed', reference_sha256: 'v1' }] };
  assert.doesNotThrow(() => assertCurrentPairReferences(ledger, shots));
  ledger.attempts.push({ shot_id: 'before', state: 'completed', raw_sha256: 'v2' });
  assert.throws(() => assertCurrentPairReferences(ledger, shots), /stale before reference/);
  ledger.attempts.push({ shot_id: 'after', state: 'completed', reference_sha256: 'v2' });
  assert.doesNotThrow(() => assertCurrentPairReferences(ledger, shots));
});
