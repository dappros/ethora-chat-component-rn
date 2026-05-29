import { Dimensions } from 'react-native';

// Shared sizing for inline media bubbles (images + video posters).
// Goal: show the media UNCROPPED, just scaled, preserving aspect ratio —
// portrait stays portrait, landscape stays landscape.
const screenW = Dimensions.get('window').width;

// Box the media must fit inside. Width adapts to the screen so it never
// blows past the bubble's max-width on small phones, but caps on tablets.
export const MEDIA_MAX_W = Math.min(260, Math.round(screenW * 0.64));
export const MEDIA_MAX_H = 320;
// Keep thumbnails from collapsing into a sliver (very wide/tall media).
const MEDIA_MIN_W = 140;
const MEDIA_MIN_H = 120;

export interface MediaDims {
  width: number;
  height: number;
}

// Neutral 4:3 placeholder used before the natural size is known.
export const defaultMediaDims = (): MediaDims => ({
  width: MEDIA_MAX_W,
  height: Math.round(MEDIA_MAX_W * 0.75),
});

// Fit (natW × natH) inside the box, preserving aspect ratio. Never
// upscales beyond the source resolution (avoids blur), but bumps very
// small media up to a sensible minimum so it stays tappable.
export const fitMediaDimensions = (natW: number, natH: number): MediaDims => {
  if (!natW || !natH) {
    return defaultMediaDims();
  }
  let scale = Math.min(MEDIA_MAX_W / natW, MEDIA_MAX_H / natH);
  if (scale > 1) {
    scale = 1;
  }
  let width = Math.round(natW * scale);
  let height = Math.round(natH * scale);

  if (width < MEDIA_MIN_W || height < MEDIA_MIN_H) {
    const up = Math.max(MEDIA_MIN_W / width, MEDIA_MIN_H / height);
    width = Math.min(MEDIA_MAX_W, Math.round(width * up));
    height = Math.min(MEDIA_MAX_H, Math.round(height * up));
  }
  return { width, height };
};
