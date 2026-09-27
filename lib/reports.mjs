import OpenAI from 'openai';
import { database } from './db.mjs';
import { getCloudinary } from './cloudinary.mjs';
import { safeError } from './pipeline-providers.mjs';
import { isAssetId } from './project-views.mjs';
import { buildReportMessages, prepareReportInput, REPORT_LLM_SETTINGS, REPORT_PROMPT_VERSION, templateClaims, validateReportClaims } from './report-prompts.mjs';

export class ReportInputError extends Error {}

const countBy = (rows, key) => rows.reduce((counts, row) => { const k = row[key] ?? 'none'; counts[k] = (counts[k] ?? 0) + 1; return counts; }, {});

/** Plan section 14.2 step 1: plain DB facts, accepted evidence and comparisons (same non-rejected rule as lib/comparisons.mjs). */
async function gatherFacts(sql, projectId) {
  const [[media], evidence, comparisons] = await Promise.all([
    sql.query(`SELECT count(a.id)::integer AS media, count(a.id) FILTER (WHERE a.status = 'accepted')::integer AS accepted,
      count(a.id) FILTER (WHERE a.status = 'review')::integer AS review, count(a.id) FILTER (WHERE a.status = 'rejected')::integer AS rejected,
      count(a.id) FILTER (WHERE a.status = 'processing')::integer AS processing, count(a.duplicate_of)::integer AS duplicates_removed
      FROM projects p LEFT JOIN assets a ON a.project_id = p.id WHERE p.id = $1::uuid GROUP BY p.id`, [projectId]),
    // ponytail: every accepted asset goes into one prompt; sample per activity once projects reach hundreds of accepted assets.
    sql.query(`SELECT a.id, a.cloudinary_public_id, a.version, a.resource_type, COALESCE(a.caption, a.cld_caption) AS caption, a.activity, s.name AS site, a.captured_at AS date
      FROM assets a LEFT JOIN sites s ON s.id = a.site_id WHERE a.project_id = $1::uuid AND a.status = 'accepted' ORDER BY a.captured_at NULLS LAST, a.id`, [projectId]),
    sql.query(`SELECT c.id, c.composite_url, c.changes, s.name AS site, b.captured_at AS before_date, a.captured_at AS after_date FROM comparisons c
      JOIN assets b ON b.id = c.before_asset_id JOIN assets a ON a.id = c.after_asset_id LEFT JOIN sites s ON s.id = c.site_id
      WHERE c.project_id = $1::uuid AND b.status <> 'rejected' AND a.status <> 'rejected' ORDER BY c.created_at, c.id`, [projectId]),
  ]);
  if (!media) throw new ReportInputError('Project not found.');
  return { media, evidence, comparisons };
}

/** Step 2-4: one text call on aliases only; any failure or zero kept claims means the template (step 6). */
async function chooseClaims(prepared, { useLlm, client }) {
  if (!prepared.sources.size) return { source: 'template', kept: [], dropped: [], fallback_reason: 'No accepted evidence or comparisons' };
  if (!useLlm) return { source: 'template', ...templateClaims(prepared), fallback_reason: 'LLM not requested' };
  if (!process.env.OPENROUTER_API_KEY || !process.env.LLM_MODEL_TEXT) return { source: 'template', ...templateClaims(prepared), fallback_reason: 'Text LLM environment is incomplete' };
  let dropped = [];
  try {
    const provider = client ?? new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY, maxRetries: 0, timeout: 90000 });
    // No response_format: JSON object mode forces an object root and claims are an array.
    const completion = await provider.chat.completions.create({ model: process.env.LLM_MODEL_TEXT, messages: buildReportMessages(prepared), ...REPORT_LLM_SETTINGS });
    if (completion.choices?.[0]?.finish_reason !== 'stop') throw new Error('Incomplete report response');
    const result = validateReportClaims(completion.choices[0].message.content, prepared);
    if (result.kept.length) return { source: 'llm', ...result };
    dropped = result.dropped;
    throw new Error('No valid cited claims');
  } catch (error) {
    const fallback = templateClaims(prepared);
    return { source: 'template', kept: fallback.kept, dropped: [...dropped, ...fallback.dropped], fallback_reason: safeError(error).message.slice(0, 300) };
  }
}

/** Plan section 14.2: facts, cited claims (LLM or template), then one atomic insert of Report, Claims and ClaimSources. */
export async function generateReport(projectId, { sql = database(), useLlm = true, client = null } = {}) {
  if (!isAssetId(projectId)) throw new ReportInputError('Project not found.');
  const { media, evidence, comparisons } = await gatherFacts(sql, projectId);
  const prepared = prepareReportInput({ evidence, comparisons });
  const { source, kept, dropped, fallback_reason } = await chooseClaims(prepared, { useLlm, client });
  const cloudinary = getCloudinary();
  // Trace chain derived image: a c_fill thumbnail per asset, the stored composite per comparison.
  const derived = new Map([
    ...evidence.map(a => [a.id, cloudinary.url(a.cloudinary_public_id, { secure: true, version: a.version ?? undefined, resource_type: a.resource_type, crop: 'fill', width: 400, height: 300, format: 'jpg', quality: 'auto' })]),
    ...comparisons.map(c => [c.id, c.composite_url]),
  ]);
  const dates = [...prepared.payload.evidence.map(e => e.date), ...prepared.payload.comparisons.flatMap(c => [c.before_date, c.after_date])].filter(Boolean).sort();
  const stats = { media, activities: countBy(evidence, 'activity'), sites: countBy(evidence, 'site'), comparisons: comparisons.length,
    claims_source: source, dropped_claims: dropped.length, prompt_version: REPORT_PROMPT_VERSION, ...(fallback_reason ? { fallback_reason } : {}) };
  const claimRows = kept.map(({ text }, position) => ({ text, position }));
  const sourceRows = kept.flatMap(({ sources }, position) => sources.map(({ type, id }) => ({ position,
    asset_id: type === 'asset' ? id : null, comparison_id: type === 'comparison' ? id : null, derived_url: derived.get(id) ?? null })));
  // One statement, so a failure leaves no partial report.
  const [report] = await sql.query(`WITH r AS (INSERT INTO reports (project_id, period_start, period_end, stats) VALUES ($1::uuid, $2::date, $3::date, $4::jsonb) RETURNING *),
    c AS (INSERT INTO claims (report_id, text, position) SELECT r.id, t.text, t.position FROM r, jsonb_to_recordset($5::jsonb) AS t(text text, position integer) RETURNING id, position),
    s AS (INSERT INTO claim_sources (claim_id, asset_id, comparison_id, derived_url) SELECT c.id, x.asset_id, x.comparison_id, x.derived_url
      FROM c JOIN jsonb_to_recordset($6::jsonb) AS x(position integer, asset_id uuid, comparison_id uuid, derived_url text) ON x.position = c.position)
    SELECT * FROM r`, [projectId, dates[0] ?? null, dates.at(-1) ?? null, JSON.stringify(stats), JSON.stringify(claimRows), JSON.stringify(sourceRows)]);
  return { report, claims: kept, dropped };
}

export function listReports(projectId, sql = database()) {
  return sql.query(`SELECT r.id, r.period_start, r.period_end, r.created_at, r.stats->>'claims_source' AS claims_source, count(c.id)::integer AS claims
    FROM reports r LEFT JOIN claims c ON c.report_id = r.id WHERE r.project_id = $1::uuid GROUP BY r.id ORDER BY r.created_at DESC, r.id LIMIT 50`, [projectId]);
}

/** Plan section 14.1: one report, its claims with sources, the cited comparisons and every original behind them. */
export async function getReport(id, projectId, sql = database()) {
  if (!isAssetId(id) || !isAssetId(projectId)) return null;
  const cited = `WITH cs AS (SELECT cs.asset_id, cs.comparison_id FROM claim_sources cs JOIN claims c ON c.id = cs.claim_id WHERE c.report_id = $1::uuid)`;
  const [[report], rows, comparisons, assets] = await Promise.all([
    sql.query('SELECT * FROM reports WHERE id = $1::uuid AND project_id = $2::uuid', [id, projectId]),
    sql.query(`SELECT c.id, c.text, c.position, cs.asset_id, cs.comparison_id, cs.derived_url FROM claims c LEFT JOIN claim_sources cs ON cs.claim_id = c.id
      WHERE c.report_id = $1::uuid ORDER BY c.position, cs.comparison_id NULLS LAST, cs.asset_id`, [id]),
    sql.query(`${cited} SELECT co.id, co.before_asset_id, co.after_asset_id, co.composite_url, co.changes, co.answers, co.analysis_source, s.name AS site_name
      FROM comparisons co LEFT JOIN sites s ON s.id = co.site_id WHERE co.id IN (SELECT comparison_id FROM cs) ORDER BY co.created_at, co.id`, [id]),
    sql.query(`${cited} SELECT a.id, a.cloudinary_public_id, a.version, a.resource_type, a.captured_at, COALESCE(a.caption, a.cld_caption) AS caption, a.activity, s.name AS site_name
      FROM assets a LEFT JOIN sites s ON s.id = a.site_id WHERE a.id IN (SELECT asset_id FROM cs
        UNION SELECT co.before_asset_id FROM comparisons co JOIN cs ON cs.comparison_id = co.id UNION SELECT co.after_asset_id FROM comparisons co JOIN cs ON cs.comparison_id = co.id)
      ORDER BY a.captured_at NULLS LAST, a.id`, [id]),
  ]);
  if (!report) return null;
  const claims = [];
  for (const { asset_id, comparison_id, derived_url, ...claim } of rows) {
    if (claims.at(-1)?.id !== claim.id) claims.push({ ...claim, sources: [] });
    if (asset_id || comparison_id) claims.at(-1).sources.push({ type: comparison_id ? 'comparison' : 'asset', id: comparison_id ?? asset_id, derived_url });
  }
  return { report, claims, comparisons, assets };
}

/** Plan section 14.3 social formats: [label, width, height]. */
export const CAMPAIGN_FORMATS = [['1:1', 1080, 1080], ['9:16', 1080, 1920], ['16:9', 1920, 1080]];

/** Card text is the claim verbatim, or cut at a word boundary with an ellipsis. Never reworded; emoji and extra whitespace removed. */
export function campaignText(text, max = 160) {
  const clean = String(text).replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u200D\uFE0F\u20E3]/gu, '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const end = clean.lastIndexOf(' ', max - 1);
  return `${clean.slice(0, end > 0 ? end : max - 1).replace(/[\s,;:]+$/, '')}…`;
}

/** Face blur first (always on), then smart crop per format, blur again, then the claim text. Nothing generative; the original is untouched. */
export function campaignCards(asset, text, cloudinary = getCloudinary()) {
  // The SDK double-escapes only ',' and '/' in l_text; '%' must be double-escaped too and '$(' would read as a variable.
  const caption = campaignText(text).replace(/[%$]/g, encodeURIComponent);
  return CAMPAIGN_FORMATS.map(([format, width, height]) => ({ format, width, height, url: cloudinary.url(asset.cloudinary_public_id, { secure: true, version: asset.version ?? undefined, format: 'jpg', transformation: [
    { effect: 'blur_faces:2000' },
    { crop: 'fill', gravity: 'auto', width, height, quality: 'auto' },
    // Live check: the pass on the original missed one face that this pass on the cropped frame caught.
    { effect: 'blur_faces:2000' },
    { overlay: { font_family: 'Arial', font_size: 48, font_weight: 'bold', text_align: 'center', line_spacing: 6, text: caption }, color: 'white', background: 'rgb:000000b3', border: '28px_solid_rgb:000000b3', crop: 'fit', width: width - 160 },
    { flags: 'layer_apply', gravity: 'south', y: Math.round(height * 0.06) },
  ] }) }));
}

/** One claim of a report in the project, its cited ACCEPTED photos and cards for the chosen one. Read-only: cards are computed, not stored. */
export async function getCampaign(reportId, claimId, projectId, { sql = database(), assetId = '' } = {}) {
  if (![reportId, claimId, projectId].every(isAssetId)) return null;
  const rows = await sql.query(`SELECT c.id, c.text, c.report_id, cs.asset_id, a.id AS accepted_id, a.cloudinary_public_id, a.version, a.resource_type
    FROM claims c JOIN reports r ON r.id = c.report_id LEFT JOIN claim_sources cs ON cs.claim_id = c.id
    LEFT JOIN assets a ON a.id = cs.asset_id AND a.project_id = r.project_id AND a.status = 'accepted' AND a.resource_type = 'image'
    WHERE c.id = $1::uuid AND c.report_id = $2::uuid AND r.project_id = $3::uuid ORDER BY cs.comparison_id NULLS LAST, cs.asset_id`, [claimId, reportId, projectId]);
  if (!rows.length) return null;
  const { id, text, report_id } = rows[0];
  const assets = rows.filter(r => r.accepted_id).map(r => ({ id: r.accepted_id, cloudinary_public_id: r.cloudinary_public_id, version: r.version, resource_type: r.resource_type }));
  const asset = assets.find(a => a.id === assetId) ?? assets[0] ?? null;
  const reason = asset ? null : rows.some(r => r.asset_id) ? 'None of the evidence this claim cites is an accepted photo.' : 'This claim cites only a comparison, so there is no single evidence photo to build a card from.';
  return { claim: { id, text, report_id }, assets, asset, cards: asset ? campaignCards(asset, text) : [], reason };
}
