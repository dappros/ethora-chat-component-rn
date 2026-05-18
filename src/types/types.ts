import type { ViewStyle, ImageSourcePropType } from 'react-native';
import type { Iso639_1Codes } from './models/language.model';
import { MODAL_TYPES } from '../helpers/constants/MODAL_TYPES';

export interface IUser extends Partial<User> {
  id: string;
  name: string | null;
  userJID?: string | null;
  token: string;
  refreshToken: string;
}

export interface IMessage {
  id: string; // message ID (aka timestamp in microseconds)
  user: IUser;
  date: Date | string; // date converted from id / timestamp (e.g. "2024-02-18T03:24:33.102Z")
  body: string; // message body
  roomJid: string; // room id
  key?: string; // workaround to solve a problem of messages uniqueness - additional, local timestamp to solve when XMPP server sends duplicate timestamps (TO DO: depricate / review)
  coinsInMessage?: string | number; // store only - message coins counter
  numberOfReplies?: number[] | number; // store only - array of replies in a thread (if applicable) - includes messages IDs so that client app can display relevant message previews for the thread
  isSystemMessage?: string;
  isMediafile?: string;
  locationPreview?: string;
  mimetype?: string;
  location?: string;
  pending?: boolean;
  timestamp?: number;
  showInChannel?: string;
  activeMessage?: boolean;
  isReply?: boolean | string;
  isDeleted?: boolean;
  mainMessage?: string;
  reply?: IReply[];
}

export interface IReply extends IMessage {}

export type HistoryPreloadState = 'idle' | 'loading' | 'done' | 'error';

export interface IRoom {
  id: string;
  name: string;
  jid: string;
  title: string;
  usersCnt: number;
  messages: IMessage[];
  isLoading: boolean;
  roomBg: string;

  lastMessage?: string;
  lastRoomMessage?: RoomLastMessage;
  icon?: string;
  composing?: boolean;
  composingList?: string[];
  lastViewedTimestamp?: number;
  unreadMessages?: number;
  noMessages?: boolean;
  role?: string;
  createdAt?: string | number | Date;
  updatedAt?: string | number | Date;

  roomMembers?: RoomMember[];

  // QoS / preload state
  historyPreloadState?: HistoryPreloadState;
  historyComplete?: boolean;
  unreadCapped?: boolean;

  // Last-message tracking (driven by newMessageMidlleware).
  lastMessageTimestamp?: number;
}

export interface RoomMember {
  ban_status: string;
  jid: string;
  last_active: number;
  name: string;
  role: string;
}

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
  // Chat-profile modal granular gates (matches web's
  // `disableChatInfo`).
  disableChatInfo?: {
    disableHeader?: boolean;
    disableDescription?: boolean;
    disableType?: boolean;
    hideMembers?: boolean;
    disableMembers?: boolean;
  };
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
