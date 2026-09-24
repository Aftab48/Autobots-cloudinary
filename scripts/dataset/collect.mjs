import { readFile, writeFile, mkdir, rename, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { exifFlags } from './exif.mjs';

export const QUERIES = ['river cleanup volunteers', 'riverbank litter', 'beach cleanup', 'tree planting volunteers', 'sapling planting', 'community cleanup drive', 'garbage on river bank', 'embankment construction', 'mangrove plantation'];
const LICENSES = new Set(['cc0', 'pdm', 'by', 'by-sa']);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'data');
const COLUMNS = ['file', 'query', 'source_url', 'creator', 'license', 'license_version', 'attribution', 'has_exif_date', 'has_gps', 'problem_type', 'source_file', 'openverse_id', 'download_url', 'title'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const local = (relative) => path.join(ROOT, relative);
const exists = async (file) => access(file).then(() => true, () => false);
async function json(file, fallback) { try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
async function atomic(file, contents) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(`${file}.tmp`, contents); await rename(`${file}.tmp`, file); }
export function csv(rows) { return [COLUMNS.join(','), ...rows.map((row) => COLUMNS.map((key) => `"${String(row[key] ?? '').replaceAll('"', '""')}"`).join(','))].join('\r\n') + '\r\n'; }
export function allowed(item) { return LICENSES.has(item.license?.toLowerCase()) && (item.category == null || item.category === 'photograph') && /^https?:\/\//i.test(item.url ?? '') && typeof item.id === 'string'; }
export function retryDelay(value, now = Date.now()) { if (!value) return 0; const n = Number(value); return Number.isFinite(n) ? Math.max(0, n * 1000) : Math.max(0, Date.parse(value) - now) || 0; }
export function activeCooldown(cooldowns, url, now = Date.now()) {
  const until = Number(cooldowns[new URL(url).origin]);
  return Number.isFinite(until) && until > now ? until : 0;
}

let lastApi = 0, lastDownload = 0, apiCalls = 0;
let hostCooldowns = {};
async function request(url, isApi) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only HTTP(S) source URLs are accepted');
  for (let attempt = 0; attempt < 3; attempt++) {
    const until = activeCooldown(hostCooldowns, url);
    if (until) throw Object.assign(new Error(`Host cooldown for ${new URL(url).origin} until ${new Date(until).toISOString()}; rerun later.`), { noRetry: true, fatal: isApi });
    const last = isApi ? lastApi : lastDownload, interval = isApi ? 15000 : 1200;
    await sleep(Math.max(0, last + interval - Date.now()));
    if (isApi) { if (++apiCalls > 150) throw new Error('150-request run limit reached'); lastApi = Date.now(); } else lastDownload = Date.now();
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'PS02-Openverse-Dataset/1.0 (local research collection)', Accept: isApi ? 'application/json' : 'image/*' }, signal: AbortSignal.timeout(45000) });
      if (!response.ok) {
        const detail = isApi ? (await response.text()).slice(0, 500).replace(/[\r\n]+/g, ' ') : '';
        const retryable = response.status === 429 || response.status >= 500;
        const delay = Math.max(retryDelay(response.headers.get('retry-after')), 3000 * (attempt + 1));
        if (retryable) hostCooldowns[new URL(url).origin] = Date.now() + delay;
        if (!isApi) await response.body?.cancel();
        // Long quota waits are a resumable stop, never ignored or shortened.
        if (retryable && delay > 60000) throw Object.assign(new Error(`HTTP ${response.status}; Retry-After ${Math.ceil(delay / 1000)} seconds. Rerun later.`), { fatal: isApi, noRetry: true });
        if (retryable && attempt < 2) { await sleep(delay); continue; }
        throw Object.assign(new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`), { noRetry: true, fatal: isApi && response.status === 429 });
      }
      const max = isApi ? 10 * 1024 * 1024 : 40 * 1024 * 1024;
      if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw Object.assign(new Error('Response exceeds byte limit'), { noRetry: true }); }
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > max) throw Object.assign(new Error('Response exceeds byte limit'), { noRetry: true }); chunks.push(chunk); }
      return Buffer.concat(chunks);
    } catch (error) { if (error.noRetry || attempt === 2) throw error; await sleep(3000 * (attempt + 1)); }
  }
}

export async function inspect(buffer) {
  const metadata = await sharp(buffer, { limitInputPixels: 80000000 }).metadata();
  if (!['jpeg', 'png', 'webp', 'tiff', 'heif', 'avif'].includes(metadata.format) || (metadata.pages ?? 1) > 1) throw new Error('Unsupported or animated image');
  // Decode to reject corrupt images, without changing the saved original bytes.
  await sharp(buffer, { limitInputPixels: 80000000 }).resize(8, 8).raw().toBuffer();
  return { ...exifFlags(metadata.exif), width: metadata.width, height: metadata.height, format: metadata.format };
}

export async function makeProblems(originals, base = ROOT) {
  const rows = [];
  // Prefer a spread across queries, then fill from remaining originals.
  const chosen = [], queries = new Set();
  for (const row of originals) if (!queries.has(row.query) && chosen.length < 5) { queries.add(row.query); chosen.push(row); }
  for (const row of originals) if (chosen.length < 5 && !chosen.includes(row)) chosen.push(row);
  await mkdir(path.join(base, 'data/problems'), { recursive: true });
  for (const [index, row] of chosen.entries()) {
    const input = path.join(base, row.file);
    const metadata = await sharp(input).metadata();
    for (const type of ['near_duplicate', 'exact_duplicate', 'heavy_blur']) {
      const extension = type === 'exact_duplicate' ? path.extname(row.file) : '.jpg';
      const file = `data/problems/${String(index + 1).padStart(2, '0')}-${type}${extension}`;
      const output = path.join(base, file);
      if (type === 'exact_duplicate') await copyFile(input, output);
      else if (type === 'near_duplicate') await sharp(input).rotate().resize({ width: Math.max(1, Math.floor(metadata.width * 0.55)), withoutEnlargement: true }).jpeg({ quality: 35 }).toFile(output);
      else await sharp(input).rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).blur(35).jpeg({ quality: 85 }).toFile(output);
      const flags = await inspect(await readFile(output));
      rows.push({ ...row, ...flags, file, source_file: row.file, problem_type: type, attribution: `${row.attribution}${type === 'exact_duplicate' ? ' Unmodified exact copy with a new filename.' : type === 'near_duplicate' ? ' Modified: resized and JPEG recompressed.' : ' Modified: resized and heavily blurred.'}` });
    }
  }
  return rows;
}

export async function collect({ perQuery = 25, maxPages = 5, problemsOnly = false } = {}) {
  await mkdir(DATA, { recursive: true });
  const stateFile = path.join(DATA, 'collection-state.json');
  const state = await json(stateFile, { version: 1, originals: [], failures: [] });
  if (state.version !== 1) throw new Error('Unknown state version');
  state.host_cooldowns ??= {};
  hostCooldowns = state.host_cooldowns;
  // Verify retained files before trusting a resumed manifest.
  const kept = [];
  for (const row of state.originals) {
    if (!/^data\/openverse\/[a-z0-9-]+\/[a-z0-9-]+\.[a-z]+$/.test(row.file) || !LICENSES.has(row.license)) throw new Error('Invalid state record');
    if (await exists(local(row.file)) && hash(await readFile(local(row.file))) === row.sha256) kept.push(row);
  }
  state.originals = kept;
  const save = () => atomic(stateFile, JSON.stringify(state, null, 2));
  const report = async () => {
    const problems = await makeProblems(state.originals);
    const summary = {
      collected_at: new Date().toISOString(), target_per_query: perQuery, originals: state.originals.length, problems: problems.length,
      per_query: Object.fromEntries(QUERIES.map((q) => [q, state.originals.filter((r) => r.query === q).length])),
      per_license: Object.fromEntries([...LICENSES].map((l) => [l, state.originals.filter((r) => r.license === l).length])),
      originals_with_exif_date: state.originals.filter((r) => r.has_exif_date).length,
      originals_with_gps: state.originals.filter((r) => r.has_gps).length,
      relevance: await exists(path.join(DATA, 'relevance-review.md')) ? 'See data/relevance-review.md for a separately recorded visual review; new downloads after that review may be unreviewed.' : 'Unreviewed: inspect the photos. Search matches and source titles/tags do not prove visual relevance.',
      note: 'Original API image URL bytes preserved. Provider rendition URLs may lack camera-original resolution or EXIF. EXIF dates include DateTime, DateTimeOriginal, and DateTimeDigitized; GPS requires valid latitude/longitude plus references. License metadata comes from Openverse and is retained for source verification.',
      failures: state.failures,
    };
    await atomic(path.join(DATA, 'manifest.csv'), csv([...state.originals, ...problems]));
    await atomic(path.join(DATA, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  };
  try {
    if (!problemsOnly) for (const query of QUERIES) {
      let count = state.originals.filter((r) => r.query === query).length;
      const attempted = new Set();
      // Openverse leaves the category unset on many genuine source photographs.
      // A bounded second pass includes those records when categorized photos run short.
      for (const category of ['photograph', null]) {
      if (count >= perQuery) break;
      for (let page = 1; page <= maxPages && count < perQuery; page++) {
        const cache = path.join(DATA, 'openverse-cache', `${slug(query)}${category ? '' : '-unclassified'}-${page}.json`);
        let result = await json(cache, null);
        if (!result) {
          const url = new URL('https://api.openverse.org/v1/images/');
          const params = new URLSearchParams({ q: query, license: [...LICENSES].join(','), page_size: '20', page: String(page) });
          if (category) params.set('category', category);
          url.search = params;
          result = JSON.parse((await request(url.href, true)).toString('utf8'));
          if (!Array.isArray(result.results)) throw new Error('Unexpected Openverse results shape');
          await atomic(cache, JSON.stringify(result, null, 2));
        }
        for (const item of result.results) {
          if (count >= perQuery) break;
          if (!allowed(item) || attempted.has(item.id) || state.originals.some((r) => r.openverse_id === item.id || r.download_url === item.url)) continue;
          attempted.add(item.id);
          try {
            const bytes = await request(item.url, false);
            const metadata = await inspect(bytes);
            const digest = hash(bytes);
            if (state.originals.some((r) => r.sha256 === digest)) continue;
            const extension = metadata.format === 'jpeg' ? 'jpg' : metadata.format === 'heif' ? 'heic' : metadata.format;
            const file = `data/openverse/${slug(query)}/${slug(item.id)}.${extension}`;
            await atomic(local(file), bytes);
            const source = item.foreign_landing_url || item.url;
            state.originals.push({ file, query, source_url: source, creator: item.creator || 'Unknown creator', license: item.license.toLowerCase(), license_version: item.license_version || '', attribution: item.attribution || `${item.title || 'Untitled'} by ${item.creator || 'Unknown creator'}; ${item.license} ${item.license_version || ''}; ${source}; ${item.license_url || ''}`, ...metadata, problem_type: 'original', source_file: '', openverse_id: item.id, download_url: item.url, title: item.title || '', tags: item.tags || [], sha256: digest });
            await save(); count++;
            console.log(`[${query}] ${count}/${perQuery}: ${item.title || item.id}`);
          } catch (error) { state.failures.push({ query, id: item.id, url: item.url, error: error.message }); await save(); console.warn(`[skip] ${query}: ${error.message}`); if (error.fatal) throw error; }
        }
        if (result.results.length === 0 || page >= result.page_count) break;
      }
      }
      console.log(`[query complete] ${query}: ${count}/${perQuery}`);
    }
  } catch (error) { state.failures.push({ stage: 'collection', error: error.message }); throw error;
  } finally { await save(); await report(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const valid = /^(--per-query=\d+|--max-pages=\d+|--problems-only|--help)$/;
  if (args.some((a) => !valid.test(a))) throw new Error('Usage: node scripts/dataset/collect.mjs [--per-query=25] [--max-pages=5] [--problems-only]');
  if (args.includes('--help')) console.log('Collect anonymous Openverse photographs into data/. Options: --per-query=25 (1-100), --max-pages=5 (1-5), --problems-only (offline). Existing cached results and verified originals are reused.');
  else {
    const perQuery = Number(args.find((a) => a.startsWith('--per-query='))?.split('=')[1] ?? 25);
    const maxPages = Number(args.find((a) => a.startsWith('--max-pages='))?.split('=')[1] ?? 5);
    if (perQuery < 1 || perQuery > 100 || maxPages < 1 || maxPages > 5) throw new Error('per-query must be 1-100 and max-pages 1-5');
    await collect({ perQuery, maxPages, problemsOnly: args.includes('--problems-only') });
  }
}
