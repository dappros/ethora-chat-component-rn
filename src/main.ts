/**
 * Library entry point.
 *
 * Consumers drop the component into their own RN/Expo app like:
 *
 *   import { Chat } from '@ethora/chat-component';
 *
 *   <Chat
 *     config={{
 *       // The API ROOT — the SDK versions every path itself
 *       // (`/v1/...`, `/v2/...`). A legacy `.../v1` is accepted and
 *       // normalised, so existing integrations keep working.
 *       baseUrl: 'https://api.chat.ethora.com',
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
export { logoutService, useLogout } from './hooks/useLogout';
export { useQRCodeChat, handleQRChatId } from './hooks/useQRCodeChatHandler';
export { resendMessage } from './utils/resendMessage';
// Font loader, exposed so hosts can also load the font outside <Chat> if needed.
export { useChatFonts } from './hooks/useChatFonts';

// Static UI i18n. `useT` is the in-component hook; `translateKey` is the
// one-shot for helpers outside React. Hosts extend or override any caption
// through `config.i18n.strings`, keyed by the same keys BUILTIN_STRINGS uses.
export { useT, useUiLocale } from './i18n/useT';
export {
  BUILTIN_STRINGS,
  DEFAULT_UI_LANGUAGE,
  resolveStringTable,
  toBaseLanguage,
  translateKey,
} from './i18n/strings';
export type { UiStringTable } from './i18n/strings';

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
  ChatTextStyle,
  VideoCallsConfig,
  VideoCallIcons,
} from './types/types';
export type { Iso639_1Codes } from './types/models/language.model';
export type { TranslateMode } from './utils/translateModePolicy';

// Auth-token rotation. Exposed so hosts can drive a refresh themselves
// (it is deduped and shares the SDK's lock) and, more importantly, so
// they can tell a dead session from a transient failure: only
// `RefreshFatalError` means "log the user out". Every other rejection —
// network, 5xx, a lost REFRESH_IN_PROGRESS race — must leave the
// session alone.
export {
  refreshAuthTokens,
  refreshAuthTokensQuietly,
  RefreshFatalError,
  isRefreshFatalError,
} from './networking/authRefresh';
export type {
  RefreshErrorCode,
  RefreshResult,
  RefreshOptions,
} from './networking/authRefresh';
