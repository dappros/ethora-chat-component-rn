import { Client, xml } from '@xmpp/client';
import { createTimeoutPromise } from './createTimeoutPromise.xmpp';
import { Element } from '@xmpp/xml';

let presenceIdCounter = 0;
const nextPresenceId = () =>
  `presenceInRoom-${Date.now().toString(36)}-${(++presenceIdCounter).toString(36)}`;

const joinedByClient = new WeakMap<Client, Map<string, Promise<Element>>>();

const joinedRooms = (client: Client): Map<string, Promise<Element>> => {
  let map = joinedByClient.get(client);
  if (!map) {
    map = new Map();
    joinedByClient.set(client, map);
    const forget = () => joinedByClient.get(client)?.clear();
    client.on('disconnect', forget);
    client.on('offline', forget);
  }
  return map;
};

export const __forgetJoinedRooms = (client: Client) =>
  joinedByClient.get(client)?.clear();

export const presenceInRoom = (
  client: Client,
  roomJID: string,
  delay = 0
): Promise<Element> => {
  const joined = joinedRooms(client);
  const existing = joined.get(roomJID);
  if (existing) {return existing;}
  const join = joinRoom(client, roomJID, delay);
  joined.set(roomJID, join);
  // A failed join is not a join: let the next caller try again.
  join.catch(() => {
    if (joined.get(roomJID) === join) {joined.delete(roomJID);}
  });
  return join;
};

const joinRoom = async (
  client: Client,
  roomJID: string,
  delay: number
): Promise<Element> => {
  let stanzaHandler: (stanza: Element) => void;
  const unsubscribe = () => client.off('stanza', stanzaHandler);
  const stanzaId = nextPresenceId();

  // Avoid `new Promise(async (resolve, reject) => …)` — the async
  // executor's own thrown errors / unhandled rejections inside it can
  // escape the constructed promise depending on the order of catch
  // attachment vs rejection. Use a regular Promise + a separate async
  // wrapper that funnels every failure path through reject().
  return new Promise<Element>((resolve, reject) => {
    let settled = false;

    const finish = (cb: (value?: any) => void, value?: any) => {
      if (settled) {return;}
      settled = true;

      if (delay <= 0) {
        unsubscribe();
        cb(value);
        return;
      }
      setTimeout(() => {
        unsubscribe();
        cb(value);
      }, delay);
    };

    stanzaHandler = (stanza) => {
      if (
        stanza.is('presence') &&
        stanza.attrs.id === stanzaId &&
        stanza.attrs.from?.startsWith(roomJID)
      ) {
        finish(resolve, stanza);
      }
    };

    client.on('stanza', stanzaHandler);

    const presence = xml(
      'presence',
      {
        from: client.jid?.toString(),
        to: `${roomJID}/${client.jid?.getLocal()}`,
        id: stanzaId,
      },
      xml(
        'x',
        { xmlns: 'http://jabber.org/protocol/muc' },
        xml('history', { maxstanzas: '0' })
      )
    );

    // Side-effects sequence: send the presence (handles its own
    // failure → reject), then wait the timeout (also handles its own
    // failure → reject). Each chain attaches its rejection handler
    // synchronously, so no race with the outer Promise's catch.
    (async () => {
      try {
        await client.send(presence);
      } catch (err) {
        unsubscribe();
        reject(err);
        return;
      }
      try {
        await createTimeoutPromise(2000, unsubscribe);
      } catch (err) {
        // The room's reply schedules resolve() `delay` ms later (2000 by
        // default) — the same length as this timeout, so the timeout used
        // to win the race and reject a join that had actually succeeded
        // (allRoomPresences "failed" with undefined on every bootstrap).
        // Only a join that never got an answer is a failure.
        if (!settled) {reject(err);}
      }
    })();
  });
};
