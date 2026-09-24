import { cache } from 'react';
import { cookies } from 'next/headers';
import { listProjects } from './projects.mjs';

export const getProjectSelection = cache(async () => {
  const preferredId = (await cookies()).get('ps02_project')?.value;
  const projects = await listProjects();
  return { projects, project: projects.find(project => project.id === preferredId) ?? projects[0] ?? null };
});

export async function selectedProjectId(): Promise<string | undefined> {
  return (await getProjectSelection()).project?.id;
}
