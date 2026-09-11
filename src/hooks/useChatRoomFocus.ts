import { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import {
  clearVisibleRoom,
  setCurrentRoom,
  setLastViewedTimestamp,
  setVisibleRoom,
} from '../roomStore/roomsSlice';
import { store } from '../roomStore';
import { getServerReadTimestamp } from '../helpers/getServerReadTimestamp';

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
 * `lastViewedTimestamp` to the newest SERVER-acknowledged message so
 * future messages count as unread. Deliberately not `Date.now()`: a
 * device clock running ahead would write a future marker that the
 * forward-only private-store merge could never correct again (bug #38).
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
    const state = store.getState();
    const rooms = state.rooms?.rooms;
    const timestamp = getServerReadTimestamp(rooms?.[jid], state.roomHeapSlice);
    // Only stamp when we actually have something to anchor to - skip
    // rather than fall back to the device clock (bug #38).
    if (timestamp > 0) {
      dispatch(setLastViewedTimestamp({ chatJID: jid, timestamp }));
    }
    dispatch(clearVisibleRoom());
    (state.chatSettingStore as any)?.client
      ?.flushLastViewedToPrivateStoreStanza(rooms, { visibleRoomJID: jid })
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
