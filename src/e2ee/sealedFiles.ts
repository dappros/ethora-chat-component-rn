import { Directory, File as FsFile, Paths } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { ensureFilenameHasExtension } from '../helpers/mimeToExtension';
import { sanitizeFileNameForPath } from '../helpers/getDisplayFileName';
import { openSealedFile, sealFileForUpload } from './fileEnvelope';
import type { Progress } from './fileCipher';
import { MAX_OPEN_BYTES, MAX_SEAL_BYTES } from './limits';

export { MAX_OPEN_BYTES, MAX_SEAL_BYTES };

const OPENED_DIR = 'ethora-sealed';

export interface SealedUpload {
  uri: string;
  name: string;
  keyMaterial: string;
  dispose(): void;
}

export interface OpenedFile {
  uri: string;
  name: string;
  mimetype: string;
  size: number;
}

const hashString = (value: string) => {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
};

export async function sealPickedFile(
  picked: { uri: string; name?: string; type?: string; size?: number },
  onProgress?: Progress
): Promise<SealedUpload> {
  if (typeof picked.size === 'number' && picked.size > MAX_SEAL_BYTES) {
    throw new Error('sealed_attachment_too_large');
  }
  const bytes = await new FsFile(picked.uri).bytes();
  if (bytes.length > MAX_SEAL_BYTES) {
    throw new Error('sealed_attachment_too_large');
  }
  const sealed = await sealFileForUpload(
    { bytes, name: picked.name, type: picked.type },
    onProgress
  );
  const parked = new FsFile(Paths.cache, `ethora-seal-${sealed.filename}`);
  parked.write(sealed.ciphertext);
  return {
    uri: parked.uri,
    name: sealed.filename,
    keyMaterial: sealed.keyMaterial,
    dispose: () => {
      try {
        if (parked.exists) {parked.delete();}
      } catch {
      }
    },
  };
}

const folderFor = (location: string): Directory =>
  new Directory(
    Paths.cache,
    OPENED_DIR,
    hashString(location.split('#')[0]!.split('?')[0]!)
  );

const noteIn = (folder: Directory) => new FsFile(folder, 'meta.json');

export async function findOpened(location: string): Promise<OpenedFile | null> {
  if (!location) {return null;}
  try {
    const folder = folderFor(location);
    const note = noteIn(folder);
    if (!note.exists) {return null;}
    const opened = JSON.parse(await note.text()) as OpenedFile;
    return new FsFile(opened.uri).exists ? opened : null;
  } catch {
    return null;
  }
}

function keep(
  location: string,
  meta: { name: string; mimetype: string; size: number },
  write: (target: FsFile) => void | Promise<void>
): Promise<OpenedFile> {
  return (async () => {
    const folder = folderFor(location);
    folder.create({ intermediates: true, idempotent: true });
    const name =
      sanitizeFileNameForPath(
        ensureFilenameHasExtension(meta.name, meta.mimetype)
      ).replace(/^\.+/, '') || 'file';
    const target = new FsFile(folder, name);
    if (target.exists) {target.delete();}
    await write(target);
    const opened: OpenedFile = {
      uri: target.uri,
      name: meta.name,
      mimetype: meta.mimetype,
      size: meta.size,
    };
    const note = noteIn(folder);
    if (note.exists) {note.delete();}
    note.write(JSON.stringify(opened));
    return opened;
  })();
}

const opening = new Map<string, Promise<OpenedFile>>();

export function openSealedAttachment(
  location: string,
  url: string,
  keyMaterial: string,
  onProgress?: Progress
): Promise<OpenedFile> {
  const running = opening.get(location);
  if (running) {return running;}

  const task = (async () => {
    const kept = await findOpened(location);
    if (kept) {return kept;}

    const parked = new FsFile(Paths.cache, `ethora-open-${hashString(location)}`);
    try {
      if (parked.exists) {parked.delete();}
      const download = await LegacyFileSystem.downloadAsync(url, parked.uri);
      if (download.status < 200 || download.status >= 300) {
        throw new Error(`sealed_attachment_http_${download.status}`);
      }
      if ((parked.size ?? 0) > MAX_OPEN_BYTES) {
        throw new Error('sealed_attachment_too_large');
      }
      const ciphertext = await parked.bytes();
      const { meta, bytes } = await openSealedFile(ciphertext, keyMaterial, onProgress);
      return await keep(
        location,
        { name: meta.originalname, mimetype: meta.mimetype, size: bytes.length },
        (target) => target.write(bytes)
      );
    } finally {
      try {
        if (parked.exists) {parked.delete();}
      } catch {
      }
    }
  })().finally(() => opening.delete(location));
  opening.set(location, task);
  return task;
}

export async function rememberOpened(
  location: string,
  source: { uri: string; name?: string; type?: string; size?: number }
): Promise<void> {
  if (!location || !source?.uri) {return;}
  const original = new FsFile(source.uri);
  await keep(
    location,
    {
      name: source.name || 'blob',
      mimetype: source.type || 'application/octet-stream',
      size: source.size ?? original.size ?? 0,
    },
    (target) => original.copy(target)
  );
}

export function clearOpenedFiles(): void {
  try {
    const root = new Directory(Paths.cache, OPENED_DIR);
    if (root.exists) {root.delete();}
  } catch {
  }
}
