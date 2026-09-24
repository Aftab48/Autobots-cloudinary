import { cookies } from 'next/headers';
import { isProjectId, listProjects } from '../../../../lib/projects.mjs';

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin && origin !== process.env.APP_BASE_URL) return Response.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  if (!isProjectId(body?.project_id)) return Response.json({ error: 'Choose a valid project.' }, { status: 400 });
  try {
    if (!(await listProjects()).some(project => project.id === body.project_id)) return Response.json({ error: 'Project not found.' }, { status: 404 });
    (await cookies()).set('ps02_project', body.project_id, { httpOnly: true, sameSite: 'lax', secure: new URL(request.url).protocol === 'https:', path: '/', maxAge: 31536000 });
    return Response.json({ selected: true });
  } catch { return Response.json({ error: 'Project could not be selected.' }, { status: 503 }); }
}
