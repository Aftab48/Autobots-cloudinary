import fs from 'node:fs/promises';
import { database } from '../../lib/db.mjs';
import { getCloudinary, projectId } from '../../lib/cloudinary.mjs';
import { activities, DEFAULT_PROJECT } from '../../lib/analysis-prompts.mjs';

process.loadEnvFile('.env.local');
const sql = database();
const migration = await fs.readFile('migrations/002_pipeline.sql', 'utf8');
await sql.transaction(migration.split(';').map(s => s.trim()).filter(Boolean).map(s => sql.query(s)));
console.log('Migration 002 applied.');
// Initialize only the original ingestion placeholder; preserve any configured project.
await sql`UPDATE projects SET activities = ${activities.filter(a => a !== 'other')}, description = ${DEFAULT_PROJECT}
  WHERE id = ${projectId} AND cardinality(activities) = 0
    AND description = 'Step 2 upload and raw evidence verification. API fixtures are not campaign evidence.'`;
const cld = getCloudinary();
// The widget cannot sign arbitrary context. This server-owned preset marker
// reaches the verified webhook before analysis, so showcase routing is automatic.
const showcase = await cld.api.upload_preset('ps02_showcase');
const presetContext = showcase.settings.context ?? {};
if (typeof presetContext !== 'object' || Array.isArray(presetContext)) throw new Error('Inspect the existing showcase context before changing it.');
if (presetContext.ps02_analysis_tier !== 'showcase') {
  await cld.api.update_upload_preset('ps02_showcase', { context: { ...presetContext, ps02_analysis_tier: 'showcase' } });
}
const marked = await cld.api.upload_preset('ps02_showcase');
if (marked.settings.context?.ps02_analysis_tier !== 'showcase') throw new Error('Showcase tier marker was not persisted.');
console.log('Signed showcase preset routes new assets to the showcase tier.');
const fields = [
  { external_id: 'project', type: 'string', label: 'Project' },
  { external_id: 'site', type: 'string', label: 'Site' },
  ...[['activity', activities], ['review_status', ['processing', 'accepted', 'review', 'rejected']]].map(([key, values]) => ({
    external_id: key, type: 'enum', label: key === 'activity' ? 'Activity' : 'Review status',
    datasource: { values: values.map(value => ({ external_id: value, value })) },
  })),
];
const { metadata_fields: existing } = await cld.api.list_metadata_fields();
for (const field of fields) {
  const actual = existing.find(f => f.external_id === field.external_id);
  if (!actual) await cld.api.add_metadata_field(field);
  else if (actual.type !== field.type || field.datasource?.values.some(v => !actual.datasource?.values.some(a => a.external_id === v.external_id))) {
    throw new Error(`Existing metadata field ${field.external_id} is incompatible; it was not changed.`);
  }
  console.log(`Structured metadata ready: ${field.external_id}`);
}
