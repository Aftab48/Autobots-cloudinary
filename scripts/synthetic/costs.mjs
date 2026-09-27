import path from 'node:path';
import fs from 'node:fs/promises';
import { output, required, readLedger, ledgerFile, writeJson, costSummary } from './common.mjs';

await fs.mkdir(output, { recursive: true });
const lockPath = path.join(output, '.generation.lock');
const lock = await fs.open(lockPath, 'wx').catch(() => { throw new Error('Generation is active or its lock needs inspection. Reconcile costs only after generation stops.'); });
try {
const ledger = await readLedger();
// Read-only reconciliation; never repeats a paid generation to recover cost.
for (const attempt of ledger.attempts) {
  if (attempt.kind === 'local_derivative' || attempt.cost_usd != null || !attempt.response_id) continue;
  const response = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(attempt.response_id)}`, { headers: { Authorization: `Bearer ${required('OPENROUTER_API_KEY')}` }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) { attempt.cost_lookup_status = response.status; continue; }
  const json = await response.json();
  if (typeof json.data?.total_cost === 'number' && Number.isFinite(json.data.total_cost) && json.data.total_cost >= 0) {
    attempt.cost_usd = json.data.total_cost;
    attempt.cost_source = 'GET /generation total_cost';
  }
}
await writeJson(ledgerFile, ledger);
const summary = { reconciled_at: new Date().toISOString(), ...costSummary(ledger) };
await writeJson(path.join(output, 'generation-cost.json'), summary);
console.log(JSON.stringify(summary, null, 2));
} finally { await lock.close(); await fs.unlink(lockPath); }
