let cached: any | undefined;

export const getMediaLibrary = (): any | null => {
  if (cached !== undefined) {return cached;}
  try {
    const legacy = require('expo-media-library/legacy');

    if (legacy?.getAssetsAsync) {
      cached = legacy;
      return cached;
    }
  } catch {
  }

  try {
    cached = require('expo-media-library') ?? null;
  } catch {
    cached = null;
  }
  return cached;
};

export const __resetMediaLibraryCache = () => {
  cached = undefined;
};
