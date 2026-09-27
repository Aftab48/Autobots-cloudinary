'use server';
import { redirect } from 'next/navigation';
import { selectedProjectId } from '../../lib/active-project';
import { generateReport, ReportInputError } from '../../lib/reports.mjs';
import { safeError } from '../../lib/pipeline-providers.mjs';

// Same work as POST /api/projects/:id/reports; the LLM call stays on the server.
export async function createReport(_: { error: string } | null, formData: FormData) {
  let target;
  try {
    const { report } = await generateReport(await selectedProjectId(), { useLlm: formData.get('template') !== 'on' });
    target = `/reports/${report.id}`;
  } catch (error) {
    if (error instanceof ReportInputError) return { error: error.message };
    console.error('Report failed', safeError(error));
    return { error: 'The report could not be generated and nothing was saved. Try again later.' };
  }
  redirect(target);
}
