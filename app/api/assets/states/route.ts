import { getAssetStates, EvidenceInputError } from '../../../../lib/project-views.mjs';
import { isProjectId } from '../../../../lib/projects.mjs';
export async function GET(request: Request) {
  const ids = new URL(request.url).searchParams.get('ids');
  const project = new URL(request.url).searchParams.get('project');
  if (project && !isProjectId(project)) return Response.json({ error: 'Invalid project.' }, { status: 400 });
  try {
    const assets = await getAssetStates(ids ? ids.split(',') : [], undefined, project ?? undefined);
    return Response.json({ assets }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof EvidenceInputError ? error.message : 'Pipeline states are temporarily unavailable.' }, { status: error instanceof EvidenceInputError ? 400 : 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
