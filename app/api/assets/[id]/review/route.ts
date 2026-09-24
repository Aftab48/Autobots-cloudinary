import { reviewAsset } from '../../../../../lib/pipeline.mjs';

export const runtime = 'nodejs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.test(id)) return Response.json({ error: 'Invalid asset ID' }, { status: 400 });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin && origin !== process.env.APP_BASE_URL) {
    return Response.json({ error: 'Cross-origin review requests are not allowed' }, { status: 403 });
  }
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body || !['processing', 'accepted', 'review', 'rejected'].includes(body.status)
    || typeof body.reviewer !== 'string' || !body.reviewer.trim() || body.reviewer.length > 100
    || typeof body.note !== 'string' || !body.note.trim() || body.note.length > 2000) {
    return Response.json({ error: 'A valid status, reviewer name and reason are required' }, { status: 400 });
  }
  try {
    const asset = await reviewAsset(id, { status: body.status, reviewer: body.reviewer.trim(), note: body.note.trim() });
    if (!asset) return Response.json({ error: 'Asset not found' }, { status: 404 });
    return Response.json({ saved: true, assetId: id, status: asset.status, metadataPending: Boolean(asset.metadata_sync_error) });
  } catch {
    console.error('Review save failed', id);
    return Response.json({ error: 'Review storage unavailable; refresh the history before retrying' }, { status: 503 });
  }
}
