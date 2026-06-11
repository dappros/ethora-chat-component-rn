import { nameToColor } from './hashcolor';

// Background for initials avatars. When `colors.avatar` is set in the
// config every avatar uses it; otherwise each user keeps their per-name
// pastel from the hash palette (the current default).
export const getAvatarColor = (
  name?: string | null,
  config?: { colors?: { avatar?: string } }
) => config?.colors?.avatar || nameToColor(name || '')?.backgroundColor;

// The default pastels are all light, so initials are dark (#141414). A
// configured avatar color may be dark (e.g. brand primary) — flip the
// initials to white when the background is too dark to read on.
export const getAvatarTextColor = (bg?: string) => {
  if (!bg || !bg.startsWith('#')) {
    return '#141414';
  }
  let hex = bg.slice(1);
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const num = parseInt(hex.slice(0, 6), 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 150 ? '#141414' : '#FFFFFF';
};
