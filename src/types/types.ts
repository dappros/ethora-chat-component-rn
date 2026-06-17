import type { ViewStyle, ImageSourcePropType, TextStyle } from 'react-native';
import type { Iso639_1Codes } from './models/language.model';
import type { IMessage, IReply } from './models/message.model';
import type { RoomMember } from './models/room.model';
import { MODAL_TYPES } from '../helpers/constants/MODAL_TYPES';

export interface IUser extends Partial<User> {
  id: string;
  name?: string | null;
  userJID?: string | null;
  token?: string;
  refreshToken?: string;
}

// IMessage and IReply are re-exported from the canonical model below (see end of file).

export type HistoryPreloadState = 'idle' | 'loading' | 'done' | 'error';

export interface IRoom {
  id: string;
  name: string;
  jid: string;
  title: string;
  usersCnt: number;
  messages: IMessage[];
  isLoading: boolean;
  roomBg: string | null;

  lastMessage?: string;
  lastRoomMessage?: RoomLastMessage;
  icon?: string | null;
  composing?: boolean;
  composingList?: string[];
  lastViewedTimestamp?: number;
  unreadMessages?: number;
  noMessages?: boolean;
  role?: string;
  createdAt?: string | number | Date;
  updatedAt?: string | number | Date;

  // REST-side metadata populated by `/chats/my` hydration. Surfaced
  // in ChatProfileModal under Description / Chat type fields.
  description?: string;
  type?: string;

  roomMembers?: RoomMember[];
  members?: RoomMember[];

  // QoS / preload state
  historyPreloadState?: HistoryPreloadState;
  historyComplete?: boolean;
  unreadCapped?: boolean;

  // Last-message tracking (driven by newMessageMidlleware).
  lastMessageTimestamp?: number;
  unreadBaselineTimestamp?: number;
  messageStats?: {
    lastMessageTimestamp?: number;
    firstMessageTimestamp?: number;
  };
}

// RoomMember is re-exported from the canonical model below (see end of file).

export interface RoomLastMessage {
  name: string;
  body: string;
}

export interface UserType extends IMessage {
  id: any;
  user: any;
  timestamp: any;
  text: any;
}

export interface ConfigUser {
  email: string;
  password: string;
}

export interface User {
  walletAddress: string;

  description?: string;
  token: string;
  refreshToken: string;

  defaultWallet: {
    walletAddress: string;
  };
  _id: string;
  firstName: string;
  lastName: string;
  email?: string;
  username?: string;
  profileImage?: string;
  emails?: [
    {
      loginType: string;
      email: string;
      verified: boolean;
      _id: string;
    },
  ];
  appId: string;
  xmppPassword: string;

  homeScreen?: string;
  registrationChannelType?: string;
  updatedAt?: string;
  authMethod?: string;
  resetPasswordExpires?: string;
  resetPasswordToken?: string;
  xmppUsername?: string;
  roles?: string[];
  tags?: string[];
  __v?: number;

  isProfileOpen?: boolean;
  isAssetsOpen?: boolean;
  isAgreeWithTerms?: boolean;
  isSuperAdmin?: any;
}

export interface XmppState {
  client: any;
  loading: boolean;
}

export interface HistoryQoSConfig {
  maxInFlightHistory?: number;
  softPauseAfterSendMs?: number;
  activeRoomBoostTtlMs?: number;
  activeSendBoostMs?: number;
  alwaysPrioritizeActiveRoom?: boolean;
  backgroundWhileCriticalSend?: boolean;
  preloadTopKRooms?: number;
  presenceFailureBackoffMs?: number;
  stagedPreloadEnabled?: boolean;
  stagedPreloadFirstPassSize?: number;
  stagedPreloadSecondPassSize?: number;
  stagedPreloadConcurrency?: number;
}

export interface xmppSettingsInterface {
  devServer?: string;
  host?: string;
  conference?: string;
  disableLastRead?: boolean;
  xmppPingOnSendEnabled?: boolean;
  historyQoS?: HistoryQoSConfig;
}

export interface InAppNotificationConfig {
  enabled?: boolean;
  showInContext?: boolean;
  maxNotifications?: number;
  duration?: number;
  position?: {
    horizontal?: 'left' | 'right' | 'center';
    vertical?: 'top' | 'bottom';
    offset?: {
      top?: number;
      bottom?: number;
      left?: number;
      right?: number;
    };
  };
  onClick?: (params: {
    roomJID: string;
    messageId: string;
    message: IMessage;
    roomName: string;
    senderName: string;
  }) => void | Promise<void>;
  customComponent?: React.ComponentType<{
    id: string;
    message: IMessage;
    roomName: string;
    senderName: string;
    roomJID: string;
    timestamp: number;
    onClose: () => void;
    onNavigateToMessage: (
      roomJID: string,
      messageId: string,
      message: IMessage,
      roomName: string,
      senderName: string
    ) => void;
    duration: number;
  }>;
}

export type ProviderBootstrapStatus =
  | 'idle'
  | 'running'
  | 'ready'
  | 'failed';

export interface FBConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface MessageBubble {
  backgroundMessage?: string;
  backgroundMessageUser?: string;
  colorUser?: string;
  color?: string;
}

export interface PartialRoomWithMandatoryKeys {
  jid: string;
  name?: string;
  title?: string;
  icon?: string;
  pinned?: boolean;
}

/**
 * A custom font to register at runtime via `expo-font`. On React Native a
 * font must be loaded before it can be referenced by name — there is no
 * web-style runtime `@font-face`. Each weight is typically its own file and
 * its own family name (RN does not synthesise weights reliably).
 *
 * `source` accepts what `Font.loadAsync` accepts: a remote URL string (e.g. a
 * hosted e-Ukraine `.ttf`), or a bundled asset via `require('./e-Ukraine.ttf')`.
 */
export interface RNFontSource {
  /** Family name used in text styles, e.g. "e-Ukraine" or "e-Ukraine-Medium". */
  family: string;
  /** Remote URL string or `require(...)` module for the font file. */
  source: string | number;
}

/**
 * Font configuration for the chat UI. When omitted, the component keeps the
 * platform's default system font, so existing integrations are unaffected.
 *
 * Provide `fonts` for the SDK to load via expo-font, then set `fontFamily` to
 * the family the chat should render in. If the host already loaded the font
 * itself (e.g. via `@expo-google-fonts/*` or its own `useFonts`), pass only
 * `fontFamily` and leave `fonts` empty.
 */
/**
 * Per-element font size / weight override.
 *
 * `fontWeight` is honoured even with a custom `fontFamily`: when
 * `weightFamilies` is configured, the chat maps the requested weight to the
 * matching family variant at render time (a single font file can't synthesise
 * 500/600 — only fake-bold ~700 — so the variant family is what actually
 * renders medium/semibold). Omit a field to keep the component default.
 */
export interface ChatTextStyle {
  /** Point size. */
  fontSize?: number;
  /** '400' | '500' | '600' | '700' | 'normal' | 'bold' | number. */
  fontWeight?: TextStyle['fontWeight'];
}

export interface TypographyConfig {
  /** Family applied across the chat UI. Must be loaded (via `fonts` or by the host). */
  fontFamily?: string;
  /**
   * Optional per-weight families. REQUIRED for `fontWeight` overrides to take
   * visible effect when a custom `fontFamily` is set — RN can't synthesise
   * intermediate weights from one font file, so each weight needs its own
   * loaded family (and a matching entry in `fonts`).
   */
  weightFamilies?: {
    regular?: string;
    medium?: string;
    semibold?: string;
    bold?: string;
  };
  /** Fonts for the SDK to load with expo-font before applying `fontFamily`. */
  fonts?: RNFontSource[];

  // ----- per-element size / weight overrides -----
  /** Message body text inside chat bubbles. Default 16. */
  messageText?: ChatTextStyle;
  /** Sender name shown above incoming messages. Default 14 / "500". */
  senderName?: ChatTextStyle;
  /** Room title in the chat header. Default 16 / "600". */
  headerTitle?: ChatTextStyle;
  /** Message composer: the input/placeholder text plus its layout sizing. */
  input?: ChatTextStyle & {
    /** Min height of the input box in px. Default 40. */
    minHeight?: number;
    /** Max height before the input scrolls in px. Default 120. */
    maxHeight?: number;
    /** Width & height of the round send button in px. Default 40. */
    sendButtonSize?: number;
  };
  /** Chat profile screen (opens when tapping the room name in the header). */
  profile?: {
    /** The "Chat Profile" bar title at the very top of the profile screen. Default ~system (small). */
    screenTitle?: ChatTextStyle;
    /** Big room-name title at the top of the profile screen. Default 24 / "400". */
    title?: ChatTextStyle;
    /** Member name rows. Default 16 / "600". */
    memberName?: ChatTextStyle;
  };
  /** Attach (photo/document picker) bottom sheet. */
  attachSheet?: {
    /** "Attach" header label. Default 13 / "600". */
    title?: ChatTextStyle;
    /** Row labels (Camera / Gallery / Document). Default 16 / "500". */
    rowLabel?: ChatTextStyle;
    /** Grey hint under each row. Default 12. */
    rowHint?: ChatTextStyle;
    /** Cancel button. Default 16 / "600". */
    cancelButton?: ChatTextStyle;
  };

  /**
   * Generic per-element font overrides addressed by key, applied via the
   * `getElementFont` helper as the highest-priority style layer. These target
   * smaller text elements that don't have a dedicated key above:
   *   - `headerSubtitle`      — the "N users" / typing line in the chat header
   *   - `inputText`           — the message composer input (overrides `input`)
   *   - `profileStatus`       — the "N members" line on the profile screen
   *   - `profileSectionLabel` — profile field labels ("Description", "Chat
   *                             type") and the member last-active line
   * When both this and a dedicated key target the same element, this wins.
   */
  elements?: Partial<
    Record<
      'headerSubtitle' | 'inputText' | 'profileStatus' | 'profileSectionLabel',
      ChatTextStyle
    >
  >;
}

export interface IConfig {
  // ----- identity / network -----
  appId?: string;
  baseUrl?: string;
  customAppToken?: string;
  projectName?: string;

  // ----- theming -----
  colors?: {
    primary: string;
    secondary: string;
    /** Tint for chrome icons (attach, mic/send, burger menu, edit banner,
     * scroll-to-bottom FAB). Falls back to `primary`, then `#0052CD`. */
    icon?: string;
    /** Color of the sender's name above incoming message bubbles.
     * Falls back to `primary`, then `#0052CD`. */
    senderName?: string;
    /** Background of initials avatars (message bubbles, chat header,
     * profile modals). When omitted, each user keeps their per-name
     * pastel color from the hash palette (current default). */
    avatar?: string;
    /** Text color of the day-separator pill ("Today", "June 8") in the
     * message list; the pill background is a light tint of it. Falls
     * back to `primary`, then `#0052CD`. */
    dateLabel?: string;
  };
  /** Configurable font family / weights for the chat UI. See TypographyConfig. */
  typography?: TypographyConfig;
  messageColor?: {
    backgroundMessage: string;
    backgroundMessageUser: string;
    colorUser: string;
    color: string;
  };
  backgroundChat?: {
    color?: string;
    image?: string | ImageSourcePropType;
  };
  bubleMessage?: MessageBubble;
  headerLogo?: string | React.ReactElement;

  // ----- header / nav -----
  disableHeader?: boolean;
  disableMedia?: boolean;
  /**
   * Enable in-chat voice-message recording. **Opt-in — off by default.**
   * When `true`, an idle input (no text, no attachments) shows a
   * microphone in the send-button slot; tap → start recording → stop &
   * send. iOS apps need `NSMicrophoneUsageDescription` in Info.plist
   * (add via `expo-av`'s plugin block in `app.json`). Receiving voice
   * messages from other clients (incl. legacy web `.bin` voicemails) is
   * independent of this flag — incoming audio plays regardless.
   */
  enableAudio?: boolean;
  chatHeaderBurgerMenu?: boolean;
  // Hide the burger icon entirely (the icon that opens the chatHeader-
  // BurgerMenu dropdown). `chatHeaderBurgerMenu` controls dropdown
  // visibility only — set this flag when you want neither the icon nor
  // the dropdown to render (e.g. patient-facing apps with a single room).
  disableChatHeaderBurgerMenuIcon?: boolean;
  // ----- granular gates inside the user-profile modal (chat info →
  //       tap a member). Use these to keep the profile section visible
  //       but hide individual actions that aren't appropriate for the
  //       embedding app (e.g. patient-facing apps that don't allow
  //       direct messaging between patients).
  disableMemberProfileActions?: boolean; // hides the whole action block
  hideMemberSendMessageAction?: boolean; // hides only "Message"
  hideMemberCopyIdAction?: boolean;      // hides only "Copy User Id"
  chatHeaderAdditional?: { enabled: boolean; element: any };
  headerMenu?: () => void;
  headerChatMenu?: () => void;
  chatHeaderSettings?: {
    hide?: boolean;
    disableCreate?: boolean;
    disableMenu?: boolean;
    hideSearch?: boolean;
  };

  // ----- auth -----
  googleLogin?: {
    enabled: boolean;
    firebaseConfig: FBConfig;
  };
  // Legacy: exchanges a client JWT via /v1/users/client. Prefer userLogin
  // or customLogin for new integrations.
  jwtLogin?: {
    token: string;
    enabled: boolean;
    handleBadlogin?: React.ReactElement;
  };
  userLogin?: {
    enabled: boolean;
    user: User | null;
  };
  // Preferred embedded integration: provide the final Ethora user/session
  // from your own backend or app auth flow.
  customLogin?: {
    enabled: boolean;
    loginFunction: () => Promise<User | null>;
  };
  defaultLogin?: boolean;
  refreshTokens?: {
    enabled: boolean;
    refreshFunction?: () => Promise<{
      accessToken: string;
      refreshToken?: string;
    } | null>;
  };

  // ----- bootstrap -----
  initBeforeLoad?: boolean;
  initBeforeLoadAuth?: {
    myEndpoint?: string;
  };
  clearStoreBeforeInit?: boolean;
  newArch?: boolean;
  useStoreConsoleEnabled?: boolean;

  // ----- xmpp / QoS -----
  xmppSettings?: xmppSettingsInterface;
  disableLastRead?: boolean;
  historyQoS?: HistoryQoSConfig;

  // ----- room list -----
  disableRooms?: boolean;
  disableRoomMenu?: boolean;
  forceSetRoom?: boolean;
  defaultRooms?: string[] | ConfigRoom[];
  setRoomJidInPath?: boolean; // web-only semantics; no-op on RN
  customRooms?: {
    rooms: PartialRoomWithMandatoryKeys[];
    disableGetRooms?: boolean;
    singleRoom: boolean;
  };
  enableRoomsRetry?: { enabled: boolean; helperText: string };
  disableNewChatButton?: boolean;
  disableRoomConfig?: boolean;
  disableChatInfo?: {
    disableHeader?: boolean;
    disableDescription?: boolean;
    disableType?: boolean;
    disableMembers?: boolean;
    hideMembers?: boolean;
    disableChatHeaderMenu?: boolean;
    disableRoomMenu?: boolean;
    /**
     * Disables uploading / removing the chat icon from the chat-info
     * modal. The avatar stays rendered (initials / current icon) but
     * the press-to-pick / remove affordances are gone — so the room
     * icon becomes read-only regardless of the user's role.
     */
    disableIconEdit?: boolean;
    /**
     * Disables the tap on a member row in the chat-info member list —
     * the popup that would show user-profile + per-member actions
     * (message / copy-id) never opens. `disableMemberProfileActions`
     * only hid the action BLOCK inside that popup; the popup itself
     * still opened on tap. Set this when no per-member interaction is
     * appropriate (e.g. patient-facing apps). Customer-reported #16.
     */
    disableMemberTap?: boolean;
  };
  qrUrl?: string;

  // ----- styling -----
  roomListStyles?: ViewStyle;
  chatRoomStyles?: ViewStyle;

  keyboardVerticalOffset?: number;
  // Opt OUT of the built-in keyboard handling. By default <Chat> mounts
  // its own react-native-keyboard-controller KeyboardProvider +
  // KeyboardAvoidingView (behavior="padding"). If the HOST app already
  // wraps <Chat> in its own KeyboardProvider / KeyboardAvoidingView, the
  // built-in one becomes a SECOND avoider over the same tree — two of them
  // animating padding on keyboard open is the Android flicker in bug #6.
  // Set this so the component renders a plain View instead and drops its
  // KeyboardProvider, leaving the host to own keyboard handling outright.
  disableKeyboardAvoidingView?: boolean;
  // Built-in keyboard strategy: instead of the default KeyboardAvoidingView
  // (which adds bottom padding to the WHOLE chat tree — the message list
  // reflows on keyboard open, the Android "messages jump/flash" in bug #6),
  // wrap ONLY the input dock in a react-native-keyboard-controller
  // KeyboardStickyView so just the input tracks the keyboard and the list
  // is never resized. Best for edge-to-edge Android hosts (where the OS
  // doesn't also resize the window). Ignored when
  // `disableKeyboardAvoidingView` is set. Needs on-device tuning of any
  // `keyboardVerticalOffset`.
  keyboardStickyInput?: boolean;

  // ----- interactions / messages -----
  disableInteractions?: boolean;
  disableReactions?: boolean;
  disableProfilesInteractions?: boolean;
  disableUserCount?: boolean;
  disableSentLogic?: boolean;
  disableTypingIndicator?: boolean;
  // Hide the full-screen "Connection error" overlay (the dark modal with
  // a Retry button shown when bootstrap/connect fails). For patient-facing
  // / kiosk apps where a full-screen error reads as a crash, set this and
  // surface connection state your own way (or let it recover silently —
  // reconnect + re-join now happen automatically). A subtle inline
  // "Connection lost. Retrying…" banner is shown instead.
  disableConnectionErrorOverlay?: boolean;
  // disableChatInfo already declared above (line ~338) — granular gates
  // (disableHeader / disableDescription / disableType / hideMembers /
  // disableMembers / disableChatHeaderMenu). Don't redeclare here.
  botMessageAutoScroll?: boolean;
  blockMessageSendingWhenProcessing?:
    | boolean
    | {
        enabled: boolean;
        timeout?: number;
        onTimeout?: (roomJID: string) => void;
      };
  messageTextFilter?: {
    enabled: boolean;
    filterFunction: (text: string) => string;
  };
  secondarySendButton?: {
    enabled: boolean;
    messageEdit: string;
    buttonText?: string;
    label?: React.ReactNode;
    buttonStyles?: ViewStyle;
    hideInputSendButton?: boolean;
    overwriteEnterClick?: true;
  };
  customTypingIndicator?: {
    enabled: boolean;
    text?: string | ((usersTyping: string[]) => string);
    position?: 'bottom' | 'top' | 'overlay' | 'floating';
    styles?: ViewStyle;
    customComponent?: React.ComponentType<{
      usersTyping: string[];
      text: string;
      isVisible: boolean;
    }>;
  };
  whitelistSystemMessage?: string[];
  customSystemMessage?: React.ComponentType<MessageProps>;

  // ----- translations -----
  translates?: { enabled: boolean; translations?: Iso639_1Codes };
  enableTranslates?: boolean;

  // ----- notifications -----
  inAppNotifications?: InAppNotificationConfig;
  pushNotifications?: {
    enabled?: boolean;
    iconPath?: string;
    badgePath?: string;
    onClick?: (params: {
      roomJID?: string;
      messageId?: string;
      data?: Record<string, any>;
      notification?: { title?: string; body?: string };
    }) => void | Promise<void>;
    onNotificationPress?: (data: any) => void;
    firebaseConfig?: FBConfig;
  };

  // ----- event hooks -----
  eventHandlers?: {
    onMessageSent?: (event: {
      message: string;
      roomJID: string;
      user: any;
      messageType: 'text' | 'media';
      metadata?: any;
    }) => void | Promise<void>;
    onMessageFailed?: (event: {
      message: string;
      roomJID: string;
      error: Error;
      messageType: 'text' | 'media';
    }) => void;
    onMessageEdited?: (event: {
      messageId: string;
      newMessage: string;
      roomJID: string;
      user: any;
    }) => void;
    onMessageRetry?: (event: {
      messageId: string;
      roomJID: string;
      messageType: 'text' | 'media';
    }) => void;
  };
}

interface ConfigRoom {
  jid: string;
  pinned: boolean;
  _id?: string;
}

export interface StorageUser {
  appId: string;
  company: any[];
  firstName: string;
  homeScreen: string;

  lastName: string;
  referrerId: string;
  refreshToken: string;
  token: string;
  walletAddress: string;
  xmppPassword: string;
  _id: string;

  isAgreeWithTerms?: boolean;
  isAllowedNewAppCreate?: boolean;
  isAssetsOpen?: boolean;
  isProfileOpen?: boolean;
}

export interface MessageProps {
  message: IMessage;
  isUser: boolean;
  isReply: boolean;
}

export interface MediaMessageType {}

export interface DeleteModal {
  isDeleteModal: boolean;
  roomJid?: string;
  messageId?: string;
}

export interface EditAction {
  isEdit: boolean;
  roomJid?: string;
  messageId?: string;
  text?: string;
}

export type ModalType = (typeof MODAL_TYPES)[keyof typeof MODAL_TYPES];

export interface ModalFile {
  fileName: string;
  fileURL: string;
  mimetype: string;
  originalName?: string;
  duration?: number | string;
  waveForm?: string;
}

// Re-export so middleware/hooks that historically import from `types`
// keep working without reaching into `types/models/...`.
export type { ReactionAction } from './models/action.model';
export type { Iso639_1Codes } from './models/language.model';
export type { IMessage, IReply, LastMessage, ReactionMessage } from './models/message.model';
export type { RoomMember, ApiRoom, ChatAccessOption } from './models/room.model';
export type { MediaFile } from './models/media.model';
export type { TranslationObject } from '../helpers/transformTranslatations';
