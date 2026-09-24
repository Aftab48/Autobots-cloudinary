'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SiteForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = Object.fromEntries(new FormData(form));
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/projects/${projectId}/sites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Site could not be added.');
      form.reset(); setMessage(`${result.site.name} added.`); router.refresh();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Site could not be added.'); }
    finally { setBusy(false); }
  }
  return <form className="review-form site-form" onSubmit={submit}><h3>Add a site</h3><label>Site name<input name="name" required maxLength={120} placeholder="e.g. Site D" /></label><button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add site'}</button><p role="status">{message}</p></form>;
}
