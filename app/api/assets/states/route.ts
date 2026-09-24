import { getAssetStates, EvidenceInputError } from '../../../../lib/project-views.mjs';
export async function GET(request: Request) {
  const ids = new URL(request.url).searchParams.get('ids');
  try {
    const assets = await getAssetStates(ids ? ids.split(',') : []);
    return Response.json({ assets }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof EvidenceInputError ? error.message : 'Pipeline states are temporarily unavailable.' }, { status: error instanceof EvidenceInputError ? 400 : 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
