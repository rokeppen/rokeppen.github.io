// Pure checks for sprite image uploads (no DOM, no network). Mirrors the `sprites` Storage
// bucket limits in supabase/migrations/2026-11-25-beer-party.sql.

export const BUCKET = 'sprites';
export const MAX_BYTES = 1048576;
export const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

const EXT_BY_TYPE = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp' };
const EXT_BY_NAME = { png: 'png', jpg: 'jpg', jpeg: 'jpg', svg: 'svg', webp: 'webp' };
const PUBLIC_PREFIX = `/storage/v1/object/public/${BUCKET}/`;

// Returns a human-readable problem, or null when the file can be uploaded.
export function validateImageFile(file) {
  const type = file?.type;
  const size = file?.size;
  if (!ALLOWED_TYPES.includes(type)) {
    return `Images must be PNG, JPEG, SVG or WebP${type ? ` (got ${type})` : ''}.`;
  }
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return 'The file is empty.';
  if (size > MAX_BYTES) return `Images must be 1 MB or smaller (this one is ${Math.ceil(size / 1024)} KB).`;
  return null;
}

// `<uuid>.<ext>`: the extension comes from the MIME type, else from the file name when that is
// a known image extension, else there is none.
export function objectPathFor(file) {
  let ext = EXT_BY_TYPE[file?.type];
  if (!ext) {
    const m = /\.([a-z0-9]+)$/i.exec(String(file?.name ?? ''));
    ext = m ? EXT_BY_NAME[m[1].toLowerCase()] : undefined;
  }
  const id = crypto.randomUUID();
  return ext ? `${id}.${ext}` : id;
}

// The object path inside the bucket for a public URL from getPublicUrl, or null when the URL
// is not one of ours (an emoji, another site, another bucket).
export function storagePathFromUrl(url) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.pathname.startsWith(PUBLIC_PREFIX)) return null;
  const raw = parsed.pathname.slice(PUBLIC_PREFIX.length);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
