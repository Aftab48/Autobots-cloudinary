import { database } from './db.mjs';
import { getCloudinary } from './cloudinary.mjs';
import { comparisonCategories, COMPARISON_PROMPT_VERSION, validateComparisonFallback } from './comparison-prompts.mjs';
import { callComparisonLlm, callComparisonVision, deliveryUrl, safeError } from './pipeline-providers.mjs';
import { exhaustVision, reserveVision, settleVision, visionRemaining } from './pipeline.mjs';
import { VISION_RESERVATION } from './pipeline-rules.mjs';
import { isAssetId } from './project-views.mjs';

export class ComparisonInputError extends Error {}
// Plan section 13 says ACCEPTED; this run deliberately allows every non-rejected status.
const ELIGIBLE = `a.resource_type = 'image' AND a.parent_asset_id IS NULL AND a.status <> 'rejected'`;
const day = at => at ? new Date(at).toISOString().slice(0, 10) : 'undated';

/** Plan section 13: none < some < a lot and no < yes, compared per category. */
export function compareAnswers(before, after) {
  return Object.fromEntries(comparisonCategories.map(({ key, answers }) => {
    const from = answers.indexOf(before?.[key]), to = answers.indexOf(after?.[key]);
    if (from < 0 || to < 0) throw new Error(`Unknown ${key} answer`);
    return [key, to > from ? 'more' : to < from ? 'less' : 'same'];
  }));
}

/** Side-by-side composite with date labels. Originals stay untouched; nothing generative. */
export function compositeUrl(before, after, cloudinary = getCloudinary()) {
  const label = text => ({ overlay: { font_family: 'Arial', font_size: 36, font_weight: 'bold', text }, color: 'white' });
  return cloudinary.url(before.cloudinary_public_id, { secure: true, version: before.version ?? undefined, format: 'jpg', transformation: [
    { crop: 'fill', width: 800, height: 600 },
    { crop: 'pad', width: 1600, height: 600, gravity: 'west' },
    // The SDK leaves '/' in string overlays; Cloudinary needs ':' for folders.
    { overlay: after.cloudinary_public_id.replaceAll('/', ':') }, { crop: 'fill', width: 800, height: 600 }, { flags: 'layer_apply', gravity: 'east' },
    label(`BEFORE ${day(before.captured_at)}`), { flags: 'layer_apply', gravity: 'north_west', x: 20, y: 20 },
    label(`AFTER ${day(after.captured_at)}`), { flags: 'layer_apply', gravity: 'north_east', x: 20, y: 20 },
  ] });
}

// AI Vision per image when enabled and budgeted for both calls; otherwise, or on any error, one LLM call.
async function answerPair(before, after, { sql, runLlm, runVision }) {
  const errors = [];
  if (process.env.AI_VISION_ENABLED === 'true' && await visionRemaining(sql) >= 2 * VISION_RESERVATION) {
    try {
      const answers = {};
      for (const [key, asset] of [['before', before], ['after', after]]) {
        if (!(await reserveVision(sql))) throw new Error('AI Vision budget reservation failed');
        let response;
        try { response = await runVision(deliveryUrl(asset)); } catch (error) { await exhaustVision(error, sql); throw error; }
        await settleVision(response.raw, sql);
        answers[key] = response.normalize();
      }
      return { answers: { ...answers, prompt_version: COMPARISON_PROMPT_VERSION }, source: 'cloudinary_ai_vision' };
    } catch (error) { errors.push({ provider: 'cloudinary_ai_vision', ...safeError(error) }); }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    try { response = await runLlm(deliveryUrl(before), deliveryUrl(after), attempt); }
    catch (error) { errors.push({ provider: 'llm_fallback', ...safeError(error) }); break; }
    try { return { answers: { ...validateComparisonFallback(response.content), prompt_version: COMPARISON_PROMPT_VERSION, ...(errors.length ? { errors } : {}) }, source: 'llm_fallback' }; }
    catch (error) { errors.push({ provider: 'llm_fallback', ...safeError(error) }); } // Only validation failures earn attempt 1.
  }
  throw Object.assign(new Error('Comparison analysis failed; nothing was saved'), { errors });
}

const findComparison = async (sql, projectId, beforeId, afterId) => (await sql.query(`SELECT * FROM comparisons
  WHERE project_id = $1::uuid AND before_asset_id = $2::uuid AND after_asset_id = $3::uuid ORDER BY created_at LIMIT 1`, [projectId, beforeId, afterId]))[0] ?? null;

/** Returns a stored comparison for the pair without calling any provider, or creates one. */
export async function createComparison(projectId, beforeId, afterId, { sql = database(), runLlm = callComparisonLlm, runVision = callComparisonVision } = {}) {
  if (![projectId, beforeId, afterId].every(isAssetId) || beforeId === afterId) throw new ComparisonInputError('Choose two different evidence assets.');
  const existing = await findComparison(sql, projectId, beforeId, afterId);
  if (existing) return { comparison: existing, created: false };
  const assets = await sql.query(`SELECT a.* FROM assets a WHERE a.project_id = $1::uuid AND a.id = ANY($2::uuid[]) AND ${ELIGIBLE}`, [projectId, [beforeId, afterId]]);
  const before = assets.find(a => a.id === beforeId), after = assets.find(a => a.id === afterId);
  if (!before || !after) throw new ComparisonInputError('Both assets must be non-rejected top-level photos in the current project.');
  if (before.captured_at && after.captured_at && new Date(before.captured_at) > new Date(after.captured_at)) throw new ComparisonInputError('The before photo must not be captured after the after photo.');
  const { answers, source } = await answerPair(before, after, { sql, runLlm, runVision });
  // ponytail: two simultaneous first requests for one pair can both call the provider; add a claim row if that matters.
  const [comparison] = await sql.query(`INSERT INTO comparisons (project_id, site_id, before_asset_id, after_asset_id, composite_url, changes, answers, analysis_source)
    SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::jsonb, $7::jsonb, $8::text
    WHERE NOT EXISTS (SELECT 1 FROM comparisons WHERE project_id = $1::uuid AND before_asset_id = $3::uuid AND after_asset_id = $4::uuid) RETURNING *`,
  [projectId, before.site_id === after.site_id ? before.site_id : null, beforeId, afterId, compositeUrl(before, after),
    JSON.stringify(compareAnswers(answers.before, answers.after)), JSON.stringify(answers), source]);
  return comparison ? { comparison, created: true } : { comparison: await findComparison(sql, projectId, beforeId, afterId), created: false };
}

/** Default pair per site: earliest vs latest eligible dated photo. */
export function listSitePairs(projectId, sql = database()) {
  const pick = order => `(SELECT a.id, a.captured_at FROM assets a WHERE a.project_id = s.project_id AND a.site_id = s.id AND a.captured_at IS NOT NULL AND ${ELIGIBLE} ORDER BY a.captured_at ${order}, a.id ${order} LIMIT 1)`;
  return sql.query(`SELECT s.id, s.name, f.id AS before_id, f.captured_at AS before_at, l.id AS after_id, l.captured_at AS after_at
    FROM sites s LEFT JOIN LATERAL ${pick('ASC')} f ON true LEFT JOIN LATERAL ${pick('DESC')} l ON true
    WHERE s.project_id = $1::uuid ORDER BY s.name, s.id`, [projectId]);
}

export function listEligibleAssets(projectId, sql = database()) {
  return sql.query(`SELECT a.id, a.captured_at, a.status, s.name AS site_name FROM assets a LEFT JOIN sites s ON s.id = a.site_id
    WHERE a.project_id = $1::uuid AND ${ELIGIBLE} ORDER BY s.name NULLS LAST, a.captured_at NULLS LAST, a.id LIMIT 500`, [projectId]);
}

export function listComparisons(projectId, sql = database()) {
  const asset = t => `jsonb_build_object('id', ${t}.id, 'cloudinary_public_id', ${t}.cloudinary_public_id, 'version', ${t}.version, 'resource_type', ${t}.resource_type, 'captured_at', ${t}.captured_at)`;
  return sql.query(`SELECT c.*, s.name AS site_name, ${asset('b')} AS before_asset, ${asset('a')} AS after_asset FROM comparisons c
    JOIN assets b ON b.id = c.before_asset_id JOIN assets a ON a.id = c.after_asset_id LEFT JOIN sites s ON s.id = c.site_id
    WHERE c.project_id = $1::uuid ORDER BY c.created_at DESC LIMIT 50`, [projectId]);
}
