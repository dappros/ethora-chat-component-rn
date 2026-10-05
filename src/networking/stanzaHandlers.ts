import { Element } from 'ltx';
import { store } from '../roomStore';
import {
  claimMamResult,
  collectMamMessage,
  collectMamReaction,
  replayArchivedReaction,
} from './xmpp/mamRouter';
import { extractReaction } from '../helpers/mamReactions';
import {
  addRooms,
  addRoomMessage,
  deleteRoomMessage,
  editRoomMessage,
  setComposing,
  setCurrentRoom,
  setRoomRole,
  setReactions,
  updateRoom,
} from '../roomStore/roomsSlice';
import { IMessage, IRoom, RoomMember } from '../types/types';
import { adjustUsersCnt, isRoomMembersTruncated } from '../helpers/roomUserCount';
import { requestSendersOf } from '../helpers/userResolver';
import { createMessageFromXml } from '../helpers/createMessageFromXml';
import { getDataFromXml } from '../helpers/getDataFromXml';
import { setDeleteModal } from '../roomStore/chatSettingsSlice';
import { messageNotificationManager } from '../utils/messageNotificationManager';
import { transformCallLogMessage } from '../helpers/callLogMessage';
import { translateKey } from '../i18n/strings';
import { isWindowQueryId } from './xmpp/mamQueryIds';

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
    stanza.attrs.id !== 'deleteMessageStanza' &&
    !stanza.getChild('reactions')
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
      return;
    }

    // Not every sender stamps `senderJID` onto `<data>` — the web SDK's
    // translate-tagged send path in particular builds `<data>` from a
    // differently-named attr bag (roomJID/firstName/userMessage/…) that
    // has no senderJID at all. This used to hard-drop the message here —
    // live AND, via the identical check in onMessageHistory, in the MAM
    // backfill too — so anything sent through that path just never
    // appeared, on this device or after a restart. The stanza's own
    // `from` is always the full MUC occupant jid (`room@conference/nick`,
    // exactly what senderJID would have held), so fall back to it instead
    // of dropping the message. Web's own onRealtimeMessage only requires
    // `<data>` to exist at all — no senderJID check — so this brings RN
    // to the same tolerance.
    const senderJID = data.attrs.senderJID || stanza.attrs.from;
    if (!senderJID) {
      return;
    }

    // Use the same parser as MAM so the message carries `xmppId` (the
    // outer stanza id = our original send id). insertMessageWithDelimiter
    // dedupes by xmppId, which is how the optimistic pending bubble flips
    // to delivered in-place instead of rendering twice.
    const parsed = await getDataFromXml(stanza);
    const { data: pData, id: pId, body: pBody, ...pRest } =
      parsed ?? ({} as Partial<NonNullable<typeof parsed>>);
    const mergedData: Record<string, unknown> = { ...(pData || data.attrs) };
    if (!mergedData.senderJID) {mergedData.senderJID = senderJID;}
    // Cast at the call site: createMessageFromXml accepts the merged
    // wrapped/positional shape; IUser type drift between models prevents
    // a narrower type here without a wider refactor.
    const rawMessage = await createMessageFromXml({
      data: mergedData,
      id: pId || id,
      body: pBody ?? '',
      ...pRest,
      isDeleted: !!deleted || !!pRest?.deleted,
    } as Parameters<typeof createMessageFromXml>[0]);

    // Turn server call-state stanzas into a friendly call-log entry
    // ("Outgoing call · 12 sec" / "Missed call"). Non-call messages pass
    // through unchanged. Without this the raw message keeps body
    // "call-state" and gets dropped by the call-signal filter in
    // roomsSlice, so call history silently disappears.
    const message = transformCallLogMessage(
      rawMessage,
      store.getState().chatSettingStore.user?.xmppUsername || ''
    );

    const roomJID = stanza.attrs.from.split('/')[0];
    store.dispatch(
      addRoomMessage({
        roomJID,
        message,
      })
    );
    // A sender missing from usersSet (a big room only carries 30 members)
    // is resolved lazily; known and recently failed ids are dropped inside.
    try {
      requestSendersOf([message]);
    } catch {
      // name resolution must never break message delivery
    }

    // Trigger in-app notification (manager dedupes + drops own messages
    // for empty bodies). Self-messages are filtered by sender check.
    try {
      const state = store.getState();
      const currentUserWallet = (state.chatSettingStore.user?.walletAddress || '').toLowerCase();
      const senderJIDLower = String(senderJID || '').toLowerCase();
      if (currentUserWallet && senderJIDLower.includes(currentUserWallet)) {
        return message; // own message, skip toast
      }
      const room = state.rooms.rooms[roomJID];
      const roomName = room?.title || room?.name || '';
      // Fallback when we don't have a display name for the sender. This is
      // user-visible — it renders as the sender line in the in-app
      // notification toast (see MessageNotificationContext's ToastRow:
      // `{senderName}: {message.body}`) — so it goes through the static
      // i18n table like any other UI caption. We're outside React here
      // (stanza handler, not a component), so resolve the locale from the
      // store directly and call `translateKey` instead of `useT()`.
      const locale =
        state.chatSettingStore.config?.i18n?.locale ||
        state.chatSettingStore.langSource;
      const overrides = state.chatSettingStore.config?.i18n?.strings;
      const senderName = [
        data.attrs.senderFirstName,
        data.attrs.senderLastName,
      ]
        .filter(Boolean)
        .join(' ')
        .trim() || translateKey('notification.senderFallback', locale, overrides);
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

const isMamResult = (stanza: any): boolean =>
  !!stanza?.is?.('message') &&
  stanza.getChild?.('result')?.attrs?.xmlns === 'urn:xmpp:mam:2';

const parseMamResult = async (stanza: any): Promise<IMessage | undefined> => {
  {
    const forwardedMsg = stanza
      .getChild('result')
      ?.getChild('forwarded')
      ?.getChild('message');
    if (forwardedMsg?.getChild?.('reactions')) {
      const reaction = extractReaction(
        forwardedMsg,
        stanza.attrs?.from,
        stanza.getChild('result')?.attrs?.id
      );
      if (reaction && !collectMamReaction(stanza, reaction)) {
        // No page is waiting for it: replay it by hand. Flagged fromHistory
        // so the room preview is not turned into an emoji.
        replayArchivedReaction(reaction);
      }
      return undefined;
    }
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
        return;
      }
      if (!data || !body || !id) {
        return;
      }
    }
    // console.log(stanza.attrs.from);

    // Mirror the realtime path's tolerance: don't hard-require
    // senderFirstName/senderLastName/senderJID on <data> — the web SDK's
    // translate-tagged send path doesn't stamp any of them, and this used
    // to drop those messages out of MAM backfill entirely (so they never
    // appeared even after a restart). The inner forwarded <message>'s own
    // `from` is the full MUC occupant jid (room@conference/nick), exactly
    // what senderJID would have held — fall back to it. createMessageFromXml
    // already derives a display name from the jid when senderFirstName/
    // senderLastName are absent.
    const forwardedMessage = stanza
      .getChild('result')
      ?.getChild('forwarded')
      ?.getChild('message');
    const innerFrom = forwardedMessage?.attrs?.from || stanza.attrs.from;
    const senderJID = data?.attrs?.senderJID || innerFrom;
    if (!data?.attrs || !senderJID) {
      // console.log(
      //   "Missing sender information in message history.",
      //   stanza.toString()
      // );
      return;
    }
    const mergedAttrs = { ...data.attrs };
    if (!mergedAttrs.senderJID) {mergedAttrs.senderJID = senderJID;}
    // The forwarded <message>'s own stanza id is our original send id
    // (what `xmppId` holds on the live/wrapped paths) - capture it so
    // this MAM-replayed message dedupes against its live echo /
    // optimistic pending bubble the same way, instead of never carrying
    // an xmppId at all.
    if (forwardedMessage?.attrs?.id) {mergedAttrs.xmppId = forwardedMessage.attrs.id;}
    const positionalMessage = await createMessageFromXml(
      mergedAttrs,
      body,
      id,
      // Bug #41: pass the resource-bearing occupant `from`
      // (room@conference/sender-id) here, not the outer envelope's
      // `stanza.attrs.from` (which has no resource for a MAM result).
      // createMessageFromXml derives `user.id` from this field's
      // resource - the same authoritative source getDataFromXml uses
      // for live messages - so catch-up rows resolve the correct
      // sender from the very first render instead of needing a later
      // correction once the "official" history fetch lands.
      innerFrom,
      !!deleted
    );

    // Translations ride on the archived stanza too (<translations> +
    // <translate source>), but the positional parse above only reads
    // <data> attrs + <body>, so every MAM-backfilled message lost them -
    // translation looked dead on every room open. Parse the full stanza
    // the way the realtime path does and carry ONLY those two fields over,
    // so sender/xmppId resolution above (bug #41) stays exactly as is.
    const parsedFull = await getDataFromXml(stanza).catch(() => undefined);
    const rawMessage = {
      ...positionalMessage,
      ...(parsedFull?.translations
        ? { translations: parsedFull.translations }
        : {}),
      ...(parsedFull?.langSource ? { langSource: parsedFull.langSource } : {}),
    };

    // Same call-log transform as the realtime path, applied to archived
    // history so calls received while offline still render as log entries.
    const message = transformCallLogMessage(
      rawMessage,
      store.getState().chatSettingStore.user?.xmppUsername || ''
    );
    return message;
  }
};

const onMessageHistory = async (stanza: any) => {
  if (!isMamResult(stanza)) {return;}
  // A windowed query (a jump target's neighbourhood, a time lookup) belongs
  // to the caller that asked: its rows are collected and returned there and
  // must never be claimed by the router or merged into the live list.
  if (isWindowQueryId(stanza.getChild('result')?.attrs?.queryid)) {return;}
  const claimed = claimMamResult(stanza);
  let message: IMessage | undefined;
  try {
    message = await parseMamResult(stanza);
  } finally {
    if (claimed) {
      collectMamMessage(stanza, message);
    }
  }
  if (!claimed && message) {
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

// Server-driven membership change: when someone is added to or removed from
// a MUC the room broadcasts <message><x xmlns="muc#user"><item jid=...
// affiliation="member|none|outcast"/></x></message> to the occupants. It is
// the ONLY thing that counts as a join or leave: usersCnt is adjusted by
// +1/-1 from its CURRENT value, because a big room carries a truncated
// members[] (the real total is usersCnt) and recomputing from its length
// would collapse the count to the page size.
const MUC_USER_NS = 'http://jabber.org/protocol/muc#user';

const onRoomMembershipChange = (stanza: Element | any): void => {
  if (typeof stanza?.is !== 'function' || !stanza.is('message')) {return;}
  const roomJid = String(stanza.attrs?.from || '').split('/')[0];
  const room = roomJid ? store.getState().rooms.rooms[roomJid] : undefined;
  if (!room) {return;}

  const x = (stanza.getChildren?.('x') || []).find(
    (e: Element) => e?.attrs?.xmlns === MUC_USER_NS
  );
  if (!x || x.getChild('invite')) {return;}
  const item = x.getChild('item');
  const memberJid = String(item?.attrs?.jid || '');
  if (!memberJid) {return;}

  const xmppUsername = memberJid.split('@')[0];
  const affiliation = String(item?.attrs?.affiliation || '');
  const leaving = affiliation === 'none' || affiliation === 'outcast';
  const members = Array.isArray(room.members) ? room.members : [];
  const idx = members.findIndex((m) => m.xmppUsername === xmppUsername);

  let next: RoomMember[];
  if (leaving) {
    if (idx < 0) {
      // The leaver may exist only in the directory of a truncated room.
      if (!isRoomMembersTruncated(room)) {return;}
      store.dispatch(
        updateRoom({
          jid: roomJid,
          updates: { usersCnt: adjustUsersCnt(room, -1, members.length) },
        })
      );
      return;
    }
    next = members.filter((_, i) => i !== idx);
  } else {
    if (idx >= 0) {return;}
    next = [
      ...members,
      { _id: '', firstName: '', lastName: '', xmppUsername, jid: memberJid },
    ];
  }

  store.dispatch(
    updateRoom({
      jid: roomJid,
      updates: {
        members: next,
        usersCnt: adjustUsersCnt(room, leaving ? -1 : 1, next.length),
      },
    })
  );
};

const onPresenceInRoom = (stanza: Element | any) => {
  onRoomMembershipChange(stanza);
  if (
    typeof stanza.attrs.id === 'string' &&
    stanza.attrs.id.startsWith('presenceInRoom') &&
    !stanza.getChild('error')
  ) {
    const roomJID: string = stanza.attrs.from.split('/')[0];
    const role: string = stanza?.children[1]?.children[0]?.attrs.role;
    if (role && store.getState().rooms.rooms?.[roomJID]?.role !== role) {
      store.dispatch(setRoomRole({ chatJID: roomJID, role: role }));
    }
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
  // Deliberately dispatches NOTHING — mirroring the web SDK, where this
  // handler parses the activity list into a local and never touches the
  // store. The activity stanza carries no firstName/lastName, and both of
  // the old dispatches poisoned good REST data with empty-named entries:
  //   - updateRoom wholesale-replaced room.roomMembers (REST members carry
  //     no jid, so the existing-by-jid lookup always missed), blanking the
  //     ChatProfileModal member list;
  //   - mergeUsersSet overwrote REST-hydrated identity entries under the
  //     exact localpart key the sender-name resolver reads first, which is
  //     why most of usersSet ended up empty.
  // REST (/chats/my → dispatchUsersSetFromRestItems + the roomMembers
  // build in rooms.api.ts) is the one hydration path for both stores.
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
    const known = store.getState().rooms.rooms;
    const fresh: IRoom[] = [];
    const jids: string[] = [];
    for (const result of children as any[]) {
      const jid = result?.attrs?.jid;
      if (!jid) {continue;}
      jids.push(jid);
      if (known[jid]) {continue;}
      fresh.push({
        jid,
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
      });
    }
    if (fresh.length) {
      store.dispatch(addRooms({ rooms: fresh }));
      if (!store.getState().rooms.activeRoomJID) {
        store.dispatch(setCurrentRoom({ roomJID: fresh[0].jid }));
      }
    }
    for (const jid of jids) {
      try {
        xmpp.presenceInRoomStanza(jid);
      } catch (e) {
        console.warn('presenceInRoomStanza failed', jid, e);
      }
    }
  }
};

// No-op stubs for handlers that handleStanzas.xmpp.ts imports but the
// RN side hasn't ported yet. Without these the bundle compiles but
// require() returns undefined at runtime → "X is not a function".
const onMessageError = (_stanza: Element, _xmpp?: any) => {};
/** A live reaction: the reactor's full current list on one message. */
const onReactionMessage = (stanza: Element) => {
  if (!stanza?.is?.('message') || stanza.getChild('result')) {return;}
  if (!stanza.getChild('reactions')) {return;}
  const reaction = extractReaction(stanza, stanza.attrs?.from);
  if (!reaction) {return;}
  store.dispatch(
    setReactions({
      roomJID: reaction.roomJID,
      messageId: reaction.messageId,
      latestReactionTimestamp: reaction.ts,
      reactions: reaction.emoji,
      from: reaction.from,
      data: reaction.data,
    })
  );
};
// Archived reactions are handled by parseMamResult + the MAM router.
const onReactionHistory = (_stanza: Element) => {};
// Presence that removes a member: unavailable + affiliation none/outcast.
// A presence is never a join (an unlisted occupant of a truncated big room
// is indistinguishable from a new member), so it only ever adjusts -1; the
// affiliation message (onRoomMembershipChange) is what counts joins.
const onRoomKicked = (stanza: Element | any) => {
  try {
    if (stanza?.attrs?.type !== 'unavailable') {return;}
    const from = String(stanza.attrs?.from || '');
    const slash = from.indexOf('/');
    const roomJID = slash >= 0 ? from.slice(0, slash) : from;
    const nickname = slash >= 0 ? from.slice(slash + 1) : '';
    const state = store.getState();
    const room = roomJID ? state.rooms.rooms[roomJID] : undefined;
    if (!room || !nickname) {return;}
    if (nickname === (state.chatSettingStore.user?.xmppUsername || '')) {return;}

    const x = (stanza.getChildren?.('x') || []).find(
      (e: Element) => e?.attrs?.xmlns === MUC_USER_NS
    );
    const item = x?.getChild?.('item');
    const affiliation = String(item?.attrs?.affiliation || '');
    if (!item || (affiliation !== 'none' && affiliation !== 'outcast')) {return;}

    const members = Array.isArray(room.members) ? room.members : [];
    const idx = members.findIndex((m) => m.xmppUsername === nickname);
    if (idx < 0) {
      if (!isRoomMembersTruncated(room)) {return;}
      store.dispatch(
        updateRoom({
          jid: roomJID,
          updates: { usersCnt: adjustUsersCnt(room, -1, members.length) },
        })
      );
      return;
    }
    const next = members.filter((_, i) => i !== idx);
    store.dispatch(
      updateRoom({
        jid: roomJID,
        updates: {
          members: next,
          usersCnt: adjustUsersCnt(room, -1, next.length),
        },
      })
    );
  } catch (error) {
    console.warn('onRoomKicked failed', error);
  }
};
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
