import Link from 'next/link';
import { assetMedia } from '../../lib/project-views.mjs';
import { listReviewEvents } from '../../lib/db.mjs';
import AssetBadges from '../components/asset-state';
import { EvidenceFacts, TraceLinks, TrustChecklist, AnalysisReason, ReviewDecision, readable } from '../components/evidence-parts';

export default async function EvidenceCard({ asset, review = false }: { asset: Record<string, any>; review?: boolean }) {
  const urls = assetMedia(asset);
  const events = review ? await listReviewEvents(asset.id) : [];
  return <article className={`search-result${review ? ' review-card' : ''}`} id={asset.id} aria-labelledby={`asset-${asset.id}`}>
    <Link className="search-preview" href={`/evidence/${asset.id}`} aria-label={`View evidence ${asset.id}`}>
      <img src={urls.preview} alt={asset.caption || asset.cld_caption || 'Evidence awaiting description'} width={640} height={420} loading="lazy" />
      <span className="search-media-label">{asset.parent_asset_id ? `Video frame · ${asset.frame_offset ?? '?'}s` : asset.resource_type === 'video' ? 'Video preview' : 'Photo'}</span>
    </Link>
    <div className="search-result-body"><AssetBadges asset={{ id: asset.id, status: asset.status, pipeline_state: asset.pipeline_state }} />
      <h3 id={`asset-${asset.id}`}><Link href={`/evidence/${asset.id}`}>{readable(asset.activity || 'Unclassified evidence')}</Link></h3>
      <p className="asset-caption">{asset.caption || asset.cld_caption || 'A description will appear after analysis.'}</p>
      <EvidenceFacts asset={asset} />
      <p className={`status-reason reason-${asset.status}`}>{asset.status_reason || (asset.pipeline_state === 'failed' ? 'Processing could not finish. Open the evidence to review its state.' : 'Waiting for the evidence pipeline.')}</p>
      <p className="asset-id">Asset {asset.id}</p><Link className="detail-link" href={`/evidence/${asset.id}`}>View evidence & trace →</Link><TraceLinks asset={asset} />
      {review && <><TrustChecklist asset={asset} /><AnalysisReason asset={asset} /><ReviewDecision asset={asset} events={events} /></>}
    </div>
  </article>;
}
