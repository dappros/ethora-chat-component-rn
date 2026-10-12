import { useSyncExternalStore } from 'react';
import { store } from '../../roomStore';

/**
 * UI state of the call shared between the overlay and the header bar:
 * whether the call is minimized, and which header (if any) currently hosts
 * the minimized bar.
 *
 * Minimized, the call is a strip under the visible header (ChatHeader or
 * HeaderRoomList), Telegram-style, instead of a floating panel. Each header
 * registers itself while mounted; the most recently mounted one shows the
 * strip (on an iPad split view both are mounted, and only one strip should
 * appear). With no header mounted (the user is on a host-app screen) the
 * overlay docks the same strip to the top of the screen.
 */

interface CallUiState {
  minimized: boolean;
  /** Id of the header that shows the strip, or null when none is mounted. */
  barHost: number | null;
}

let state: CallUiState = { minimized: false, barHost: null };
const hosts: number[] = [];
let nextHostId = 1;
const listeners = new Set<() => void>();
let storeUnsubscribe: (() => void) | null = null;

const emit = (patch: Partial<CallUiState>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};

// The next call always opens full-screen.
const ensureStoreWatcher = () => {
  if (storeUnsubscribe) {return;}
  storeUnsubscribe = store.subscribe(() => {
    if (state.minimized && store.getState().call.phase === 'idle') {
      emit({ minimized: false });
    }
  });
};

const subscribe = (listener: () => void) => {
  ensureStoreWatcher();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => state;

/** Current state, for non-React code and tests. */
export const getCallUiState = (): CallUiState => state;

export const useCallUi = (): CallUiState =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

export const setCallMinimized = (minimized: boolean): void => {
  if (state.minimized !== minimized) {emit({ minimized });}
};

export const registerCallBarHost = (
  onId?: (id: number) => void
): (() => void) => {
  const id = nextHostId++;
  hosts.push(id);
  onId?.(id);
  emit({ barHost: id });
  return () => {
    const index = hosts.indexOf(id);
    if (index >= 0) {hosts.splice(index, 1);}
    emit({ barHost: hosts.length ? hosts[hosts.length - 1] : null });
  };
};
