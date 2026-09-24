import assert from 'node:assert/strict';
import { database } from '../../lib/db.mjs';
import { createProject, createSite, DEMO_PROJECT } from '../../lib/projects.mjs';
import { reviewAssetSite } from '../../lib/pipeline.mjs';
import { buildEvidenceQuery, parseEvidenceFilters } from '../../lib/project-views.mjs';
process.loadEnvFile('.env.local');
const sql=database(), statements=[];
const id=n=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const project=id(1), other=id(2), site=id(3), foreign=id(4), asset=id(5);
const add=(text,values=[])=>{const i=statements.length;statements.push(sql.query(text,values));return i;};
for (const table of ['projects','sites','assets','review_events']) add(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING CONSTRAINTS) ON COMMIT DROP`);
const projectCalls=[];
await createProject(DEMO_PROJECT,{query:async(text,values)=>{projectCalls.push({text,values});return [{}];}});
const created=add(projectCalls[0].text,projectCalls[0].values);
add('INSERT INTO projects(id,name,activities) VALUES ($1,\'Project A\',$3),($2,\'Project B\',$3)',[project,other,['river_cleanup']]);
const siteCalls=[];
await createSite(project,{name:'Site from API',lat:22.5,lng:88.3},{query:async(text,values)=>{siteCalls.push({text,values});return text.includes('SELECT id FROM projects')?[{id:project}]:[];}});
const siteCreated=siteCalls.map(q=>add(q.text,q.values)).at(-1);
add('INSERT INTO sites(id,project_id,name) VALUES ($1,$2,\'Site A\'),($3,$4,\'Foreign\')',[site,project,foreign,other]);
add(`INSERT INTO assets(id,project_id,cloudinary_asset_id,cloudinary_public_id,resource_type,status,pipeline_state,manual_reviewed_at,analysis_result)
  VALUES ($1,$2,'site-edit-fixture','site-edit-fixture','image','accepted','classified',now(),'{"caption":"cached"}'::jsonb),
  ($3,$4,'foreign-fixture','foreign-fixture','image','review','classified',NULL,NULL)`,[asset,project,id(6),other]);
async function siteQuery(siteId,note) {
  let captured;
  await reviewAssetSite(asset,{site_id:siteId,reviewer:'Fixture reviewer',note},{sql:{query:async(text,values)=>{captured={text,values};return [{id:'event'}];}},mirror:async()=>true});
  return add(captured.text,captured.values);
}
const assign=await siteQuery(site,'Assign to Site A');
const afterAssign=add('SELECT * FROM assets WHERE id=$1',[asset]);
const rejectForeign=await siteQuery(foreign,'Invalid foreign site');
const clear=await siteQuery(null,'Clear site');
const afterClear=add('SELECT * FROM assets WHERE id=$1',[asset]);
const events=add('SELECT event_type,from_status,to_status,from_site_id,to_site_id,note FROM review_events WHERE asset_id=$1 ORDER BY note',[asset]);
const evidence=buildEvidenceQuery(parseEvidenceFilters({}),false,project);
const scoped=add(evidence.text,evidence.values);
const results=await sql.transaction(statements);
assert.equal(results[created][0].name,DEMO_PROJECT.name);
assert.equal(results[created][0].start_date,'2026-01-01'); assert.equal(results[created][0].end_date,'2026-06-30');
assert.deepEqual(results[created][0].activities,DEMO_PROJECT.activities);
assert.equal(results[siteCreated][0].project_id,project);
assert.equal(results[assign][0].from_site_id,null); assert.equal(results[assign][0].to_site_id,site);
assert.equal(results[afterAssign][0].site_id,site); assert.ok(results[afterAssign][0].manual_site_reviewed_at);
assert.equal(results[rejectForeign].length,0);
assert.equal(results[clear][0].from_site_id,site); assert.equal(results[clear][0].to_site_id,null);
assert.equal(results[afterClear][0].site_id,null); assert.equal(results[afterClear][0].status,'accepted');
assert.deepEqual(results[afterClear][0].analysis_result,{caption:'cached'});
assert.equal(results[events].length,2); assert.ok(results[events].every(e=>e.event_type==='site'&&e.from_status==='accepted'&&e.to_status==='accepted'));
assert.deepEqual(results[scoped].map(a=>a.id),[asset]);
console.log('Project context integration passed: exact project/date/activity persistence, site creation, project-scoped evidence, atomic site assignment/clearing audit, foreign-site rejection, preserved manual status and cached analysis. Temporary tables dropped; no media/AI calls.');
