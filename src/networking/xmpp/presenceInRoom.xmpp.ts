import { Client, xml } from '@xmpp/client';
import { createTimeoutPromise } from './createTimeoutPromise.xmpp';
import { Element } from '@xmpp/xml';

let presenceIdCounter = 0;
const nextPresenceId = () =>
  `presenceInRoom-${Date.now().toString(36)}-${(++presenceIdCounter).toString(36)}`;

export const presenceInRoom = async (
  client: Client,
  roomJID: string,
  delay = 2000
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
      xml('x', { xmlns: 'http://jabber.org/protocol/muc' })
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
        reject(err);
      }
    })();
  });
};
