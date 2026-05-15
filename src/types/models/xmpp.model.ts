// Canonical xmpp types now live in `src/types/types.ts`. This file
// re-exports them so callers importing from `types/models/xmpp.model`
// stay aligned with the flow layer. Add NEW fields/methods to
// `src/types/types.ts` (or `src/networking/xmppClient.ts` for class
// methods) rather than duplicating here.

import { Client } from '@xmpp/client';
import XmppClient from '../../networking/xmppClient';
import { Iso639_1Codes } from './language.model';
import { IMessage } from './message.model';

export type { xmppSettingsInterface, HistoryQoSConfig } from '../types';

export interface XmppState {
  client: XmppClient | null;
  loading: boolean;
}

export interface MediaUploadData {
  file: any; // RN: usually a {uri,name,type} object; web: File
  type: string;
  name?: string;
}

export type HistorySource =
  | 'active'
  | 'send_ack'
  | 'background'
  | 'default';

export interface HistoryFetchOptions {
  coalesceRoom?: boolean;
  skipIfPreloaded?: boolean;
  source?: HistorySource;
}

export interface XmppClientInterface {
  client: Client;
  devServer?: string;
  host: string;
  service: string;
  conference: string;
  username: string;
  status: string;

  password: string;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  reconnectDelay: number;

  // ---- lifecycle ----
  checkOnline(): boolean;
  initializeClient(): void;
  attachEventListeners(): void;
  reconnect(): void;
  close(): Promise<void>;
  ensureConnected(timeout?: number): Promise<void>;
  waitForOnline(timeout?: number): Promise<void>;
  disconnect?(options?: { suppressReconnect?: boolean }): Promise<void>;

  // ---- QoS / MAM ----
  setActiveRoomJid(roomJID: string | null): void;
  isActiveRoomGateOpen(): boolean;
  promoteRoomHistory(roomJID: string): void;
  onCriticalSend(roomJID: string, messageId?: string): void;
  prioritizeRoomPresence(roomJID: string): Promise<boolean>;
  enqueueHistoryTask(params: {
    chatJID: string;
    max: number;
    before?: number;
    id?: string;
    source?: HistorySource;
  }): Promise<any>;

  // ---- rooms ----
  getRoomsStanza(disableGetRooms?: boolean): Promise<void>;
  createRoomStanza(
    title: string,
    description: string,
    to?: string
  ): Promise<string | object>;
  inviteRoomRequestStanza(to: string, roomJid: string): Promise<void>;
  leaveTheRoomStanza(roomJID: string): void;
  presenceInRoomStanza(roomJID: string): void;
  getHistoryStanza(
    chatJID: string,
    max: number,
    before?: number,
    otherStanzaId?: string,
    options?: HistoryFetchOptions
  ): Promise<IMessage[]>;
  getLastMessageArchiveStanza(roomJID: string): void;
  setRoomImageStanza(
    roomJid: string,
    roomThumbnail: string,
    type: string,
    roomBackground?: string
  ): void;
  getRoomInfoStanza(roomJID: string): void;
  getRoomMembersStanza(roomJID: string): void;
  setVCardStanza?(xmppUsername: string): void;
  createPrivateRoomStanza?(
    title: string,
    description: string,
    to: string
  ): Promise<string>;

  // ---- messages ----
  sendMessage(
    roomJID: string,
    firstName: string,
    lastName: string,
    photo: string,
    walletAddress: string,
    userMessage: string,
    notDisplayedValue?: string,
    isReply?: boolean,
    showInChannel?: boolean,
    mainMessage?: string,
    customId?: string
  ): void;
  deleteMessageStanza(room: string, msgId: string): void;
  editMessageStanza(room: string, msgId: string, text: string): void;
  sendTypingRequestStanza(
    chatId: string,
    fullName: string,
    start: boolean
  ): void;
  getChatsPrivateStoreRequestStanza(): Promise<any>;
  actionSetTimestampToPrivateStoreStanza(
    chatId: string,
    timestamp: number,
    chats?: string[]
  ): Promise<void>;
  sendMediaMessageStanza(roomJID: string, data: any, id?: string): void;
  sendMessageReactionStanza?(
    messageId: string,
    roomJid: string,
    reactionsList: string[],
    reactionSymbol?: string
  ): void;
  sendTextMessageWithTranslateTagStanza?(
    roomJID: string,
    firstName: string,
    lastName: string,
    photo: string,
    walletAddress: string,
    userMessage: string,
    notDisplayedValue?: string,
    isReply?: boolean,
    showInChannel?: boolean,
    mainMessage?: string,
    langSource?: Iso639_1Codes
  ): void;
}
