// Explicit, one-asset server-side runner. No scanning, automatic retries, or batch mode.
import { pathToFileURL } from 'node:url';
import { database, getAsset } from '../../lib/db.mjs';
import { processAsset } from '../../lib/pipeline.mjs';
import { safeError } from '../../lib/pipeline-providers.mjs';
import { projectId } from '../../lib/cloudinary.mjs';

export function parseProcessArgs(args) {
  const parsed = { id: null, tier: null, forceLlm: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!['--asset', '--tier', '--llm'].includes(flag) || seen.has(flag)) throw new Error('Usage: node scripts/pipeline/process.mjs --asset UUID [--tier bulk|showcase|demo] [--llm]');
    seen.add(flag);
    if (flag === '--llm') parsed.forceLlm = true;
    else if (flag === '--asset') parsed.id = args[++i];
    else parsed.tier = args[++i];
  }
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(parsed.id ?? '')) throw new Error('A single valid asset UUID is required');
  if (seen.has('--tier') && !['bulk', 'showcase', 'demo'].includes(parsed.tier)) throw new Error('Tier must be bulk, showcase or demo');
  return parsed;
}

async function main() {
  const { id, tier, forceLlm } = parseProcessArgs(process.argv.slice(2));
  process.loadEnvFile('.env.local');
  if (!await getAsset(id)) throw new Error('Asset is not in this project');
  if (tier !== null) await database()`UPDATE assets SET analysis_tier = ${tier} WHERE id = ${id} AND project_id = ${projectId}`;
  const result = await processAsset(id, { forceLlm });
  console.log(JSON.stringify({ id, state: result.state, status: result.asset?.status, analysis_source: result.asset?.analysis_source, reason: result.asset?.status_reason, error: result.error }, null, 2));
  if (result.state !== 'classified') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(safeError(error).message); process.exitCode = 1; });
}
