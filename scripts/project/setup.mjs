import { readFile } from 'node:fs/promises';
process.loadEnvFile('.env.local');
import { database } from '../../lib/db.mjs';
import { DEMO_PROJECT } from '../../lib/projects.mjs';
const sql = database();
const migration = await readFile(new URL('../../migrations/005_project_context.sql', import.meta.url), 'utf8');
await sql.transaction(migration.split(';').map(s => s.trim()).filter(Boolean).map(s => sql.query(s)));
const p = DEMO_PROJECT;
await sql.transaction([sql`SELECT pg_advisory_xact_lock(hashtextextended('ps02-demo-seed',0))`,
  sql.query('INSERT INTO projects (id,name,organization,campaign_type,location,start_date,end_date,description,activities) VALUES ($1::uuid,$2,$3,$4,$5,$6::date,$7::date,$8,$9::text[]) ON CONFLICT (id) DO NOTHING', [p.id,p.name,p.organization,p.campaign_type,p.location,p.start_date,p.end_date,p.description,p.activities]),
...['Site A', 'Site B', 'Site C'].map(name => sql.query('INSERT INTO sites (project_id,name) SELECT $1::uuid,$2 WHERE NOT EXISTS (SELECT 1 FROM sites WHERE project_id=$1::uuid AND name=$2)', [p.id,name]))], { isolationLevel: 'ReadCommitted' });
console.log(`Demo project ready: ${p.name} (${p.id}); Sites A, B and C. Existing projects retained.`);
