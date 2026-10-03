import { Client, xml } from '@xmpp/client';
import { createTimeoutPromise } from './createTimeoutPromise.xmpp';
import { IMessage } from '../../types/types';
import { beginMamQuery, cancelMamQuery } from './mamRouter';

declare const __DEV__: boolean | undefined;

let historyIdCounter = 0;

export const getHistory = async (
  client: Client,
  chatJID: string,
  max: number,
  before?: number,
  otherId?: string,
  options?: { selfApplied?: boolean }
): Promise<IMessage[] | undefined> => {
  if (typeof chatJID !== 'string') {return;}
  // If a caller passes a bare local-part (no `@host`), pick a default
  // conference based on the client's actual service URL — never leak a
  // hard-coded dev domain.
  const fixedChatJid = chatJID.includes('@')
    ? chatJID
    : (() => {
        const service: string = (client as any)?.options?.service || '';
        const host =
          service.match(/wss?:\/\/([^:/]+)/)?.[1] || 'xmpp.chat.ethora.com';
        return `${chatJID}@conference.${host}`;
      })();


  const id = otherId ?? `get-history:${Date.now().toString(36)}-${(++historyIdCounter).toString(36)}`;

  const page = beginMamQuery(id, fixedChatJid, !options?.selfApplied);

  const message = xml(
    'iq',
    {
      type: 'set',
      to: fixedChatJid,
      id: id,
    },
    xml(
      'query',
      { xmlns: 'urn:xmpp:mam:2', queryid: id },
      xml(
        'set',
        { xmlns: 'http://jabber.org/protocol/rsm' },
        xml('max', {}, max.toString()),
        before ? xml('before', {}, before.toString()) : xml('before')
      )
    )
  );

  client?.send(message).catch((err: any) => console.log('err on load', err));

  const timeoutPromise = createTimeoutPromise(10000);

  try {
    const res = await Promise.race<IMessage[] | null>([
      page,
      timeoutPromise as Promise<null>,
    ]);
    if (res === null) {
      const partial = cancelMamQuery(id);
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log(
          `[mam] history request for ${fixedChatJid} timed out after 10s (${partial.length} results arrived)`
        );
      }
      return partial;
    }
    return res;
  } catch (e) {
    const partial = cancelMamQuery(id);
    if (typeof __DEV__ !== 'undefined' && __DEV__ && e === undefined) {
      console.log(
        `[mam] history request for ${fixedChatJid} got no closing iq within 10s (${partial.length} results arrived)`
      );
    }
    return partial;
  }
};
