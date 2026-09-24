import { createSite, ProjectInputError } from '../../../../../lib/projects.mjs';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin && origin !== process.env.APP_BASE_URL) return Response.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 });
  let body; try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  try { return Response.json({ site: await createSite((await params).id, body) }, { status: 201 }); }
  catch (error) { return Response.json({ error: error instanceof ProjectInputError ? error.message : 'Site could not be saved.' }, { status: error instanceof ProjectInputError ? 400 : 503 }); }
}
