import Link from 'next/link';
import { getCloudinary } from '../../lib/cloudinary.mjs';
import CaptureForm from './capture-form';
import { getProjectSelection } from '../../lib/active-project';
import { getProjectContext } from '../../lib/project-views.mjs';

export const dynamic = 'force-dynamic';

export default async function CapturePage({ searchParams }: { searchParams: Promise<{ test?: string }> }) {
  const config = getCloudinary().config();
  const selected = (await getProjectSelection()).project;
  const project = selected ? await getProjectContext(undefined, selected.id) : null;
  const testMode = (await searchParams).test === 'core';
  return <main className="evidence">
    <p className="eyebrow">PS02 / FIELD CAPTURE</p>
    <h1>Take a field photo.</h1>
    <p>The browser records the time and GPS location when you take the photo and sends them with it. They count for more than EXIF, but they aren’t proof.</p>
    {project ? <><p className="search-project">Project: <strong>{project.name}</strong></p><CaptureForm key={project.id} cloudName={config.cloud_name!} apiKey={config.api_key!} testMode={testMode} project={{ id: project.id, sites: project.sites.map(({ id, name }) => ({ id, name })) }} /></> : <div className="panel search-empty"><h2>No project selected.</h2><p><Link href="/projects/new">Create a project</Link> before capturing evidence.</p></div>}
    <p><Link href="/evidence">View evidence →</Link></p>
  </main>;
}
