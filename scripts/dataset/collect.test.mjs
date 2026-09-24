import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { activeCooldown, allowed, csv, inspect, makeProblems, retryDelay } from './collect.mjs';
import { exifFlags } from './exif.mjs';

test('only requested licenses and HTTP(S) original URLs are accepted', () => {
  for (const license of ['cc0', 'pdm', 'by', 'by-sa']) assert.equal(allowed({ license, id: 'id', url: 'https://example.com/photo.jpg' }), true);
  for (const license of ['by-nc', 'by-nd', 'by-nc-sa', '', undefined]) assert.equal(allowed({ license, id: 'id', url: 'https://example.com/photo.jpg' }), false);
  assert.equal(allowed({ license: 'cc0', id: 'id', url: 'file:///private.jpg' }), false);
  for (const category of ['photograph', null, undefined]) assert.equal(allowed({ license: 'cc0', id: 'id', url: 'https://example.com/photo.jpg', category }), true);
  for (const category of ['illustration', 'digitized_artwork']) assert.equal(allowed({ license: 'cc0', id: 'id', url: 'https://example.com/photo.jpg', category }), false);
});

test('CSV quotes attribution punctuation, multiline data and booleans', () => {
  const result = csv([{ creator: 'A, "B"', attribution: 'line one\nline two', has_gps: false }]);
  assert.match(result, /"A, ""B"""/);
  assert.match(result, /"line one\nline two"/);
  assert.match(result, /"false"/);
});

test('Retry-After seconds and dates are honored', () => {
  assert.equal(retryDelay('90'), 90000);
  assert.equal(retryDelay('Thu, 24 Sep 2026 12:00:00 GMT', Date.parse('2026-09-24T11:59:30Z')), 30000);
  assert.equal(retryDelay('bad'), 0);
});

test('persisted cooldown covers all URLs on a host, expires, and leaves other hosts available', () => {
  const cooldowns = JSON.parse(JSON.stringify({ 'https://upload.wikimedia.org': 610000 }));
  assert.equal(activeCooldown(cooldowns, 'https://upload.wikimedia.org/photo-a.jpg', 10000), 610000);
  assert.equal(activeCooldown(cooldowns, 'https://upload.wikimedia.org/different/photo-b.jpg', 600000), 610000);
  assert.equal(activeCooldown(cooldowns, 'https://live.staticflickr.com/photo.jpg', 10000), 0);
  assert.equal(activeCooldown(cooldowns, 'https://upload.wikimedia.org/photo-a.jpg', 610000), 0);
});

test('EXIF date and GPS flags require valid values and tolerate malformed TIFF', async () => {
  const input = sharp({ create: { width: 64, height: 48, channels: 3, background: '#126a73' } });
  const bytes = await input.withExif({ IFD0: { DateTime: '2024:08:16 12:30:00' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '12/1 30/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '77/1 30/1 0/1' } }).jpeg().toBuffer();
  const flags = await inspect(bytes);
  assert.equal(flags.has_exif_date, true);
  assert.equal(flags.has_gps, true);
  const stripped = await sharp(bytes).jpeg().toBuffer();
  assert.equal((await inspect(stripped)).has_exif_date, false);
  assert.equal((await inspect(stripped)).has_gps, false);
  for (const b of [undefined, Buffer.from('junk'), Buffer.from('Exif\0\0II*\0\xff\xff\xff\xff')]) assert.deepEqual(exifFlags(b), { has_exif_date: false, has_gps: false });
});

test('five source photos produce 15 linked problems and byte-identical exact copies', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'ps02-dataset-test-'));
  try {
    await mkdir(path.join(temp, 'data/openverse/test'), { recursive: true });
    const rows = [];
    for (let i = 0; i < 5; i++) {
      const file = `data/openverse/test/source-${i}.jpg`;
      await sharp({ create: { width: 100, height: 80, channels: 3, background: { r: i * 30, g: 120, b: 90 } } }).jpeg().toFile(path.join(temp, file));
      rows.push({ file, query: `query ${i}`, attribution: 'Fixture by test', license: 'cc0' });
    }
    const problems = await makeProblems(rows, temp);
    assert.equal(problems.length, 15);
    for (const row of problems) {
      assert.ok(row.source_file);
      assert.equal(row.license, 'cc0');
      if (row.problem_type === 'exact_duplicate') assert.deepEqual(await readFile(path.join(temp, row.file)), await readFile(path.join(temp, row.source_file)));
      if (row.problem_type === 'near_duplicate') { const metadata = await sharp(path.join(temp, row.file)).metadata(); assert.equal(metadata.width, 55); assert.equal(metadata.format, 'jpeg'); }
      if (row.problem_type === 'heavy_blur') assert.match(row.attribution, /heavily blurred/);
    }
  } finally { await rm(temp, { recursive: true, force: true }); }
});
