import Link from 'next/link';
import { selectedProjectId } from '../../lib/active-project';
import { assetMedia } from '../../lib/project-views.mjs';
import { listComparisons, listEligibleAssets, listSitePairs } from '../../lib/comparisons.mjs';
import { changeCategories as categories, formatDate } from '../components/evidence-parts';
import CompareForm from './compare-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Before / after · PS02' };

function Source({ label, asset }: { label: string; asset: Record<string, any> }) {
  return <>{label} <Link href={`/evidence/${asset.id}`}><code>{asset.id}</code></Link> (<a href={assetMedia(asset).original} target="_blank" rel="noreferrer">original ↗</a>)</>;
}

export default async function BeforeAfterPage({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  const projectId = await selectedProjectId();
  if (!projectId) return <main className="evidence"><h1>Project not available.</h1><p>Create a project before comparing evidence.</p></main>;
  const [pairs, assets, comparisons] = await Promise.all([listSitePairs(projectId), listEligibleAssets(projectId), listComparisons(projectId)]);
  const { status } = await searchParams;
  const option = (asset: Record<string, any>) => <option key={asset.id} value={asset.id}>{asset.site_name || 'No site'} · {formatDate(asset.captured_at)} · {asset.status} · {asset.id.slice(0, 8)}</option>;
  return <main className="evidence"><p className="eyebrow">PS02 / BEFORE &amp; AFTER</p><h1>Before and after.</h1>
    <p>Compare two photos of the same place. Cloudinary builds the side-by-side image. The same fixed questions are answered for each photo, and the answers are compared in code. Only visible differences are reported.</p>
    {status === 'created' && <p className="notice" role="status">Comparison saved.</p>}
    {status === 'existing' && <p className="notice" role="status">This pair was already compared. The saved result is shown; nothing was analysed again.</p>}
    <section className="panel" aria-labelledby="sites-heading"><h2 id="sites-heading">Compare a site</h2><p className="small muted">Default pair: the earliest and the latest dated photo at the site that is not rejected.</p>
      {pairs.length ? <div className="table-scroll"><table><thead><tr><th scope="col">Site</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Action</th></tr></thead><tbody>{pairs.map(site => <tr key={site.id}><th scope="row">{site.name}</th>
        {site.before_id && site.before_id !== site.after_id ? <><td><Link href={`/evidence/${site.before_id}`}>{formatDate(site.before_at)}</Link></td><td><Link href={`/evidence/${site.after_id}`}>{formatDate(site.after_at)}</Link></td>
          <td><CompareForm label={`Compare ${site.name}`}><input type="hidden" name="before_asset_id" value={site.before_id} /><input type="hidden" name="after_asset_id" value={site.after_id} /></CompareForm></td></>
          : <td colSpan={3} className="muted">Needs two dated photos</td>}</tr>)}</tbody></table></div> : <p className="muted">No sites have been added yet.</p>}
    </section>
    <section className="panel" aria-labelledby="pick-heading"><h2 id="pick-heading">Pick two photos</h2><p className="small muted">Top-level photos from this project that are not rejected. The before photo cannot be captured after the after photo.</p>
      <CompareForm label="Compare selected photos"><div className="filter-fields"><label>Before<select name="before_asset_id" required defaultValue=""><option value="" disabled>Choose a photo</option>{assets.map(option)}</select></label><label>After<select name="after_asset_id" required defaultValue=""><option value="" disabled>Choose a photo</option>{assets.map(option)}</select></label></div></CompareForm>
    </section>
    <section aria-labelledby="results-heading"><div className="search-results-heading"><h2 id="results-heading">{comparisons.length} {comparisons.length === 1 ? 'comparison' : 'comparisons'}</h2><p>Newest first</p></div>
      {comparisons.map(c => <article key={c.id} id={`comparison-${c.id}`} className="panel"><h3>{c.site_name || 'Different or unknown sites'} · {formatDate(c.before_asset.captured_at)} → {formatDate(c.after_asset.captured_at)}</h3>
        {c.composite_url && <a href={c.composite_url} target="_blank" rel="noreferrer"><img className="detail-preview" src={c.composite_url} alt={`Side-by-side photos: before ${formatDate(c.before_asset.captured_at)} on the left, after ${formatDate(c.after_asset.captured_at)} on the right`} width={1600} height={600} /></a>}
        <p className="analysis-source">{c.analysis_source === 'cloudinary_ai_vision' ? 'Answered by Cloudinary AI Vision' : 'Answered by the fallback vision model'}</p>
        <div className="table-scroll"><table><caption className="eyebrow">VISIBLE CHANGES</caption><thead><tr><th scope="col">Category</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Change</th></tr></thead>
          <tbody>{categories.map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td>{c.answers?.before?.[key]}</td><td>{c.answers?.after?.[key]}</td><td><strong>{c.changes?.[key]}</strong></td></tr>)}</tbody></table></div>
        <p className="small">Sources: <Source label="before" asset={c.before_asset} />, <Source label="after" asset={c.after_asset} /></p>
        {c.composite_url && <a className="trace-url" href={c.composite_url} target="_blank" rel="noreferrer">{c.composite_url}</a>}
        <p className="small muted">Comparison <code>{c.id}</code>. Visible differences only; two photos cannot show cause or impact.</p>
      </article>)}
    </section>
  </main>;
}
