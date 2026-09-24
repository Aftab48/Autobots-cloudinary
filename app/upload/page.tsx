import Link from 'next/link';
import { getCloudinary } from '../../lib/cloudinary.mjs';
import UploadWidget from './upload-widget';

export const dynamic = 'force-dynamic';

export default async function UploadPage({ searchParams }: { searchParams: Promise<{ test?: string }> }) {
  const config = getCloudinary().config();
  const testMode = (await searchParams).test === 'core';
  return <main>
    <p className="eyebrow">PS02 / EVIDENCE INGESTION</p>
    <h1>Upload field evidence.</h1>
    <p>Choose multiple images or videos. Originals go directly to Cloudinary; verified notifications save their raw metadata to the evidence list.</p>
    <UploadWidget cloudName={config.cloud_name!} apiKey={config.api_key!} testMode={testMode} />
    <p><Link href="/evidence">View evidence →</Link></p>
  </main>;
}
