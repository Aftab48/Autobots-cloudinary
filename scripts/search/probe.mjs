import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import OpenAI from 'openai';
import { buildSearchMessages, parseSearchQuery, SEARCH_LLM_SETTINGS, SEARCH_PROMPT_VERSION } from '../../lib/search-query.mjs';

if (!process.argv.includes('--run')) throw new Error('Pass --run for exactly three text-only OpenRouter calls.');
process.loadEnvFile('.env.local');
if (!process.env.OPENROUTER_API_KEY || !process.env.LLM_MODEL_TEXT) throw new Error('Text model configuration is required.');
const context = { name: 'River Restoration', start_date: '2026-01-01', sites: [],
  activities: ['river_cleanup', 'waste_removal', 'tree_plantation', 'infrastructure', 'community_participation'] };
const examples = [
  { query: 'Show me evidence of community participation during the river restoration campaign between January and March.', activity: 'community_participation', from: '2026-01-01', to: '2026-03-31', keywords: ['people_present', 'crowd'] },
  { query: 'Find photos showing volunteers planting trees near the river.', activity: 'tree_plantation', from: null, to: null, keywords: ['people_present', 'water_body', 'saplings'] },
  { query: 'Show infrastructure work completed in March.', activity: 'infrastructure', from: '2026-03-01', to: '2026-03-31', keywords: ['completed', 'construction'] },
];
const client = new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY, maxRetries: 0, timeout: 30000 });
const results = [];
for (const example of examples) {
  try {
    const response = await client.chat.completions.create({ model: process.env.LLM_MODEL_TEXT,
      messages: buildSearchMessages(example.query, context), ...SEARCH_LLM_SETTINGS, response_format: { type: 'json_object' } });
    assert.equal(response.choices?.[0]?.finish_reason, 'stop');
    const filters = parseSearchQuery(response.choices[0].message.content, context);
    assert.equal(filters.activity, example.activity);
    assert.equal(filters.date_from, example.from);
    assert.equal(filters.date_to, example.to);
    assert.equal(filters.site, null);
    for (const keyword of example.keywords) assert.ok(filters.keywords.includes(keyword), `Missing expansion: ${keyword}`);
    results.push({ query: example.query, passed: true, filters, usage: response.usage });
  } catch (error) {
    // Do not serialize provider errors: they can contain request credentials.
    results.push({ query: example.query, passed: false, error: error instanceof assert.AssertionError ? error.message : 'Provider request or strict validation failed' });
  }
}
await fs.mkdir('artifacts/search', { recursive: true });
await fs.writeFile('artifacts/search/llm-probe.json', JSON.stringify({ checked_at: new Date().toISOString(), model: process.env.LLM_MODEL_TEXT,
  prompt_version: SEARCH_PROMPT_VERSION, settings: SEARCH_LLM_SETTINGS, context, results }, null, 2) + '\n');
console.log(JSON.stringify(results));
if (results.some(result => !result.passed)) process.exitCode = 1;
