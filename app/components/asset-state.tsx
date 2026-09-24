'use client';
import { createContext, useContext, useEffect, useState } from 'react';

export type AssetState = { id: string; status: string; pipeline_state: string };
const States = createContext<Record<string, AssetState>>({});
const pending = (asset: AssetState) => ['uploaded', 'analyzing'].includes(asset.pipeline_state);

/** Refresh just pipeline labels, never repeat a search or trigger analysis. */
export function AssetStates({ assets, children, projectId }: { assets: AssetState[]; children: React.ReactNode; projectId?: string }) {
  const [states, setStates] = useState<Record<string, AssetState>>(() => Object.fromEntries(assets.map(asset => [asset.id, asset])));
  const [notice, setNotice] = useState('');
  const signature = JSON.stringify(assets.map(({ id, status, pipeline_state }) => ({ id, status, pipeline_state })));
  useEffect(() => {
    const initial = JSON.parse(signature) as AssetState[];
    setStates(Object.fromEntries(initial.map(asset => [asset.id, asset])));
    setNotice('');
    let remaining = initial.filter(pending).map(asset => asset.id);
    if (!remaining.length) return;
    let stopped = false, attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      if (stopped) return;
      if (document.visibilityState === 'hidden') { timer = setTimeout(poll, 5000); return; }
      attempts++;
      try {
        const response = await fetch(`/api/assets/states?ids=${remaining.join(',')}${projectId ? `&project=${encodeURIComponent(projectId)}` : ''}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('State read failed');
        const data = await response.json() as { assets: AssetState[] };
        if (stopped) return;
        setStates(previous => ({ ...previous, ...Object.fromEntries(data.assets.map(asset => [asset.id, asset])) }));
        if (data.assets.some(asset => !pending(asset))) setNotice('Processing changed. Badges are current; reload this page to see updated descriptions and counts.');
        remaining = data.assets.filter(pending).map(asset => asset.id);
      } catch {
        if (!stopped) setNotice('Live pipeline updates are unavailable. Reload this page to check the latest state.');
      }
      if (!stopped && remaining.length && attempts < 60) timer = setTimeout(poll, 5000);
      else if (!stopped && remaining.length) setNotice('Live updates paused after five minutes. Reload this page to check ongoing processing.');
    };
    timer = setTimeout(poll, 5000);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [signature, projectId]);
  return <States.Provider value={states}>{notice && <p className="notice state-notice" role="status">{notice}</p>}{children}</States.Provider>;
}

export default function AssetBadges({ asset }: { asset: AssetState }) {
  const current = useContext(States)[asset.id] || asset;
  const stateLabels: Record<string, string> = { uploaded: 'Uploaded · queued', analyzing: 'Analyzing', classified: 'Classified', failed: 'Processing failed' };
  return <div className="asset-badges" aria-label="Evidence status and pipeline state" aria-live="polite">
    <span className={`status status-${current.status}`}>{current.status}</span>
    <span className={`pipeline pipeline-${current.pipeline_state}`}><span className="pipeline-dot" aria-hidden="true" />{stateLabels[current.pipeline_state] || 'State unavailable'}</span>
  </div>;
}
