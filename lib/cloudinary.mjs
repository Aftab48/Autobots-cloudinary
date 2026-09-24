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
  const allowed = new Set(['timestamp', 'upload_preset', 'source']);
  if (Object.keys(params).some(key => !allowed.has(key))) throw new Error('Unsupported upload parameter');
  if (!presets.includes(String(params.upload_preset))) throw new Error('Unknown upload preset');
  if (!Number.isInteger(params.timestamp) || Math.abs(Number(params.timestamp) - now) > 300) throw new Error('Invalid upload timestamp');
  if (params.source !== undefined && (typeof params.source !== 'string' || !/^uw(?:[\w.-]{0,80})$/.test(params.source))) throw new Error('Invalid widget source');
  return params;
}

export function verifyWebhook(body, timestamp, signature) {
  const seconds = Number(timestamp);
  if (!timestamp || !/^\d+$/.test(timestamp) || !Number.isSafeInteger(seconds) || seconds > Math.floor(Date.now() / 1000) + 60 || !signature) return false;
  return getCloudinary().utils.verifyNotificationSignature(body, seconds, signature, 7200);
}
