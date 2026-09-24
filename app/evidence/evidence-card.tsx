import { getCloudinary } from '../../lib/cloudinary.mjs';
import { listReviewEvents } from '../../lib/db.mjs';
import ReviewForm from './review-form';

const labels: Record<string, string> = {
  sharp_enough: 'Sharp enough', not_duplicate: 'Not a duplicate', relevant: 'Relevant to project',
  activity_in_project: 'Activity in project list', date_in_project: 'Date within project dates',
  has_location: 'Has location or site', sufficient_resolution: 'Sufficient resolution',
};

export default async function EvidenceCard({ asset }: { asset: Record<string, any> }) {
  const events = await listReviewEvents(asset.id);
  const url = asset.raw_cloudinary?.secure_url ?? getCloudinary().url(asset.cloudinary_public_id, {
    secure: true, resource_type: asset.resource_type, version: Number(asset.version),
    width: 640, crop: 'limit', quality: 'auto', fetch_format: 'auto',
  });
  return <article className="panel" id={asset.id}>
    <div className="asset-heading"><h2>{asset.caption || asset.cloudinary_public_id}</h2><span className={`status status-${asset.status}`}>{asset.status.toUpperCase()}</span></div>
    <p className="asset-id">Asset {asset.id} · {asset.resource_type} · {asset.pipeline_state}</p>
    {asset.resource_type === 'image' ? <img className="evidence-preview" src={url} alt={asset.caption || 'Uploaded evidence awaiting description'} />
      : <video className="evidence-preview" src={url} controls preload="metadata" />}
    <p>{asset.status_reason || 'Processing the evidence.'}</p>
    {asset.manual_reviewed_at && <p className="notice">A reviewer chose this status. The checklist retains the automatic checks.</p>}
    {asset.checklist && <ul className="checklist" aria-label="Trust checklist">
      {Object.entries(asset.checklist).map(([key, pass]) => <li key={key} className={pass ? 'pass' : 'fail'}>
        <span aria-hidden="true">{pass ? '✓' : '×'}</span> {labels[key] ?? key} — {pass ? 'Pass' : 'Needs attention'}
      </li>)}
    </ul>}
    <dl className="asset-facts">
      <div><dt>Activity</dt><dd>{asset.activity?.replaceAll('_', ' ') ?? 'Awaiting analysis'}</dd></div>
      <div><dt>Date</dt><dd>{asset.captured_at ? new Date(asset.captured_at).toISOString() : 'Unknown'} ({asset.capture_source ?? 'unavailable'})</dd></div>
      <div><dt>Location</dt><dd>{asset.lat != null && asset.lng != null ? `${asset.lat}, ${asset.lng}` : asset.site_id ? 'Assigned site' : 'No location or site'}{asset.location_source ? ` (${asset.location_source})` : ''}</dd></div>
      <div><dt>Analysis</dt><dd>{asset.analysis_source?.replaceAll('_', ' ') ?? 'Not analyzed'}</dd></div>
    </dl>
    {asset.duplicate_of && <p>Grouped with original: <a href={`/evidence#${asset.duplicate_of}`}>{asset.duplicate_of}</a></p>}
    {asset.metadata_sync_error && <p className="notice">The decision is saved. Cloudinary metadata sync needs a retry.</p>}
    <details><summary>Review decision and history ({events.length})</summary>
      <ReviewForm assetId={asset.id} status={asset.status} />
      {events.length ? <ol className="review-history">{events.map(event => <li key={event.id}>
        <strong>{event.reviewer}</strong>: {event.from_status.toUpperCase()} → {event.to_status.toUpperCase()}
        <p>{event.note}</p><small>{new Date(event.created_at).toISOString()}</small>
      </li>)}</ol> : <p>No manual decisions yet.</p>}
    </details>
    <details><summary>Source metadata and webhook history</summary>
      <p>EXIF / image metadata</p><pre>{JSON.stringify(asset.exif, null, 2)}</pre>
      <p>pHash: <code>{asset.phash ?? 'Not supplied'}</code></p><p>etag: <code>{asset.etag ?? 'Not supplied'}</code></p>
      <pre>{JSON.stringify(asset.cloudinary_events, null, 2)}</pre>
    </details>
  </article>;
}
