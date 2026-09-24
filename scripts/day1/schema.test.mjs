import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVision, analysisSchema, filtersSchema, strictAnswer } from './common.mjs';

test('documented AI Vision shape maps hyphens to schema keys without invented confidence',()=>{
  const value=normalizeVision({data:{analysis:{tags:[{name:'river-cleanup'},{name:'people-present'}]}}},{data:{analysis:{responses:[{value:'People gather litter.'},{value:'Yes, litter is being collected.'}]}}});
  assert.equal(value.activity,'river_cleanup');
  assert.equal(value.analysis_source,'cloudinary_ai_vision');
  assert.deepEqual(value.signals,['people_present']);
  assert.equal(value.relevant_to_project,true);
});
test('ambiguous activity and unparseable relevance cannot silently pass',()=>{
  const value=normalizeVision({data:{analysis:{tags:[{name:'river-cleanup'},{name:'tree-plantation'}]}}},{data:{analysis:{responses:[{value:'People outdoors.'},{value:'Possibly related.'}]}}});
  assert.equal(value.activity,'other');assert.equal(value.relevant_to_project,null);
  assert.throws(()=>normalizeVision({},{}),/Unexpected AI Vision/);
});
test('LLM schema rejects invented activity, signals, source, extra keys and non-boolean relevance',()=>{
  const valid={caption:'A park.',activity:'other',relevant_to_project:false,category:'other',signals:['vegetation'],reason:'No restoration activity.',analysis_source:'llm_fallback'};
  assert.equal(analysisSchema.safeParse(valid).success,true);
  for(const bad of [{activity:'cleanup'},{signals:['authentic']},{analysis_source:'guessed'},{relevant_to_project:'yes'},{confidence:0.99}])assert.equal(analysisSchema.safeParse({...valid,...bad}).success,false);
});
test('filters reject reversed dates and unconfigured sites; pair answers fail closed',()=>{
  assert.equal(filtersSchema.safeParse({text:'cleanup',date_from:'2026-04-30',date_to:'2026-02-01',activity:'river_cleanup',site:'Site A'}).success,false);
  assert.equal(filtersSchema.safeParse({text:'cleanup',date_from:null,date_to:null,activity:null,site:'invented'}).success,false);
  assert.equal(strictAnswer('some.',['none','some','a lot']),'some');
  assert.equal(strictAnswer('maybe some vegetation',['none','some','a lot']),null);
});
