import Link from 'next/link';
import { assetMedia } from '../../lib/project-views.mjs';
import ReviewForm from '../evidence/review-form';

export const readable = (value: string) => value.replaceAll('_', ' ');
export const formatDate = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value)) : 'Date unknown';
export const utcTime = (value: string | Date) => new Date(value).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
export const writtenBy = (source: string | null | undefined) => source === 'llm' ? 'AI text model, citations checked in code' : 'Fixed template (no AI)';
export const changeCategories = [['vegetation', 'Vegetation'], ['tree_presence', 'Tree presence'], ['visible_waste', 'Visible waste'], ['human_activity', 'Human activity']];
export const trustLabels: Record<string, string> = { sharp_enough: 'Sharp enough', not_duplicate: 'Not a duplicate', relevant: 'Relevant to project', activity_in_project: 'Activity in project list', date_in_project: 'Date within project dates', has_location: 'Has location or site', sufficient_resolution: 'Sufficient resolution' };

export function TrustChecklist({ asset }: { asset: Record<string, any> }) {
  const checks = { ...Object.fromEntries(Object.keys(trustLabels).map(key => [key, null])), ...(asset.checklist || {}) };
  return <section aria-label="Trust checklist"><h2>Trust checklist</h2>
    {asset.manual_reviewed_at && <p className="notice">A reviewer set this status. The checks below still show what the automatic pass found.</p>}
    <ul className="checklist">{Object.entries(checks).map(([key, pass]) => {
      const evaluated = pass === true || pass === false;
      const reason = asset.checklist_reasons?.[key] || (!evaluated ? ['uploaded', 'analyzing'].includes(asset.pipeline_state) ? 'Waiting for processing.' : 'No evaluation was recorded.' : null);
      return <li key={key} className={pass === true ? 'pass' : pass === false ? 'fail' : 'not-checked'}><span aria-hidden="true">{pass === true ? '✓' : pass === false ? '×' : '—'}</span> {trustLabels[key] || readable(key)} <strong>· {pass === true ? 'Pass' : pass === false ? 'Fail' : 'Not checked'}</strong>{reason && <small>{reason}</small>}</li>;
    })}</ul>
    <p className="small muted">These checks test whether the evidence fits the project; they don’t prove it’s authentic.</p>
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

export function ReviewDecision({ asset, events, sites = [] }: { asset: Record<string, any>; events: Record<string, any>[]; sites?: { id: string; name: string }[] }) {
  const siteLabel = (id: string | null) => id ? <span className="history-site">{sites.find(site => site.id === id)?.name || 'Unavailable site'} <small className="muted">({id})</small></span> : <span>No site</span>;
  return <section className="review-decision"><ReviewForm key={`${asset.id}-${asset.status}`} assetId={asset.id} status={asset.status} />
    <details><summary>Decision history ({events.length})</summary>{events.length ? <ol className="review-history">{events.map(event => <li key={event.id}><strong>{event.reviewer}</strong>: {event.event_type === 'site' ? <>Site changed from {siteLabel(event.from_site_id)} → {siteLabel(event.to_site_id)}</> : <>{event.from_status?.toUpperCase() || 'Unknown'} → {event.to_status?.toUpperCase() || 'Unknown'}</>}<p>{event.note}</p><time dateTime={new Date(event.created_at).toISOString()}>{new Date(event.created_at).toISOString().replace('T', ' ').replace('.000Z', ' UTC')}</time></li>)}</ol> : <p className="small muted">No manual decisions yet.</p>}</details>
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
