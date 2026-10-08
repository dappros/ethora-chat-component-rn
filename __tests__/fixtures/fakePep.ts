import { xml } from '@xmpp/client';
import { Element } from 'ltx';

/**
 * An in-memory stand-in for the server's PEP storage, shared by the fake
 * clients of a test, so OMEMO can be exercised without an ejabberd.
 */

/** PEP items of every account, shared by the fake clients: jid -> node -> id. */
export type Pep = Map<string, Map<string, Map<string, Element>>>;

export function fakeClient(pep: Pep, jid: string) {
  const sent: Element[] = [];
  const requests: Element[] = [];
  const nodesOf = (owner: string) => {
    let nodes = pep.get(owner);
    if (!nodes) {pep.set(owner, (nodes = new Map()));}
    return nodes;
  };

  return {
    sent,
    requests,
    jid: {
      bare: () => ({ toString: () => jid }),
      getDomain: () => jid.split('@')[1],
      getLocal: () => jid.split('@')[0],
      toString: () => jid,
    },
    send: async (stanza: Element) => void sent.push(stanza),
    iqCaller: {
      request: async (iq: Element) => {
        requests.push(iq);
        const pubsub = iq.getChild('pubsub')!;
        const publish = pubsub.getChild('publish');
        if (publish) {
          // A PEP publish always lands on the publisher's own account
          const node = nodesOf(jid);
          const item = publish.getChild('item')!;
          let items = node.get(publish.attrs.node);
          if (!items) {node.set(publish.attrs.node, (items = new Map()));}
          items.set(item.attrs.id, item.children[0] as Element);
          return xml('iq', { type: 'result' });
        }

        const query = pubsub.getChild('items')!;
        const owner = String(iq.attrs.to);
        const stored = nodesOf(owner).get(query.attrs.node) ?? new Map();
        const wanted = query.getChild('item')?.attrs.id;
        const items = [...stored.entries()]
          .filter(([id]) => !wanted || id === wanted)
          .map(([id, payload]) => xml('item', { id }, payload));
        return xml(
          'iq',
          { type: 'result' },
          xml(
            'pubsub',
            { xmlns: 'http://jabber.org/protocol/pubsub' },
            xml('items', { node: query.attrs.node }, ...items)
          )
        );
      },
    },
  };
}

