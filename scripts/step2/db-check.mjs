import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, storeNotification } from '../../lib/db.mjs';
import { assetFolder } from '../../lib/cloudinary.mjs';

process.loadEnvFile('.env.local');
const assetId = `step2-offline-${randomUUID()}`;
const sql = database();
try {
  const initial = { asset_id: assetId, public_id: 'test-not-a-real-upload', resource_type: 'image', asset_folder: assetFolder, image_metadata: { Make: 'Fixture' }, quality_analysis: { focus: 0.75 }, phash: 'test-hash', etag: 'test-etag' };
  await storeNotification(initial);
  await storeNotification(initial);
  await storeNotification({ asset_id: assetId, notification_type: 'captioning', info: { detection: { captioning: { data: { caption: 'Synthetic test only' } } } } });
  await storeNotification({ asset_id: assetId, notification_type: 'tagging', info: { detection: { other: { data: ['example'] } } }, tags: ['example'] });
  const rows = await sql`SELECT * FROM assets WHERE cloudinary_asset_id = ${assetId}`;
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.cloudinary_events.length, 3);
  assert.equal(row.exif.Make, 'Fixture');
  assert.equal(row.phash, 'test-hash');
  assert.equal(row.etag, 'test-etag');
  assert.equal(row.raw_cloudinary.quality_analysis.focus, 0.75);
  assert.equal(row.raw_cloudinary.info.detection.captioning.data.caption, 'Synthetic test only');
  assert.deepEqual(row.raw_cloudinary.info.detection.other.data, ['example']);
  assert.equal(row.cld_caption, 'Synthetic test only');
  assert.deepEqual(row.cld_tags, ['example']);
  console.log('Database integration passed: idempotency, partial late events, core data and nested add-on preservation. No Cloudinary or AI calls.');
} catch (error) {
  console.error('Database integration failed:', error.message);
  process.exitCode = 1;
} finally {
  await sql`DELETE FROM assets WHERE cloudinary_asset_id = ${assetId}`;
}
