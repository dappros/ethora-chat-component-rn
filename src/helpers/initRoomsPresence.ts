import XmppClient from '../networking/xmppClient';
import { IRoom } from '../types/types';
import { presenceInRoom } from '../networking/xmpp/presenceInRoom.xmpp';
import { pushSubscriptionService } from '../services/pushSubscriptionService';

export const initRoomsPresence = async (
  client: XmppClient,
  rooms: { [jid: string]: IRoom }
) => {
  console.log('Persisted presence');
  if (!client) return null;
  const jids = Object.keys(rooms || {});
  if (!jids.length) return null;
  
  await Promise.allSettled(
    jids.map(async (jid) => {
      try {
        await presenceInRoom(client.client, jid);
      } catch (e) {}
    })
  );

  if (jids.length > 0 && client.client) {
    const userNick = client.client.jid?.getLocal();
    await pushSubscriptionService.subscribeToRooms(
      client.client,
      jids,
      userNick
    ).catch((error) => {
      console.error('Failed to subscribe to rooms for push:', error);
    });
  }
};
