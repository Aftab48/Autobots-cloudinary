import { neon } from '@neondatabase/serverless';
import { projectId, assetFolder } from './cloudinary.mjs';

export function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  return neon(process.env.DATABASE_URL);
}

/** @param {{status?: string|null}} options */
export async function listAssets({ status = null } = {}) {
  return database()`SELECT * FROM assets WHERE project_id = ${projectId} AND (${status}::text IS NULL OR status = ${status}) ORDER BY created_at DESC LIMIT 100`;
}

export async function getAsset(id) {
  return (await database()`SELECT * FROM assets WHERE id = ${id} AND project_id = ${projectId}`)[0] ?? null;
}

export async function listReviewEvents(id) {
  return database()`SELECT * FROM review_events WHERE asset_id = ${id} ORDER BY created_at DESC`;
}

// Single atomic upsert: retries are harmless and late add-on notifications cannot erase core fields.
export async function storeNotification(data) {
  const sql = database();
  if (typeof data.asset_id !== 'string') return null;
  const existing = await sql`SELECT id, cloudinary_public_id, resource_type FROM assets WHERE cloudinary_asset_id = ${data.asset_id}`;
  if (data.asset_folder !== assetFolder && !existing.length) return null;
  const publicId = data.public_id ?? existing[0]?.cloudinary_public_id;
  const resourceType = data.resource_type ?? existing[0]?.resource_type;
  if (typeof publicId !== 'string' || !['image', 'video'].includes(resourceType)) return null;
  const raw = JSON.stringify(data);
  const exif = data.image_metadata ?? data.media_metadata ?? data.exif ?? null;
  const caption = data.info?.detection?.captioning?.data?.caption ?? null;
  const context = data.context?.custom ?? data.context ?? {};
  // Only verified notifications/server upload responses reach this function.
  // Public widget signatures reject context overrides; this marker is preset-owned.
  const tier = ['showcase', 'demo'].includes(context.ps02_analysis_tier) ? context.ps02_analysis_tier : 'bulk';
  const parentId = typeof context.source_asset_id === 'string' && /^[a-f\d-]{36}$/i.test(context.source_asset_id) ? context.source_asset_id : null;
  const parent = parentId ? (await sql`SELECT id FROM assets WHERE id = ${parentId} AND project_id = ${projectId} AND resource_type = 'video'`)[0] : null;
  const offset = Number(context.frame_offset);
  const frameOffset = parent && Number.isFinite(offset) && offset >= 0 ? offset : null;
  const result = await sql`
    INSERT INTO assets (project_id, cloudinary_asset_id, cloudinary_public_id, version, resource_type,
      width, height, bytes, format, exif, quality_score, etag, phash, cld_tags, cld_caption, raw_cloudinary, cloudinary_events, parent_asset_id, frame_offset, analysis_tier)
    VALUES (${projectId}, ${data.asset_id}, ${publicId}, ${data.version ?? null}, ${resourceType},
      ${data.width ?? null}, ${data.height ?? null}, ${data.bytes ?? null}, ${data.format ?? null},
      ${exif ? JSON.stringify(exif) : null}::jsonb, ${data.quality_analysis?.focus ?? null},
      ${data.etag ?? null}, ${data.phash ?? null}, ${data.tags ?? []}, ${caption}, ${raw}::jsonb, jsonb_build_array(${raw}::jsonb), ${parent?.id ?? null}, ${frameOffset}, ${parent ? 'bulk' : tier})
    ON CONFLICT (cloudinary_asset_id) DO UPDATE SET
      cloudinary_public_id = EXCLUDED.cloudinary_public_id,
      version = COALESCE(EXCLUDED.version, assets.version),
      width = COALESCE(EXCLUDED.width, assets.width), height = COALESCE(EXCLUDED.height, assets.height),
      bytes = COALESCE(EXCLUDED.bytes, assets.bytes), format = COALESCE(EXCLUDED.format, assets.format),
      parent_asset_id = COALESCE(EXCLUDED.parent_asset_id, assets.parent_asset_id), frame_offset = COALESCE(EXCLUDED.frame_offset, assets.frame_offset),
      exif = COALESCE(EXCLUDED.exif, assets.exif), quality_score = COALESCE(EXCLUDED.quality_score, assets.quality_score),
      etag = COALESCE(EXCLUDED.etag, assets.etag), phash = COALESCE(EXCLUDED.phash, assets.phash),
      cld_tags = ARRAY(SELECT DISTINCT unnest(assets.cld_tags || EXCLUDED.cld_tags)),
      cld_caption = COALESCE(EXCLUDED.cld_caption, assets.cld_caption),
      raw_cloudinary = assets.raw_cloudinary || jsonb_strip_nulls(EXCLUDED.raw_cloudinary) ||
        jsonb_build_object('info', COALESCE(assets.raw_cloudinary->'info', '{}'::jsonb) || COALESCE(EXCLUDED.raw_cloudinary->'info', '{}'::jsonb) ||
          jsonb_build_object('detection', COALESCE(assets.raw_cloudinary#>'{info,detection}', '{}'::jsonb) || COALESCE(EXCLUDED.raw_cloudinary#>'{info,detection}', '{}'::jsonb))),
      cloudinary_events = CASE WHEN assets.cloudinary_events @> EXCLUDED.cloudinary_events THEN assets.cloudinary_events
        ELSE assets.cloudinary_events || EXCLUDED.cloudinary_events END
    RETURNING id`;
  return result[0].id;
}
