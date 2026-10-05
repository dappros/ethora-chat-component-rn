import { ApiRoom, IRoom } from '../types/types';
import type { LastMessage } from '../types/models/message.model';

const mapApiLastMessage = (
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
    const lastMessage = mapApiLastMessage(room?.lastMessage, jid);
    const roomData: IRoom = {
      ...room,
      id: (room as any)?._id || '',
      jid,
      name: room?.title || '',
      title: room?.title || '',
      usersCnt: Number(room?.members?.length || usersArrayLength + 1),
      messages: [],
      isLoading: false,
      roomBg: null,
      icon: room?.picture !== 'none' ? room?.picture : null,
      unreadMessages: 0,
      lastViewedTimestamp: 0,
      lastMessage,
      lastMessageTimestamp: seedTimestamp(lastMessage),
    };
    return roomData;
  } catch (error) {
    console.log(error);
    return null;
  }
};
