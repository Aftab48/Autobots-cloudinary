// Read the TIFF IFDs exposed by sharp.metadata().exif. No metadata is invented.
export function exifFlags(input) {
  const flags = { has_exif_date: false, has_gps: false };
  if (!input) return flags;
  try {
    const b = input.subarray(input.subarray(0, 6).equals(Buffer.from('Exif\0\0')) ? 6 : 0);
    const le = b.toString('ascii', 0, 2) === 'II';
    if (!le && b.toString('ascii', 0, 2) !== 'MM') return flags;
    const u16 = (p) => le ? b.readUInt16LE(p) : b.readUInt16BE(p);
    const u32 = (p) => le ? b.readUInt32LE(p) : b.readUInt32BE(p);
    if (u16(2) !== 42) return flags;
    const seen = new Set();
    function ifd(offset) {
      const tags = new Map();
      if (!offset || seen.has(offset) || offset + 2 > b.length) return tags;
      seen.add(offset);
      const count = u16(offset);
      if (count > 1024 || offset + 2 + count * 12 > b.length) return tags;
      for (let i = 0; i < count; i++) {
        const p = offset + 2 + i * 12, type = u16(p + 2), n = u32(p + 4);
        const size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 })[type];
        if (!size || n > 100000) continue;
        const start = size * n <= 4 ? p + 8 : u32(p + 8);
        if (start + size * n > b.length) continue;
        tags.set(u16(p), { type, n, start, value: u32(p + 8) });
      }
      return tags;
    }
    const root = ifd(u32(4));
    const exif = ifd(root.get(0x8769)?.value);
    for (const tag of [root.get(0x132), exif.get(0x9003), exif.get(0x9004)]) {
      if (tag?.type !== 2) continue;
      const value = b.toString('ascii', tag.start, tag.start + tag.n).replace(/\0.*$/, '');
      if (/^[12]\d{3}:(0[1-9]|1[0-2]):(0[1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value)) flags.has_exif_date = true;
    }
    const gps = ifd(root.get(0x8825)?.value);
    function coordinate(id, max) {
      const tag = gps.get(id);
      if (tag?.type !== 5 || tag.n !== 3) return false;
      const values = [0, 1, 2].map((i) => u32(tag.start + i * 8) / u32(tag.start + i * 8 + 4));
      return values.every(Number.isFinite) && values[0] <= max && values[1] < 60 && values[2] < 60 && values[0] + values[1] / 60 + values[2] / 3600 <= max;
    }
    const ref = (id) => { const t = gps.get(id); return t?.type === 2 ? b.toString('ascii', t.start, t.start + t.n).replace(/\0.*$/, '') : ''; };
    flags.has_gps = coordinate(2, 90) && coordinate(4, 180) && /^[NS]$/.test(ref(1)) && /^[EW]$/.test(ref(3));
  } catch { /* Truncated or malformed EXIF is not a positive flag. */ }
  return flags;
}
