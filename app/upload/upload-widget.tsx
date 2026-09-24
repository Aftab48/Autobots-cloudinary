'use client';

import Script from 'next/script';
import { useRef, useState, useEffect } from 'react';

type Widget = { open: () => void; destroy: () => void };
declare global {
  interface Window {
    cloudinary?: { createUploadWidget: (options: Record<string, unknown>, callback: (error: unknown, result: { event: string }) => void) => Widget };
  }
}

export default function UploadWidget({ cloudName, apiKey, testMode }: { cloudName: string; apiKey: string; testMode: boolean }) {
  const [ready, setReady] = useState(false);
  const [showcase, setShowcase] = useState(false);
  const [message, setMessage] = useState('');
  const [count, setCount] = useState(0);
  const widget = useRef<Widget | null>(null);
  useEffect(() => () => widget.current?.destroy(), []);

  function open() {
    if (!window.cloudinary) return;
    widget.current?.destroy();
    widget.current = window.cloudinary.createUploadWidget({
      cloudName, apiKey, uploadPreset: testMode ? 'ps02_core' : showcase ? 'ps02_showcase' : 'ps02_ingest',
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
      if (result?.event === 'success') {
        setCount(value => value + 1);
        setMessage('Upload complete. The evidence list updates after Cloudinary sends its notification.');
      }
    });
    widget.current.open();
  }

  return <section className="panel">
    <Script src="https://upload-widget.cloudinary.com/latest/global/all.js" onReady={() => setReady(true)} onError={() => setMessage('The Cloudinary Upload Widget could not load.')} />
    {testMode ? <p className="notice">Core test mode: EXIF, quality and hashes only. No captioning, tagging or AI Vision calls.</p>
      : <><label className="toggle"><input type="checkbox" checked={showcase} onChange={event => setShowcase(event.target.checked)} /> Showcase upload</label>
        <p>{showcase ? 'Adds Google tags and captions. Use only for the hand-picked showcase set (up to 40 assets).' : 'Standard uploads include Cloudinary captions.'}</p></>}
    <button disabled={!ready} onClick={open}>{ready ? 'Choose files to upload' : 'Loading upload widget…'}</button>
    <p role="status">{message}{count > 0 ? ` ${count} uploaded this session.` : ''}</p>
  </section>;
}
