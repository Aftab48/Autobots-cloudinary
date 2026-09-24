import { NextResponse } from 'next/server';
import { searchAssets, SearchInputError, SearchNotFoundError } from '../../../../../lib/search.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const result = await searchAssets(id, url.searchParams.get('q') ?? '', { useLlm: url.searchParams.get('llm') !== 'off' });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SearchInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof SearchNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: 'Search is temporarily unavailable. Please try again.' }, { status: 503 });
  }
}
