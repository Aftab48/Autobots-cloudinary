import Link from 'next/link';
import { selectedProjectId } from '../../lib/active-project';
import { listReports } from '../../lib/reports.mjs';
import { formatDate, utcTime, writtenBy } from '../components/evidence-parts';
import GenerateForm from './generate-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reports · PS02' };

export default async function ReportsPage() {
  const projectId = await selectedProjectId();
  if (!projectId) return <main className="evidence"><p className="eyebrow">PS02 / REPORTS</p><h1>Project not available.</h1><div className="panel search-empty"><h2>No project selected.</h2><p>Create a project before writing a report.</p><p><Link href="/projects/new">Create a project →</Link></p></div></main>;
  const reports = await listReports(projectId);
  return <main className="evidence"><p className="eyebrow">PS02 / REPORTS</p><h1>Reports.</h1>
    <p>A report states plain counts from the database and a list of observations. Every observation cites the accepted evidence or comparison it comes from; sentences without a valid citation are removed before saving.</p>
    <section className="panel" aria-labelledby="generate-heading"><h2 id="generate-heading">Generate a report</h2><p className="small muted">The AI text model sees only accepted evidence and comparisons. If it fails or no sentence survives the citation check, the fixed template is used instead.</p><GenerateForm /></section>
    <section aria-labelledby="reports-heading"><div className="search-results-heading"><h2 id="reports-heading">{reports.length} {reports.length === 1 ? 'report' : 'reports'}</h2><p>Newest first</p></div>
      {reports.length ? <div className="table-scroll"><table><thead><tr><th scope="col">Generated</th><th scope="col">Evidence period</th><th scope="col">Sentences written by</th><th scope="col">Observations</th></tr></thead>
        <tbody>{reports.map(r => <tr key={r.id}><th scope="row"><Link href={`/reports/${r.id}`}>{utcTime(r.created_at)}</Link></th><td>{r.period_start ? `${formatDate(r.period_start)} → ${formatDate(r.period_end)}` : 'No dated evidence'}</td><td>{writtenBy(r.claims_source)}</td><td>{r.claims}</td></tr>)}</tbody></table></div>
        : <div className="panel search-empty"><h3>No reports yet.</h3><p>Generate one once evidence has been accepted.</p></div>}
    </section>
  </main>;
}
