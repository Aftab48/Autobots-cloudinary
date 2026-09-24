import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getCloudinary, assetFolder } from '../../lib/cloudinary.mjs';

// Explicit, bounded live fixture upload. No analysis APIs or add-ons are requested.
process.loadEnvFile('.env.local');
const output = 'artifacts/pipeline';
await fs.mkdir(output, { recursive: true });
const source = 'data/openverse/river-cleanup-volunteers/db4ea6ad-7a6c-4eea-bb89-a8617a9a6891.jpg';
const manifest = await fs.readFile('data/manifest.csv', 'utf8');
const fixtures = [
  { role: 'original', file: source },
  ...['exact_duplicate', 'near_duplicate', 'heavy_blur'].map(role => ({ role, file: `data/problems/01-${role}.jpg` })),
];
for (const item of fixtures.slice(1)) {
  if (!manifest.split('\n').some(line => line.includes(`"${item.file}"`) && line.includes(`"${source}"`))) {
    throw new Error(`Manifest source_file mismatch: ${item.file}`);
  }
}
if (!process.argv.includes('--upload')) throw new Error('Live upload requires --upload (exactly four ps02_core fixtures).');
const cld = getCloudinary();
const preset = await cld.api.upload_preset('ps02_core');
if (preset.unsigned !== false || preset.settings.detection || preset.settings.categorization || preset.settings.auto_tagging) {
  throw new Error('ps02_core must be signed and have no add-ons.');
}
for (const item of fixtures) {
  const bytes = await fs.readFile(item.file);
  item.sha256 = createHash('sha256').update(bytes).digest('hex');
  const cache = `${output}/upload-${item.role}.json`;
  let stored;
  try { stored = JSON.parse(await fs.readFile(cache, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (stored) {
    if (stored.sha256 !== item.sha256) throw new Error('Fixture changed; inspect existing upload before proceeding.');
    Object.assign(item, stored);
  } else {
    const response = await cld.uploader.upload(item.file, {
      upload_preset: 'ps02_core', asset_folder: assetFolder,
      public_id: `ps02/pipeline-tests/01-${item.role}-${item.sha256.slice(0, 12)}`,
      overwrite: false, resource_type: 'image',
    });
    Object.assign(item, { response });
    await fs.writeFile(cache, JSON.stringify(item, null, 2) + '\n');
  }
  console.log(JSON.stringify({ role: item.role, asset_id: item.response.asset_id,
    focus: item.response.quality_analysis?.focus, width: item.response.width, height: item.response.height,
    etag: item.response.etag, phash: item.response.phash,
    exif_keys: Object.keys(item.response.image_metadata ?? {}) }));
}
await fs.writeFile(`${output}/fixtures.json`, JSON.stringify(fixtures, null, 2) + '\n');
