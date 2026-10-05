import { useSyncExternalStore } from 'react';

/** How long the jump highlight stays on a bubble. */
export const HIGHLIGHT_MS = 1000;

interface Highlight {
  id: string;
  /** Epoch ms the highlight ends. */
  until: number;
}

let current: Highlight | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/**
 * Highlight the bubble of one message for HIGHLIGHT_MS (a jump just landed on
 * it), or clear the highlight with null. Kept outside the list on purpose: a
 * row that is unmounted and mounted again while the highlight is running (the
 * list recycles rows as the scroll settles) reads the same state, so the
 * highlight follows the message instead of being lost with the row.
 */
export const setBubbleHighlight = (id: string | null, now = Date.now()): void => {
  current = id === null ? null : { id, until: now + HIGHLIGHT_MS };
  emit();
};

export const getBubbleHighlightUntil = (id: string): number =>
  current && current.id === id ? current.until : 0;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * End time (epoch ms) of the highlight of this message, 0 when it has none.
 * The snapshot is a number, so only the highlighted row re-renders.
 */
export const useBubbleHighlightUntil = (id: string): number =>
  useSyncExternalStore(
    subscribe,
    () => getBubbleHighlightUntil(id),
    () => 0
  );
