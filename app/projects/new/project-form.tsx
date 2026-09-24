'use client';
import { useState } from 'react';

export default function ProjectForm({ activities }: { activities: string[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  async function select(project: { id: string; name: string }) {
    const response = await fetch('/api/projects/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: project.id }) });
    if (!response.ok) throw new Error(`“${project.name}” was created, but could not be opened. Use Open project below or choose it in the navigation after reloading.`);
    window.location.assign('/');
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    try {
      if (created) { await select(created); return; }
      const response = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...Object.fromEntries(data), activities: data.getAll('activities') }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Project could not be created.');
      setCreated(result.project);
      await select(result.project);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Project could not be created.'); setBusy(false); }
  }
  return <form className="panel project-form" onSubmit={submit}><fieldset disabled={busy || Boolean(created)}><div className="form-grid">
    <label className="full-width">Project name<input name="name" required maxLength={160} autoComplete="off" /></label>
    <label>Organization<input name="organization" maxLength={200} autoComplete="organization" /></label>
    <label>Campaign type<input name="campaign_type" defaultValue="Environmental Restoration" maxLength={120} /></label>
    <label className="full-width">Location<input name="location" maxLength={200} /></label>
    <label>Start date<input name="start_date" type="date" /></label><label>End date<input name="end_date" type="date" /></label>
    <label className="full-width">Description<textarea name="description" rows={3} maxLength={2000} /></label>
  </div><fieldset className="activity-options"><legend>Activities</legend><p className="small muted">Start with the restoration activity list. Keep at least one activity for your campaign.</p>{activities.map(activity => <label className="toggle" key={activity}><input type="checkbox" name="activities" value={activity} defaultChecked />{activity.replaceAll('_', ' ')}</label>)}</fieldset></fieldset>
    <button type="submit" disabled={busy}>{busy ? (created ? 'Opening project…' : 'Creating project…') : created ? 'Open project' : 'Create project'}</button>{error && <p role="alert">{error}</p>}
  </form>;
}
