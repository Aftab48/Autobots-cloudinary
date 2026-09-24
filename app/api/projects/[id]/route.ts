import { getProjectContext, isAssetId } from '../../../../lib/project-views.mjs';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isAssetId(id)) return Response.json({ error: 'Invalid project.' }, { status: 400 });
  try {
    const project = await getProjectContext(undefined, id);
    return project ? Response.json({ project }) : Response.json({ error: 'Project not found.' }, { status: 404 });
  } catch { return Response.json({ error: 'Project unavailable.' }, { status: 503 }); }
}
