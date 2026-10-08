import { ApiRoom, IRoom } from '../types/types';
import type { LastMessage } from '../types/models/message.model';

/**
 * Maps the flattened `lastMessage` doc `GET /v1/chats/my` embeds per room
 * into the shape a live message already takes. Backends differ in whether
 * they send it at all, so every field is optional and its absence changes
 * nothing. It is only ever a SEED for the room-list preview (and for the
 * unread middleware's "read past the API's last message" check).
 */
export const mapApiLastMessage = (
  apiLastMessage: ApiRoom['lastMessage'],
  roomJid: string
): LastMessage | undefined => {
  const body = String(apiLastMessage?.body || '').trim();
  if (!apiLastMessage || !body) {return undefined;}
  const senderName = `${apiLastMessage.senderFirstName || ''} ${
    apiLastMessage.senderLastName || ''
  }`.trim();
  return {
    id: apiLastMessage.messageId || apiLastMessage.stanzaId || '',
    xmppId: apiLastMessage.stanzaId,
    roomJid,
    body,
    date: apiLastMessage.createdAt,
    isDeleted: false,
    user: {
      id: apiLastMessage.fromUserId || apiLastMessage.from || '',
      name: senderName,
    },
  } as LastMessage;
};

/**
 * The unread count the server reported for a room, or undefined when the
 * backend sends none (then the local MAM-based count is the only source).
 */
export const readApiUnreadCount = (item: {
  unreadCount?: unknown;
}): number | undefined => {
  const raw = item?.unreadCount;
  return typeof raw === 'number' && Number.isFinite(raw)
    ? Math.max(0, Math.floor(raw))
    : undefined;
};

/**
 * Room user count from a /chats/my item: the API total (`usersCnt`, or the
 * older `participants`) when it is bigger than the page of members the
 * response carries (big public rooms list at most 30), else the members
 * length, else the supplied fallback.
 */
export const readApiUsersCnt = (
  item: Pick<ApiRoom, 'members' | 'usersCnt'> & { participants?: unknown },
  fallback: number = 0
): number => {
  const membersLen = Array.isArray(item?.members) ? item.members.length : 0;
  const total = Number(item?.usersCnt ?? item?.participants);
  if (Number.isFinite(total) && total > 0) {
    return Math.max(total, membersLen);
  }
  return membersLen || fallback;
};

const seedTimestamp = (seed: LastMessage | undefined): number | undefined => {
  if (!seed) {return undefined;}
  const id = Number(seed.id);
  if (Number.isFinite(id) && id > 0) {return id;}
  const ms = seed.date ? new Date(seed.date).getTime() : NaN;
  return Number.isFinite(ms) && ms > 0 ? ms * 1000 : undefined;
};

export const createRoomFromApi = (
  room: ApiRoom,
  service: string = 'conference.dev.xmpp.ethoradev.com',
  usersArrayLength: number = 0
): IRoom | null => {
  try {
    const jid = `${room?.name}@${service}` || '';
    const apiUnreadCount = readApiUnreadCount(room);
    const lastMessage = mapApiLastMessage(room?.lastMessage, jid);
    const roomData: IRoom = {
      ...room,
      id: (room as any)?._id || '',
      jid,
      name: room?.title || '',
      title: room?.title || '',
      usersCnt: readApiUsersCnt(room, usersArrayLength + 1),
      messages: [],
      isLoading: false,
      roomBg: null,
      icon: room?.picture !== 'none' ? room?.picture : null,
      unreadMessages: apiUnreadCount ?? 0,
      apiUnreadCount,
      apiUnreadSeededAt: apiUnreadCount === undefined ? undefined : Date.now(),
      lastViewedTimestamp: 0,
      lastMessage,
      lastMessageTimestamp: seedTimestamp(lastMessage),
    } as IRoom;
    return roomData;
  } catch (error) {
    console.log(error);
    return null;
  }
};
