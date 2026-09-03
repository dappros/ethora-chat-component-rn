import { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import {
  clearVisibleRoom,
  setCurrentRoom,
  setLastViewedTimestamp,
  setVisibleRoom,
} from '../roomStore/roomsSlice';
import { store } from '../roomStore';

interface UseChatRoomFocusOptions {
  /** The room JID that the consumer's tab/screen is currently showing. */
  roomJID: string | null | undefined;
  /**
   * Whether the chat tab/screen is currently focused. In tab-based
   * navigators where `<ChatRoom>` never unmounts, the SDK can't tell
   * "user is looking at this tab" from "user is on a different tab"
   * — pass this from `useFocusEffect` (React Navigation) or a similar
   * focus signal so the unread counter clears on focus and starts
   * counting again on blur.
   */
  isFocused: boolean;
}

/**
 * Public hook for consumers embedding `<ChatRoom>` inside a tab-based
 * navigator. Mirrors the mount/unmount unread-tracking that ChatRoom
 * does internally — but driven by an explicit focus signal so the
 * unread counter behaves correctly when the chat tab is not focused
 * but the component is still mounted.
 *
 * Without this hook, `useUnread()` will always return 0 for the chat
 * room because the SDK assumes "mounted == active". With this hook,
 * focus marks the room visible (clearing the badge) and blur stamps
 * `lastViewedTimestamp = Date.now()` so future messages count as unread.
 *
 * Usage with React Navigation:
 *
 * ```tsx
 * import { useIsFocused } from '@react-navigation/native';
 *
 * function ChatTab() {
 *   const isFocused = useIsFocused();
 *   useChatRoomFocus({ roomJID: 'general@conference.host', isFocused });
 *   return <Chat config={...} />;
 * }
 * ```
 *
 * Bug #18-adjacent / unread-tracking bug from sdk-bug-tracker.md.
 */
export const useChatRoomFocus = ({
  roomJID,
  isFocused,
}: UseChatRoomFocusOptions) => {
  const dispatch = useDispatch();
  const prevRef = useRef<{ roomJID: string | null; isFocused: boolean }>({
    roomJID: null,
    isFocused: false,
  });

  const leaveRoom = (jid: string) => {
    const rooms = store.getState().rooms?.rooms;
    // Only mark read as far as the user actually scrolled. Blindly
    // stamping `Date.now()` here clears messages they never reached, and
    // the server flush below makes that permanent across a restart.
    // Customer-reported #33.
    const boundaryTs = rooms?.[jid]?.readBoundaryTs ?? null;
    const timestamp = boundaryTs ?? Date.now();
    dispatch(setLastViewedTimestamp({ chatJID: jid, timestamp }));
    dispatch(clearVisibleRoom());
    (store.getState().chatSettingStore as any)?.client
      ?.flushLastViewedToPrivateStoreStanza(rooms, {
        visibleRoomJID: jid,
        visibleRoomTs: boundaryTs,
      })
      .catch(() => {});
  };

  useEffect(() => {
    const prev = prevRef.current;
    if (prev.isFocused && prev.roomJID && (prev.roomJID !== roomJID || !isFocused)) {
      leaveRoom(prev.roomJID);
    }

    if (roomJID && isFocused) {
      dispatch(setCurrentRoom({ roomJID }));
      dispatch(setVisibleRoom({ roomJID }));
    }

    prevRef.current = { roomJID: roomJID || null, isFocused };
  }, [roomJID, isFocused, dispatch]);

  useEffect(() => {
    return () => {
      const prev = prevRef.current;
      if (prev.isFocused && prev.roomJID) {
        leaveRoom(prev.roomJID);
      }
    };
  }, []);
};

export default useChatRoomFocus;
