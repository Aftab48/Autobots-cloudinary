import { database } from './db.mjs';
import { projectId as legacyProjectId } from './cloudinary.mjs';

export const SUPPORTED_ACTIVITIES = ['river_cleanup', 'waste_removal', 'tree_plantation', 'infrastructure', 'community_participation'];
export const DEMO_PROJECT = { id: '00000000-0000-4000-8000-000000000005', name: 'River Restoration — Kolkata', organization: 'Green Bengal NGO (fictional demo org)', campaign_type: 'Environmental Restoration', location: 'Kolkata, West Bengal', start_date: '2026-01-01', end_date: '2026-06-30', description: 'Riverbank cleanup, restoration and community participation campaign.', activities: SUPPORTED_ACTIVITIES };
export class ProjectInputError extends Error {}
export const isProjectId = value => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
function string(value, label, max, required = false) {
  if (value == null || value === '') { if (required) throw new ProjectInputError(`${label} is required.`); return null; }
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new ProjectInputError(`${label} must contain ${required ? '1–' : 'at most '}${max} characters.`);
  return value.trim() || null;
}
export function validateDate(value, label = 'Date') {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new ProjectInputError(`${label} must be a valid YYYY-MM-DD date.`);
  return value;
}
export function validateProject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProjectInputError('Provide project details.');
  const start_date = validateDate(input.start_date, 'Start date'), end_date = validateDate(input.end_date, 'End date');
  if (start_date && end_date && start_date > end_date) throw new ProjectInputError('End date must be on or after start date.');
  if (!Array.isArray(input.activities) || !input.activities.length || input.activities.some(a => !SUPPORTED_ACTIVITIES.includes(a)) || new Set(input.activities).size !== input.activities.length) throw new ProjectInputError('Choose at least one supported activity without duplicates.');
  return { name: string(input.name, 'Name', 160, true), organization: string(input.organization, 'Organization', 200), campaign_type: string(input.campaign_type, 'Campaign type', 120), location: string(input.location, 'Location', 200), description: string(input.description, 'Description', 2000), start_date, end_date, activities: input.activities };
}
export async function listProjects(sql = database()) {
  return sql.query('SELECT * FROM projects ORDER BY (id = $1::uuid) DESC, (id = $2::uuid) ASC, name, id', [DEMO_PROJECT.id, legacyProjectId]);
}
export async function getActiveProject(preferredId = null, sql = database()) {
  const projects = await listProjects(sql);
  return projects.find(p => p.id === preferredId) ?? projects[0] ?? null;
}
export async function createProject(input, sql = database()) {
  const p = validateProject(input);
  return (await sql.query('INSERT INTO projects (name,organization,campaign_type,location,start_date,end_date,description,activities) VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8::text[]) RETURNING *', [p.name,p.organization,p.campaign_type,p.location,p.start_date,p.end_date,p.description,p.activities]))[0];
}
export async function createSite(projectId, input, sql = database()) {
  if (!isProjectId(projectId)) throw new ProjectInputError('Invalid project.');
  const name = string(input?.name, 'Site name', 120, true);
  const coordinate = (v, max) => { if (v == null || v === '') return null; const n = Number(v); if (!Number.isFinite(n) || Math.abs(n) > max) throw new ProjectInputError('Invalid site coordinates.'); return n; };
  const lat = coordinate(input?.lat, 90), lng = coordinate(input?.lng, 180);
  if ((lat === null) !== (lng === null)) throw new ProjectInputError('Provide both latitude and longitude.');
  if (!(await sql.query('SELECT id FROM projects WHERE id=$1::uuid', [projectId])).length) throw new ProjectInputError('Project does not exist.');
  if ((await sql.query('SELECT id FROM sites WHERE project_id=$1::uuid AND lower(name)=lower($2)', [projectId, name])).length) throw new ProjectInputError('This project already has a site with that name.');
  return (await sql.query('INSERT INTO sites (project_id,name,lat,lng) VALUES ($1::uuid,$2,$3,$4) RETURNING *', [projectId,name,lat,lng]))[0];
}
