import OpenAI from 'openai';
import { z } from 'zod';
import { getCloudinary } from './cloudinary.mjs';
import { activities, buildFallbackMessages, buildQuestionBody, fallbackSchema, LLM_SETTINGS, normalizeVision } from './analysis-prompts.mjs';

export function safeError(error) {
  const secrets = [process.env.CLOUDINARY_URL, process.env.DATABASE_URL, process.env.OPENROUTER_API_KEY].filter(Boolean);
  try {
    const cloud = new URL(process.env.CLOUDINARY_URL);
    for (const value of [cloud.password, cloud.username]) {
      if (value) secrets.push(value);
      try { if (value) secrets.push(decodeURIComponent(value)); } catch { /* malformed encoding */ }
    }
  } catch { /* Error reporting must also work with missing/broken configuration. */ }
  const seen = new WeakSet();
  const clean = (value, depth = 0) => {
    if (typeof value === 'string') return secrets.reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value);
    if (!value || typeof value !== 'object') return typeof value === 'bigint' ? String(value) : value;
    if (seen.has(value) || depth > 8) return '[OMITTED]';
    seen.add(value);
    return Array.isArray(value) ? value.map(item => clean(item, depth + 1))
      : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item, depth + 1)]));
  };
  try {
    return clean({ message: String(error?.message ?? 'Unknown error').slice(0, 2000), code: error?.code ?? null, status: error?.status ?? error?.http_code ?? null, field: error?.field ?? null, response: error?.response ?? null });
  } catch { return { message: 'Error details unavailable', code: null, status: null }; }
}
export function deliveryUrl(asset) {
  return getCloudinary().url(asset.cloudinary_public_id, { secure: true, version: asset.version, resource_type: asset.resource_type, crop: 'limit', width: 1024, format: 'jpg' });
}
export async function callLlm(asset, project, attempt) {
  if (!process.env.LLM_MODEL_VISION || !process.env.OPENROUTER_API_KEY) throw new Error('Vision LLM environment is incomplete');
  const client = new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY, maxRetries: 0, timeout: 90000 });
  const context = JSON.stringify({ name: project.name, description: project.description, allowed_activities: project.activities, cloudinary_caption: asset.cld_caption, cloudinary_tags: asset.cld_tags });
  const messages = buildFallbackMessages(deliveryUrl(asset), context);
  messages[0].content += `\nFor this project, select activity only from ${JSON.stringify(project.activities.filter(a => activities.includes(a)))} or other. Use other for any activity outside that list.`;
  if (attempt) messages.push({ role: 'user', content: 'The previous output failed validation. Return only a complete JSON object matching the required schema.' });
  const response = await client.chat.completions.create({ model: process.env.LLM_MODEL_VISION, messages, ...LLM_SETTINGS, response_format: { type: 'json_schema', json_schema: { name: 'asset_analysis', strict: true, schema: z.toJSONSchema(fallbackSchema, { target: 'draft-7' }) } } });
  return { content: response.choices?.[0]?.finish_reason === 'stop' ? response.choices[0].message.content : '', usage: response.usage ?? null };
}
export async function callVision(asset, project) {
  const config = new URL(process.env.CLOUDINARY_URL);
  const auth = Buffer.from(`${decodeURIComponent(config.username)}:${decodeURIComponent(config.password)}`).toString('base64');
  const context = JSON.stringify({ name: project.name, description: project.description, allowed_activities: project.activities, cloudinary_caption: asset.cld_caption, cloudinary_tags: asset.cld_tags });
  const body = buildQuestionBody(deliveryUrl(asset), context);
  body.prompts[2] += ` For this project, choose only from ${JSON.stringify(project.activities.filter(a => activities.includes(a)))} or other; use other for activities outside that list.`;
  const response = await fetch(`https://api.cloudinary.com/v2/analysis/${config.hostname}/analyze/ai_vision_general`, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  const raw = await response.json();
  if (!response.ok || raw.error) throw Object.assign(new Error(`AI Vision HTTP ${response.status}`), { status: response.status, response: raw });
  return { raw, normalize: () => normalizeVision(raw) };
}
