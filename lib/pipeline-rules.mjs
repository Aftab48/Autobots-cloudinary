import { analysisSchema, validateFallback, normalizeVision } from './analysis-prompts.mjs';
// Deterministic rules; no provider calls. Focus thresholds are internal, not confidence.
export const QUALITY = Object.freeze({ rejectFocus: 0.25, reviewFocus: 0.5, minEdge: 400 });
export const VISION_RESERVATION = 2500;

// Recover only persisted provider output. This function never requests analysis.
export function restoreRecordedAnalysis(asset, project) {
  for (const attempt of [...(asset.analysis_attempts ?? [])].reverse()) {
    if (attempt.provider !== 'llm_fallback' || attempt.content == null) continue;
    try { return validateProjectActivity(validateFallback(attempt.content), project); } catch { /* inspect the next saved response */ }
  }
  if (asset.ai_vision_raw) {
    try { return validateProjectActivity(normalizeVision(asset.ai_vision_raw), project); } catch { /* invalid response remains reviewable */ }
  }
  return null;
}

export function framesNeedReview(frames) {
  return frames.length !== 3 || frames.some(f => !f.checklist?.sharp_enough || !f.analysis_result);
}

function date(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T');
  const calendar = /^(\d{4})-(\d{2})-(\d{2})(?:$|T| )/.exec(normalized);
  if (!calendar) return null;
  const [year, month, day] = calendar.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized) ? `${normalized}Z` : normalized);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
function coordinate(value, ref, max) {
  if (value === null || value === undefined || value === '') return null;
  let n = Number(value);
  if (!Number.isFinite(n) && typeof value === 'string') {
    const parts = value.match(/-?\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?/g)?.map(p => p.includes('/') ? Number(p.split('/')[0]) / Number(p.split('/')[1]) : Number(p));
    if (parts?.length === 3) n = parts[0] + parts[1] / 60 + parts[2] / 3600;
    if (parts?.length === 1) n = parts[0];
  }
  if (/^(?:S|W|South|West)$/i.test(ref ?? '') || (typeof value === 'string' && /(?:[SW]|South|West)\s*$/i.test(value))) n = -Math.abs(n);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}
function gps(lat, lng, latRef, lngRef) {
  const a = coordinate(lat, latRef, 90), b = coordinate(lng, lngRef, 180);
  return a !== null && b !== null ? { lat: a, lng: b } : null;
}
export function resolveCapture(asset, sites = []) {
  const raw = asset.raw_cloudinary ?? {}, context = raw.context?.custom ?? raw.context ?? {}, exif = asset.exif ?? raw.image_metadata ?? raw.media_metadata ?? {};
  const candidates = [
    ['capture_page', date(context.capture_time ?? context.captured_at), gps(context.capture_lat, context.capture_lng)],
    ['exif', date(exif.DateTimeOriginal ?? exif.DateTimeDigitized ?? exif.DateTime), gps(exif.GPSLatitude, exif.GPSLongitude, exif.GPSLatitudeRef, exif.GPSLongitudeRef)],
    ['user', date(context.batch_date), gps(context.batch_lat, context.batch_lng)],
    ['upload_time', date(raw.created_at ?? asset.created_at), null],
  ];
  const timestamp = candidates.find(c => c[1]);
  const location = candidates.find(c => c[2]);
  const site = asset.manual_site_reviewed_at ? sites.find(s => s.id === asset.site_id) : sites.find(s => s.id === context.site_id || s.name === context.site);
  return { captured_at: timestamp?.[1] ?? null, capture_source: timestamp?.[0] ?? null,
    lat: location?.[2]?.lat ?? site?.lat ?? null, lng: location?.[2]?.lng ?? site?.lng ?? null,
    location_source: location?.[0] ?? (site ? 'user' : null), site_id: site?.id ?? null };
}
export function hashDistance(a, b) {
  if (!/^[a-f\d]{16}$/i.test(a ?? '') || !/^[a-f\d]{16}$/i.test(b ?? '')) return null;
  let xor = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), count = 0;
  while (xor) { count++; xor &= xor - 1n; }
  return count;
}
export function chooseAnalysisPath(asset, { forceLlm = false, enabled = false, remaining = 0 } = {}) {
  if (asset.analysis_result || asset.analysis_completed_at || asset.analysis_source) return 'cached';
  return !forceLlm && enabled && ['showcase', 'demo'].includes(asset.analysis_tier) && remaining >= VISION_RESERVATION ? 'cloudinary_ai_vision' : 'llm_fallback';
}
export function restoreLegacyAnalysis(asset) {
  const parsed = analysisSchema.safeParse({ caption: asset.caption, activity: asset.activity, relevant_to_project: asset.relevant,
    category: asset.category, signals: asset.signals, reason: asset.reason, analysis_source: asset.analysis_source });
  return parsed.success ? { analysis: parsed.data, error: null } : { analysis: null, error: 'Legacy stored analysis is invalid; manual review required without re-analysis' };
}
export function validateProjectActivity(analysis, project) {
  if (analysis.activity !== 'other' && !project.activities.includes(analysis.activity)) throw new Error('Analysis activity is outside the configured project list');
  return analysis;
}
export function trustDecision(asset, project, { frameFailure = false } = {}) {
  const a = asset.analysis_result, focus = asset.quality_score;
  const pending = ['uploaded', 'analyzing'].includes(asset.pipeline_state);
  const resolved = asset.pipeline_state === 'classified' || Boolean(asset.capture_source || asset.captured_at);
  const hard = [];
  if (asset.bytes === 0 || asset.raw_cloudinary?.error) hard.push('File is empty or corrupt');
  if (typeof focus === 'number' && focus < QUALITY.rejectFocus && asset.resource_type !== 'video') hard.push('Image is too blurry');
  if (asset.duplicate_of) hard.push('Duplicate of another asset');
  if (a?.relevant_to_project === false) hard.push('Clearly irrelevant to the project');
  const skipped = hard.length ? `Skipped: ${hard[0].toLowerCase()} before analysis` : pending ? 'Analysis is still processing' : asset.analysis_error ? 'Analysis did not return a usable result' : 'Analysis has not been evaluated';
  const hasDates = Boolean(project.start_date && project.end_date);
  const inDate = Boolean(asset.captured_at) && new Date(asset.captured_at) >= new Date(project.start_date) && new Date(asset.captured_at) < new Date(new Date(project.end_date).getTime() + 86400000);
  const dedupeAvailable = Boolean(asset.etag || /^[a-f\d]{16}$/i.test(asset.phash ?? ''));
  const checklist = {
    sharp_enough: typeof focus === 'number' ? focus >= QUALITY.reviewFocus && !frameFailure : null,
    not_duplicate: asset.duplicate_of ? false : !dedupeAvailable || (!asset.duplicate_checked_at && asset.pipeline_state !== 'classified') ? null : true,
    relevant: typeof a?.relevant_to_project === 'boolean' ? a.relevant_to_project : null,
    activity_in_project: a ? a.activity !== 'other' && project.activities.includes(a.activity) : null,
    date_in_project: !hasDates || !resolved ? null : inDate,
    has_location: !resolved ? null : Boolean(asset.site_id || (asset.lat != null && asset.lng != null)),
    sufficient_resolution: asset.width != null && asset.height != null ? asset.width >= QUALITY.minEdge && asset.height >= QUALITY.minEdge : null,
  };
  const checklist_reasons = {
    sharp_enough: focus == null ? 'Cloudinary sharpness measurement is unavailable' : frameFailure ? 'Video frames need review' : checklist.sharp_enough ? 'Sharpness meets the minimum' : 'Sharpness is below the usable threshold',
    not_duplicate: !dedupeAvailable && !asset.duplicate_of ? 'No etag or usable perceptual hash is available' : checklist.not_duplicate == null ? 'Duplicate check is still processing' : asset.duplicate_of ? 'Duplicate of another asset' : 'No matching duplicate found',
    relevant: !a || a.relevant_to_project == null ? skipped : a.relevant_to_project ? 'Visual analysis supports project relevance' : 'Visual analysis found the asset irrelevant',
    activity_in_project: !a ? skipped : checklist.activity_in_project ? 'Observed activity is in the project list' : 'Activity is outside the project list',
    date_in_project: !hasDates ? 'Project has no complete date range' : !resolved ? 'Capture date has not been resolved' : inDate ? 'Capture date is within project dates' : 'Date is missing or outside project dates',
    has_location: !resolved ? 'Location has not been resolved' : checklist.has_location ? 'A site or location is available' : 'No location or site',
    sufficient_resolution: checklist.sufficient_resolution == null ? 'Image dimensions are unavailable' : checklist.sufficient_resolution ? 'Image resolution meets the minimum' : 'Image resolution needs review',
  };
  const soft = Object.keys(checklist).filter(k => checklist[k] !== true).map(k => checklist_reasons[k]);
  return { checklist, checklist_reasons, status: hard.length ? 'rejected' : soft.length ? 'review' : 'accepted', status_reason: (hard.length ? hard : soft.length ? soft : ['All trust checks pass']).join('; ') };
}
