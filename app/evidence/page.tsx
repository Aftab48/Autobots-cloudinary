import Link from 'next/link';
import { listAssets } from '../../lib/db.mjs';
import EvidenceCard from './evidence-card';

export const dynamic = 'force-dynamic';

export default async function EvidencePage() {
  const assets = await listAssets();
  return <main className="evidence">
    <p className="eyebrow">PS02 / EVIDENCE</p>
    <h1>Evidence and decisions.</h1>
    <p>Each status follows the trust checklist. Dates, locations and visual analysis are evidence hints, not proof of authenticity.</p>
    <nav><Link href="/upload">Upload evidence</Link><Link href="/review">Review queue</Link><a href="/evidence">Refresh list</a></nav>
    {!assets.length && <p className="panel">No evidence received yet. Upload an image, then refresh once its notification arrives.</p>}
    {assets.map(asset => <EvidenceCard key={asset.id} asset={asset} />)}
  </main>;
}
