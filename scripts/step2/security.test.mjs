import assert from 'node:assert/strict';
import test from 'node:test';
import { getCloudinary, validateUploadParams, verifyWebhook } from '../../lib/cloudinary.mjs';

test('signed widget parameters cannot override presets or enable costly operations', () => {
  const params = { timestamp: 1000, upload_preset: 'ps02_core', source: 'uw' };
  assert.deepEqual(validateUploadParams(params, 1000), params);
  for (const extra of [{ detection: 'captioning' }, { transformation: 'e_gen_fill' }, { notification_url: 'https://other.test' }, { context: 'project_id=other' }, { public_id: 'existing' }, { overwrite: true }]) {
    assert.throws(() => validateUploadParams({ ...params, ...extra }, 1000));
  }
  assert.throws(() => validateUploadParams({ ...params, upload_preset: 'unrestricted' }, 1000));
  assert.throws(() => validateUploadParams(params, 5000));
});

test('webhooks require exact signed raw body and recent timestamp', () => {
  const previous = process.env.CLOUDINARY_URL;
  process.env.CLOUDINARY_URL = 'cloudinary://test-key:test-secret@testing';
  try {
    const body = '{"asset_id":"test"}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sign = (value, seconds) => getCloudinary().utils.webhook_signature(value, seconds, { api_secret: 'test-secret' });
    assert.equal(verifyWebhook(body, timestamp, sign(body, timestamp)), true);
    assert.equal(verifyWebhook(body + ' ', timestamp, sign(body, timestamp)), false);
    assert.equal(verifyWebhook(body, timestamp, 'forged'), false);
    assert.equal(verifyWebhook(body, '1', sign(body, '1')), false);
    const future = String(Number(timestamp) + 3600);
    assert.equal(verifyWebhook(body, future, sign(body, future)), false);
    assert.equal(verifyWebhook(body, null, null), false);
  } finally { if (previous === undefined) delete process.env.CLOUDINARY_URL; else process.env.CLOUDINARY_URL = previous; }
});
