'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SiteReviewForm({ assetId, siteId, sites }: { assetId: string; siteId: string | null; sites: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/assets/${assetId}/site`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...Object.fromEntries(form), site_id: form.get('site_id') || null }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Site could not be saved.');
      setMessage(result.metadataPending ? 'Site saved and logged. Cloudinary metadata sync is pending.' : 'Site saved and logged.'); router.refresh();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Site could not be saved.'); }
    finally { setBusy(false); }
  }
  return <form className="review-form site-review-form" onSubmit={submit}><h3>Review site assignment</h3><p className="small muted">Assign or clear a site. Your change and reason are recorded in the decision history.</p><label>Site<select key={siteId || 'none'} name="site_id" defaultValue={siteId || ''}><option value="">No site assigned</option>{sites.map(site => <option value={site.id} key={site.id}>{site.name}</option>)}</select></label><label>Reviewer name<input name="reviewer" required maxLength={100} autoComplete="name" /></label><label>Reason<textarea name="note" required maxLength={2000} rows={2} /></label><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save site'}</button><p role="status">{message}</p></form>;
}
