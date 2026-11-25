// Uploads to / removes from the `sprites` Storage bucket. Generic: used by the catalog editors
// (weapon and guest images) and the level editor (bar image). `client` is the supabase client.
import { BUCKET, validateImageFile, objectPathFor, storagePathFromUrl } from './upload-validate.js';

// Resolves to { ok: true, url } or { ok: false, error }; never throws.
export async function uploadSprite(client, file) {
  const problem = validateImageFile(file);
  if (problem) return { ok: false, error: problem };
  if (!client?.storage) return { ok: false, error: 'Image uploads are unavailable (no database connection).' };
  try {
    const bucket = client.storage.from(BUCKET);
    const path = objectPathFor(file);
    const { error } = await bucket.upload(path, file, { contentType: file.type, upsert: false });
    if (error) return { ok: false, error: `Upload failed: ${error.message ?? error}` };
    const url = bucket.getPublicUrl(path)?.data?.publicUrl;
    if (!url) return { ok: false, error: 'Upload failed: no public URL returned.' };
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: `Upload failed: ${e?.message ?? e}` };
  }
}

// Best effort: deletes the object behind one of our public URLs. Ignores anything else
// (emoji, foreign URLs) and never throws; a leftover file only costs storage.
export async function removeSprite(client, url) {
  const path = storagePathFromUrl(url);
  if (!path || !client?.storage) return;
  try {
    const { error } = await client.storage.from(BUCKET).remove([path]);
    if (error) console.warn('Could not remove old sprite:', error.message ?? error);
  } catch (e) {
    console.warn('Could not remove old sprite:', e?.message ?? e);
  }
}
