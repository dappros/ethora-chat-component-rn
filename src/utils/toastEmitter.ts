/**
 * Tiny pub/sub used by `ToastContext` so non-React code can fire a
 * toast. Replaces an out-of-tree port artifact (`../../../../utils/...`).
 */
import type { ToastType } from '../components/Toast';

type Listener = (toast: ToastType) => void;

const listeners = new Set<Listener>();

export const toastEmitter = {
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  emit(toast: ToastType) {
    listeners.forEach((fn) => {
      try {
        fn(toast);
      } catch {
        /* swallow */
      }
    });
  },
};
