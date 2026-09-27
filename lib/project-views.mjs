import { database } from './db.mjs';
import { projectId, getCloudinary } from './cloudinary.mjs';
import { trustDecision } from './pipeline-rules.mjs';

export const PAGE_SIZE = 24;
export const STATUSES = ['processing', 'accepted', 'review', 'rejected'];
export const isAssetId = value => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
export class EvidenceInputError extends Error {}

export function parseEvidenceFilters(params = {}) {
  const value = key => {
    const v = params[key];
    if (v === undefined || v === '') return null;
    if (typeof v !== 'string') throw new EvidenceInputError(`Choose one ${key} filter.`);
    return v;
  };
  const status = value('status'), activity = value('activity'), site = value('site');
  if (status && !STATUSES.includes(status)) throw new EvidenceInputError('Choose a valid evidence status.');
  if (activity && !/^[a-z][a-z0-9_]{0,79}$/.test(activity)) throw new EvidenceInputError('Choose a valid activity.');
  if (site && !isAssetId(site)) throw new EvidenceInputError('Choose a valid site.');
  const date = key => {
    const v = value(key);
    if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < '0001-01-01' || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)) throw new EvidenceInputError('Use a valid date in YYYY-MM-DD format.');
    return v;
  };
  const from = date('from'), to = date('to'), pageValue = value('page');
  if (from && to && from > to) throw new EvidenceInputError('The end date must be on or after the start date.');
  if (pageValue && (!/^[1-9]\d{0,5}$/.test(pageValue))) throw new EvidenceInputError('Choose a valid page number.');
  return { status, activity, site, from, to, page: pageValue ? Number(pageValue) : 1 };
}

export function buildEvidenceQuery(filters, countOnly = false, selectedProjectId = projectId) {
  return { text: `SELECT ${countOnly ? 'count(*)::integer AS filtered_total' : 'a.*, s.name AS site_name, count(*) OVER()::integer AS filtered_total'}
    FROM assets a LEFT JOIN sites s ON s.id = a.site_id AND s.project_id = a.project_id
    WHERE a.project_id = $1::uuid
      AND ($2::text IS NULL OR a.status = $2)
      AND ($3::text IS NULL OR a.activity = $3)
      AND ($4::uuid IS NULL OR a.site_id = $4)
      AND ($5::date IS NULL OR a.captured_at >= ($5::date::timestamp AT TIME ZONE 'UTC'))
      AND ($6::date IS NULL OR a.captured_at < (($6::date + 1)::timestamp AT TIME ZONE 'UTC'))
    ${countOnly ? '' : 'ORDER BY a.created_at DESC, a.id ASC LIMIT $7 OFFSET $8'}`,
    values: [selectedProjectId, filters.status, filters.activity, filters.site, filters.from, filters.to, ...(countOnly ? [] : [PAGE_SIZE, (filters.page - 1) * PAGE_SIZE])] };
}

/** @returns {Promise<(Record<string, any> & {sites: Record<string, any>[], activities: string[]}) | null>} */
export async function getProjectContext(sql = database(), selectedProjectId = projectId) {
  const [projects, sites, activities] = await Promise.all([
    sql.query('SELECT * FROM projects WHERE id = $1::uuid', [selectedProjectId]),
    sql.query('SELECT id, name FROM sites WHERE project_id = $1::uuid ORDER BY name, id', [selectedProjectId]),
    sql.query('SELECT DISTINCT activity FROM assets WHERE project_id = $1::uuid AND activity IS NOT NULL ORDER BY activity', [selectedProjectId]),
  ]);
  return projects[0] ? { ...projects[0], sites, activities: [...new Set([...(projects[0].activities ?? []), ...activities.map(row => row.activity)])] } : null;
}

export async function listEvidence(params = {}, sql = database(), selectedProjectId = projectId) {
  const filters = parseEvidenceFilters(params);
  const query = buildEvidenceQuery(filters, false, selectedProjectId);
  const assets = await sql.query(query.text, query.values);
  const [[project], sites] = assets.length ? await Promise.all([sql.query('SELECT * FROM projects WHERE id = $1::uuid', [selectedProjectId]), sql.query('SELECT lat, lng FROM sites WHERE project_id = $1::uuid', [selectedProjectId])]) : [[], []];
  if (project) for (const asset of assets) Object.assign(asset, checklistForDisplay(asset, project, sites));
  let total = assets[0]?.filtered_total ?? 0;
  if (!assets.length && filters.page > 1) {
    const count = buildEvidenceQuery(filters, true, selectedProjectId);
    total = (await sql.query(count.text, count.values))[0]?.filtered_total ?? 0;
  }
  return { assets, filters, total, pageSize: PAGE_SIZE };
}

export async function getDashboard(sql = database(), selectedProjectId = projectId) {
  const [project, statuses, activities, timeline, totals] = await Promise.all([
    getProjectContext(sql, selectedProjectId),
    sql.query('SELECT status, count(*)::integer AS count FROM assets WHERE project_id = $1::uuid GROUP BY status', [selectedProjectId]),
    sql.query(`SELECT activity, count(*) FILTER (WHERE status = 'accepted')::integer AS accepted,
      count(*) FILTER (WHERE status = 'review')::integer AS review FROM assets
      WHERE project_id = $1::uuid GROUP BY activity ORDER BY accepted DESC, review DESC, activity`, [selectedProjectId]),
    sql.query(`SELECT (captured_at AT TIME ZONE 'UTC')::date::text AS day,
      count(*) FILTER (WHERE resource_type = 'image' AND parent_asset_id IS NULL)::integer AS photos,
      count(*) FILTER (WHERE resource_type = 'video')::integer AS videos,
      count(*) FILTER (WHERE parent_asset_id IS NOT NULL)::integer AS frames,
      array_agg(DISTINCT activity) FILTER (WHERE activity IS NOT NULL) AS activities
      FROM assets WHERE project_id = $1::uuid GROUP BY (captured_at AT TIME ZONE 'UTC')::date
      ORDER BY (captured_at AT TIME ZONE 'UTC')::date DESC NULLS LAST`, [selectedProjectId]),
    sql.query(`SELECT count(*)::integer AS assets,
      count(*) FILTER (WHERE parent_asset_id IS NOT NULL)::integer AS frames,
      count(*) FILTER (WHERE pipeline_state IN ('uploaded','analyzing'))::integer AS processing
      FROM assets WHERE project_id = $1::uuid`, [selectedProjectId]),
  ]);
  return { project, statuses, activities, timeline, totals: totals[0] };
}

/** One read for every result card; search logic and responses remain unchanged. */
export async function getAssetStates(ids, sql = database(), selectedProjectId = projectId) {
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => !isAssetId(id))) throw new EvidenceInputError('Provide up to 100 valid asset IDs.');
  if (!ids.length) return [];
  return sql.query('SELECT id, status, pipeline_state FROM assets WHERE project_id = $1::uuid AND id = ANY($2::uuid[])', [selectedProjectId, ids]);
}

export function assetMedia(asset, cloudinary = getCloudinary()) {
  const options = { secure: true, resource_type: asset.resource_type, version: asset.version ?? undefined };
  return {
    original: cloudinary.url(asset.cloudinary_public_id, options),
    preview: cloudinary.url(asset.cloudinary_public_id, { ...options, crop: 'limit', width: 640, height: 420, format: 'jpg', quality: 'auto' }),
  };
}

export async function getEvidenceDetail(id, sql = database(), selectedProjectId = projectId) {
  if (!isAssetId(id)) return null;
  const [asset] = await sql.query(`SELECT a.*, s.name AS site_name FROM assets a
    LEFT JOIN sites s ON s.id = a.site_id AND s.project_id = a.project_id
    WHERE a.id = $1::uuid AND a.project_id = $2::uuid`, [id, selectedProjectId]);
  if (!asset) return null;
  const [[project], sites] = await Promise.all([sql.query('SELECT * FROM projects WHERE id = $1::uuid', [selectedProjectId]), sql.query('SELECT lat, lng FROM sites WHERE project_id = $1::uuid', [selectedProjectId])]);
  if (project) Object.assign(asset, checklistForDisplay(asset, project, sites));
  const [events, frames, comparisons, claims] = await Promise.all([
    sql.query('SELECT * FROM review_events WHERE asset_id = $1::uuid ORDER BY created_at DESC, id', [id]),
    sql.query('SELECT id, frame_offset, status, pipeline_state FROM assets WHERE parent_asset_id = $1::uuid AND project_id = $2::uuid ORDER BY frame_offset', [id, selectedProjectId]),
    sql.query('SELECT id, before_asset_id, after_asset_id, composite_url FROM comparisons WHERE project_id = $2::uuid AND (before_asset_id = $1::uuid OR after_asset_id = $1::uuid)', [id, selectedProjectId]),
    sql.query(`SELECT c.id, c.report_id, c.text, cs.asset_id, cs.comparison_id, cs.derived_url
      FROM claim_sources cs JOIN claims c ON c.id = cs.claim_id JOIN reports r ON r.id = c.report_id
      LEFT JOIN comparisons co ON co.id = cs.comparison_id AND co.project_id = r.project_id
      WHERE r.project_id = $2::uuid AND (cs.asset_id = $1::uuid OR co.before_asset_id = $1::uuid OR co.after_asset_id = $1::uuid)
      ORDER BY c.report_id, c.position`, [id, selectedProjectId]),
  ]);
  return { asset, events, frames, comparisons, claims };
}

export function checklistForDisplay(asset, project, sites = []) {
  const decision = trustDecision(asset, project, { frameFailure: asset.resource_type === 'video' && asset.checklist?.sharp_enough === false, sites });
  return { checklist: decision.checklist, checklist_reasons: decision.checklist_reasons };
}
