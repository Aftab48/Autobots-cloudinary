import piexif from 'piexifjs';
import sharp from 'sharp';

export const OFFSET_TIME_ORIGINAL = 0x9011;
// piexifjs predates EXIF 2.31. Register its standard ASCII offset tag explicitly.
piexif.TAGS.Exif[OFFSET_TIME_ORIGINAL] = { name: 'OffsetTimeOriginal', type: 'Ascii' };
export const LABELS = { Make: 'PS02 Synthetic', Model: 'Generated test fixture', ImageDescription: 'SYNTHETIC TEST DATA - generated for pipeline testing, not real field evidence' };
export function declaredMetadata(shot) {
  if (shot.metadata?.exif_present === false) return { capture_date: '', lat: '', lng: '', exif: false };
  const date = shot.metadata?.DateTimeOriginal;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30$/.test(date ?? '') || !Number.isFinite(Date.parse(date))) throw new Error(`Invalid IST capture time for ${shot.id}`);
  const lat = shot.metadata.GPSLatitude;
  const lng = shot.metadata.GPSLongitude;
  if ((lat == null) !== (lng == null)) throw new Error(`Incomplete GPS for ${shot.id}`);
  if (lat != null && (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180)) throw new Error(`Invalid GPS for ${shot.id}`);
  return { capture_date: date, lat: lat ?? '', lng: lng ?? '', exif: true };
}
export function degreesToRational(value) {
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutesFloat = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  return [[degrees, 1], [minutes, 1], [Math.round((minutesFloat - minutes) * 60 * 1000000), 1000000]];
}
function rationalToDegrees(value, ref) {
  if (!value) return null;
  const [d, m, s] = value.map(([n, den]) => n / den);
  return (d + m / 60 + s / 3600) * (ref === 'S' || ref === 'W' ? -1 : 1);
}
export async function prepareImage(raw, shot, model, format = { width: 1600, height: 1200 }) {
  const declared = declaredMetadata(shot);
  // Preserve XMP (including provider credentials), ICC and any visible watermark.
  // The untouched raw remains authoritative: JPEG re-encoding can invalidate signed credentials.
  const converted = await sharp(raw).keepXmp().keepIccProfile().resize(format.width, format.height, { fit: 'fill' }).jpeg({ quality: declared.exif ? 94 : 80 }).toBuffer();
  if (!declared.exif) return converted; // Deliberate exception to EXIF identity labels; filename/manifest still identify it.
  const zeroth = {};
  for (const [key, value] of Object.entries({ ...LABELS, Software: model })) zeroth[piexif.ImageIFD[key]] = value;
  const exif = { [piexif.ExifIFD.DateTimeOriginal]: declared.capture_date.slice(0, 19).replaceAll('-', ':').replace('T', ' '), [OFFSET_TIME_ORIGINAL]: '+05:30' };
  const gps = {};
  if (declared.lat !== '') {
    gps[piexif.GPSIFD.GPSLatitude] = degreesToRational(declared.lat);
    gps[piexif.GPSIFD.GPSLatitudeRef] = declared.lat < 0 ? 'S' : 'N';
    gps[piexif.GPSIFD.GPSLongitude] = degreesToRational(declared.lng);
    gps[piexif.GPSIFD.GPSLongitudeRef] = declared.lng < 0 ? 'W' : 'E';
  }
  return Buffer.from(piexif.insert(piexif.dump({ '0th': zeroth, Exif: exif, GPS: gps }), converted.toString('binary')), 'binary');
}
export function readExif(bytes) {
  const data = piexif.load(bytes.toString('binary'));
  const date = data.Exif[piexif.ExifIFD.DateTimeOriginal];
  const offset = data.Exif[OFFSET_TIME_ORIGINAL];
  return {
    has_exif: bytes.includes(Buffer.from('Exif\0\0')),
    capture_date: date ? date.slice(0, 10).replaceAll(':', '-') + 'T' + date.slice(11) + (offset ?? '') : '',
    datetime_original: date ?? null,
    offset_time_original: offset ?? null,
    lat: rationalToDegrees(data.GPS[piexif.GPSIFD.GPSLatitude], data.GPS[piexif.GPSIFD.GPSLatitudeRef]),
    lng: rationalToDegrees(data.GPS[piexif.GPSIFD.GPSLongitude], data.GPS[piexif.GPSIFD.GPSLongitudeRef]),
    latitude_ref: data.GPS[piexif.GPSIFD.GPSLatitudeRef] ?? null,
    longitude_ref: data.GPS[piexif.GPSIFD.GPSLongitudeRef] ?? null,
    labels: Object.fromEntries(['Make', 'Model', 'Software', 'ImageDescription'].map(key => [key, data['0th'][piexif.ImageIFD[key]] ?? null])),
    gps_tag_count: Object.keys(data.GPS).length,
  };
}
export function verifyExif(bytes, shot, model) {
  const actual = readExif(bytes);
  const wanted = declaredMetadata(shot);
  const errors = [];
  if (actual.has_exif !== wanted.exif) errors.push('EXIF presence mismatch');
  if (actual.capture_date !== wanted.capture_date) errors.push('Capture date/offset mismatch');
  for (const key of ['lat', 'lng']) {
    if (wanted[key] === '' ? actual[key] != null : actual[key] == null || Math.abs(actual[key] - wanted[key]) > 1e-8) errors.push(`${key} mismatch`);
  }
  if (wanted.lat === '' && actual.gps_tag_count) errors.push('Unexpected GPS tags');
  if (wanted.lat !== '' && actual.latitude_ref !== (wanted.lat < 0 ? 'S' : 'N')) errors.push('GPSLatitudeRef mismatch');
  if (wanted.lng !== '' && actual.longitude_ref !== (wanted.lng < 0 ? 'W' : 'E')) errors.push('GPSLongitudeRef mismatch');
  if (wanted.exif) for (const [key, value] of Object.entries({ ...LABELS, Software: model })) if (actual.labels[key] !== value) errors.push(`${key} label mismatch`);
  return { ok: errors.length === 0, errors, actual };
}
export const manifestColumns = ['file', 'shot_id', 'site', 'role', 'capture_date', 'lat', 'lng', 'generator_model', 'expected_pipeline_result', 'scenario_capture_date', 'metadata_exception'];
export function manifestRow(shot, model) {
  const declared = declaredMetadata(shot);
  return { file: `${shot.id}.synthetic.jpg`, shot_id: shot.id, site: shot.site, role: shot.role, capture_date: declared.capture_date, lat: declared.lat, lng: declared.lng, generator_model: model, expected_pipeline_result: shot.expected_pipeline_result.status, scenario_capture_date: shot.capture_datetime_ist, metadata_exception: declared.exif ? '' : 'Intentionally no EXIF, including identity labels; synthetic identity retained by filename and manifest. Raw generator provenance retained separately.' };
}
export function toCsv(rows) {
  return [manifestColumns, ...rows.map(row => manifestColumns.map(key => row[key]))].map(row => row.map(value => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n';
}
export function parseCsv(text) {
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(value); value = ''; }
    else if (c === '\n' && !quoted) { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; }
    else value += c;
  }
  if (quoted) throw new Error('Unterminated CSV quote');
  if (value || row.length) { row.push(value); rows.push(row); }
  const header = rows.shift();
  if (JSON.stringify(header) !== JSON.stringify(manifestColumns)) throw new Error('Unexpected manifest columns');
  return rows.map(fields => { if (fields.length !== header.length) throw new Error('Malformed CSV row'); return Object.fromEntries(header.map((key, i) => [key, fields[i]])); });
}
