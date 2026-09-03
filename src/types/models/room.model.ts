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
   * Timestamp of the newest message the user had actually reached when
   * they scrolled away from the bottom of this room, or null/undefined
   * while they are at the bottom (everything on screen is read).
   *
   * Lives in the store rather than in ChatRoom's local state because
   * several code paths outside the component mark a room read — the
   * AppState background handler, the `isVisible` consumer signal, the
   * visible-room auto-advance, `useChatRoomFocus` — and all of them must
   * stamp what the user actually saw instead of `Date.now()`. Stamping
   * "now" while they are scrolled up silently destroys unread messages,
   * and because those paths also flush to the server-side private store
   * the loss survives an app restart. Customer-reported #33.
   */
  readBoundaryTs?: number | null;
  noMessages?: boolean;
  role?: string;

  messageStats?: {
    lastMessageTimestamp?: number;
    firstMessageTimestamp?: number;
  };
  historyComplete?: boolean;
}

export interface ApiRoom {
  name: string;
  type: 'public' | 'group' | 'private';

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
