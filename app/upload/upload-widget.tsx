'use client';

import Script from 'next/script';
import { useRef, useState, useEffect } from 'react';

type Widget = { open: () => void; destroy: () => void };
declare global {
  interface Window {
    cloudinary?: { createUploadWidget: (options: Record<string, unknown>, callback: (error: unknown, result: { event: string }) => void) => Widget };
  }
}

export default function UploadWidget({ cloudName, apiKey, testMode, project }: { cloudName: string; apiKey: string; testMode: boolean; project: { id: string; sites: { id: string; name: string }[]; activities: string[] } }) {
  const [ready, setReady] = useState(false);
  const [showcase, setShowcase] = useState(false);
  const [message, setMessage] = useState('');
  const [count, setCount] = useState(0);
  const [site, setSite] = useState('');
  const [activity, setActivity] = useState('');
  const [date, setDate] = useState('');
  const [active, setActive] = useState(false);
  const widget = useRef<Widget | null>(null);
  useEffect(() => () => widget.current?.destroy(), []);

  function open(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.cloudinary) return;
    widget.current?.destroy();
    const preset = testMode ? 'ps02_core' : showcase ? 'ps02_showcase' : 'ps02_ingest';
    const context = { project: project.id, ps02_analysis_tier: preset === 'ps02_showcase' ? 'showcase' : 'bulk', ...(site ? { site_id: site } : {}), ...(activity ? { activity_hint: activity } : {}), ...(date ? { batch_date: date } : {}) };
    setActive(true);
    try {
    widget.current = window.cloudinary.createUploadWidget({
      cloudName, apiKey, uploadPreset: preset, asset_folder: `ps02/${project.id}`, context,
      sources: ['local', 'url', 'camera'], multiple: true, maxFiles: showcase && !testMode ? 40 : 100,
      resourceType: 'auto', clientAllowedFormats: ['image', 'video'],
      uploadSignature: async (callback: (signature: string) => void, paramsToSign: Record<string, unknown>) => {
        try {
          const response = await fetch('/api/upload-signature', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paramsToSign }),
          });
          if (!response.ok) throw new Error('Signing failed');
          callback((await response.json()).signature);
        } catch {
          setMessage('Upload signing failed. Close the widget and try again.');
          callback('');
        }
      },
    }, (error, result) => {
      if (error) setMessage('The upload could not finish. Please try again.');
      if (result?.event === 'close') setActive(false);
      if (result?.event === 'success') {
        setCount(value => value + 1);
        setMessage('Upload complete. The evidence list updates after Cloudinary sends its notification.');
      }
    });
    widget.current.open();
    } catch {
      setActive(false);
      setMessage('The upload window could not open. Please try again.');
    }
  }

  return <section className="panel">
    <Script src="https://upload-widget.cloudinary.com/latest/global/all.js" onReady={() => setReady(true)} onError={() => setMessage('The Cloudinary Upload Widget could not load.')} />
    <form onSubmit={open}><fieldset className="batch-context" disabled={active}><legend>Batch context <span className="muted">· optional</span></legend><p className="small muted">These details apply to every file in this batch. The date is used when capture and EXIF dates are unavailable; an activity hint is recorded for reviewers.</p><div className="form-grid">
      <label>Site<select value={site} onChange={event => setSite(event.target.value)}><option value="">Site unknown</option>{project.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
      <label>Activity hint<select value={activity} onChange={event => setActivity(event.target.value)}><option value="">No activity hint</option>{project.activities.map(activity => <option key={activity} value={activity}>{activity.replaceAll('_', ' ')}</option>)}</select></label>
      <label>Date · UTC<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
    </div>
    {testMode ? <p className="notice">Core test mode: EXIF, quality and hashes only. No captioning, tagging or AI Vision calls.</p>
      : <><label className="toggle"><input type="checkbox" checked={showcase} onChange={event => setShowcase(event.target.checked)} /> Showcase upload</label>
        <p>{showcase ? 'Adds Google tags and captions. Use only for the hand-picked showcase set (up to 40 assets).' : 'Standard uploads include Cloudinary captions.'}</p></>}
    </fieldset><button type="submit" disabled={!ready || active}>{active ? 'Upload window open' : ready ? 'Choose files to upload' : 'Loading upload widget…'}</button></form>
    <p role="status">{message}{count > 0 ? ` ${count} uploaded this session.` : ''}</p>
  </section>;
}
