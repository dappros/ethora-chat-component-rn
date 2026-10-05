import XmppClient from '../networking/xmppClient';
import { IRoom } from '../types/types';
import { presenceInRoom } from '../networking/xmpp/presenceInRoom.xmpp';
import { pushSubscriptionService } from '../services/pushSubscriptionService';
import { startBackgroundJoinSweep } from './backgroundJoinSweep';

/**
 * Joins the known rooms and subscribes them for push. Callers should NOT
 * await it on a path that gates first paint: with a real XmppClient the
 * joins are the shared background sweep (open room first, then recent
 * activity, bounded concurrency), started here and not waited for. Only a
 * bare client without the sweep falls back to joining every room at once.
 */
export const initRoomsPresence = async (
  client: XmppClient,
  rooms: { [jid: string]: IRoom }
) => {
  console.log('Persisted presence');
  if (!client) {return null;}
  const jids = Object.keys(rooms || {});
  if (!jids.length) {return null;}

  if (typeof (client as any).sendAllPresencesAndMarkReady === 'function') {
    startBackgroundJoinSweep(client);
  } else {
    await Promise.allSettled(
      jids.map(async (jid) => {
        try {
          await presenceInRoom(client.client, jid);
        } catch (e) {}
      })
    );
  }

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
