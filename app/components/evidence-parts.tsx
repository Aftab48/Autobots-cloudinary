import Link from 'next/link';
import { assetMedia } from '../../lib/project-views.mjs';
import ReviewForm from '../evidence/review-form';

export const readable = (value: string) => value.replaceAll('_', ' ');
export const formatDate = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value)) : 'Date unknown';
export const trustLabels: Record<string, string> = { sharp_enough: 'Sharp enough', not_duplicate: 'Not a duplicate', relevant: 'Relevant to project', activity_in_project: 'Activity in project list', date_in_project: 'Date within project dates', has_location: 'Has location or site', sufficient_resolution: 'Sufficient resolution' };

export function TrustChecklist({ asset }: { asset: Record<string, any> }) {
  return <section aria-label="Trust checklist"><h2>Trust checklist</h2>
    {asset.manual_reviewed_at && <p className="notice">A reviewer chose this status. These checks retain the automatic assessment.</p>}
    {asset.checklist && Object.keys(asset.checklist).length ? <ul className="checklist">{Object.entries(asset.checklist).map(([key, pass]) => <li key={key} className={pass === true ? 'pass' : 'fail'}><span aria-hidden="true">{pass === true ? '✓' : '×'}</span> {trustLabels[key] || readable(key)} <strong>— {pass === true ? 'Pass' : 'Fail'}</strong></li>)}</ul> : <p className="muted">Checks are not available yet. Processing must finish before a trust assessment can be shown.</p>}
    <p className="small muted">These signals assess consistency with the project. They do not prove authenticity.</p>
  </section>;
}

export function AnalysisReason({ asset }: { asset: Record<string, any> }) {
  return <section className="analysis-reason"><h2>AI assessment</h2>
    {asset.analysis_source && <p className="analysis-source">{asset.analysis_source === 'cloudinary_ai_vision' ? 'Analyzed by Cloudinary AI Vision' : 'Analyzed by the fallback vision model'}</p>}
    <p>{asset.reason || 'No AI reason is available yet.'}</p>
  </section>;
}

export function TraceLinks({ asset }: { asset: Record<string, any> }) {
  const urls = assetMedia(asset);
  return <details className="trace-links"><summary>Transformation URL & original</summary>
    <p className="small">Cloudinary preview: bounded resize, JPEG format and automatic quality. No generative transformation.</p>
    <a className="trace-url" href={urls.preview} target="_blank" rel="noreferrer">{urls.preview}</a>
    <p className="small"><a href={urls.original} target="_blank" rel="noreferrer">Open original asset ↗</a></p>
  </details>;
}

export function ReviewDecision({ asset, events }: { asset: Record<string, any>; events: Record<string, any>[] }) {
  return <section className="review-decision"><ReviewForm key={`${asset.id}-${asset.status}`} assetId={asset.id} status={asset.status} />
    <details><summary>Decision history ({events.length})</summary>{events.length ? <ol className="review-history">{events.map(event => <li key={event.id}><strong>{event.reviewer}</strong>: {event.from_status.toUpperCase()} → {event.to_status.toUpperCase()}<p>{event.note}</p><time dateTime={new Date(event.created_at).toISOString()}>{new Date(event.created_at).toISOString().replace('T', ' ').replace('.000Z', ' UTC')}</time></li>)}</ol> : <p className="small muted">No manual decisions yet.</p>}</details>
    {asset.metadata_sync_error && <p className="notice">The decision is saved. Cloudinary metadata sync needs a retry.</p>}
  </section>;
}

export function EvidenceFacts({ asset }: { asset: Record<string, any> }) {
  return <dl className="search-result-facts"><div><dt>Activity</dt><dd>{readable(asset.activity || 'Awaiting analysis')}</dd></div><div><dt>Site</dt><dd>{asset.site_name || 'Site unknown'}</dd></div><div><dt>Captured · UTC</dt><dd>{formatDate(asset.captured_at)}</dd></div></dl>;
}

export function EvidencePagination({ filters, count, total, pageSize, base = '/evidence' }: { filters: Record<string, any>; count: number; total: number; pageSize: number; base?: string }) {
  const href = (page: number) => {
    const values: Record<string, unknown> = { ...filters, page };
    const params = new URLSearchParams(Object.entries(values).filter(([, value]) => value !== null && value !== '').map(([key, value]) => [key, String(value)]));
    return `${base}?${params}`;
  };
  return <nav className="pagination" aria-label="Evidence pages">{filters.page > 1 && <Link href={href(filters.page - 1)}>← Previous page</Link>}<span>Page {filters.page}</span>{count > 0 && filters.page * pageSize < total && <Link href={href(filters.page + 1)}>Next page →</Link>}</nav>;
}
