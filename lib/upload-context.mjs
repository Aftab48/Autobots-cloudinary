import { database } from './db.mjs';
import { parseUploadContext, validateUploadParams } from './cloudinary.mjs';
import { isProjectId, validateDate } from './projects.mjs';

export async function validateProjectUpload(params, sql = database(), now = Math.floor(Date.now() / 1000)) {
  validateUploadParams(params, now);
  // Existing scripts use the legacy preset's fixed project folder.
  if (params.asset_folder === undefined) return params;
  const context = parseUploadContext(params.context);
  const [project] = await sql.query('SELECT id,activities FROM projects WHERE id=$1::uuid', [context.project]);
  if (!project) throw new Error('Unknown project');
  if (context.site_id && (!isProjectId(context.site_id) || !(await sql.query('SELECT id FROM sites WHERE id=$1::uuid AND project_id=$2::uuid', [context.site_id, project.id])).length)) throw new Error('Site must belong to project');
  if (context.activity_hint && !project.activities.includes(context.activity_hint)) throw new Error('Activity hint must be in the project list');
  if (context.batch_date) validateDate(context.batch_date, 'Batch date');
  return params;
}
