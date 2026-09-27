import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const output = path.join(root, 'data/synthetic');
try { process.loadEnvFile(path.join(root, '.env.local')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const required = name => { const value = process.env[name]?.trim(); if (!value) throw new Error(`Missing ${name} in .env.local`); return value; };
export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; }
}
export async function atomicWrite(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, bytes);
  await fs.rename(temp, file);
}
export const writeJson = (file, value) => atomicWrite(file, JSON.stringify(value, null, 2) + '\n');
export async function readShots() {
  const data = await readJson(path.join(output, 'shotlist.json'));
  if (!Array.isArray(data.shots) || !data.shots.length) throw new Error('No shots');
  const ids = new Set();
  for (const shot of data.shots) {
    if (!/^[a-zA-Z0-9-]+$/.test(shot.id) || ids.has(shot.id)) throw new Error(`Invalid/duplicate shot id: ${shot.id}`);
    ids.add(shot.id);
    if (shot.role === 'after' && (!shot.base_shot_id || !shot.edit_instruction)) throw new Error(`After lacks edit source: ${shot.id}`);
  }
  for (const shot of data.shots) if (shot.base_shot_id && !ids.has(shot.base_shot_id)) throw new Error(`Missing base for ${shot.id}`);
  return data;
}
export const ledgerFile = path.join(output, 'generation-ledger.json');
export const readLedger = () => readJson(ledgerFile, { schema_version: 1, attempts: [] });
export function latestAttempt(ledger, id) { return ledger.attempts.findLast(a => a.shot_id === id); }
export function canGenerate(ledger, id) {
  const previous = latestAttempt(ledger, id);
  if (!previous) return true;
  if (previous.state === 'completed') return false;
  throw new Error(`${id}: prior ${previous.state} attempt may have incurred charges. Inspect ledger/response; no automatic retry.`);
}
export function parseGenerationArgs(args) {
  const allowed = new Set(['--run', '--all', '--shot', '--regenerate']);
  const seen = new Set();
  let shotId = null;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!allowed.has(flag) || seen.has(flag)) throw new Error(`Unknown or duplicate generation argument: ${flag}`);
    seen.add(flag);
    if (flag === '--shot') {
      shotId = args[++i];
      if (!shotId || !/^[a-zA-Z0-9-]+$/.test(shotId) || shotId.startsWith('--')) throw new Error('--shot requires a valid shot ID');
    }
  }
  const all = seen.has('--all'), regenerate = seen.has('--regenerate');
  if (!seen.has('--run') || all === Boolean(shotId) || (regenerate && all)) throw new Error('Usage: --run (--all | --shot ID [--regenerate]); regeneration is single-shot only');
  return { all, shotId, regenerate };
}
export function generationAttemptPlan(ledger, id, { regenerate = false } = {}) {
  const previous = latestAttempt(ledger, id);
  if (!regenerate) return { generate: canGenerate(ledger, id), version: previous?.version ?? 1, file_stem: id };
  if (!previous) throw new Error(`${id}: nothing to regenerate; use --shot without --regenerate`);
  if (previous.state !== 'completed') throw new Error(`${id}: prior ${previous.state} attempt may have incurred charges; regeneration cannot bypass an ambiguous attempt`);
  const attempts = ledger.attempts.filter(a => a.shot_id === id);
  const version = Math.max(attempts.length, ...attempts.map(a => a.version ?? 1)) + 1;
  return { generate: true, version, file_stem: `${id}-v${version}`, regenerated_from_sha256: previous.raw_sha256 };
}
export function assertCurrentPairReferences(ledger, shots) {
  for (const shot of shots.filter(s => s.role === 'after')) {
    const after = latestAttempt(ledger, shot.id);
    const before = latestAttempt(ledger, shot.base_shot_id);
    if (after?.state === 'completed' && before?.state === 'completed' && after.reference_sha256 !== before.raw_sha256) throw new Error(`${shot.id}: stale before reference; explicitly regenerate this after from latest ${shot.base_shot_id}`);
  }
}
export function decodeImage(url) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(url ?? '');
  if (!match) throw new Error('Expected image data URL (PNG, JPEG or WebP); response retained for inspection');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length) throw new Error('Empty generated image');
  return { bytes, mime: match[1], extension: { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[match[1]] };
}
export function costFromUsage(usage) {
  const cost = usage?.cost;
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null;
}
export function costSummary(ledger) {
  const paid = ledger.attempts.filter(a => a.kind !== 'local_derivative');
  return { known_generation_cost_usd: paid.reduce((n, a) => n + (a.cost_usd ?? 0), 0), unknown_cost_shots: paid.filter(a => a.cost_usd == null).map(a => a.shot_id), generation_attempts: paid.length };
}
export async function rawFor(ledger, id) {
  const record = latestAttempt(ledger, id);
  if (record?.state !== 'completed' || !record.raw_file) throw new Error(`Generate dependency first: ${id}`);
  if (record.kind === 'edit') assertCurrentPairReferences(ledger, [{ id, role: 'after', base_shot_id: record.reference_shot_id }]);
  const bytes = await fs.readFile(path.join(output, record.raw_file));
  if (sha256(bytes) !== record.raw_sha256) throw new Error(`Raw integrity mismatch: ${id}`);
  return { record, bytes };
}
export async function fetchCatalog() {
  const response = await fetch('https://openrouter.ai/api/v1/images/models', { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`OpenRouter model catalog HTTP ${response.status}`);
  const json = await response.json();
  if (!Array.isArray(json.data)) throw new Error('Unexpected model catalog');
  return json.data.filter(m => m.architecture?.output_modalities?.includes('image'));
}
