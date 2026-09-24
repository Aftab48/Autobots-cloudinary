import OpenAI from 'openai';
import { database } from './db.mjs';
import { getCloudinary } from './cloudinary.mjs';
import { buildSearchMessages, parseSearchQuery, fallbackSearchQuery, normalizeSearchText, searchReferenceYear, SEARCH_LLM_SETTINGS } from './search-query.mjs';

export class SearchInputError extends Error {}
export class SearchNotFoundError extends Error {}
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

export async function getSearchContext(projectId, sql = database()) {
  if (!uuid.test(projectId)) throw new SearchInputError('Invalid project ID');
  const [project] = await sql.query('SELECT id, name, start_date, end_date, activities FROM projects WHERE id = $1::uuid', [projectId]);
  if (!project) return null;
  const sites = await sql.query('SELECT id, name FROM sites WHERE project_id = $1::uuid ORDER BY name, id', [projectId]);
  return { ...project, sites };
}

/** A single bounded text call; every missing/failed/invalid provider path is deterministic. */
export async function resolveSearchQuery(query, context, { useLlm = true, client = null, env = process.env } = {}) {
  let normalized;
  try { normalized = normalizeSearchText(query); } catch (error) { throw new SearchInputError(error.message); }
  if (normalized && useLlm && env.OPENROUTER_API_KEY && env.LLM_MODEL_TEXT) {
    try {
      const provider = client ?? new OpenAI({ apiKey: env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1', timeout: 10000, maxRetries: 0 });
      const completion = await provider.chat.completions.create({ model: env.LLM_MODEL_TEXT,
        ...SEARCH_LLM_SETTINGS, response_format: { type: 'json_object' }, messages: buildSearchMessages(normalized, context) });
      if (completion.choices?.[0]?.finish_reason !== 'stop') throw new Error('Incomplete search response');
      return { filters: parseSearchQuery(completion.choices?.[0]?.message?.content, context), mode: 'llm' };
    } catch { /* No raw provider error or credentials leave the server. */ }
  }
  return { filters: fallbackSearchQuery(normalized, context), mode: 'fallback' };
}

/** All user/provider values are bound. plainto_tsquery handles each term before OR-ing. */
export function buildAssetSearch(projectId, filters) {
  return { text: `WITH terms AS (
    SELECT plainto_tsquery('english', keyword) AS term FROM unnest($2::text[]) AS keyword
  ), query AS (
    SELECT coalesce(string_agg('(' || term::text || ')', ' | ') FILTER (WHERE numnode(term) > 0), '')::tsquery AS tsq FROM terms
  )
  SELECT a.id, a.project_id, p.name AS project_name, a.site_id, s.name AS site_name,
    a.caption, a.cld_caption, a.activity, a.captured_at, a.status, a.resource_type,
    a.cloudinary_public_id, a.version,
    ts_rank(a.search_vector, query.tsq) AS search_rank,
    coalesce((SELECT jsonb_agg(jsonb_build_object('field', field, 'value', value))
      FROM (
        SELECT 'caption' AS field, a.caption AS value UNION ALL
        SELECT 'cld_caption', a.cld_caption UNION ALL
        SELECT 'cld_tags', unnest(a.cld_tags) UNION ALL
        SELECT 'signals', unnest(a.signals) UNION ALL
        SELECT 'activity', a.activity
      ) AS fields
      WHERE value IS NOT NULL AND to_tsvector('english', value) @@ query.tsq), '[]'::jsonb) AS why_matched
  FROM assets a JOIN projects p ON p.id = a.project_id
  LEFT JOIN sites s ON s.id = a.site_id AND s.project_id = a.project_id CROSS JOIN query
  WHERE a.project_id = $1::uuid
    AND (cardinality($2::text[]) = 0 OR a.search_vector @@ query.tsq)
    AND ($3::date IS NULL OR a.captured_at >= ($3::date::timestamp AT TIME ZONE 'UTC'))
    AND ($4::date IS NULL OR a.captured_at < (($4::date + 1)::timestamp AT TIME ZONE 'UTC'))
    AND ($5::text IS NULL OR a.activity = $5::text)
    AND ($6::uuid IS NULL OR a.site_id = $6::uuid)
  ORDER BY (a.status = 'accepted') DESC, search_rank DESC, a.captured_at DESC NULLS LAST, a.id ASC
  LIMIT 101`, values: [projectId, filters.keywords, filters.date_from, filters.date_to, filters.activity, filters.site] };
}

export function presentSearchAsset(asset, filters, cloudinary = getCloudinary()) {
  const { search_rank, cloudinary_public_id, version, ...result } = asset;
  const why_matched = [...asset.why_matched];
  if (filters.date_from || filters.date_to) why_matched.push({ field: 'date', value: `Capture date in requested range: ${new Date(asset.captured_at).toISOString().slice(0, 10)}` });
  if (filters.site) why_matched.push({ field: 'site', value: asset.site_name });
  if (filters.activity && !why_matched.some(hit => hit.field === 'activity')) why_matched.push({ field: 'activity', value: asset.activity });
  const options = { secure: true, resource_type: asset.resource_type, version: version ?? undefined };
  return { ...result, why_matched,
    original_url: cloudinary.url(cloudinary_public_id, options),
    thumbnail_url: cloudinary.url(cloudinary_public_id, { ...options, crop: 'limit', width: 640, height: 420, format: 'jpg', quality: 'auto' }) };
}

export async function searchAssets(projectId, query, { useLlm = true } = {}) {
  try { normalizeSearchText(query); } catch (error) { throw new SearchInputError(error.message); }
  const sql = database();
  const project = await getSearchContext(projectId, sql);
  if (!project) throw new SearchNotFoundError('Project not found');
  const { filters, mode } = await resolveSearchQuery(query, project, { useLlm });
  const statement = buildAssetSearch(projectId, filters);
  const rows = await sql.query(statement.text, statement.values);
  const cloudinary = getCloudinary();
  return { project, query: query.trim(), filters, mode, reference_year: searchReferenceYear(project),
    results: rows.slice(0, 100).map(asset => presentSearchAsset(asset, filters, cloudinary)), has_more: rows.length > 100 };
}
