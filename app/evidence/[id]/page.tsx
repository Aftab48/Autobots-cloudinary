import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEvidenceDetail, getProjectContext, assetMedia } from '../../../lib/project-views.mjs';
import { selectedProjectId } from '../../../lib/active-project';
import SiteReviewForm from '../site-review-form';
import AssetBadges, { AssetStates } from '../../components/asset-state';
import { TrustChecklist, AnalysisReason, ReviewDecision, readable, formatDate } from '../../components/evidence-parts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Evidence detail · PS02' };
export default async function EvidenceDetail({ params }: { params: Promise<{ id: string }> }) {
  const projectId = await selectedProjectId();
  const detail = await getEvidenceDetail((await params).id, undefined, projectId);
  if (!detail) notFound();
  const project = await getProjectContext(undefined, projectId);
  const { asset, events, frames, comparisons, claims } = detail;
  const urls = assetMedia(asset);
  const state = { id: asset.id, status: asset.status, pipeline_state: asset.pipeline_state };
  const batchContext = asset.raw_cloudinary?.context?.custom || asset.raw_cloudinary?.context || {};
  return <main className="evidence evidence-detail"><p className="eyebrow">PS02 / EVIDENCE DETAIL</p><Link href="/evidence">← Evidence library</Link><h1>{readable(asset.activity || 'Unclassified evidence')}</h1>
    <AssetStates projectId={projectId} assets={[state, ...frames.map(({ id, status, pipeline_state }) => ({ id, status, pipeline_state }))]}>
      <AssetBadges asset={state} /><p className="asset-id">Asset {asset.id}</p>
      <div className="detail-grid"><section className="panel media-panel" aria-label="Evidence preview">
        {asset.resource_type === 'video' ? <video className="detail-preview" src={urls.original} poster={urls.preview} controls preload="metadata" aria-label="Original evidence video" /> : <a href={urls.preview} target="_blank" rel="noreferrer"><img className="detail-preview" src={urls.preview} alt={asset.caption || asset.cld_caption || 'Uploaded evidence awaiting analysis'} width={640} height={420} /></a>}
        <p>{asset.caption || asset.cld_caption || 'No description is available yet.'}</p><p className="status-reason">{asset.status_reason || 'This evidence is waiting for processing.'}</p>
        {asset.pipeline_state === 'failed' && <p className="notice">Processing failed. The saved original remains available. Review this evidence before using it in a claim.</p>}
      </section><section className="panel" aria-labelledby="details-heading"><h2 id="details-heading">Evidence record</h2><dl className="detail-facts"><div><dt>Site</dt><dd>{asset.site_name || 'Site unknown'}</dd></div><div><dt>Captured · UTC</dt><dd>{formatDate(asset.captured_at)}{asset.captured_at && <span className="small muted"> · {new Date(asset.captured_at).toISOString().slice(11, 19)}</span>}</dd></div><div><dt>Date source</dt><dd>{asset.capture_source ? readable(asset.capture_source) : 'Not available'}</dd></div><div><dt>Location</dt><dd>{asset.lat != null && asset.lng != null ? `${asset.lat}, ${asset.lng}` : asset.site_name || 'No location recorded'}{asset.location_source && ` (${readable(asset.location_source)})`}</dd></div>{batchContext.activity_hint && <div><dt>Batch activity hint</dt><dd>{readable(batchContext.activity_hint)} <span className="small muted">(provided at upload)</span></dd></div>}<div><dt>Media</dt><dd>{asset.resource_type}{asset.format ? ` · ${asset.format}` : ''}{asset.width && asset.height ? ` · ${asset.width} × ${asset.height}` : ''}</dd></div><div><dt>Uploaded · UTC</dt><dd>{formatDate(asset.created_at)}</dd></div></dl></section></div>
      <div className="panel"><TrustChecklist asset={asset} /><AnalysisReason asset={asset} /></div>
      <section className="panel trace-chain" aria-labelledby="trace-heading"><p className="eyebrow">FROM CLAIM TO ORIGINAL</p><h2 id="trace-heading">Full trace chain</h2><ol className="trace-steps">
        <li><h3>Report claim</h3>{claims.length ? claims.map(claim => <div key={`${claim.id}-${claim.comparison_id || claim.asset_id}`}><blockquote>{claim.text}</blockquote><p className="small">Claim <code>{claim.id}</code> · report <code>{claim.report_id}</code><br />Cites {claim.comparison_id ? `comparison ${claim.comparison_id}` : `asset ${claim.asset_id}`}</p>{claim.derived_url && <a className="trace-url" href={claim.derived_url} target="_blank" rel="noreferrer">{claim.derived_url}</a>}</div>) : <p className="muted">No report claim currently cites this evidence.</p>}</li>
        <li><h3>Comparison / evidence asset</h3><p className="small">Evidence <code>{asset.id}</code></p>{comparisons.map(comparison => <div key={comparison.id}><p className="small">Comparison <code>{comparison.id}</code>: <Link href={`/evidence/${comparison.before_asset_id}`}>Before evidence</Link> → <Link href={`/evidence/${comparison.after_asset_id}`}>After evidence</Link></p>{comparison.composite_url && <a className="trace-url" href={comparison.composite_url} target="_blank" rel="noreferrer">{comparison.composite_url}</a>}</div>)}
          {asset.duplicate_of && <p className="small">Duplicate of <Link href={`/evidence/${asset.duplicate_of}`}>{asset.duplicate_of}</Link>.</p>}
          {asset.parent_asset_id && <p className="small">Derived video frame at {asset.frame_offset ?? 'unknown'} seconds. <Link href={`/evidence/${asset.parent_asset_id}`}>Open source video →</Link></p>}
          {frames.length > 0 && <ul className="frame-list">{frames.map(frame => <li key={frame.id}><Link href={`/evidence/${frame.id}`}>Frame at {frame.frame_offset}s →</Link><AssetBadges asset={{ id: frame.id, status: frame.status, pipeline_state: frame.pipeline_state }} /></li>)}</ul>}
        </li>
        <li><h3>Derived image · transformation URL</h3><p className="small">Cloudinary resizes to fit 640 × 420, uses JPEG and automatic quality. The transformation is visible in this URL; no generative transformation is applied.</p><a className="trace-url" href={urls.preview} target="_blank" rel="noreferrer">{urls.preview}</a></li>
        <li><h3>Original Cloudinary asset</h3><dl><dt>Public ID</dt><dd><code>{asset.cloudinary_public_id}</code></dd><dt>Version</dt><dd><code>{asset.version ?? 'Not supplied'}</code></dd></dl><a className="button-link" href={urls.original} target="_blank" rel="noreferrer">Open original asset ↗</a><p><a className="trace-url" href={urls.original} target="_blank" rel="noreferrer">{urls.original}</a></p></li>
      </ol></section>
      <div className="panel"><SiteReviewForm assetId={asset.id} siteId={asset.site_id} sites={(project?.sites || []).map(({ id, name }) => ({ id, name }))} /><ReviewDecision asset={asset} events={events} sites={(project?.sites || []).map(({ id, name }) => ({ id, name }))} /></div>
    </AssetStates>
  </main>;
}
