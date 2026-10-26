import { useEffect, useState } from 'react';

/**
 * Seconds since the call truly connected, counted from the server-set
 * `joinedAt` anchor so both sides show the same time (web's
 * useSharedCallElapsed). Null until the peer is in.
 */
export const useSharedCallElapsed = (anchorAt: number | null): number | null => {
  const [, tick] = useState(0);
  useEffect(() => {
    if (anchorAt === null) {return;}
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [anchorAt]);
  if (anchorAt === null) {return null;}
  return Math.max(0, Math.floor((Date.now() - anchorAt) / 1000));
};

export const formatCallDuration = (totalSeconds: number): string => {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};
