import Link from 'next/link';
import { listAssets } from '../../lib/db.mjs';
import { getCloudinary } from '../../lib/cloudinary.mjs';

export const dynamic = 'force-dynamic';

export default async function EvidencePage() {
  const assets = await listAssets();
  const cloudinary = getCloudinary();
  return <main className="evidence">
    <p className="eyebrow">PS02 / RAW EVIDENCE</p>
    <h1>Evidence list.</h1>
    <p>Raw Cloudinary data received through verified webhooks. These assets await analysis. API fixtures are not campaign evidence.</p>
    <nav><Link href="/upload">Upload evidence</Link><a href="/evidence">Refresh list</a></nav>
    {!assets.length && <p className="panel">No evidence received yet. Upload an image, then refresh once its notification arrives.</p>}
    {assets.map(asset => <article className="panel" key={asset.id}>
      <h2>{asset.cloudinary_public_id}</h2>
      <p className="asset-id">Asset {asset.id} · {asset.resource_type} · {asset.status}</p>
      {asset.resource_type === 'image' && <img className="evidence-preview" src={cloudinary.url(asset.cloudinary_public_id, { secure: true, version: Number(asset.version), width: 640, crop: 'limit', quality: 'auto', fetch_format: 'auto' })} alt={`Uploaded evidence ${asset.cloudinary_public_id}`} />}
      <dl>
        <dt>EXIF / image metadata</dt><dd><pre>{JSON.stringify(asset.exif, null, 2)}</pre></dd>
        <dt>Quality analysis</dt><dd><pre>{JSON.stringify(asset.raw_cloudinary.quality_analysis ?? null, null, 2)}</pre></dd>
        <dt>pHash</dt><dd><code>{asset.phash ?? 'Not supplied'}</code></dd>
        <dt>etag</dt><dd><code>{asset.etag ?? 'Not supplied'}</code></dd>
      </dl>
      <details><summary>Raw Cloudinary data</summary><pre>{JSON.stringify(asset.raw_cloudinary, null, 2)}</pre></details>
      <details><summary>Original webhook payloads ({asset.cloudinary_events.length})</summary><pre>{JSON.stringify(asset.cloudinary_events, null, 2)}</pre></details>
    </article>)}
  </main>;
}
