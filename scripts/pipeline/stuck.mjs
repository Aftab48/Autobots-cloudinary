import { pathToFileURL } from 'node:url';
import { listRecoverableAssets } from '../../lib/pipeline-recovery.mjs';
import { safeError } from '../../lib/pipeline-providers.mjs';

export function parseStuckArgs(args) {
  if (!args.length) return 100;
  if (args.length !== 2 || args[0] !== '--limit' || !/^\d+$/.test(args[1])) throw new Error('Usage: npm run pipeline:stuck -- [--limit 1..1000]');
  const limit = Number(args[1]);
  if (limit < 1 || limit > 1000) throw new Error('Limit must be from 1 to 1000');
  return limit;
}
async function main() {
  const limit = parseStuckArgs(process.argv.slice(2));
  process.loadEnvFile('.env.local');
  const assets = await listRecoverableAssets(limit);
  console.log(JSON.stringify({ read_only: true, stale_after_minutes: 15, showing: assets.length, limit,
    assets: assets.map(a => ({ ...a, rerun: `npm run pipeline:process -- --asset ${a.id} --llm` })),
    note: 'Rerun one selected asset. Stored output is reused; an asset with no prior attempt may incur one analysis (plus a malformed-output retry). Ambiguous interrupted calls stay in REVIEW. No automatic batch retry.',
  }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(safeError(error).message); process.exitCode = 1; });
}
