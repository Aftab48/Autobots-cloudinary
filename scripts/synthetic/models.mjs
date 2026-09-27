import path from 'node:path';
import { fetchCatalog, output, writeJson } from './common.mjs';

const models = await fetchCatalog();
await writeJson(path.join(output, 'image-models.json'), { retrieved_at: new Date().toISOString(), source: 'https://openrouter.ai/api/v1/images/models', models });
console.log(JSON.stringify(models.map(m => ({ id: m.id, input_modalities: m.architecture.input_modalities, output_modalities: m.architecture.output_modalities, accepts_image_reference: m.architecture.input_modalities.includes('image'), supported_parameters: m.supported_parameters })), null, 2));
console.log('Image input + output is necessary but does not itself guarantee editing. Verify the selected model documentation before generation.');
