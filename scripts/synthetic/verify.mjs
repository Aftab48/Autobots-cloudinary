import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { readShots, readLedger, rawFor, output, readJson, writeJson, sha256 } from './common.mjs';
import { verifyExif, manifestRow, parseCsv } from './metadata.mjs';

export async function verifyDataset() {
const dataset = await readShots();
const ledger = await readLedger();
const manifest = parseCsv(await fs.readFile(path.join(output, 'manifest.csv'), 'utf8'));
const prepared = await readJson(path.join(output, 'preparation-report.json'));
if (manifest.length !== dataset.shots.length || new Set(manifest.map(r => r.shot_id)).size !== manifest.length) throw new Error('Manifest count/uniqueness mismatch');
const report = [];
for (const shot of dataset.shots) {
  const { record } = await rawFor(ledger, shot.id);
  const row = manifest.find(r => r.shot_id === shot.id);
  const expected = manifestRow(shot, record.model);
  if (!row || Object.keys(expected).some(k => String(expected[k]) !== row[k])) throw new Error(`${shot.id}: manifest does not match shot list and ledger`);
  const bytes = await fs.readFile(path.join(output, row.file));
  const check = verifyExif(bytes, shot, row.generator_model);
  const metadata = await sharp(bytes).metadata();
  if (metadata.format !== 'jpeg' || metadata.width !== dataset.format.width || metadata.height !== dataset.format.height) check.errors.push('JPEG format/dimension mismatch');
  if (sha256(bytes) !== prepared.files.find(f => f.shot_id === shot.id)?.sha256) check.errors.push('Prepared file integrity mismatch');
  check.ok = !check.errors.length;
  report.push({ shot_id: shot.id, ...check });
}
await writeJson(path.join(output, 'exif-verification.json'), { verified_at: new Date().toISOString(), total: report.length, passed: report.filter(r => r.ok).length, files: report });
if (report.some(r => !r.ok)) throw new Error('EXIF/manifest verification failed; see exif-verification.json');
console.log(`Verified ${report.length}/${dataset.shots.length}: EXIF, labels, dates/offsets, GPS, omissions, manifest, dimensions and file hashes.`);
return { total: report.length, passed: report.length, files: report };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verifyDataset();
