import { v2 as cloudinary } from 'cloudinary';

export const projectId = '00000000-0000-4000-8000-000000000002';
export const assetFolder = `ps02/${projectId}`;
export const presets = ['ps02_core', 'ps02_ingest', 'ps02_showcase'];

export function getCloudinary() {
  if (!process.env.CLOUDINARY_URL) throw new Error('CLOUDINARY_URL is required');
  const url = new URL(process.env.CLOUDINARY_URL);
  cloudinary.config({ cloud_name: url.hostname, api_key: decodeURIComponent(url.username), api_secret: decodeURIComponent(url.password), secure: true });
  return cloudinary;
}

/** Only widget-generated safe fields are signed. Analysis flags live in signed presets. */
export function validateUploadParams(/** @type {Record<string, unknown>} */ params, now = Math.floor(Date.now() / 1000)) {
  const allowed = new Set(['timestamp', 'upload_preset', 'source', 'asset_folder', 'context']);
  if (Object.keys(params).some(key => !allowed.has(key))) throw new Error('Unsupported upload parameter');
  if (!presets.includes(String(params.upload_preset))) throw new Error('Unknown upload preset');
  if (!Number.isInteger(params.timestamp) || Math.abs(Number(params.timestamp) - now) > 300) throw new Error('Invalid upload timestamp');
  if (params.source !== undefined && (typeof params.source !== 'string' || !/^uw(?:[\w.-]{0,80})$/.test(params.source))) throw new Error('Invalid widget source');
  if (params.asset_folder !== undefined || params.context !== undefined) {
    if (typeof params.asset_folder !== 'string' || !/^ps02\/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(params.asset_folder)) throw new Error('Invalid project folder');
    const context = parseUploadContext(params.context);
    if (context.project !== params.asset_folder.slice(5)) throw new Error('Context project must match folder');
    const expectedTier = params.upload_preset === 'ps02_showcase' ? 'showcase' : 'bulk';
    if (context.ps02_analysis_tier !== expectedTier) throw new Error('Analysis tier must match the signed preset');
  }
  return params;
}

const SIMPLE_VALUE = /^[a-zA-Z0-9_-]+$/;
const CONTEXT_VALUES = { project: SIMPLE_VALUE, site_id: SIMPLE_VALUE, activity_hint: SIMPLE_VALUE, batch_date: SIMPLE_VALUE, ps02_analysis_tier: SIMPLE_VALUE,
  // Capture page (§8.3): browser UTC time (toISOString) and decimal GPS recorded at capture; accuracy in whole metres.
  capture_time: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, capture_lat: /^-?\d{1,2}(?:\.\d{1,7})?$/, capture_lng: /^-?\d{1,3}(?:\.\d{1,7})?$/, capture_accuracy: /^\d{1,6}$/ };

export function parseUploadContext(value) {
  if (typeof value !== 'string' || value.length > 700) throw new Error('Invalid upload context');
  const context = {};
  for (const part of value.split('|')) {
    const match = /^([a-z][a-z0-9_]*)=(.+)$/.exec(part);
    if (!match || !Object.hasOwn(CONTEXT_VALUES, match[1]) || !CONTEXT_VALUES[match[1]].test(match[2]) || Object.hasOwn(context, match[1])) throw new Error('Unsupported upload context');
    context[match[1]] = match[2];
  }
  const { capture_time: time, capture_lat: lat, capture_lng: lng, capture_accuracy: accuracy } = context;
  if (time !== undefined && (Number.isNaN(Date.parse(time)) || new Date(time).toISOString() !== time)) throw new Error('Invalid capture time');
  // GPS comes as a pair recorded with the capture time; accuracy only describes that fix.
  if ((lat === undefined) !== (lng === undefined) || (lat !== undefined && time === undefined) || (accuracy !== undefined && lat === undefined)) throw new Error('Incomplete capture location');
  if (lat !== undefined && (Math.abs(Number(lat)) > 90 || Math.abs(Number(lng)) > 180)) throw new Error('Capture location is out of range');
  return context;
}

export function verifyWebhook(body, timestamp, signature) {
  const seconds = Number(timestamp);
  if (!timestamp || !/^\d+$/.test(timestamp) || !Number.isSafeInteger(seconds) || seconds > Math.floor(Date.now() / 1000) + 60 || !signature) return false;
  return getCloudinary().utils.verifyNotificationSignature(body, seconds, signature, 7200);
}
