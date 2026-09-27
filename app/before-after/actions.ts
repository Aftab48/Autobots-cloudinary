'use server';
import { redirect } from 'next/navigation';
import { selectedProjectId } from '../../lib/active-project';
import { createComparison, ComparisonInputError } from '../../lib/comparisons.mjs';
import { safeError } from '../../lib/pipeline-providers.mjs';

// Provider calls stay on the server; the browser only sends the two asset IDs.
export async function compare(_: { error: string } | null, formData: FormData) {
  let target;
  try {
    const { comparison, created } = await createComparison(await selectedProjectId(), formData.get('before_asset_id'), formData.get('after_asset_id'));
    target = `/before-after?status=${created ? 'created' : 'existing'}#comparison-${comparison.id}`;
  } catch (error) {
    if (error instanceof ComparisonInputError) return { error: error.message };
    console.error('Comparison failed', safeError(error), (error as { errors?: unknown }).errors);
    return { error: 'The comparison could not be completed and nothing was saved. Try again later.' };
  }
  redirect(target);
}
