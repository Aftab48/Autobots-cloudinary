import Link from 'next/link';
import { listAssets } from '../../lib/db.mjs';
import EvidenceCard from '../evidence/evidence-card';

export const dynamic = 'force-dynamic';
export default async function ReviewPage() {
  const assets = await listAssets({ status: 'review' });
  return <main className="evidence">
    <p className="eyebrow">PS02 / HUMAN REVIEW</p><h1>Review queue.</h1>
    <p>Resolve uncertain evidence and record why you changed its status. Every decision keeps the reviewer, time and previous status.</p>
    <nav><Link href="/evidence">All evidence</Link><Link href="/upload">Upload evidence</Link><a href="/review">Refresh queue</a></nav>
    <p>{assets.length} {assets.length === 1 ? 'asset needs' : 'assets need'} review{assets.length === 100 ? ' (showing the latest 100)' : ''}.</p>
    {!assets.length && <p className="panel">The review queue is clear.</p>}
    {assets.map(asset => <EvidenceCard key={asset.id} asset={asset} />)}
  </main>;
}
