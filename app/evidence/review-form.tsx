'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ReviewForm({ assetId, status }: { assetId: string; status: string }) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/assets/${assetId}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(form)),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Review could not be saved.');
      setMessage(result.metadataPending ? 'Review saved. Cloudinary metadata sync is pending.' : 'Review saved and logged.');
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Review could not be saved.'); }
    finally { setBusy(false); }
  }
  return <form className="review-form" onSubmit={submit}>
    <h3>Reviewer decision</h3>
    <label>Status<select name="status" defaultValue={status} required>
      <option value="accepted">ACCEPTED</option><option value="review">REVIEW</option>
      <option value="rejected">REJECTED</option><option value="processing">PROCESSING</option>
    </select></label>
    <label>Reviewer name<input name="reviewer" required maxLength={100} autoComplete="name" /></label>
    <label>Reason<textarea name="note" required maxLength={2000} rows={3} /></label>
    <button disabled={busy} type="submit">{busy ? 'Saving…' : 'Save decision'}</button>
    <p role="status" aria-live="polite">{message}</p>
  </form>;
}
