import { Client, xml } from '@xmpp/client';
import { Element } from '@xmpp/xml';

// A bare `local@domain.tld`. The conference prefix is NOT required here (a
// host may run its MUC service on a custom domain, xmppSettings.conference);
// callers that fan out over the room list filter with isLikelyMucJid first.
const isValidRoomJid = (jid: unknown): jid is string => {
  if (typeof jid !== 'string') {return false;}
  const at = jid.indexOf('@');
  if (at <= 0) {return false;}
  const domain = jid.slice(at + 1).split('/')[0];
  return !!domain;
};

let presenceIdCounter = 0;
const nextPresenceId = () =>
  `presenceInRoom-${Date.now().toString(36)}-${(++presenceIdCounter).toString(36)}`;

/**
 * Sends the MUC join presence for `roomJID` and resolves with the room's
 * answer. Rejects with `presence_error:<code>:<jid>` on an error presence,
 * `presence_timeout:<jid>` when nothing answers within `timeoutMs`, and
 * `presence_send_failed:<jid>:...` when the stanza could not be written.
 *
 * `delay` is an optional extra wait after the answer. It used to be a fixed
 * 2 s: the join answer arrives BEFORE the server's replay of the room history
 * (default up to 20 stanzas), and callers waited for that replay to settle.
 * The join now asks for `historyStanzas` (default 0) so nothing is replayed
 * (history comes from MAM), and the default settle delay is 0.
 */
export const presenceInRoom = async (
  client: Client,
  roomJID: string,
  delay = 0,
  timeoutMs = 2000,
  // How many of the room's recent messages the MUC service replays on join
  // (XEP-0045 <history maxstanzas/>). Default 0: history comes from MAM only.
  // Without the element the server replays its default (ejabberd: up to 20
  // stanzas) for EVERY room joined: N rooms * 20 messages of wire traffic
  // that MAM then fetches again.
  historyStanzas = 0
): Promise<Element> => {
  if (!isValidRoomJid(roomJID)) {
    return Promise.reject(
      new Error(`presence_invalid_jid:${String(roomJID)}`)
    );
  }
  let stanzaHandler: (stanza: Element) => void;

  const unsubscribe = () => client?.off?.('stanza', stanzaHandler);
  const stanzaId = nextPresenceId();

  return new Promise<Element>((resolve, reject) => {
    let settled = false;
    // Cleared as soon as the promise settles by any other path, so the
    // timeout timer doesn't linger after we already know the outcome.
    let cancelTimeout: (() => void) | null = null;

    const finish = (cb: (value?: any) => void, value?: any) => {
      if (settled) {return;}
      settled = true;
      cancelTimeout?.();
      if (!(delay > 0)) {
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
        if (stanza.attrs.type === 'error') {
          const errEl = stanza.getChild('error');
          const code =
            (errEl &&
              (errEl.getChild('forbidden')
                ? 'forbidden'
                : errEl.getChild('remote-server-not-found')
                  ? 'remote-server-not-found'
                  : errEl.getChild('not-allowed')
                    ? 'not-allowed'
                    : errEl.getChild('item-not-found')
                      ? 'item-not-found'
                      : errEl.attrs?.type || 'unknown')) ||
            'unknown';
          settled = true;
          cancelTimeout?.();
          unsubscribe();
          reject(new Error(`presence_error:${code}:${roomJID}`));
          return;
        }
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
        xml('history', {
          maxstanzas: String(
            Number.isFinite(historyStanzas) && historyStanzas > 0
              ? Math.floor(historyStanzas)
              : 0
          ),
        })
      )
    );

    Promise.resolve(client.send(presence))
      .then(() => {
        // The answer may already have arrived while send() was settling.
        if (settled) {return;}
        const timer = setTimeout(() => {
          if (settled) {return;}
          settled = true;
          unsubscribe();
          reject(new Error(`presence_timeout:${roomJID}`));
        }, timeoutMs);
        cancelTimeout = () => clearTimeout(timer);
      })
      .catch((err) => {
        unsubscribe();
        settled = true;
        reject(
          new Error(
            `presence_send_failed:${roomJID}:${err instanceof Error ? err.message : String(err)}`
          )
        );
      });
  });
};
