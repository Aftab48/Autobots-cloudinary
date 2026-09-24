// Re-notify an existing core test image after fixing the account's webhook signing key.
// No new upload, add-on, AI analysis, overwrite, or transformation.
import fs from 'node:fs/promises';
import { getCloudinary } from '../../lib/cloudinary.mjs';
process.loadEnvFile('.env.local');
try {
  const { upload } = JSON.parse(await fs.readFile('artifacts/step2/smoke.json', 'utf8'));
  const result = await getCloudinary().uploader.explicit(upload.public_id, {
    type: 'upload', resource_type: 'image', media_metadata: true, quality_analysis: true, phash: true,
    notification_url: new URL('/api/cloudinary/webhook', process.env.APP_BASE_URL).toString(),
  });
  console.log(JSON.stringify({ public_id: result.public_id, operation: 'explicit', existing_asset: result.asset_id === upload.asset_id, exif_keys: Object.keys(result.image_metadata ?? {}).length, quality: result.quality_analysis, phash: result.phash, etag: result.etag }));
} catch (error) {
  console.error('Re-notification failed:', error.message ?? error.error?.message ?? 'Service request failed');
  process.exitCode = 1;
}
