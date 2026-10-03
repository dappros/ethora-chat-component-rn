import { Middleware } from '@reduxjs/toolkit';

declare const __DEV__: boolean | undefined;

/**
 * Dev-only store profiler: counts dispatches and the time the reducer +
 * middleware chain spent on them, and prints a one-line summary every
 * 10 s while there was activity. Reads as
 *   [perf] 10s: 143 actions, 212ms in store, top: roomMessages/addRoomMessages×12 (90ms) …
 * No-op (and not even installed) in release builds.
 */
const WINDOW_MS = 10000;

let count = 0;
let totalMs = 0;
let byType: Record<string, { n: number; ms: number }> = {};
let timer: ReturnType<typeof setTimeout> | null = null;

const flush = () => {
  timer = null;
  if (count === 0) {return;}
  const top = Object.entries(byType)
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, 4)
    .map(([type, v]) => `${type}×${v.n} (${v.ms.toFixed(0)}ms)`)
    .join(', ');
  console.log(
    `[perf] ${WINDOW_MS / 1000}s: ${count} actions, ${totalMs.toFixed(0)}ms in store, top: ${top}`
  );
  count = 0;
  totalMs = 0;
  byType = {};
};

export const perfMiddleware: Middleware = () => (next) => (action: any) => {
  const start = Date.now();
  const result = next(action);
  const ms = Date.now() - start;
  count += 1;
  totalMs += ms;
  const type = action?.type || '?';
  const entry = byType[type] || (byType[type] = { n: 0, ms: 0 });
  entry.n += 1;
  entry.ms += ms;
  if (!timer) {timer = setTimeout(flush, WINDOW_MS);}
  return result;
};

export const isPerfProfilingEnabled = () =>
  typeof __DEV__ !== 'undefined' && __DEV__ === true;
