import { ensureFilenameHasExtension, filenameFromUrl } from './mimeToExtension';

export interface DisplayFileNameOptions {
  originalName?: string | null;
  fileName?: string | null;
  location?: string | null;
  mimetype?: string | null;
}

/**
 * Picks the best human-readable filename for a chat attachment - the
 * single source of truth for every place a file name is rendered in the
 * UI, saved to disk, shared, or downloaded.
 *
 * Priority: `originalName` (the sender's own file name, e.g. "test1.pdf")
 * beats `fileName` (the server's stored/hashed name, e.g.
 * "3f9a1c...c2.pdf") beats the last path segment of `location`. The
 * stored hash name is only a fallback of last resort.
 *
 * Bug #40: display and save/share/download logic used to prefer the
 * stored hash name over the original one, so an attachment sent as
 * "test1.pdf" showed up (and got saved to the phone) as something like
 * "3f9a1c...c2.pdf" - both directions (web -> RN and RN -> RN).
 *
 * Always returns a non-empty string with a valid extension: if the
 * chosen candidate has no extension (a hash name can be `<hex>` with no
 * extension at all, or `<hex>.<ext>`), one is appended from `mimetype`
 * (or `.bin` as a last resort when the mime is unknown/missing too).
 */
export function getDisplayFileName(options: DisplayFileNameOptions): string {
  const candidate =
    (options.originalName && options.originalName.trim()) ||
    (options.fileName && options.fileName.trim()) ||
    filenameFromUrl(options.location) ||
    '';
  return ensureFilenameHasExtension(candidate, options.mimetype);
}

/**
 * Makes a display name safe to use as an actual path segment when
 * saving/sharing a file to the device: strips path separators (so an
 * odd/hostile server-provided name can't escape the target directory)
 * and control characters. Keeps the rest of the name - including the
 * extension - intact.
 */
export function sanitizeFileNameForPath(name: string): string {
  const cleaned = (name || '')
    .replace(/[\/\\]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();
  return cleaned || 'file';
}

/**
 * Resolves a filename that is safe to write into a target directory:
 * sanitizes it, then - if `exists` reports a collision - inserts
 * " (1)", " (2)", ... before the extension until a free name is found,
 * so saving two different attachments that share a display name never
 * silently overwrites the first one.
 *
 * `exists` is injected so callers can back it with whatever existence
 * check makes sense for their storage API (expo-file-system,
 * StorageAccessFramework directory listing, ...) - this function stays
 * pure and easy to unit test.
 */
export async function getUniqueFileName(
  name: string,
  exists: (candidateName: string) => Promise<boolean>
): Promise<string> {
  const safeName = sanitizeFileNameForPath(name);
  if (!(await exists(safeName))) {
    return safeName;
  }
  const dotIndex = safeName.lastIndexOf('.');
  const base = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
  const ext = dotIndex > 0 ? safeName.slice(dotIndex) : '';
  // 999 collisions is already a pathological case; fall back to a
  // timestamp suffix rather than looping forever.
  for (let i = 1; i < 1000; i += 1) {
    const candidate = `${base} (${i})${ext}`;
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
  return `${base} (${Date.now()})${ext}`;
}
