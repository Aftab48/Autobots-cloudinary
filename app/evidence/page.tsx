import Link from 'next/link';
import { getProjectContext, listEvidence, EvidenceInputError, STATUSES } from '../../lib/project-views.mjs';
import EvidenceCard from './evidence-card';
import { AssetStates } from '../components/asset-state';
import { EvidencePagination, readable } from '../components/evidence-parts';
import { selectedProjectId } from '../../lib/active-project';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Evidence · PS02' };
type Params = Record<string, string | string[] | undefined>;
export default async function EvidencePage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const projectId = await selectedProjectId();
  const project = await getProjectContext(undefined, projectId);
  let result;
  try { result = await listEvidence(params, undefined, projectId); } catch (error) {
    if (!(error instanceof EvidenceInputError)) throw error;
    return <main className="evidence"><p className="eyebrow">PS02 / EVIDENCE</p><h1>Evidence library.</h1><div className="panel search-error" role="alert"><h2>Check your filters</h2><p>{error.message}</p><Link href="/evidence">Reset filters</Link></div></main>;
  }
  const { assets, filters, total, pageSize } = result;
  return <main className="evidence"><p className="eyebrow">PS02 / EVIDENCE</p><h1>Evidence library.</h1><p>Follow every asset from upload to decision. Filter by the recorded capture date, activity, site or review status.</p>
    <form className="panel filter-form" action="/evidence"><div className="filter-fields">
      <label>Status<select name="status" defaultValue={filters.status || ''}><option value="">All statuses</option>{STATUSES.map(status => <option key={status} value={status}>{readable(status)}</option>)}</select></label>
      <label>Activity<select name="activity" defaultValue={filters.activity || ''}><option value="">All activities</option>{[...new Set([...(project?.activities || []), ...(filters.activity ? [filters.activity] : [])])].map(activity => <option key={activity} value={activity}>{readable(activity)}</option>)}</select></label>
      <label>Site<select name="site" defaultValue={filters.site || ''}><option value="">All sites</option>{project?.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}{filters.site && !project?.sites.some((site) => site.id === filters.site) && <option value={filters.site}>Unknown site</option>}</select></label>
      <label>From · UTC<input type="date" name="from" defaultValue={filters.from || ''} /></label><label>Through · UTC<input type="date" name="to" defaultValue={filters.to || ''} /></label>
    </div><div className="filter-actions"><button type="submit">Apply filters</button><Link href="/evidence">Reset</Link><p className="small muted">Both dates are inclusive. Undated assets appear when no date filter is set.</p></div></form>
    <div className="search-results-heading"><h2>{total} {total === 1 ? 'asset' : 'assets'}</h2><p>Newest uploads first · includes derived video frames</p></div>
    <AssetStates projectId={projectId} assets={assets.map(({ id, status, pipeline_state }) => ({ id, status, pipeline_state }))}>
      {assets.length ? <div className="search-results">{assets.map(asset => <EvidenceCard key={asset.id} asset={asset} />)}</div> : <div className="panel search-empty"><h2>{total ? 'No assets on this page.' : 'No evidence matches these filters.'}</h2><p>{total ? 'Use the previous page or reset your filters.' : 'Broaden the filters or upload field evidence to start the collection.'}</p><p><Link href="/evidence">All evidence</Link> · <Link href="/upload">Upload evidence</Link></p></div>}
    </AssetStates><EvidencePagination filters={filters} count={assets.length} total={total} pageSize={pageSize} />
  </main>;
}
