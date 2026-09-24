import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { getCloudinary, assetFolder } from '../../lib/cloudinary.mjs';
import { database } from '../../lib/db.mjs';

process.loadEnvFile('.env.local');
try {
  const sql = database();
  const cloudinary = getCloudinary();
  const config = cloudinary.config();
  const base = 'http://localhost:3000';
  const artifact = 'artifacts/step2/smoke.json';
  await fs.mkdir('artifacts/step2', { recursive: true });
  const preset = await cloudinary.api.upload_preset('ps02_core');
  assert.equal(preset.unsigned, false);
  for (const field of ['detection', 'categorization', 'auto_tagging', 'background_removal', 'moderation', 'transformation', 'eager']) assert.equal(preset.settings[field], undefined, `Unexpected ${field} in core preset`);
  const badSignature = await fetch(`${base}/api/upload-signature`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paramsToSign: { timestamp: Math.floor(Date.now()/1000), upload_preset: 'ps02_core', detection: 'captioning' } }) });
  assert.equal(badSignature.status, 400);
  const badWebhook = await fetch(`${base}/api/cloudinary/webhook`, { method: 'POST', body: '{}' });
  assert.equal(badWebhook.status, 401);
  // Reuse a previous successful upload when repeating this check; never loop uploads.
  let upload;
  try {
    const previous = await fs.readFile(artifact, 'utf8');
    if (process.argv.includes('--fresh')) await fs.writeFile('artifacts/step2/smoke-before-key-fix.json', previous);
    else upload = JSON.parse(previous).upload;
  } catch {}
  if (!upload) {
    const paramsToSign = { timestamp: Math.floor(Date.now()/1000), upload_preset: 'ps02_core', source: 'uw' };
    const signed = await fetch(`${base}/api/upload-signature`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paramsToSign }) });
    assert.equal(signed.status, 200);
    const form = new FormData();
    for (const [key, value] of Object.entries(paramsToSign)) form.set(key, String(value));
    form.set('signature', (await signed.json()).signature);
    form.set('api_key', config.api_key);
    form.set('file', 'https://res.cloudinary.com/demo/image/upload/park.jpg');
    const response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloud_name}/image/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(90000) });
    upload = await response.json();
    if (!response.ok) throw new Error(upload.error?.message ?? `Upload HTTP ${response.status}`);
    delete upload.signature;
    delete upload.api_key;
    await fs.writeFile(artifact, JSON.stringify({ upload }, null, 2));
  }
  assert.equal(upload.asset_folder, assetFolder);
  let row;
  for (let attempt = 0; attempt < 30; attempt++) {
    [row] = await sql`SELECT * FROM assets WHERE cloudinary_asset_id = ${upload.asset_id}`;
    if (row?.phash && row?.etag && row?.exif && row?.raw_cloudinary?.quality_analysis) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  assert.ok(row, 'Cloudinary webhook has not created the Asset row');
  assert.ok(Object.keys(row.exif).length > 0, 'Expected actual EXIF metadata');
  assert.ok(row.phash && row.etag && row.raw_cloudinary.quality_analysis);
  const htmlResponse = await fetch(`${base}/evidence`);
  const html = await htmlResponse.text();
  assert.equal(htmlResponse.status, 200);
  for (const value of [row.id, row.phash, row.etag, 'EXIF / image metadata', 'Quality analysis']) assert.ok(html.includes(value));
  const summary = { verified_at: new Date().toISOString(), preset: 'ps02_core', uploads: 1, asset_id: row.id, cloudinary_asset_id: upload.asset_id, public_id: upload.public_id, exif_keys: Object.keys(row.exif), quality_analysis: row.raw_cloudinary.quality_analysis, phash: row.phash, etag: row.etag, webhook_events: row.cloudinary_events.length, list_http_status: htmlResponse.status, signature_override_rejected: badSignature.status, unsigned_webhook_rejected: badWebhook.status, browser_verified: false };
  await fs.writeFile(artifact, JSON.stringify({ summary, upload, webhook: row.cloudinary_events }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error('Step 2 smoke failed:', error.message ?? error.error?.message ?? 'Service request failed');
  process.exitCode = 1;
}
