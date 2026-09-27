import path from 'node:path';
import { readShots, readLedger, rawFor, output, atomicWrite, writeJson, sha256 } from './common.mjs';
import { prepareImage, verifyExif, manifestRow, toCsv } from './metadata.mjs';

const dataset = await readShots();
const ledger = await readLedger();
const manifest = [];
const report = [];
for (const shot of dataset.shots) {
  const { bytes, record } = await rawFor(ledger, shot.id);
  const jpeg = await prepareImage(bytes, shot, record.model, dataset.format);
  const verification = verifyExif(jpeg, shot, record.model);
  if (!verification.ok) throw new Error(`${shot.id}: ${verification.errors.join(', ')}`);
  const row = manifestRow(shot, record.model);
  await atomicWrite(path.join(output, row.file), jpeg);
  manifest.push(row);
  report.push({ shot_id: shot.id, file: row.file, sha256: sha256(jpeg), raw_file: record.raw_file, raw_sha256: record.raw_sha256, verification });
}
await atomicWrite(path.join(output, 'manifest.csv'), toCsv(manifest));
await writeJson(path.join(output, 'preparation-report.json'), { generated_at: new Date().toISOString(), count: report.length, notes: ['Raw generator bytes remain untouched. JPEG conversion preserves XMP/ICC where supported, but cryptographic credentials may no longer validate on transformed derivatives.', 'No-EXIF edge intentionally omits EXIF identity labels. Its filename and manifest still identify it as synthetic.'], files: report });
console.log(`Prepared ${report.length} synthetic JPEGs and manifest.csv; all EXIF readbacks passed.`);
