import { verifyWebhook } from '../../../../lib/cloudinary.mjs';
import { storeNotification } from '../../../../lib/db.mjs';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.text();
  try {
    if (!verifyWebhook(body, request.headers.get('x-cld-timestamp'), request.headers.get('x-cld-signature'))) {
      return Response.json({ error: 'Invalid notification signature' }, { status: 401 });
    }
  } catch {
    return Response.json({ error: 'Webhook verification unavailable' }, { status: 503 });
  }
  let data;
  try { data = JSON.parse(body); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return Response.json({ error: 'Invalid notification' }, { status: 400 });
  try {
    const assetId = await storeNotification(data);
    return Response.json({ received: true, assetId, ignored: !assetId });
  } catch {
    // Non-2xx makes a transient database failure retryable by Cloudinary.
    console.error('Cloudinary notification database write failed');
    return Response.json({ error: 'Evidence storage unavailable' }, { status: 503 });
  }
}
