import { filenameFromUrl, isLikelyAudio } from './mimeToExtension';

export type FileKind = 'image' | 'video' | 'audio' | 'file';

interface FileKindInput {
  mimetype?: string | null;
  name?: string | null;
  url?: string | null;
  duration?: number | string | null;
  waveForm?: string | null;
  originalName?: string | null;
}

/**
 * Which card a file gets in a bubble. Mirrors the branches MediaMessage has
 * always used for a single file (image, video, audio, octet-stream as a voice
 * note, then the voice-message heuristics) so an album, a card stack and a
 * lone file all agree on what a given file is.
 */
export const getFileKind = (input: FileKindInput): FileKind => {
  const mime = (input.mimetype || '').toLowerCase();
  if (mime.startsWith('image/')) {return 'image';}
  if (mime.startsWith('video/')) {return 'video';}
  if (mime.startsWith('audio/')) {return 'audio';}
  if (mime.includes('application/octet-stream')) {return 'audio';}
  const name = input.name || filenameFromUrl(input.url);
  return isLikelyAudio(mime, name, input.url, {
    duration: input.duration,
    waveForm: input.waveForm,
    originalName: input.originalName,
  })
    ? 'audio'
    : 'file';
};

/** True for the kinds that sit in the picture/video album. */
export const isAlbumKind = (kind: FileKind): boolean =>
  kind === 'image' || kind === 'video';
