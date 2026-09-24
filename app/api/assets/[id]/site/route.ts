import { reviewAssetSite } from '../../../../../lib/pipeline.mjs';
import { ProjectInputError } from '../../../../../lib/projects.mjs';
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin && origin !== process.env.APP_BASE_URL) return Response.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 });
  let body; try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  try { return Response.json({ saved: true, ...await reviewAssetSite((await params).id, body) }); }
  catch (error) { return Response.json({ error: error instanceof ProjectInputError ? error.message : 'Site review could not be saved; refresh history before retrying.' }, { status: error instanceof ProjectInputError ? 400 : 503 }); }
}
