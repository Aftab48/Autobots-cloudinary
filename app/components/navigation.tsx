'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const pages = [['/', 'Dashboard'], ['/evidence', 'Evidence'], ['/review', 'Review queue'], ['/search', 'Search'], ['/before-after', 'Before / after'], ['/reports', 'Reports'], ['/upload', 'Upload'], ['/capture', 'Capture']];
export default function Navigation({ projects, selectedId, unavailable = false }: { projects: { id: string; name: string }[]; selectedId?: string; unavailable?: boolean }) {
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function selectProject(projectId: string) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/projects/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: projectId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Project could not be selected.');
      window.location.assign('/');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Project could not be selected.'); setBusy(false); }
  }
  return <header className="site-header"><div className="site-header-inner"><Link className="site-brand" href="/" aria-label="PS02 project dashboard">PS02<span>Field evidence</span></Link>
    <div className="project-switcher"><label htmlFor="active-project">Current project</label><select id="active-project" value={selectedId || ''} disabled={busy || !projects.length} onChange={event => selectProject(event.target.value)}>{!projects.length && <option value="">{unavailable ? 'Projects unavailable' : 'No projects yet'}</option>}{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select><Link href="/projects/new">+ New project</Link>{unavailable && <span role="status">Projects are temporarily unavailable. Reload to try again.</span>}{busy && <span role="status">Switching project…</span>}{error && <span role="alert">{error}</span>}</div>
    <nav aria-label="Project navigation">{pages.map(([href, title]) => <Link key={href} href={href} aria-current={(href === '/' ? pathname === href : pathname.startsWith(href)) ? 'page' : undefined}>{title}</Link>)}</nav>
  </div></header>;
}
