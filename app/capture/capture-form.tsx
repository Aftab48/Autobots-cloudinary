'use client';

import { useRef, useState } from 'react';

type Fix = { lat: string; lng: string; accuracy: string };

export default function CaptureForm({ cloudName, apiKey, testMode, project }: { cloudName: string; apiKey: string; testMode: boolean; project: { id: string; sites: { id: string; name: string }[] } }) {
  const [file, setFile] = useState<File | null>(null);
  const [capturedAt, setCapturedAt] = useState('');
  const [fix, setFix] = useState<Fix | null>(null);
  const [location, setLocation] = useState('');
  const [site, setSite] = useState('');
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);

  function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    setFile(picked); setFix(null); setMessage('');
    if (!picked) { setCapturedAt(''); setLocation(''); return; }
    // A gallery pick keeps its older file time; its own EXIF is more honest than "now".
    if (Date.now() - picked.lastModified > 5 * 60000) {
      setCapturedAt('');
      setLocation('This photo was not taken just now, so its EXIF date and location (or the site you pick) will be used.');
      return;
    }
    setCapturedAt(new Date().toISOString());
    if (!window.isSecureContext || !navigator.geolocation) {
      setLocation('Location is not available here (it needs https). The capture time is still recorded; the photo EXIF or the site you pick will give the location.');
      return;
    }
    setLocation('Getting your location…'); setLocating(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const accuracy = Math.min(999999, Math.ceil(coords.accuracy));
      setLocating(false);
      setFix({ lat: coords.latitude.toFixed(6), lng: coords.longitude.toFixed(6), accuracy: String(accuracy) });
      setLocation(`Location recorded (within about ${accuracy} m).`);
    }, error => { setLocating(false); setLocation(`${error.code === error.PERMISSION_DENIED ? 'Location permission was denied.' : error.code === error.TIMEOUT ? 'Location timed out.' : 'Location is unavailable.'} You can still upload; the capture time is recorded and the photo EXIF or the site you pick will give the location.`); },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
  }

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setBusy(true); setMessage('');
    const context = { project: project.id, ps02_analysis_tier: 'bulk', ...(site ? { site_id: site } : {}),
      ...(capturedAt ? { capture_time: capturedAt, ...(fix ? { capture_lat: fix.lat, capture_lng: fix.lng, capture_accuracy: fix.accuracy } : {}) } : {}) };
    const params = { timestamp: Math.floor(Date.now() / 1000), upload_preset: testMode ? 'ps02_core' : 'ps02_ingest', asset_folder: `ps02/${project.id}`,
      context: Object.entries(context).map(([key, value]) => `${key}=${value}`).join('|') };
    try {
      const signing = await fetch('/api/upload-signature', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paramsToSign: params }) });
      if (!signing.ok) throw new Error('Upload signing failed. Check the phone date and time, then try again.');
      const form = new FormData();
      for (const [key, value] of Object.entries(params)) form.append(key, String(value));
      form.append('api_key', apiKey);
      form.append('signature', (await signing.json()).signature);
      form.append('file', file);
      const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Cloudinary did not accept the photo: ${result.error?.message ?? `HTTP ${response.status}`}`);
      setFile(null); setCapturedAt(''); setFix(null); setLocation('');
      if (input.current) input.current.value = '';
      setMessage('Uploaded. The evidence list updates after Cloudinary sends its notification.');
    } catch (error) {
      setMessage(`${error instanceof TypeError ? 'The upload could not finish. Check the connection.' : (error as Error).message} The photo is kept here; try again.`);
    } finally { setBusy(false); }
  }

  return <section className="panel">
    <form onSubmit={upload}><fieldset className="batch-context" disabled={busy}><div className="form-grid">
      <label className="full-width">Photo<input ref={input} type="file" accept="image/*" capture="environment" onChange={choose} required /></label>
      <label className="full-width">Site <span className="muted">· optional</span><select value={site} onChange={event => setSite(event.target.value)}><option value="">Site unknown</option>{project.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
    </div>
    {location && <p className="small" role="status">{location}</p>}
    {testMode && <p className="notice">Core test mode: EXIF, quality and hashes only. No captioning, tagging or AI Vision calls.</p>}
    </fieldset><button type="submit" disabled={!file || busy || locating}>{busy ? 'Uploading…' : locating ? 'Waiting for location…' : 'Upload photo'}</button></form>
    <p role="status">{message}</p>
  </section>;
}
