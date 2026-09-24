import Link from 'next/link';
import { getCloudinary } from '../../lib/cloudinary.mjs';
import UploadWidget from './upload-widget';
import { getProjectSelection } from '../../lib/active-project';
import { getProjectContext } from '../../lib/project-views.mjs';

export const dynamic = 'force-dynamic';

export default async function UploadPage({ searchParams }: { searchParams: Promise<{ test?: string }> }) {
  const config = getCloudinary().config();
  const selected = (await getProjectSelection()).project;
  const project = selected ? await getProjectContext(undefined, selected.id) : null;
  const testMode = (await searchParams).test === 'core';
  return <main className="evidence">
    <p className="eyebrow">PS02 / EVIDENCE INGESTION</p>
    <h1>Upload field evidence.</h1>
    <p>Choose multiple images or videos. Originals go directly to Cloudinary; verified notifications save their raw metadata to the evidence list.</p>
    {project ? <><p className="search-project">Project: <strong>{project.name}</strong></p><UploadWidget key={project.id} cloudName={config.cloud_name!} apiKey={config.api_key!} testMode={testMode} project={{ id: project.id, sites: project.sites.map(({ id, name }) => ({ id, name })), activities: selected.activities }} /></> : <p><Link href="/projects/new">Create a project</Link> before uploading evidence.</p>}
    <p><Link href="/evidence">View evidence →</Link></p>
  </main>;
}
