import fs from 'node:fs/promises';
import { database } from '../../lib/db.mjs';
import { getCloudinary, assetFolder, presets } from '../../lib/cloudinary.mjs';

process.loadEnvFile('.env.local');
try {
const sql = database();
const statements = (await fs.readFile('migrations/001_evidence.sql', 'utf8')).split(';').map(s => s.trim()).filter(Boolean);
await sql.transaction(statements.map(statement => sql.query(statement)));
console.log('Migration 001 applied (8 domain tables; no ORM or embeddings).');
const cloudinary = getCloudinary();
const notificationUrl = new URL('/api/cloudinary/webhook', process.env.APP_BASE_URL).toString();
for (const name of presets) {
  const options = {
    unsigned: false, asset_folder: assetFolder, overwrite: false,
    media_metadata: true, quality_analysis: true, phash: true,
    notification_url: notificationUrl,
    ...(name !== 'ps02_core' ? { detection: 'captioning' } : {}),
    ...(name === 'ps02_showcase' ? { categorization: 'google_tagging', auto_tagging: 0.6 } : {}),
  };
  let existing;
  try { existing = await cloudinary.api.upload_preset(name); }
  catch (error) { if ((error.http_code ?? error.error?.http_code) !== 404) throw error; }
  if (existing) {
    // Never silently overwrite unrelated account configuration or leave costly flags on core.
    const keys = ['asset_folder', 'overwrite', 'media_metadata', 'quality_analysis', 'phash', 'notification_url', 'detection', 'categorization', 'auto_tagging'];
    if (existing.unsigned !== false || keys.some(key => String(existing.settings[key] ?? '') !== String(options[key] ?? ''))) {
      throw new Error(`Existing ${name} differs from the required settings; inspect it before updating.`);
    }
  } else await cloudinary.api.create_upload_preset({ name, ...options });
  const actual = await cloudinary.api.upload_preset(name);
  console.log(JSON.stringify({ name: actual.name, unsigned: actual.unsigned, settings: actual.settings }));
}
} catch (error) {
  console.error('Step 2 setup failed:', error.message ?? error.error?.message ?? 'Service request failed');
  process.exitCode = 1;
}
