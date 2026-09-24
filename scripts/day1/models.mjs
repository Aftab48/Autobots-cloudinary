import { record } from './common.mjs';
await record('model-catalog',{method:'GET',url:'https://openrouter.ai/api/v1/models'},async()=>{
  const r=await fetch('https://openrouter.ai/api/v1/models',{signal:AbortSignal.timeout(30000)});
  if(!r.ok) throw new Error(`Model catalog HTTP ${r.status}`);
  const data=await r.json();
  console.log(data.data.filter(m=>m.architecture.input_modalities.includes('image')).map(m=>({id:m.id,pricing:m.pricing,supported_parameters:m.supported_parameters})));
  return data;
});
