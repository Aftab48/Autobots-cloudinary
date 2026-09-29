import Link from 'next/link';
import { listEvidence, EvidenceInputError } from '../../lib/project-views.mjs';
import EvidenceCard from '../evidence/evidence-card';
import { AssetStates } from '../components/asset-state';
import { EvidencePagination } from '../components/evidence-parts';
import { selectedProjectId } from '../../lib/active-project';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Review queue · Provo' };
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const projectId = await selectedProjectId();
  let result;
  try { result = await listEvidence({ status: 'review', page: (await searchParams).page }, undefined, projectId); } catch (error) {
    if (!(error instanceof EvidenceInputError)) throw error;
    return <main className="evidence"><h1>Review queue.</h1><p role="alert">{error.message}</p><Link href="/review">Return to review queue</Link></main>;
  }
  const { assets, filters, total, pageSize } = result;
  return <main className="evidence"><p className="eyebrow">PROVO / HUMAN REVIEW</p><h1>Review queue.</h1><p>Resolve uncertain evidence using its trust checks and AI assessment. Every decision records who changed the status, when and why.</p>
    <div className="search-results-heading"><h2>{total} {total === 1 ? 'asset needs' : 'assets need'} review</h2><p>Newest uploads first</p></div>
    <AssetStates projectId={projectId} assets={assets.map(({ id, status, pipeline_state }) => ({ id, status, pipeline_state }))}>
      {!assets.length ? <section className="panel search-empty"><h2>{total ? 'No review items on this page.' : 'The queue is clear.'}</h2><p>Uncertain evidence will appear here after processing.</p><p><Link href="/evidence">Browse all evidence →</Link></p></section> : <div className="review-list">{assets.map(asset => <EvidenceCard key={asset.id} asset={asset} review />)}</div>}
    </AssetStates><EvidencePagination filters={filters} count={assets.length} total={total} pageSize={pageSize} base="/review" />
  </main>;
}
