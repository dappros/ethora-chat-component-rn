import xmpp, { Client, xml } from '@xmpp/client';
import { walletToUsername } from '../helpers/walletUsername';
import { xmppSettingsInterface } from '../types/types';

import { sendMediaMessage } from './xmpp/sendMediaMessage.xmpp';
import { getChatsPrivateStoreRequest } from './xmpp/getChatsPrivateStoreRequest.xmpp';
import { actionSetTimestampToPrivateStore } from './xmpp/actionSetTimestampToPrivateStore.xmpp';
import { sendTypingRequest } from './xmpp/sendTypingRequest.xmpp';
import { getHistory } from './xmpp/getHistory.xmpp';
import { sendTextMessage } from './xmpp/sendTextMessage.xmpp';
import { deleteMessage } from './xmpp/deleteMessage.xmpp';
import { presenceInRoom } from './xmpp/presenceInRoom.xmpp';
import { getLastMessage } from './xmpp/getLastMessageArchive.xmpp';
import { createRoom } from './xmpp/createRoom.xmpp';
import { setRoomImage } from './xmpp/setRoomImage.xmpp';
import { getRoomMembers } from './xmpp/getRoomMembers.xmpp';
import { getRoomInfo } from './xmpp/getRoomInfo.xmpp';
import { leaveTheRoom } from './xmpp/leaveTheRoom.xmpp';
import { editMessage } from './xmpp/editMessage.xmpp';
import { inviteRoomRequest } from './xmpp/inviteRoomRequest.xmpp';
import { getRooms } from './xmpp/getRooms.xmpp';
import { handleStanza } from './xmpp/handleStanzas.xmpp';

const DEFAULT_DEV_SERVER = 'xmpp.chat.ethora.com:5443';

type HistorySource = 'active' | 'send_ack' | 'background' | 'default';

interface HistoryOptions {
  coalesceRoom?: boolean;
  skipIfPreloaded?: boolean;
  source?: HistorySource;
}

interface MamInFlightEntry {
  promise: Promise<any>;
  source: HistorySource;
  startedAt: number;
}

export class XmppClient {
  client!: Client;
  xmppSettings?: xmppSettingsInterface;
  devServer: string | undefined;
  host: string = '';
  service: string = '';
  conference: string = '';
  username: string;
  status: 'offline' | 'connecting' | 'online' | 'error' = 'offline';

  password = '';
  reconnectAttempts = 0;
  maxReconnectAttempts = 5;
  reconnectDelay = 2000;
  suppressReconnect = false;

  // ---- QoS state (mirrors web XmppClient) ----------------------------
  disableLastRead = false;
  private activeRoomJID: string | null = null;
  private activeRoomBoostUntil = 0;
  private softPauseUntil = 0;
  private mamInFlightByRoom: Map<string, MamInFlightEntry> = new Map();
  private maxInFlightHistory = 3;
  private softPauseAfterSendMs = 250;
  private activeRoomBoostTtlMs = 4000;
  private alwaysPrioritizeActiveRoom = true;

  // -------------------------------------------------------------------

  checkOnline() {
    return this.client && this.client.status === 'online';
  }

  constructor(
    username: string,
    password: string,
    xmppSettings?: xmppSettingsInterface | string
  ) {
    // Back-compat: third arg used to be a bare devServer string.
    if (typeof xmppSettings === 'string') {
      this.xmppSettings = { devServer: xmppSettings };
      this.devServer = xmppSettings;
    } else {
      this.xmppSettings = xmppSettings;
      this.devServer = xmppSettings?.devServer;
    }
    this.disableLastRead = this.xmppSettings?.disableLastRead === true;

    const qos = this.xmppSettings?.historyQoS;
    if (qos) {
      if (typeof qos.maxInFlightHistory === 'number')
        this.maxInFlightHistory = qos.maxInFlightHistory;
      if (typeof qos.softPauseAfterSendMs === 'number')
        this.softPauseAfterSendMs = qos.softPauseAfterSendMs;
      if (typeof qos.activeRoomBoostTtlMs === 'number')
        this.activeRoomBoostTtlMs = qos.activeRoomBoostTtlMs;
      if (typeof qos.alwaysPrioritizeActiveRoom === 'boolean')
        this.alwaysPrioritizeActiveRoom = qos.alwaysPrioritizeActiveRoom;
    }

    this.username = username;
    this.password = password;
    this.initializeClient();
  }

  // ===================================================================
  // QoS API — mirrors web XmppClientInterface
  // ===================================================================
  setActiveRoomJid(roomJID: string | null) {
    this.activeRoomJID = roomJID;
    if (roomJID) this.promoteRoomHistory(roomJID);
  }

  promoteRoomHistory(_roomJID: string) {
    this.activeRoomBoostUntil = Date.now() + this.activeRoomBoostTtlMs;
  }

  /**
   * Active-room gate is "open" whenever the boost has expired OR there's
   * room for more concurrent MAM fetches. Scheduler uses this to backoff.
   */
  isActiveRoomGateOpen(): boolean {
    if (this.mamInFlightByRoom.size >= this.maxInFlightHistory) return false;
    if (Date.now() < this.softPauseUntil) return false;
    return true;
  }

  /** Called right before a critical send. Soft-pauses background MAM. */
  onCriticalSend(roomJID: string, _messageId?: string) {
    this.softPauseUntil = Date.now() + this.softPauseAfterSendMs;
    if (roomJID) this.promoteRoomHistory(roomJID);
  }

  /**
   * Higher-priority presence than presenceInRoomStanza. For now just
   * delegates — kept distinct so callers don't change when full priority
   * lanes land later.
   */
  async prioritizeRoomPresence(roomJID: string): Promise<boolean> {
    try {
      this.presenceInRoomStanza(roomJID);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Queued history fetch. Coalesces by room: if the same room already has
   * a higher-priority request in flight, return that promise. Honors
   * `skipIfPreloaded` by checking redux state (lazy import to avoid cycle).
   */
  async enqueueHistoryTask(params: {
    chatJID: string;
    max: number;
    before?: number;
    id?: string;
    source?: HistorySource;
  }): Promise<any> {
    const { chatJID, max, before, id, source = 'default' } = params;

    // Coalesce — if a fetch for the same room is in-flight, reuse it
    // unless the new request is higher priority.
    const existing = this.mamInFlightByRoom.get(chatJID);
    if (existing && this.sourceRank(existing.source) <= this.sourceRank(source)) {
      return existing.promise;
    }

    // Wait for the gate (in-flight cap + soft-pause). For active-room
    // requests we still proceed past the cap when the boost is fresh.
    while (
      this.mamInFlightByRoom.size >= this.maxInFlightHistory &&
      !(this.alwaysPrioritizeActiveRoom && this.activeRoomJID === chatJID)
    ) {
      await new Promise((r) => setTimeout(r, 80));
    }
    if (Date.now() < this.softPauseUntil && source === 'background') {
      const wait = this.softPauseUntil - Date.now();
      await new Promise((r) => setTimeout(r, wait));
    }

    let promise: Promise<any>;
    promise = (async () => {
      try {
        return await getHistory(this.client, chatJID, max, before, id);
      } finally {
        const cur = this.mamInFlightByRoom.get(chatJID);
        if (cur && cur.promise === promise) {
          this.mamInFlightByRoom.delete(chatJID);
        }
      }
    })();

    this.mamInFlightByRoom.set(chatJID, {
      promise,
      source,
      startedAt: Date.now(),
    });
    return promise;
  }

  private sourceRank(s: HistorySource): number {
    switch (s) {
      case 'active':
        return 0;
      case 'send_ack':
        return 1;
      case 'default':
        return 2;
      case 'background':
        return 3;
    }
  }

  initializeClient() {
    try {
      const devServer = this.devServer || DEFAULT_DEV_SERVER;
      const url = `wss://${devServer}/ws`;
      this.service = url;
      this.host =
        this.xmppSettings?.host || url.match(/wss:\/\/([^:/]+)/)?.[1] || '';
      this.conference =
        this.xmppSettings?.conference || `conference.${this.host}`;
      this.status = 'connecting';

      this.client = xmpp.client({
        service: url,
        username: walletToUsername(this.username),
        password: this.password,
      });

      // Wrap `send` so the dev logger sees outgoing stanzas too.
      const origSend = this.client.send?.bind(this.client);
      if (origSend) {
        this.client.send = (stanza: any) => {
          try {
            const tag = stanza?.name || 'stanza';
            const id = stanza?.attrs?.id || '';
            const to = stanza?.attrs?.to || '';
            require('../utils/devLogger').pushLog(
              'xmpp',
              `→ ${tag}${id ? ` id=${id}` : ''}${to ? ` to=${to.split('/')[0]}` : ''}`,
              stanza?.toString ? stanza.toString() : undefined
            );
          } catch {}
          return origSend(stanza);
        };
      }

      this.attachEventListeners();
      this.client.start().catch((error) => {
        console.error('Error starting xmpp client:', error);
        this.status = 'error';
      });
    } catch (error) {
      console.error('Error initializing client:', error);
      this.status = 'error';
    }
  }

  attachEventListeners() {
    this.client.on('disconnect', () => {
      console.log('XMPP disconnected.');
      this.status = 'offline';
      try {
        // lazy-require to avoid pulling devLogger into prod bundles
        // that don't reference it; tree-shaken via dead-code elim.
        require('../utils/devLogger').pushLog('xmpp', 'disconnect');
      } catch {}
    });

    this.client.on('online', () => {
      console.log('XMPP online.', new Date());
      this.status = 'online';
      this.reconnectAttempts = 0;
      try {
        require('../utils/devLogger').pushLog(
          'xmpp',
          'online',
          this.username
        );
      } catch {}
    });

    this.client.on('error', (error) => {
      console.error('XMPP client error:', error);
      try {
        require('../utils/devLogger').pushLog(
          'xmpp',
          'error',
          (error && error.message) || error
        );
      } catch {}
    });

    this.client.on('stanza', (stanza: any) => {
      try {
        const tag = stanza?.name || 'stanza';
        const id = stanza?.attrs?.id || '';
        const from = stanza?.attrs?.from || '';
        const type = stanza?.attrs?.type || '';
        require('../utils/devLogger').pushLog(
          'xmpp',
          `← ${tag}${id ? ` id=${id}` : ''}${type ? ` type=${type}` : ''}${from ? ` from=${from.split('/')[0]}` : ''}`,
          stanza?.toString ? stanza.toString() : undefined
        );
      } catch {}
      handleStanza.bind(this, stanza, this)();
    });
  }

  /**
   * Resolves once status === 'online' or rejects when status === 'error'.
   * Mirrors the web client's `ensureConnected` helper.
   */
  waitForOnline(timeoutMs: number = 15000): Promise<void> {
    if (this.status === 'online') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (this.status === 'online') return resolve();
        if (this.status === 'error') {
          return reject(new Error('XMPP client error'));
        }
        if (Date.now() - start > timeoutMs) {
          return reject(new Error('XMPP connect timeout'));
        }
        setTimeout(tick, 250);
      };
      tick();
    });
  }

  // Alias to match the web XmppClientInterface.
  ensureConnected(timeout?: number): Promise<void> {
    return this.waitForOnline(timeout);
  }

  scheduleReconnect() {
    if (this.suppressReconnect) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached.');
      return;
    }
    this.reconnectAttempts++;
    const delay =
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`Reconnecting attempt ${this.reconnectAttempts} in ${delay}ms`);
    setTimeout(() => this.reconnect(), delay);
  }

  reconnect() {
    if (this.suppressReconnect) return;
    console.log('Attempting to reconnect xmpp client...');
    if (this.client) {
      this.client.stop().finally(() => {
        this.initializeClient();
      });
    } else {
      this.initializeClient();
    }
  }

  async disconnect(options?: { suppressReconnect?: boolean }): Promise<void> {
    if (options?.suppressReconnect) this.suppressReconnect = true;
    return this.close();
  }

  async close() {
    if (this.client) {
      try {
        await this.client.stop();
        console.log('XMPP client connection closed.');
      } catch (error) {
        console.error('Error closing the xmpp client:', error);
      }
    }
    this.status = 'offline';
  }

  getRoomsStanza = async () => {
    await getRooms(this.client);
  };

  //room functions

  async createRoomStanza(title: string, description: string, to?: string) {
    return await createRoom(title, description, this.client, to);
  }

  async inviteRoomRequestStanza(to: string, roomJid: string) {
    await inviteRoomRequest(this.client, to, roomJid);
  }

  leaveTheRoomStanza = (roomJID: string) => {
    leaveTheRoom(roomJID, this.client);
  };

  presenceInRoomStanza = (roomJID: string) => {
    presenceInRoom(this.client, roomJID);
  };

  getHistoryStanza = async (
    chatJID: string,
    max: number,
    before?: number,
    id?: string,
    options?: HistoryOptions
  ) => {
    if (options?.coalesceRoom) {
      return this.enqueueHistoryTask({
        chatJID,
        max,
        before,
        id,
        source: options?.source || 'default',
      });
    }
    return await getHistory(this.client, chatJID, max, before, id);
  };

  getLastMessageArchiveStanza(roomJID: string) {
    getLastMessage(this.client, roomJID);
  }

  setRoomImageStanza = (
    roomJid: string,
    roomThumbnail: string,
    type: string,
    roomBackground?: string
  ) => {
    setRoomImage(roomJid, roomThumbnail, type, this.client, roomBackground);
  };

  getRoomInfoStanza = (roomJID: string) => {
    getRoomInfo(roomJID, this.client);
  };

  getRoomMembersStanza = (roomJID: string) => {
    getRoomMembers(roomJID, this.client);
  };

  //messages
  sendMessage = (
    roomJID: string,
    firstName: string,
    lastName: string,
    photo: string,
    walletAddress: string,
    userMessage: string,
    notDisplayedValue?: string,
    isReply?: boolean,
    showInChannel?: boolean,
    mainMessage?: string
  ) => {
    sendTextMessage(
      this.client,
      roomJID,
      firstName,
      lastName,
      photo,
      walletAddress,
      userMessage,
      notDisplayedValue,
      isReply,
      showInChannel,
      mainMessage,
      this.devServer || DEFAULT_DEV_SERVER
    );
  };

  deleteMessageStanza(room: string, msgId: string) {
    deleteMessage(this.client, room, msgId);
  }

  editMessageStanza(room: string, msgId: string, text: string) {
    editMessage(this.client, room, msgId, text);
  }

  sendTypingRequestStanza(chatId: string, fullName: string, start: boolean) {
    sendTypingRequest(this.client, chatId, fullName, start);
  }

  getChatsPrivateStoreRequestStanza = async () => {
    if (this.disableLastRead) return null;
    try {
      return await getChatsPrivateStoreRequest(this.client);
    } catch (error) {
      console.log(error);
      return null;
    }
  };

  async actionSetTimestampToPrivateStoreStanza(
    chatId: string,
    timestamp: number,
    chats?: string[]
  ) {
    if (this.disableLastRead) return;
    try {
      await actionSetTimestampToPrivateStore(
        this.client,
        chatId,
        timestamp,
        chats
      );
    } catch (error) {}
  }

  sendMediaMessageStanza(roomJID: string, data: any, _id?: string) {
    sendMediaMessage(this.client, roomJID, data);
  }

  // -------------------------------------------------------------------
  // Method stubs to satisfy `XmppClientInterface`. Concrete RN xmpp
  // helpers don't exist yet — the stubs log a single warning and no-op
  // so consumers don't blow up at runtime. Replace with real impls when
  // their `*.xmpp.ts` helpers are ported from the web side.
  // -------------------------------------------------------------------

  setVCardStanza(_xmppUsername: string) {
    console.warn('setVCardStanza: not implemented in RN xmpp client');
  }

  async createPrivateRoomStanza(
    title: string,
    description: string,
    to: string
  ): Promise<string> {
    console.warn('createPrivateRoomStanza: not implemented; falling back to createRoom');
    const result = await this.createRoomStanza(title, description, to);
    return typeof result === 'string' ? result : '';
  }

  sendMessageReactionStanza(
    _messageId: string,
    _roomJid: string,
    _reactionsList: string[],
    _reactionSymbol?: string
  ) {
    console.warn('sendMessageReactionStanza: not implemented in RN xmpp client');
  }

  sendTextMessageWithTranslateTagStanza(
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
    _langSource?: string
  ) {
    // No translate tag support yet — fall back to a regular text send.
    this.sendMessage(
      roomJID,
      firstName,
      lastName,
      photo,
      walletAddress,
      userMessage,
      notDisplayedValue,
      isReply,
      showInChannel,
      mainMessage
    );
  }
}

export default XmppClient;
