import type { ViewStyle, ImageSourcePropType } from 'react-native';
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

export interface IConfig {
  // ----- identity / network -----
  appId?: string;
  baseUrl?: string;
  customAppToken?: string;
  projectName?: string;

  // ----- theming -----
  colors?: { primary: string; secondary: string };
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
  };
  qrUrl?: string;

  // ----- styling -----
  roomListStyles?: ViewStyle;
  chatRoomStyles?: ViewStyle;

  keyboardVerticalOffset?: number;

  // ----- interactions / messages -----
  disableInteractions?: boolean;
  disableReactions?: boolean;
  disableProfilesInteractions?: boolean;
  disableUserCount?: boolean;
  disableSentLogic?: boolean;
  disableTypingIndicator?: boolean;
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
}

// Re-export so middleware/hooks that historically import from `types`
// keep working without reaching into `types/models/...`.
export type { ReactionAction } from './models/action.model';
export type { Iso639_1Codes } from './models/language.model';
export type { IMessage, IReply, LastMessage, ReactionMessage } from './models/message.model';
export type { RoomMember, ApiRoom, ChatAccessOption } from './models/room.model';
export type { MediaFile } from './models/media.model';
export type { TranslationObject } from '../helpers/transformTranslatations';
