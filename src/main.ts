/**
 * Library entry point.
 *
 * Consumers drop the component into their own RN/Expo app like:
 *
 *   import { Chat } from '@ethora/chat-component';
 *
 *   <Chat
 *     config={{
 *       baseUrl: 'https://api.chat.ethora.com/v1',
 *       xmppSettings: { host: 'xmpp.chat.ethora.com' },
 *       jwtLogin: { enabled: true, token: '<paste JWT>' },
 *       initBeforeLoad: true,
 *       colors: { primary: '#5E3FDE' },
 *     }}
 *   />
 *
 * The provider wires up redux + xmpp + toast automatically. Pass
 * `roomJID` to lock the chat to a single room, or omit it to show the
 * built-in room list.
 */

import 'react-native-get-random-values';

// Main mount points.
export { ReduxWrapper as Chat } from './components/MainComponents/ReduxWrapper';
export { XmppProvider } from './context/xmppProvider';

// Hooks that consumers usually need (badge counts, logout, push, etc.).
export { useUnread } from './hooks/useUnreadMessagesCounter';
export { useChatRoomFocus } from './hooks/useChatRoomFocus';
export { logoutService } from './hooks/useLogout';
export { useQRCodeChat, handleQRChatId } from './hooks/useQRCodeChatHandler';
export { resendMessage } from './utils/resendMessage';
// Font loader — exposed so hosts can also load the font outside <Chat> if needed.
export { useChatFonts } from './hooks/useChatFonts';

// Public types — needed so consumers can type their `config` prop and
// any event handlers they pass in.
export type {
  IConfig,
  IRoom,
  IMessage,
  IUser,
  User,
  ConfigUser,
  MessageProps,
  TypographyConfig,
  RNFontSource,
} from './types/types';
