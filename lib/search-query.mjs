import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const SEARCH_PROMPT_VERSION = 'search-v1';
export const SEARCH_LLM_SETTINGS = Object.freeze({ temperature: 0, max_tokens: 700 });
export const SEARCH_MAX_QUERY_LENGTH = 1000;
export const SEARCH_MAX_KEYWORDS = 24;
// A concrete server path also works in Next.js/Turbopack's build workers.
export const SEARCH_SYSTEM_PROMPT = readFileSync(join(process.cwd(), 'prompts/search-v1.md'), 'utf8');

const tokenPattern = /^[\p{L}\p{N}]+(?:[_-][\p{L}\p{N}]+)*$/u;
const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthNames = months.flatMap(name => [name, name.slice(0, 3)]).sort((a, b) => b.length - a.length).join('|');
const activityAliases = {
  river_cleanup: ['river cleanup', 'riverbank cleanup', 'river clean up', 'river cleanup work'],
  waste_removal: ['waste removal', 'waste collection', 'garbage collection', 'rubbish removal'],
  tree_plantation: ['tree plantation', 'tree planting', 'planting trees', 'planting', 'plant trees', 'sapling planting'],
  infrastructure: ['infrastructure', 'construction', 'repair', 'embankment work'],
  community_participation: ['community participation', 'community engagement', 'community gathering'],
};
const expansions = [
  [/\b(volunteers?|people|crowd)\b/u, ['volunteers', 'people', 'people_present', 'crowd']],
  [/\b(planting|plantation|saplings?|plant trees)\b/u, ['planting', 'tree_plantation', 'trees', 'saplings', 'vegetation']],
  [/\b(river|riverbank|riverside)\b/u, ['river', 'water_body', 'riverbank']],
  [/\b(infrastructure|construction|structures?|repair)\b/u, ['infrastructure', 'construction', 'structures', 'equipment']],
  [/\b(cleanup|clean up|litter|waste|garbage|rubbish)\b/u, ['cleanup', 'litter', 'waste_visible', 'cleanup_tools']],
  [/\bcommunity (participation|engagement|gathering)\b/u, ['community_participation', 'community', 'participation', 'people_present', 'crowd']],
];
const filler = new Set('show me find photos photo photographs photograph images image videos video evidence of during the restoration campaign between and in on at near a an to from through until since before after with for by work showing all please captured taken was were is are it this that'.split(' '));

function isDate(value) {
  if (!/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function searchReferenceYear(context = {}) {
  const start = context.start_date instanceof Date ? context.start_date.toISOString().slice(0, 10) : String(context.start_date ?? '').slice(0, 10);
  if (isDate(start)) return Number(start.slice(0, 4));
  const year = context.reference_year ?? new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 1900 || year > 2199) throw new Error('Invalid search reference year');
  return year;
}

function choices(context) {
  return {
    activities: (context.activities ?? []).filter(value => typeof value === 'string'),
    sites: (context.sites ?? []).filter(value => typeof value.id === 'string' && typeof value.name === 'string'),
  };
}

export function normalizeSearchText(query) {
  if (typeof query !== 'string' || query.length > SEARCH_MAX_QUERY_LENGTH) throw new Error(`Search query must be at most ${SEARCH_MAX_QUERY_LENGTH} characters`);
  return query.trim();
}

export function searchQuerySchema(context = {}) {
  const allowed = choices(context);
  const date = z.string().refine(isDate, 'Invalid capture date').nullable();
  return z.object({
    keywords: z.array(z.string().min(1).max(48).regex(tokenPattern).refine(word => word === word.toLowerCase(), 'Keywords must be lowercase')).max(SEARCH_MAX_KEYWORDS)
      .refine(words => new Set(words).size === words.length, 'Keywords must be unique'),
    date_from: date,
    date_to: date,
    activity: z.string().refine(value => allowed.activities.includes(value), 'Unknown project activity').nullable(),
    site: z.string().refine(value => allowed.sites.some(site => site.id === value), 'Unknown project site').nullable(),
  }).strict().refine(value => !value.date_from || !value.date_to || value.date_from <= value.date_to, 'Capture date range is reversed');
}

/** JSON text or an already parsed object; invalid output must trigger fallback. */
export function parseSearchQuery(raw, context = {}) {
  if (typeof raw === 'string' && raw.length > 12000) throw new Error('Search response is too large');
  return searchQuerySchema(context).parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
}

export function buildSearchMessages(query, context = {}) {
  const allowed = choices(context);
  return [
    { role: 'system', content: SEARCH_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify({ context: {
      name: String(context.name ?? '').slice(0, 200),
      reference_year: searchReferenceYear(context),
      ...allowed,
    }, query: normalizeSearchText(query) }) },
  ];
}

function iso(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function monthEnd(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
function shifted(date, days) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
}

function fallbackDates(text, referenceYear) {
  let remaining = text;
  let matches = [...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/gu)].map(match => ({ start: match[1], end: match[1], index: match.index, raw: match[0] }));
  if (!matches.length) {
    const monthPattern = new RegExp(`\\b(${monthNames})\\.?\\b(?:\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b)?(?:[ ,]+((?:19|20|21)\\d{2})\\b)?`, 'gu');
    const found = [...text.matchAll(monthPattern)];
    const explicitYears = [...text.matchAll(/\b((?:19|20|21)\d{2})\b/gu)];
    const sharedYear = explicitYears.length === 1 ? Number(explicitYears[0][1]) : referenceYear;
    let previousMonth = 0;
    let previousYear = sharedYear;
    matches = found.map(match => {
      const month = months.findIndex(name => name === match[1] || name.slice(0, 3) === match[1]) + 1;
      let year = match[3] ? Number(match[3]) : sharedYear;
      if (!match[3] && month < previousMonth) year = previousYear + 1;
      previousMonth = month;
      previousYear = year;
      const day = match[2] ? Number(match[2]) : null;
      return { start: iso(year, month, day ?? 1), end: iso(year, month, day ?? monthEnd(year, month)), index: match.index, raw: match[0] };
    });
    if (!matches.length && explicitYears.length) matches = explicitYears.map(match => ({ start: `${match[1]}-01-01`, end: `${match[1]}-12-31`, index: match.index, raw: match[0] }));
  }
  // Never normalize an impossible calendar date, or silently keep half a bad range.
  if (!matches.length || matches.some(value => !isDate(value.start) || !isDate(value.end)) || matches.length > 2) return { date_from: null, date_to: null, remaining };
  for (const match of matches) remaining = remaining.replace(match.raw, ' ');
  const first = matches[0];
  if (matches.length === 2) {
    return first.start <= matches[1].end
      ? { date_from: first.start, date_to: matches[1].end, remaining }
      : { date_from: null, date_to: null, remaining: text };
  }
  const prefix = text.slice(0, first.index).trim();
  if (/\bbefore$/u.test(prefix)) return { date_from: null, date_to: shifted(first.start, -1), remaining };
  if (/\bafter$/u.test(prefix)) return { date_from: shifted(first.end, 1), date_to: null, remaining };
  if (/\b(since|from)$/u.test(prefix)) return { date_from: first.start, date_to: null, remaining };
  if (/\b(through|until|to)$/u.test(prefix)) return { date_from: null, date_to: first.end, remaining };
  return { date_from: first.start, date_to: first.end, remaining };
}

function containsPhrase(text, phrase) {
  return ` ${text.replace(/[^\p{L}\p{N}]+/gu, ' ')} `.includes(` ${phrase.replace(/[_-]/g, ' ')} `);
}

/** No requests and no credentials: safe on missing config, provider or validation failure. */
export function fallbackSearchQuery(query, context = {}) {
  const text = normalizeSearchText(query).toLowerCase();
  const allowed = choices(context);
  const dates = fallbackDates(text, searchReferenceYear(context));
  const matchedActivities = allowed.activities.filter(key => [key.replace(/_/g, ' '), ...(activityAliases[key] ?? [])].some(phrase => containsPhrase(text, phrase)));
  const activity = matchedActivities.length === 1 ? matchedActivities[0] : null;
  const matchedSites = allowed.sites.filter(site => containsPhrase(text, site.name.toLowerCase()));
  const site = matchedSites.length === 1 ? matchedSites[0].id : null;
  let remaining = dates.remaining;
  if (site) remaining = remaining.replace(matchedSites[0].name.toLowerCase(), ' ');
  // The river in the first plan example describes its campaign, not another constraint.
  remaining = remaining.replace(/\b(?:the\s+)?river restoration campaign\b/gu, ' ');
  const keywords = [];
  const add = word => {
    if (word.length <= 48 && tokenPattern.test(word) && !keywords.includes(word) && keywords.length < SEARCH_MAX_KEYWORDS) keywords.push(word);
  };
  if (activity) add(activity);
  for (const word of remaining.match(/[\p{L}\p{N}]+(?:[_-][\p{L}\p{N}]+)*/gu) ?? []) if (!filler.has(word)) add(word);
  for (const [pattern, synonyms] of expansions) if (pattern.test(remaining.replace(/_/g, ' '))) synonyms.forEach(add);
  return parseSearchQuery({ keywords, date_from: dates.date_from, date_to: dates.date_to, activity, site }, context);
}
