import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import {
  setCurrentRoom,
  setLastViewedTimestamp,
} from '../roomStore/roomsSlice';

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
 * blur stamps `lastViewedTimestamp = Date.now()` (so future messages
 * count as unread) and focus stamps `0` (clears the badge and tells
 * the middleware the user is actively viewing).
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

  useEffect(() => {
    if (!roomJID) {return;}
    if (isFocused) {
      // Tell middleware "user is actively viewing this room" — skips
      // unread recomputes for it and clears any existing badge.
      dispatch(setCurrentRoom({ roomJID }));
      dispatch(setLastViewedTimestamp({ chatJID: roomJID, timestamp: 0 }));
    } else {
      // Tab lost focus. Stamp "read up to now" AND clear the active-room
      // marker. The unread middleware skips the room while
      // `jid === activeChatJID`, so without clearing it the count stayed
      // pinned at 0 for tab-based consumers whose <ChatRoom> never
      // unmounts (bug #19). On re-focus the branch above restores it.
      dispatch(
        setLastViewedTimestamp({ chatJID: roomJID, timestamp: Date.now() })
      );
      dispatch(setCurrentRoom({ roomJID: null as any }));
    }
  }, [roomJID, isFocused, dispatch]);
};

export default useChatRoomFocus;
