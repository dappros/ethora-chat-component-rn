import { Element } from 'ltx';
import { store } from '../roomStore';
import {
  addRoom,
  addRoomMessage,
  deleteRoomMessage,
  editRoomMessage,
  setComposing,
  setCurrentRoom,
  setRoomRole,
  updateRoom,
} from '../roomStore/roomsSlice';
import { IRoom, RoomMember } from '../types/types';
import { createMessageFromXml } from '../helpers/createMessageFromXml';
import { getDataFromXml } from '../helpers/getDataFromXml';
import { setDeleteModal } from '../roomStore/chatSettingsSlice';
import { messageNotificationManager } from '../utils/messageNotificationManager';

// TO DO: we are thinking to refactor this code in the following way:
// each stanza will be parsed for 'type'
// then it will be handled based on the type
// XMPP parsing will be done universally as a pre-processing step
// then handlers for different types will work with a Javascript object
// types: standard, coin transfer, is composing, attachment (media), token (nft) or smart contract
// types can be added into our chat protocol (XMPP stanza add field type="") to make it easier to parse here

//core default
const onRealtimeMessage = async (stanza: Element) => {
  if (
    !stanza?.getChild('result') &&
    !stanza.getChild('composing') &&
    !stanza.getChild('paused') &&
    !stanza.getChild('subject') &&
    !stanza.is('iq') &&
    stanza.attrs.id !== 'deleteMessageStanza'
  ) {
    const body = stanza?.getChild('body');
    const archived = stanza?.getChild('archived');
    const data = stanza?.getChild('data');
    const id = archived?.attrs.id;

    const deleted = stanza
      .getChild('result')
      ?.getChild('forwarded')
      ?.getChild('message')
      ?.getChild('deleted');

    if (!data) {
      console.log(stanza.toString());
      console.log('Missing data elements in real-time message.');
      return;
    }

    if (!data.attrs.senderJID) {
      console.log(stanza.toString());
      console.log(data.attrs.senderJID);

      console.log('Missing sender information in real-time message.');
      return;
    }

    // Use the same parser as MAM so the message carries `xmppId` (the
    // outer stanza id = our original send id). insertMessageWithDelimiter
    // dedupes by xmppId, which is how the optimistic pending bubble flips
    // to delivered in-place instead of rendering twice.
    const parsed = await getDataFromXml(stanza);
    const { data: pData, id: pId, body: pBody, ...pRest } =
      parsed ?? ({} as Partial<NonNullable<typeof parsed>>);
    // Cast at the call site: createMessageFromXml accepts the merged
    // wrapped/positional shape; IUser type drift between models prevents
    // a narrower type here without a wider refactor.
    const message = await createMessageFromXml({
      data: pData || data.attrs,
      id: pId || id,
      body: pBody ?? '',
      ...pRest,
      isDeleted: !!deleted || !!pRest?.deleted,
    } as Parameters<typeof createMessageFromXml>[0]);

    const roomJID = stanza.attrs.from.split('/')[0];
    store.dispatch(
      addRoomMessage({
        roomJID,
        message,
      })
    );

    // Trigger in-app notification (manager dedupes + drops own messages
    // for empty bodies). Self-messages are filtered by sender check.
    try {
      const state = store.getState();
      const currentUserWallet = (state.chatSettingStore.user?.walletAddress || '').toLowerCase();
      const senderJID = String(data.attrs.senderJID || '').toLowerCase();
      if (currentUserWallet && senderJID.includes(currentUserWallet)) {
        return message; // own message, skip toast
      }
      const room = state.rooms.rooms[roomJID];
      const roomName = room?.title || room?.name || '';
      const senderName = [
        data.attrs.senderFirstName,
        data.attrs.senderLastName,
      ]
        .filter(Boolean)
        .join(' ')
        .trim() || 'New message';
      messageNotificationManager.showNotification(
        message,
        roomName,
        senderName,
        roomJID
      );
    } catch (err) {
      console.warn('notification dispatch failed', err);
    }
    return message;
  }
};

const onDeleteMessage = async (stanza: Element) => {
  if (stanza.attrs.id === 'deleteMessageStanza') {
    const deleted = stanza.getChild('delete');
    const stanzaId = stanza.getChild('stanza-id');

    if (!deleted) {
      return;
    }

    store.dispatch(
      deleteRoomMessage({
        roomJID: stanzaId?.attrs.by,
        messageId: deleted.attrs.id,
      })
    );
    store.dispatch(setDeleteModal({ isDeleteModal: false }));
  }
};

const onEditMessage = async (stanza: Element) => {
  if (stanza?.attrs?.id?.includes('edit-message')) {
    const stanzaId = stanza.getChild('stanza-id');
    const replace = stanza.getChild('replace');

    if (!stanzaId && !replace) {
      return;
    }

    store.dispatch(
      editRoomMessage({
        roomJID: stanzaId?.attrs.by,
        messageId: replace?.attrs.id,
        text: replace?.attrs.text,
      })
    );
  }
};

const onMessageHistory = async (stanza: any) => {
  if (
    stanza.is('message') &&
    stanza.children[0].attrs.xmlns === 'urn:xmpp:mam:2'
  ) {
    // console.log("stanza -->", stanza.toString());
    const body = stanza
      .getChild('result')
      ?.getChild('forwarded')
      ?.getChild('message')
      ?.getChild('body');
    const data = stanza
      .getChild('result')
      ?.getChild('forwarded')
      ?.getChild('message')
      ?.getChild('data');
    const deleted = stanza
      .getChild('result')
      ?.getChild('forwarded')
      ?.getChild('message')
      ?.getChild('deleted');

    const delay = stanza
      .getChild('result')
      ?.getChild('forwarded')
      ?.getChild('delay');
    const id = stanza.getChild('result')?.attrs.id;
    if (!delay) {
      if (stanza.getChild('subject')) {
        console.log('Subject.');
        return;
      }
      if (!data || !body || !id) {
        console.log('Missing required elements in message history.');
        return;
      }
    }
    // console.log(stanza.attrs.from);

    if (
      !data?.attrs ||
      !data.attrs.senderFirstName ||
      !data.attrs.senderLastName ||
      !data.attrs.senderJID
    ) {
      // console.log(
      //   "Missing sender information in message history.",
      //   stanza.toString()
      // );
      return;
    }
    const message = await createMessageFromXml(
      data.attrs,
      body,
      id,
      stanza.attrs.from,
      !!deleted
    );
    store.dispatch(
      addRoomMessage({
        roomJID: stanza.attrs.from,
        message,
      })
    );
  }
};

const handleComposing = async (stanza: Element, currentUser: string) => {
  if (stanza.getChild('paused') || stanza.getChild('composing')) {
    const composingUser = stanza.attrs?.from?.split('/')?.[1];

    // Normalize both sides the same way before comparing — previously
    // we lower-cased the currentUser but only stripped underscores from
    // the composingUser, so wallet-style IDs with underscores
    // ("foo_bar") never matched their own MUC nick ("foo_bar") and the
    // user saw a typing indicator for their own keystrokes.
    const norm = (s?: string) =>
      (s || '').toLowerCase().replace(/_/g, '');

    // Secondary self-check via the <data senderJID="..."> attribute —
    // covers the case where the MUC resource part differs from the
    // raw xmppUsername (custom nick formats, JID-mode resources, etc.).
    const senderJID = stanza.getChild('data')?.attrs?.senderJID || '';
    const senderLocal = senderJID.split('@')[0] || '';
    const state = store.getState();
    const selfUser = state.chatSettingStore?.user;
    const selfXmppUsername = selfUser?.xmppUsername || '';
    const selfWallet = selfUser?.walletAddress || '';
    const isSelf =
      (composingUser && norm(currentUser) === norm(composingUser)) ||
      (senderLocal && norm(senderLocal) === norm(selfXmppUsername)) ||
      (senderLocal && norm(senderLocal).includes(norm(selfWallet)));

    if (composingUser && !isSelf) {
      const chatJID = stanza.attrs?.from.split('/')[0];

      let composingList: string[] = [];

      stanza?.getChild('composing')
        ? composingList.push(
            stanza.getChild('data')?.attrs?.fullName?.split(' ')?.[0] || 'User'
          )
        : composingList.pop();

      store.dispatch(
        setComposing({
          chatJID: chatJID,
          composing: !!stanza?.getChild('composing'),
          composingList,
        })
      );
    }
  }
};

const onPresenceInRoom = (stanza: Element | any) => {
  if (
    typeof stanza.attrs.id === 'string' &&
    stanza.attrs.id.startsWith('presenceInRoom') &&
    !stanza.getChild('error')
  ) {
    const roomJID: string = stanza.attrs.from.split('/')[0];
    const role: string = stanza?.children[1]?.children[0]?.attrs.role;
    store.dispatch(setRoomRole({ chatJID: roomJID, role: role }));
  }
};

const onChatInvite = async (stanza: Element, client: any) => {
  if (stanza.is('message') && stanza.attrs.type !== 'groupchat') {
    // check if it is invite
    const chatId = stanza.attrs.from;
    const xEls = stanza.getChildren('x');

    for (const el of xEls) {
      const child = el.getChild('invite');

      if (child) {
        const chat = store.getState().rooms.rooms[chatId];
        if (chat) {
          return;
        }

        await client.presenceInRoomStanza(chatId);
        await client.getRoomsStanza();
      }
    }
  }
};

const onGetMembers = (stanza: Element) => {
  if (String(stanza.attrs?.id || '') !== 'roomMemberInfo') {return;}

  try {
    const queries: Element[] = stanza.getChildren('query') ?? [];
    const activities: Element[] = [];
    let roomJid = '';
    for (const q of queries) {
      if (!roomJid && q.attrs?.room) {roomJid = q.attrs.room;}
      const acts = q.getChildren('activity') ?? [];
      for (const a of acts) {activities.push(a);}
    }

    const jid = roomJid || store.getState().rooms.activeRoomJID;
    if (!jid || activities.length === 0) {return;}

    const existingRoom = store.getState().rooms.rooms[jid];
    const existingMembers: RoomMember[] = existingRoom?.roomMembers ?? [];
    const existingByJid = new Map<string, RoomMember>(
      existingMembers
        .filter((m): m is RoomMember & { jid: string } => !!m.jid)
        .map((m) => [m.jid, m])
    );

    const roomMembers: RoomMember[] = activities.map((a) => {
      const memberJid: string | undefined = a.attrs?.jid;
      const existing = memberJid ? existingByJid.get(memberJid) : undefined;
      // The activity stanza carries only the XMPP-side fields
      // (name/role/ban_status/last_active/jid). REST-loaded existing
      // members supply firstName/lastName/xmppUsername/_id; when there's
      // no REST match yet we leave those as empty strings.
      return {
        firstName: existing?.firstName ?? '',
        lastName: existing?.lastName ?? '',
        xmppUsername: existing?.xmppUsername ?? '',
        _id: existing?._id ?? '',
        ...existing,
        name: a.attrs?.name,
        role: a.attrs?.role,
        ban_status: a.attrs?.ban_status,
        last_active: Number(a.attrs?.last_active),
        jid: memberJid,
      };
    });

    store.dispatch(updateRoom({ jid, updates: { roomMembers } }));
  } catch (err) {
    console.warn('onGetMembers parse failed', err);
  }
};

const onGetRoomInfo = (stanza: Element) => {
  if (stanza.attrs.id === 'roomInfo' && !stanza.getChild('error')) {
  }
};

const onGetLastMessageArchive = (stanza: Element, _xmpp: any) => {
  if (stanza.attrs.id === 'GetLastArchive') {
  }
};

const onNewRoomCreated = (stanza: Element, xmpp: any) => {
  store.dispatch(setCurrentRoom({ roomJID: stanza.attrs.from }));
  xmpp.getRoomsStanza();
};

const onGetChatRooms = (stanza: Element, xmpp: any) => {
  if (
    stanza.attrs.id === 'getUserRooms' &&
    Array.isArray(stanza.getChild('query')?.children)
  ) {
    const children = stanza.getChild('query')?.children || [];
    children.forEach(async (result: any) => {
      const currentChatRooms = store.getState().rooms.rooms;

      const isRoomAlreadyAdded = Object.values(currentChatRooms).some(
        (element) => element.jid === result?.attrs?.jid
      );

      const jid = result?.attrs?.jid;

      if (!isRoomAlreadyAdded) {
        try {
          const roomData: IRoom = {
            jid: jid || '',
            name: result?.attrs?.name || '',
            id: '',
            title: result?.attrs?.name || '',
            usersCnt: Number(result?.attrs?.users_cnt || 0),
            messages: [],
            isLoading: false,
            roomBg:
              result?.attrs?.room_background !== 'none'
                ? result?.attrs?.room_background
                : null,
            icon:
              result?.attrs?.room_thumbnail !== 'none'
                ? result?.attrs?.room_thumbnail
                : null,
            unreadMessages: 0,
            lastViewedTimestamp: 0,
          };

          store.dispatch(addRoom({ roomData: { ...roomData } }));

          if (!store.getState().rooms.activeRoomJID) {
            store.dispatch(setCurrentRoom({ roomJID: roomData.jid }));
          }
        } catch (error) {}
      }

      if (jid) {
        try {
          xmpp.presenceInRoomStanza(jid);
        } catch (e) {
          console.warn('presenceInRoomStanza failed', jid, e);
        }
      }
    });
  }
};

// No-op stubs for handlers that handleStanzas.xmpp.ts imports but the
// RN side hasn't ported yet. Without these the bundle compiles but
// require() returns undefined at runtime → "X is not a function".
const onMessageError = (_stanza: Element, _xmpp?: any) => {};
const onReactionMessage = (_stanza: Element) => {};
const onReactionHistory = (_stanza: Element) => {};
const onRoomKicked = (_stanza: Element) => {};

export {
  onRealtimeMessage,
  onMessageHistory,
  onPresenceInRoom,
  onGetLastMessageArchive,
  handleComposing,
  onGetChatRooms,
  onNewRoomCreated,
  onGetMembers,
  onGetRoomInfo,
  onDeleteMessage,
  onEditMessage,
  onChatInvite,
  onMessageError,
  onReactionMessage,
  onReactionHistory,
  onRoomKicked,
};
