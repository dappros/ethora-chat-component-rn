import { useSyncExternalStore } from 'react';
import type {
  ScheduledCallDetail,
} from '../networking/api-requests/scheduledCalls.api';

/**
 * UI state of the scheduled-call flow: the pre-join sheet (a call opened from
 * a card or a link) and the editor (schedule a new call / edit one). Kept
 * outside redux because it is transient and has no business in persistence,
 * the same way the call overlay's own UI state is (VideoCalls/callUiStore).
 */

export type PreJoinErrorReason =
  | 'not-a-member'
  | 'not-found'
  | 'cancelled'
  | 'network';

export type PreJoinState =
  | { phase: 'loading'; slug: string }
  | { phase: 'ready'; slug: string; detail: ScheduledCallDetail }
  | {
      phase: 'error';
      slug: string;
      reason: PreJoinErrorReason;
      /** The call's title when the server told us (cancelled). */
      title?: string;
    };

export type EditorState =
  | { mode: 'create'; roomJid: string }
  | { mode: 'edit'; roomJid: string; detail: ScheduledCallDetail };

interface ScheduledCallUiState {
  preJoin: PreJoinState | null;
  editor: EditorState | null;
}

let state: ScheduledCallUiState = { preJoin: null, editor: null };
const listeners = new Set<() => void>();

const emit = (patch: Partial<ScheduledCallUiState>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};

export const scheduledCallUi = {
  getState: (): ScheduledCallUiState => state,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  showPreJoin: (preJoin: PreJoinState) => emit({ preJoin }),
  closePreJoin: () => emit({ preJoin: null }),
  openCreate: (roomJid: string) => emit({ editor: { mode: 'create', roomJid } }),
  openEdit: (roomJid: string, detail: ScheduledCallDetail) =>
    emit({ editor: { mode: 'edit', roomJid, detail } }),
  closeEditor: () => emit({ editor: null }),
  reset: () => emit({ preJoin: null, editor: null }),
};

export const useScheduledCallUi = (): ScheduledCallUiState =>
  useSyncExternalStore(
    scheduledCallUi.subscribe,
    scheduledCallUi.getState,
    scheduledCallUi.getState
  );
