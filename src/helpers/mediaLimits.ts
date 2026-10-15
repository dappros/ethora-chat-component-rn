import type { IConfig } from '../types/types';

/** Hard client-side cap on a single upload. Mirrors the backend's body limit. */
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

/** The most files one message may carry (also the parser-side ceiling). */
export const MAX_MEDIA_FILES = 10;

/** Files per message the host allows: `attachments.maxFiles`, clamped to 1-10. */
export const mediaFileCap = (config?: Pick<IConfig, 'attachments'> | null): number => {
  const configured = Number(config?.attachments?.maxFiles);
  if (!Number.isFinite(configured)) {return MAX_MEDIA_FILES;}
  return Math.min(MAX_MEDIA_FILES, Math.max(1, Math.floor(configured)));
};

/**
 * Bytes allowed per file: the 50 MB upload cap, lowered by
 * `attachments.maxSizeMB` when the host sets a smaller one.
 */
export const mediaSizeLimit = (
  config?: Pick<IConfig, 'attachments'> | null,
  override?: number
): number => {
  const base = typeof override === 'number' && override > 0 ? Math.min(override, MAX_MEDIA_BYTES) : MAX_MEDIA_BYTES;
  const mb = Number(config?.attachments?.maxSizeMB);
  return Number.isFinite(mb) && mb > 0 ? Math.min(base, mb * 1024 * 1024) : base;
};
