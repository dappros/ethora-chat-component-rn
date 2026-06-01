import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * In-tree overlay host for the message context menu (MessageInteractions).
 *
 * Why this exists: MessageInteractions used to render inside a React Native
 * `<Modal>`. On Android a Modal opens its own window, which steals focus
 * from the chat input — so opening the menu dismissed the keyboard. Hosting
 * the menu in the SAME view tree (no extra window) keeps the keyboard up.
 *
 * Coordinate note: the menu is positioned from `UIManager.measure` WINDOW
 * coordinates (pageX/pageY), but this host sits below the status bar / any
 * safe-area + header insets, so its own origin is offset from the window.
 * The host measures that offset (`measureInWindow`) and exposes it so the
 * menu can convert window coords → host-local coords. The host is mounted
 * ABOVE ChatRoom's KeyboardAvoidingView, so its origin doesn't move when the
 * keyboard opens (only the measured bubble's pageY does).
 */
interface OverlayEntry {
  id: string;
  node: React.ReactNode;
}

interface InteractionsOverlayCtx {
  present: (id: string, node: React.ReactNode) => void;
  dismiss: (id: string) => void;
  originX: number;
  originY: number;
}

const Ctx = createContext<InteractionsOverlayCtx>({
  present: () => {},
  dismiss: () => {},
  originX: 0,
  originY: 0,
});

export const useInteractionsOverlay = () => useContext(Ctx);

export const InteractionsOverlayProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [entries, setEntries] = useState<OverlayEntry[]>([]);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const hostRef = useRef<View>(null);

  const measure = useCallback(() => {
    hostRef.current?.measureInWindow?.((x, y) => {
      if (typeof x !== 'number' || typeof y !== 'number') {return;}
      setOrigin((prev) => (prev.x === x && prev.y === y ? prev : { x, y }));
    });
  }, []);

  const present = useCallback(
    (id: string, node: React.ReactNode) => {
      // Re-measure on present: the keyboard / layout may have shifted us
      // since the last onLayout.
      measure();
      setEntries((prev) => {
        const next = prev.filter((e) => e.id !== id);
        next.push({ id, node });
        return next;
      });
    },
    [measure]
  );

  const dismiss = useCallback((id: string) => {
    setEntries((prev) =>
      prev.some((e) => e.id === id) ? prev.filter((e) => e.id !== id) : prev
    );
  }, []);

  // MUST be memoized. Otherwise every host re-render (e.g. from present()'s
  // setEntries) creates a new context value → all consumers re-render →
  // MessageInteractions' present-effect fires again → setEntries → … →
  // "Maximum update depth exceeded". present/dismiss are stable (useCallback)
  // and origin rarely changes, so this value is stable across entry changes.
  const ctxValue = useMemo(
    () => ({ present, dismiss, originX: origin.x, originY: origin.y }),
    [present, dismiss, origin.x, origin.y]
  );

  return (
    // `children` is a stable element from the caller, so re-rendering this
    // host (present/dismiss/origin state) does NOT re-render the chat
    // subtree — React reconciliation skips the unchanged children element.
    <View
      ref={hostRef}
      style={styles.host}
      onLayout={measure}
      collapsable={false}
    >
      <Ctx.Provider value={ctxValue}>
        {children}
        {entries.length > 0 && (
          <View style={styles.overlay} pointerEvents="box-none">
            {entries.map((e) => (
              <React.Fragment key={e.id}>{e.node}</React.Fragment>
            ))}
          </View>
        )}
      </Ctx.Provider>
    </View>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 9999, elevation: 9999 },
});

export default InteractionsOverlayProvider;
