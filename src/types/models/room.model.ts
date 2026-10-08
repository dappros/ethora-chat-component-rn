import { IMessage, LastMessage } from './message.model';

export interface RoomMember {
  firstName: string;
  lastName: string;
  xmppUsername: string;
  _id: string;

  ban_status?: string;
  jid?: string;
  name?: string;
  role?: string;
  last_active?: number;
  profileImage?: string;
  description?: string;
}

export interface RoomLastMessage {
  name: string;
  body: string;
}

export interface IRoom {
  name: string;
  jid: string;
  title: string;
  usersCnt: number;
  messages: IMessage[];
  isLoading: boolean;
  roomBg: string | null;

  members?: RoomMember[];
  type?: 'public' | 'group' | 'private';
  e2ee?: boolean;
  creteadAt?: string; // Typo? Should it be createdAt?

  appId?: string;
  createdAt?: string;
  createdBy?: string;
  description?: string;
  isAppChat?: boolean;
  picture?: string;
  updatedAt?: string;
  __v?: number | string;
  _id?: string;

  id?: string;
  lastMessage?: LastMessage;
  lastMessageTimestamp?: number;
  lastRoomMessage?: RoomLastMessage;
  icon?: string | null;
  composing?: boolean;
  composingList?: string[];
  lastViewedTimestamp?: number;
  unreadMessages?: number;
  /**
   * Unread count the server reported for this room in `GET /v1/chats/my`
   * (`unreadCount`) and when it was read (epoch ms). Only present on backends
   * that send it. Used as a floor while the local message list is too short
   * to count from; ignored once the user has read past the API's last
   * message, cleared when the room is opened, never persisted.
   */
  apiUnreadCount?: number;
  apiUnreadSeededAt?: number;
  noMessages?: boolean;
  role?: string;

  messageStats?: {
    lastMessageTimestamp?: number;
    firstMessageTimestamp?: number;
  };
  historyComplete?: boolean;
}

/**
 * The flattened `lastMessage` object `GET /v1/chats/my` embeds per room.
 * Every field is optional: backends differ in what they send.
 */
export interface ApiRoomLastMessage {
  body?: string;
  truncated?: boolean;
  from?: string;
  fromUserId?: string;
  messageId?: string;
  stanzaId?: string;
  createdAt?: string;
  isOwn?: boolean;
  senderFirstName?: string;
  senderLastName?: string;
}

export interface ApiRoom {
  name: string;
  type: 'public' | 'group' | 'private';
  /** True total; `members` is capped at 30 for big public rooms. */
  usersCnt?: number;
  /** Unread messages for the caller, on backends that report it. */
  unreadCount?: number;
  lastMessage?: ApiRoomLastMessage;

  e2ee?: boolean;
  title?: string;
  description?: string;
  picture?: string;
  members?: RoomMember[];
  createdBy?: string;
  appId?: any;

  _id?: string;
  isAppChat?: boolean;
  createdAt?: string;
  updatedAt?: string;
  __v?: string;
  jid?: string;
  participants?: number;
  icon?: string;
  muted?: boolean;
}

export interface PostRoom {
  title: string;
  uuid?: string;
  type: 'public' | 'group';

  description?: string;
  picture?: string;
  members?: string[];
}

export interface PostReportRoom {
  chatName: string;
  category: string;
  text?: string;
}

export interface PostAddRoomMember {
  chatName: string;
  members: string[];
}

export interface DeleteRoomMember {
  roomId: string;
  members: string[];
}

export interface IRoomCompressed extends Pick<IRoom, 'jid'> {}

export type PartialRoomWithMandatoryKeys = Partial<IRoom> &
  Pick<IRoom, 'jid' | 'title'>;

export interface ConfigRoom {
  jid: string;
  pinned: boolean;
  _id?: string;
}

export type ChatAccessOption =
  | { name: 'Public'; id: 'public' }
  | { name: 'Members-only'; id: 'group' };
