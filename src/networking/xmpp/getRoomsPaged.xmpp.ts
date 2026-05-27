import { Client, xml } from '@xmpp/client';
import { createTimeoutPromise } from './createTimeoutPromise.xmpp';
import { Element } from '@xmpp/xml';

export const getRoomsPaged = async (
  client: Client,
  maxResults = 3,
  before = null
) => {
  let stanzaHdlrPointer: {
    (el: Element): void;
    (stanza: any): void;
    (el: Element): void;
  };

  const unsubscribe = () => {
    client.off('stanza', stanzaHdlrPointer);
  };

  // Avoid `new Promise(async (resolve, reject) => {...})` — an async
  // executor swallows the promise it returns, so any rejection inside
  // it that happens BEFORE the catch handler attaches becomes
  // "Uncaught (in promise)" red-screen. Use an explicit deferred + a
  // regular async body that handles its own errors.
  return new Promise<any>((resolve, reject) => {
    stanzaHdlrPointer = (stanza) => {
      if (stanza.is('iq') && stanza.attrs.id === 'getUserRooms') {
        unsubscribe();
        resolve(stanza);
      }
    };

    client.on('stanza', stanzaHdlrPointer);

    const query = xml('query', { xmlns: 'ns:getrooms' });
    const set = xml(
      'set',
      { xmlns: 'http://jabber.org/protocol/rsm' },
      xml('max', {}, maxResults.toString())
    );

    if (before) {
      set.append(xml('before', {}, before));
    }

    query.append(set);

    const message = xml(
      'iq',
      { type: 'get', from: client.jid?.toString(), id: 'getUserRoomsPaged' },
      query
    );

    // Capture potential rejections from client.send() — it returns a
    // Promise on most @xmpp/client builds; the previous bare call left
    // the rejection unhandled when the socket was closing.
    let sendPromise: Promise<unknown> | undefined;
    try {
      sendPromise = client.send(message) as unknown as Promise<unknown>;
    } catch (err) {
      console.error('Error sending getRooms request:', err);
      unsubscribe();
      reject(err);
      return;
    }
    Promise.resolve(sendPromise)
      .catch((err) => {
        console.error('client.send rejected in getRoomsPaged', err);
        unsubscribe();
        reject(err);
      });

    // The timeout catch was racy — if createTimeoutPromise rejected
    // before `.catch(reject)` attached, the rejection escaped. Use a
    // .then/.catch pair attached synchronously to be safe.
    createTimeoutPromise(2000, unsubscribe).then(
      () => {
        /* timeout completed cleanly */
      },
      (err) => reject(err)
    );
  });
};
