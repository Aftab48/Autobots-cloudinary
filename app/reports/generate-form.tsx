'use client';
import { useActionState } from 'react';
import { createReport } from './actions';

// Disabled while pending so a double click cannot pay for two reports.
export default function GenerateForm() {
  const [state, action, pending] = useActionState(createReport, null);
  return <form action={action}><div className="search-actions"><label className="toggle"><input type="checkbox" name="template" /> Template sentences only (no AI call)</label>
    <button type="submit" disabled={pending}>{pending ? 'Generating…' : 'Generate report'}</button></div>
    {pending && <p className="small muted" role="status">Writing the report. This can take a few seconds.</p>}{state?.error && <p role="alert">{state.error}</p>}</form>;
}
