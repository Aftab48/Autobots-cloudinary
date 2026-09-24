import { getCloudinary } from '../../../lib/cloudinary.mjs';
import { validateProjectUpload } from '../../../lib/upload-context.mjs';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let params;
  try {
    const body = await request.json();
    if (!body || typeof body.paramsToSign !== 'object' || Array.isArray(body.paramsToSign) || !body.paramsToSign) throw new Error('Missing paramsToSign');
    params = await validateProjectUpload(body.paramsToSign);
  } catch {
    return Response.json({ error: 'Invalid upload parameters' }, { status: 400 });
  }
  try {
    const cloudinary = getCloudinary();
    return Response.json({ signature: cloudinary.utils.api_sign_request(params, cloudinary.config().api_secret!) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Upload signing is unavailable' }, { status: 503 });
  }
}
