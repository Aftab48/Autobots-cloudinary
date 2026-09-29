import Link from 'next/link';
import { notFound } from 'next/navigation';
import { selectedProjectId } from '../../../lib/active-project';
import { assetMedia, getProjectContext } from '../../../lib/project-views.mjs';
import { getReport } from '../../../lib/reports.mjs';
import { changeCategories, formatDate, readable, utcTime, writtenBy } from '../../components/evidence-parts';
import PrintButton from './print-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Report · Provo' };
type Row = Record<string, any>;
type Source = { type: 'asset' | 'comparison'; id: string; derived_url: string | null };

function SourceLink({ source }: { source: Source }) {
  return <Link href={source.type === 'asset' ? `/evidence/${source.id}` : `/before-after#comparison-${source.id}`} data-source-id={source.id}>{source.type === 'asset' ? 'evidence' : 'comparison'} <code>{source.id}</code></Link>;
}

function Original({ label, asset }: { label: string; asset?: Row }) {
  if (!asset) return <p className="small muted">{label}: the original record is no longer available.</p>;
  return <p className="small">{label} <Link href={`/evidence/${asset.id}`}><code>{asset.id}</code></Link><br />Public ID <code>{asset.cloudinary_public_id}</code> · version <code>{asset.version ?? 'Not supplied'}</code> · <a href={assetMedia(asset).original} target="_blank" rel="noreferrer">Open original ↗</a></p>;
}

/** Plan section 14.1: the sentence opens claim → comparison/asset → derived transformation URL → original. */
function Claim({ claim, reportId, assets, comparisons }: { claim: Row; reportId: string; assets: Map<string, Row>; comparisons: Map<string, Row> }) {
  const sources: Source[] = claim.sources;
  return <li className="report-claim" id={`claim-${claim.id}`} data-claim-id={claim.id}><details><summary>{claim.text}</summary>
    <ol className="trace-steps">
      <li><h3>Report claim</h3><p className="small">Claim <code>{claim.id}</code> · report <code>{reportId}</code></p></li>
      <li><h3>Cited comparison / evidence</h3>{sources.map((s, i) => <p className="small" key={i}><SourceLink source={s} /></p>)}</li>
      <li><h3>Derived image · transformation URL</h3><p className="small">You can read every transformation in each URL, and none of them is generative.</p>{sources.map((s, i) => <div className="trace-item" key={i}><p className="small">{s.type === 'asset' ? 'Thumbnail (fill to 400 × 300, JPEG, automatic quality)' : 'Side-by-side composite with date labels'} for <code>{s.id}</code></p>
        {s.derived_url ? <a className="trace-url" href={s.derived_url} target="_blank" rel="noreferrer">{s.derived_url}</a> : <p className="small muted">No derived URL was saved.</p>}</div>)}</li>
      <li><h3>Original Cloudinary asset</h3>{sources.map((s, i) => s.type === 'asset' ? <Original key={i} label="Evidence" asset={assets.get(s.id)} />
        : <div key={i}><Original label="Before evidence" asset={assets.get(comparisons.get(s.id)?.before_asset_id)} /><Original label="After evidence" asset={assets.get(comparisons.get(s.id)?.after_asset_id)} /></div>)}</li>
    </ol></details>
    <p className="claim-sources">Sources: {sources.map((s, i) => <span key={i}>{i > 0 && ', '}<SourceLink source={s} /></span>)}<span className="print-hide"> · <Link href={`/reports/${reportId}/campaign/${claim.id}`}>Campaign cards →</Link></span></p>
  </li>;
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const projectId = await selectedProjectId();
  const [data, project] = await Promise.all([getReport((await params).id, projectId), getProjectContext(undefined, projectId)]);
  if (!data || !project) notFound();
  const { report, claims, comparisons, assets } = data;
  const stats = report.stats || {}, media = stats.media || {};
  const assetById = new Map<string, Row>(assets.map((a: Row) => [a.id, a]));
  const comparisonById = new Map<string, Row>(comparisons.map((c: Row) => [c.id, c]));
  const thumbnails: Source[] = [...new Map<string, Source>(claims.flatMap((c: Row) => c.sources).filter((s: Source) => s.type === 'asset').map((s: Source) => [s.id, s])).values()];
  const period = report.period_start ? `${formatDate(report.period_start)} → ${formatDate(report.period_end)}` : 'No dated evidence';
  const count = (value: unknown) => typeof value === 'number' ? value : 0;
  return <main className="evidence report"><p className="eyebrow">PROVO / REPORT</p><Link className="print-hide" href="/reports">← All reports</Link><h1>{project.name}</h1>
    <p>{period}</p>
    <div className="report-path"><p className="analysis-source">Sentences: {writtenBy(stats.claims_source)}</p><PrintButton /></div>
    <p className="small muted">{stats.claims_source === 'llm' ? `Only sentences citing accepted evidence or comparisons supplied to the model were kept${stats.dropped_claims ? `; ${stats.dropped_claims} uncited or wrongly cited ${stats.dropped_claims === 1 ? 'sentence was' : 'sentences were'} removed` : ''}.`
      : `One sentence per comparison and per activity count, with sources attached directly.${stats.fallback_reason && stats.fallback_reason !== 'LLM not requested' ? ` The AI path was not used: ${stats.fallback_reason}.` : ''}`}</p>

    <section aria-labelledby="overview-heading"><h2 id="overview-heading">Project overview</h2>
      <dl className="project-facts"><div><dt>Organization</dt><dd>{project.organization || 'Not specified'}</dd></div><div><dt>Location</dt><dd>{project.location || 'Not specified'}</dd></div><div><dt>Evidence period</dt><dd>{period}</dd></div><div><dt>Generated</dt><dd>{utcTime(report.created_at)}</dd></div></dl>
      <h3>Sites</h3>{project.sites.length ? <ul className="site-list">{project.sites.map((site: Row) => <li key={site.id}>{site.name} <span className="muted">· {count(stats.sites?.[site.name])} accepted</span></li>)}</ul> : <p className="muted">No sites have been added.</p>}
    </section>

    <section aria-labelledby="stats-heading"><h2 id="stats-heading">Evidence statistics</h2><div className="status-grid">{[['Media analyzed', media.media, ''], ['Accepted', media.accepted, 'accepted'], ['Review', media.review, 'review'], ['Rejected', media.rejected, 'rejected']].map(([label, value, status]) => <div className={`stat-card${status ? ` stat-${status}` : ''}`} key={label}><span>{label}</span><strong>{count(value)}</strong></div>)}</div>
      <p className="small muted">Plain database counts when the report was generated. Duplicates removed: {count(media.duplicates_removed)} · still processing: {count(media.processing)} · comparisons included: {count(stats.comparisons)}.</p>
    </section>

    <section className="panel" aria-labelledby="activities-heading"><h2 id="activities-heading">Activity breakdown</h2><p className="small muted">Accepted evidence only.</p>
      {Object.keys(stats.activities || {}).length ? <div className="table-scroll"><table><thead><tr><th scope="col">Activity</th><th scope="col">Accepted evidence</th></tr></thead><tbody>{Object.entries(stats.activities as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([activity, n]) => <tr key={activity}><th scope="row">{activity === 'none' ? 'Unclassified' : readable(activity)}</th><td>{n}</td></tr>)}</tbody></table></div> : <p className="muted">No accepted evidence.</p>}
    </section>

    <section aria-labelledby="comparisons-heading"><h2 id="comparisons-heading">Before / after comparisons</h2>
      {comparisons.length ? comparisons.map((c: Row) => { const before = assetById.get(c.before_asset_id), after = assetById.get(c.after_asset_id);
        return <article key={c.id} id={`comparison-${c.id}`} className="panel report-comparison"><h3>{c.site_name || 'Different or unknown sites'} · {formatDate(before?.captured_at)} → {formatDate(after?.captured_at)}</h3>
          {c.composite_url && <img className="detail-preview" src={c.composite_url} alt={`Side-by-side photos: before ${formatDate(before?.captured_at)} on the left, after ${formatDate(after?.captured_at)} on the right`} width={1600} height={600} />}
          <p className="analysis-source">{c.analysis_source === 'cloudinary_ai_vision' ? 'Answered by Cloudinary AI Vision' : 'Answered by the fallback vision model'}</p>
          <div className="table-scroll"><table><caption className="eyebrow">VISIBLE CHANGES</caption><thead><tr><th scope="col">Category</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Change</th></tr></thead>
            <tbody>{changeCategories.map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td>{c.answers?.before?.[key]}</td><td>{c.answers?.after?.[key]}</td><td><span className={`change change-${c.changes?.[key]}`}>{c.changes?.[key]}</span></td></tr>)}</tbody></table></div>
          <p className="small">Comparison <code>{c.id}</code> · <Link href={`/evidence/${c.before_asset_id}`}>before evidence</Link> · <Link href={`/evidence/${c.after_asset_id}`}>after evidence</Link>. Visible differences only; two photos cannot show cause or impact.</p>
        </article>; }) : <p className="muted">No comparison is cited in this report.</p>}
    </section>

    <section className="panel" aria-labelledby="claims-heading"><h2 id="claims-heading">Key observations</h2><p className="small muted print-hide">Select a sentence to open its trace chain: claim → comparison or evidence → derived image → original Cloudinary asset.</p>
      {claims.length ? <ol className="report-claims">{claims.map((claim: Row) => <Claim key={claim.id} claim={claim} reportId={report.id} assets={assetById} comparisons={comparisonById} />)}</ol> : <p className="muted">Nothing to cite: the project had no accepted evidence or comparisons.</p>}
    </section>

    <section aria-labelledby="media-heading"><h2 id="media-heading">Supporting media</h2><p className="small muted">Every evidence thumbnail cited above, linked to its record and its untouched original.</p>
      {thumbnails.length ? <ul className="report-thumbs">{thumbnails.map(s => { const asset = assetById.get(s.id);
        return <li key={s.id}>{s.derived_url && <img src={s.derived_url} alt={asset?.caption || 'Cited evidence'} width={400} height={300} loading="lazy" />}<div><p>{asset?.caption || 'No caption'}</p><p className="muted">{asset?.site_name || 'Site unknown'} · {formatDate(asset?.captured_at)}</p>
          <p><Link href={`/evidence/${s.id}`}>Evidence <code>{s.id}</code></Link></p>{asset && <p><a href={assetMedia(asset).original} target="_blank" rel="noreferrer">Original ↗</a></p>}</div></li>; })}</ul> : <p className="muted">No evidence is cited directly.</p>}
    </section>
  </main>;
}
