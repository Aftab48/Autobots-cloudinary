import type { Metadata } from 'next';
import Link from 'next/link';
import { selectedProjectId } from '../../lib/active-project';
import { getSearchContext, searchAssets, SearchInputError } from '../../lib/search.mjs';
import SearchForm from './search-form';
import { getAssetStates } from '../../lib/project-views.mjs';
import AssetBadges, { AssetStates, type AssetState } from '../components/asset-state';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Search evidence · PS02', description: 'Find project evidence by activity, site, capture date and description.' };

type SearchAsset = {
  id: string; project_name: string; site_name: string | null; caption: string | null; cld_caption: string | null;
  activity: string | null; captured_at: string | null; status: string; resource_type: string;
  thumbnail_url: string; original_url: string; why_matched: { field: string; value: string }[];
};
type ProjectContext = { name: string; sites: { id: string; name: string }[] };
const fieldLabels: Record<string, string> = { caption: 'Caption', cld_caption: 'Cloudinary caption', cld_tags: 'Tag', signals: 'Signal', activity: 'Activity', date: 'Date', site: 'Site' };
const readable = (value: string) => value.replaceAll('_', ' ');
const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value)) : 'Capture date unknown';

function ResultCard({ asset, state }: { asset: SearchAsset; state?: AssetState }) {
  return <article className="search-result" aria-labelledby={`asset-${asset.id}`}>
    <a className="search-preview" href={`/evidence/${asset.id}`} aria-label={`View evidence ${asset.id}`}>
      {/* Cloudinary supplies this bounded transformation; no generative processing. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset.thumbnail_url} alt={asset.caption || asset.cld_caption || `${readable(asset.activity || 'Evidence')} preview`} width={640} height={420} loading="lazy" />
      <span className="search-media-label">{asset.resource_type === 'video' ? 'Video preview' : 'Photo'}</span>
    </a>
    <div className="search-result-body">
      <AssetBadges asset={state || { id: asset.id, status: asset.status, pipeline_state: 'unknown' }} />
      <div className="asset-heading"><h3 id={`asset-${asset.id}`}><Link href={`/evidence/${asset.id}`}>{readable(asset.activity || 'Unclassified activity')}</Link></h3></div>
      <dl className="search-result-facts">
        <div><dt>Project</dt><dd>{asset.project_name}</dd></div>
        <div><dt>Site</dt><dd>{asset.site_name || 'Site unknown'}</dd></div>
        <div><dt>Captured · UTC</dt><dd>{formatDate(asset.captured_at)}</dd></div>
      </dl>
      <div className="search-why"><h4>Why matched</h4>
        {asset.why_matched.length ? <ul>{asset.why_matched.map((hit, index) => <li key={`${hit.field}-${index}`}><strong>{fieldLabels[hit.field] || readable(hit.field)}:</strong> {hit.value}</li>)}</ul>
          : <p>Included in this project’s evidence; no text or date filter was applied.</p>}
      </div>
      <p className="asset-id">Asset {asset.id}</p>
      <div className="search-result-links"><a href={asset.original_url} target="_blank" rel="noreferrer">Original asset ↗</a><a href={asset.thumbnail_url} target="_blank" rel="noreferrer">Cloudinary preview ↗</a></div>
      <details className="trace-links"><summary>Transformation URL</summary><a className="trace-url" href={asset.thumbnail_url} target="_blank" rel="noreferrer">{asset.thumbnail_url}</a></details>
    </div>
  </article>;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; llm?: string | string[] }> }) {
  let projectId: string | undefined;
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q : '';
  const submitted = typeof params.q === 'string';
  const keywordOnly = params.llm === 'off';
  let context: ProjectContext | null = null;
  let response = null;
  let error = '';
  let states: AssetState[] = [];
  let stateError = false;
  try {
    projectId = await selectedProjectId();
    if (!projectId) throw new SearchInputError('This project is not available yet.');
    if (submitted) {
      response = await searchAssets(projectId, query, { useLlm: !keywordOnly });
      context = response.project as ProjectContext;
    } else {
      context = await getSearchContext(projectId) as ProjectContext | null;
      if (!context) error = 'This project is not available yet.';
    }
  } catch (cause) {
    error = cause instanceof SearchInputError ? cause.message : 'Search is temporarily unavailable. Please try again.';
  }
  const filters = response?.filters;
  if (response?.results.length) {
    try { states = await getAssetStates(response.results.map((asset: SearchAsset) => asset.id), undefined, projectId) as AssetState[]; }
    catch { stateError = true; }
  }
  const statesById = Object.fromEntries(states.map(state => [state.id, state]));
  const site = filters?.site ? context?.sites.find(item => item.id === filters.site)?.name || filters.site : null;

  return <main className="evidence search-page">
    <p className="eyebrow">PS02 / SEARCH EVIDENCE</p>
    <h1>Find the evidence.</h1>
    <p className="search-intro">Find moments of participation, restoration and change in your project’s evidence. See the stored details behind every match.</p>
    {context && <p className="search-project">Searching in <strong>{context.name}</strong></p>}
    <SearchForm initialQuery={query} keywordOnly={keywordOnly} />
    {error && <div className="panel search-error" role="alert"><h2>Unable to search</h2><p>{error}</p><p>Submit your search again to retry.</p></div>}
    {!submitted && !error && <section className="search-empty"><h2>A question is a good place to start.</h2><p>Describe what you need, or choose an example above. Results link back to the original evidence.</p></section>}
    {response && filters && <>
      <section className="panel search-interpretation" aria-labelledby="search-filters-title">
        <div className="asset-heading"><h2 id="search-filters-title">How we searched</h2><span className="status">{response.mode === 'llm' ? 'AI query interpretation' : 'Keyword/date fallback'}</span></div>
        <dl className="search-applied-filters">
          <div><dt>Expanded keywords</dt><dd>{filters.keywords.length ? <ul className="search-keywords">{filters.keywords.map((word: string) => <li key={word}>{word}</li>)}</ul> : 'All keywords'}</dd></div>
          <div><dt>Capture date · UTC</dt><dd>{filters.date_from || filters.date_to ? `${filters.date_from || 'Any start'} → ${filters.date_to || 'Any end'} (inclusive)` : 'Any date'}</dd></div>
          <div><dt>Activity</dt><dd>{filters.activity ? readable(filters.activity) : 'Any activity'}</dd></div>
          <div><dt>Site</dt><dd>{site || 'Any site'}</dd></div>
        </dl>
        <p className="search-help">Month-only dates use {response.reference_year}, based on the project start year when available. A year in your query takes precedence.</p>
        <p className="search-help">Results may match any expanded keyword within these filters. A match does not establish that every concept is present or that work is completed.</p>
        {response.mode === 'fallback' && <p className="search-help">{!query.trim() ? 'Browsing all project evidence; no AI request was needed.' : keywordOnly ? 'You selected keyword/date matching.' : 'AI query interpretation was unavailable; keyword/date matching was used.'}</p>}
      </section>
      <section aria-labelledby="search-results-title">
        <div className="search-results-heading"><h2 id="search-results-title">{response.has_more ? 'First 100 matches' : `${response.results.length} ${response.results.length === 1 ? 'match' : 'matches'}`}</h2><p>Accepted evidence first · then text relevance</p></div>
        {response.has_more && <p className="notice">Showing up to 100 results. Add a date, activity or site to narrow your search.</p>}
        {stateError && <p className="notice">Pipeline states are temporarily unavailable. The search results are still available.</p>}
        <AssetStates projectId={projectId} assets={states}>{!response.results.length ? <div className="panel search-empty"><h3>No evidence matched these filters.</h3><p>Try a broader activity or date range, or remove a place name. Check the interpreted filters above before searching again.</p></div>
          : <div className="search-results">{response.results.map((asset: SearchAsset) => <ResultCard key={asset.id} asset={asset} state={statesById[asset.id]} />)}</div>}</AssetStates>
      </section>
    </>}
  </main>;
}
