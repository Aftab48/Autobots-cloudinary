import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject, DEMO_PROJECT, SUPPORTED_ACTIVITIES, getActiveProject, createProject, createSite } from '../../lib/projects.mjs';
import { validateProjectUpload } from '../../lib/upload-context.mjs';
import { parseUploadContext } from '../../lib/cloudinary.mjs';
import { notificationProjectId } from '../../lib/db.mjs';
import { resolveCapture, trustDecision, framesNeedReview } from '../../lib/pipeline-rules.mjs';
import { checklistForDisplay } from '../../lib/project-views.mjs';
import { reviewAssetSite } from '../../lib/pipeline.mjs';
import { types } from '@neondatabase/serverless';
const id = DEMO_PROJECT.id, siteId = '10000000-0000-4000-8000-000000000001';
const base = { resource_type: 'image', bytes: 100, quality_score: 1, etag: 'hash', width: 1000, height: 1000, pipeline_state: 'classified', captured_at: '2026-03-01', site_id: siteId, analysis_result: { relevant_to_project: true, activity: 'river_cleanup' } };
test('Postgres DATE retains calendar day and project year in every timezone', () => {
  assert.equal(types.getTypeParser(1082)('2026-01-01'),'2026-01-01');
  assert.equal(types.getTypeParser(1082)('2026-06-30'),'2026-06-30');
});
test('project data validates editable supported activities and optional date ranges', () => {
  assert.deepEqual(validateProject(DEMO_PROJECT).activities, SUPPORTED_ACTIVITIES);
  assert.deepEqual(validateProject({ ...DEMO_PROJECT, activities: ['tree_plantation'], start_date: '', end_date: '' }).activities, ['tree_plantation']);
  for (const patch of [{ name: ' ' }, { start_date: '2026-02-30' }, { end_date: '2025-01-01' }, { activities: [] }, { activities: ['injected'] }, { activities: ['river_cleanup','river_cleanup'] }]) assert.throws(() => validateProject({ ...DEMO_PROJECT, ...patch }));
});
test('demo is the default while a valid explicit project selection is retained', async () => {
  const other = { id: siteId }, sql = { query: async () => [DEMO_PROJECT,other] };
  assert.equal((await getActiveProject(null,sql)).id, id);
  assert.equal((await getActiveProject(siteId,sql)).id, siteId);
  assert.equal((await getActiveProject('invalid',sql)).id, id);
});
test('project/site writes bind data and verify parent existence', async () => {
  const calls = [], sql = { query: async (text, values) => { calls.push({ text, values }); return text.startsWith('INSERT') ? [{ id }] : text.startsWith('SELECT id FROM projects') ? [{ id }] : []; } };
  await createProject(DEMO_PROJECT,sql); assert.ok(calls[0].values.includes(DEMO_PROJECT.name)); assert.ok(!calls[0].text.includes(DEMO_PROJECT.name));
  await createSite(id,{ name: 'Site D' },sql); assert.equal(calls.at(-1).values[0],id);
  await assert.rejects(createSite(id,{ name: 'Site D', lat: 100, lng: 0 },sql));
});
test('signed batch context validates project/site/activity/date and cannot change provider routing', async () => {
  const sql = { query: async (text, values) => text.includes('FROM projects') ? [{ id, activities: SUPPORTED_ACTIVITIES }] : values[0] === siteId ? [{ id: siteId }] : [] };
  const params = { timestamp: 1000, upload_preset: 'ps02_core', asset_folder: `ps02/${id}`, context: `project=${id}|ps02_analysis_tier=bulk|site_id=${siteId}|activity_hint=river_cleanup|batch_date=2026-03-01` };
  assert.equal(await validateProjectUpload(params,sql,1000),params);
  for (const context of [params.context.replace('bulk','showcase'),params.context+'|capture_time=2026-01-01',params.context+'|detection=captioning',params.context.replace('2026-03-01','2026-02-30'),params.context.replace('river_cleanup','other'),params.context.replace(siteId,'20000000-0000-4000-8000-000000000001')]) await assert.rejects(validateProjectUpload({ ...params,context },sql,1000));
  await assert.rejects(validateProjectUpload({...params,asset_folder:`ps02/${siteId}`},sql,1000));
  assert.ok(await validateProjectUpload({...params,upload_preset:'ps02_showcase',context:params.context.replace('bulk','showcase')},sql,1000));
});
test('notifications cannot move an asset or mismatch context/folder; partial add-ons retain ownership', () => {
  assert.equal(notificationProjectId({asset_folder:`ps02/${id}`,context:{custom:{project:id}}}),id);
  assert.equal(notificationProjectId({}, {project_id:id}),id);
  assert.equal(notificationProjectId({asset_folder:`ps02/${siteId}`},{project_id:id}),null);
  assert.equal(notificationProjectId({asset_folder:`ps02/${id}`,context:{project:siteId}}),null);
  assert.equal(notificationProjectId({asset_folder:'unrelated'}),null);
});
test('batch dates are user supplied after EXIF and capture-page timestamps; hint cannot set observed activity', () => {
  const asset = { raw_cloudinary:{context:{custom:{batch_date:'2026-03-01',activity_hint:'tree_plantation'}},created_at:'2026-09-01'} };
  assert.equal(resolveCapture(asset).capture_source,'user');
  assert.equal(resolveCapture({...asset,exif:{DateTimeOriginal:'2026:02:01 12:00:00'}}).capture_source,'exif');
  assert.equal(resolveCapture({...asset,raw_cloudinary:{context:{custom:{capture_time:'2026-01-01',batch_date:'2026-03-01'}}}}).capture_source,'capture_page');
  assert.equal(resolveCapture(asset).activity,undefined);
});
test('manual site selection including clearing wins over original upload context during reprocessing', () => {
  const sites=[{id:siteId,name:'Site A',lat:1,lng:2},{id,name:'Site B',lat:3,lng:4}];
  const raw_cloudinary={context:{site_id:siteId}};
  assert.equal(resolveCapture({raw_cloudinary,manual_site_reviewed_at:'now',site_id:id},sites).site_id,id);
  assert.equal(resolveCapture({raw_cloudinary,manual_site_reviewed_at:'now',site_id:null},sites).site_id,null);
  const cleared=resolveCapture({raw_cloudinary,manual_site_reviewed_at:'now',site_id:null},sites);
  assert.equal(cleared.lat,null); assert.equal(cleared.lng,null);
  const changed=resolveCapture({raw_cloudinary,manual_site_reviewed_at:'now',site_id:id},sites);
  assert.equal(changed.lat,3); assert.equal(changed.lng,4);
  const withExif=resolveCapture({raw_cloudinary,manual_site_reviewed_at:'now',site_id:id,exif:{GPSLatitude:22.5,GPSLongitude:88.3}},sites);
  assert.equal(withExif.site_id,id); assert.equal(withExif.lat,22.5); assert.equal(withExif.lng,88.3); assert.equal(withExif.location_source,'exif');
});
test('checklist distinguishes pass, evaluated fail, and missing measurement', () => {
  assert.equal(trustDecision(base,DEMO_PROJECT).status,'accepted');
  const decision=trustDecision({...base,quality_score:null,etag:null,analysis_result:null},DEMO_PROJECT);
  assert.equal(decision.checklist.sharp_enough,null); assert.equal(decision.checklist.not_duplicate,null);
  assert.equal(decision.checklist.relevant,null); assert.equal(decision.checklist.activity_in_project,null); assert.equal(decision.status,'review');
  assert.equal(trustDecision({...base,site_id:null},DEMO_PROJECT).checklist.has_location,false);
  assert.equal(trustDecision(base,{...DEMO_PROJECT,start_date:null}).checklist.date_in_project,null);
  assert.match(trustDecision(base,{...DEMO_PROJECT,start_date:null}).checklist_reasons.date_in_project,/Project has no/);
});
test('hard rejected skipped analysis remains not checked; processing checks remain unknown until evaluated', () => {
  const blurry=trustDecision({...base,quality_score:0.1,analysis_result:null},DEMO_PROJECT);
  assert.equal(blurry.status,'rejected'); assert.equal(blurry.checklist.sharp_enough,false); assert.equal(blurry.checklist.relevant,null); assert.match(blurry.checklist_reasons.relevant,/Skipped: image is too blurry/);
  const pending=trustDecision({pipeline_state:'uploaded'},DEMO_PROJECT);
  assert.ok(Object.values(pending.checklist).every(v=>v===null));
  assert.equal(framesNeedReview(Array.from({length:3},()=>({checklist:{sharp_enough:null},analysis_result:{}}))),true);
  const failed=trustDecision({pipeline_state:'failed',etag:'hash'},DEMO_PROJECT);
  assert.equal(failed.checklist.not_duplicate,null); assert.equal(failed.checklist.date_in_project,null); assert.equal(failed.checklist.has_location,null);
});
test('legacy false checklists are normalized from stored evidence without changing stored/manual status', () => {
  const asset={...base,analysis_result:null,status:'accepted',manual_reviewed_at:'now',checklist:{relevant:false}};
  const view=checklistForDisplay(asset,DEMO_PROJECT);
  assert.equal(view.checklist.relevant,null); assert.equal(asset.status,'accepted');
});
test('site changes bind old/new site audit atomically and reject invalid scope without metadata writes', async () => {
  let query,mirrors=0;
  const sql={query:async(text,values)=>{query={text,values};return [{id:'event'}];}};
  const result=await reviewAssetSite(id,{site_id:siteId,reviewer:'A',note:'GPS notes'}, {sql,mirror:async()=>{mirrors++;return true;}});
  assert.equal(result.metadataPending,false); assert.equal(mirrors,1); assert.match(query.text,/s.project_id=p.project_id/); assert.match(query.text,/FOR UPDATE/); assert.match(query.text,/from_site_id,to_site_id/); assert.equal(query.values[1],siteId);
  await assert.rejects(reviewAssetSite(id,{site_id:siteId,reviewer:'A',note:'Wrong site'},{sql:{query:async()=>[]},mirror:async()=>{mirrors++;}}));
  assert.equal(mirrors,1);
});
test('capture-page context round-trips through signing validation and wins over EXIF time and GPS', async () => {
  const sql = { query: async text => text.includes('FROM projects') ? [{ id, activities: SUPPORTED_ACTIVITIES }] : [] };
  const now = Date.parse('2026-09-27T10:00:00.000Z') / 1000;
  const context = `project=${id}|ps02_analysis_tier=bulk|capture_time=2026-09-27T09:58:30.123Z|capture_lat=22.572646|capture_lng=-88.363895|capture_accuracy=12`;
  const params = { timestamp: now, upload_preset: 'ps02_ingest', asset_folder: `ps02/${id}`, context };
  assert.equal(await validateProjectUpload(params, sql, now), params);
  const custom = parseUploadContext(context);
  assert.deepEqual([custom.capture_time, custom.capture_lat, custom.capture_lng, custom.capture_accuracy], ['2026-09-27T09:58:30.123Z', '22.572646', '-88.363895', '12']);
  // Cloudinary returns signed context as context.custom in the stored notification.
  const exif = { DateTimeOriginal: '2026:01:05 08:00:00', GPSLatitude: 20, GPSLongitude: 30 };
  const won = resolveCapture({ raw_cloudinary: { context: { custom } }, exif });
  assert.deepEqual([won.captured_at, won.capture_source, won.lat, won.lng, won.location_source], ['2026-09-27T09:58:30.123Z', 'capture_page', 22.572646, -88.363895, 'capture_page']);
  // GPS denied/unavailable: the page sends time only; time still wins, location falls back to EXIF.
  const timeOnly = `project=${id}|ps02_analysis_tier=bulk|capture_time=2026-09-27T09:58:30.123Z`;
  assert.ok(await validateProjectUpload({ ...params, context: timeOnly }, sql, now));
  const fallback = resolveCapture({ raw_cloudinary: { context: { custom: parseUploadContext(timeOnly) } }, exif });
  assert.deepEqual([fallback.capture_source, fallback.location_source, fallback.lat, fallback.lng], ['capture_page', 'exif', 20, 30]);
});
test('capture-page values are strictly formatted, in range, complete and plausible', async () => {
  const sql = { query: async text => text.includes('FROM projects') ? [{ id, activities: SUPPORTED_ACTIVITIES }] : [] };
  const now = Date.parse('2026-09-27T10:00:00.000Z') / 1000, base = `project=${id}|ps02_analysis_tier=bulk`;
  const gps = '|capture_lat=22.5|capture_lng=88.3';
  for (const extra of ['|capture_time=2026-09-27', '|capture_time=2026-09-27T09:58:30Z', '|capture_time=2026-09-27T09:58:30.123+05:30', '|capture_time=2026-02-30T09:58:30.123Z',
    `|capture_time=2026-09-27T09:58:30.123Z|capture_lat=90.1|capture_lng=0`, `|capture_time=2026-09-27T09:58:30.123Z|capture_lat=0|capture_lng=180.5`, `|capture_time=2026-09-27T09:58:30.123Z|capture_lat=1e1|capture_lng=0`,
    `|capture_time=2026-09-27T09:58:30.123Z|capture_lat=22.5`, gps, `|capture_time=2026-09-27T09:58:30.123Z|capture_accuracy=5`, `|capture_time=2026-09-27T09:58:30.123Z${gps}|capture_accuracy=-5`,
    '|capture_time=2026-09-27T10:06:00.000Z', '|capture_time=2026-09-26T09:00:00.000Z', '|capture_time=2026-09-27T09:58:30.123Z|capture_time=2026-09-27T09:58:31.123Z']) {
    await assert.rejects(validateProjectUpload({ timestamp: now, upload_preset: 'ps02_core', asset_folder: `ps02/${id}`, context: base + extra }, sql, now), undefined, extra);
  }
  assert.ok(await validateProjectUpload({ timestamp: now, upload_preset: 'ps02_core', asset_folder: `ps02/${id}`, context: `${base}|capture_time=2026-09-27T10:04:00.000Z${gps}` }, sql, now));
});
