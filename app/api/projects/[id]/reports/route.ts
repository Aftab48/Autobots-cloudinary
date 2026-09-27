import { generateReport, ReportInputError } from '../../../../../lib/reports.mjs';
import { safeError } from '../../../../../lib/pipeline-providers.mjs';

// Plan section 14.2. Provider calls stay on the server; ?llm=off forces the template claims.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin && origin !== process.env.APP_BASE_URL) return Response.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 });
  try {
    const { report, claims } = await generateReport((await params).id, { useLlm: new URL(request.url).searchParams.get('llm') !== 'off' });
    return Response.json({ report, claims }, { status: 201 });
  } catch (error) {
    if (error instanceof ReportInputError) return Response.json({ error: error.message }, { status: 404 });
    console.error('Report failed', safeError(error));
    return Response.json({ error: 'The report could not be generated and nothing was saved. Try again later.' }, { status: 503 });
  }
}
