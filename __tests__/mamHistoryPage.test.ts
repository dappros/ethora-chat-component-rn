/**
 * MAM page reading: RSM `<fin>` parsing, cursor writes by the server cursor,
 * windowed-query isolation, time-filter iq shape, reaction replay.
 * Real ltx stanzas, a fake client, the real store.
 */
import { parse } from 'ltx';
import { store } from '../src/roomStore';
import {
  addRoom,
  deleteAllRooms,
  setRoomMessages,
  updateRoom,
} from '../src/roomStore/roomsSlice';
import { IRoom } from '../src/types/types';
import {
  fetchHistoryPage,
  getHistory,
  getHistoryPage,
} from '../src/networking/xmpp/getHistory.xmpp';
import { onMessageHistory } from '../src/networking/stanzaHandlers';
import { __resetMamRouter, routeMamIq } from '../src/networking/xmpp/mamRouter';

const ROOM = 'room1@conference.example.com';
const REACTOR = '6a2c08adef26ca2d3e1e3677';

// `feedGlobal`: also run every stanza through the global handlers the way the
// real client does (handleStanza). A live (non-window) page is read by the MAM
// router, which those handlers feed; a window page and fetchHistoryPage read
// the wire by themselves and need no feeding.
function makeClient(feedGlobal = false) {
  const listeners: Record<string, ((arg: any) => void)[]> = {};
  const send = jest.fn(async () => undefined);
  const client: any = {
    send,
    on: jest.fn((e: string, fn: any) => {
      (listeners[e] = listeners[e] || []).push(fn);
    }),
    off: jest.fn((e: string, fn: any) => {
      listeners[e] = (listeners[e] || []).filter((l) => l !== fn);
    }),
    status: 'online',
    options: { service: 'wss://example.com/ws' },
    trigger: (e: string, payload: any) => {
      (listeners[e] || []).slice().forEach((fn) => fn(payload));
      if (feedGlobal && e === 'stanza') {
        if (payload?.is?.('iq')) routeMamIq(payload);
        else void onMessageHistory(payload);
      }
    },
    listenerCount: (e: string) => (listeners[e] || []).length,
  };
  return { client, send };
}

const sentIq = (send: jest.Mock) => send.mock.calls[send.mock.calls.length - 1][0];

const row = (queryId: string, id: string, body: string) =>
  parse(
    `<message from="${ROOM}" to="me@example.com">
       <result xmlns="urn:xmpp:mam:2" queryid="${queryId}" id="${id}">
         <forwarded xmlns="urn:xmpp:forward:0">
           <delay xmlns="urn:xmpp:delay" stamp="2026-08-07T08:39:00.000Z"/>
           <message from="${ROOM}/sender" id="orig-${id}" type="groupchat">
             <stanza-id xmlns="urn:xmpp:sid:0" by="${ROOM}" id="${id}"/>
             <data senderJID="sender@example.com" senderFirstName="Al" senderLastName="Bo"/>
             <body>${body}</body>
           </message>
         </forwarded>
       </result>
     </message>`
  );

const reactionRow = (
  queryId: string,
  id: string,
  target: string,
  emoji: string[]
) =>
  parse(
    `<message from="${ROOM}">
       <result xmlns="urn:xmpp:mam:2" queryid="${queryId}" id="${id}">
         <forwarded xmlns="urn:xmpp:forward:0">
           <delay xmlns="urn:xmpp:delay" stamp="2026-08-07T08:40:00.000Z"/>
           <message id="message-reaction:${id}" from="${REACTOR}@example.com/res">
             <stanza-id xmlns="urn:xmpp:sid:0" by="${ROOM}" id="${id}"/>
             <reactions xmlns="urn:xmpp:reactions:0" id="${target}" from="${REACTOR}@example.com/res">
               ${emoji.map((e) => `<reaction>${e}</reaction>`).join('')}
             </reactions>
             <data senderFirstName="Al" senderLastName="Bo"/>
           </message>
         </forwarded>
       </result>
     </message>`
  );

const fin = (
  id: string,
  opts: { complete?: string; first?: string; last?: string; count?: string } = {}
) =>
  parse(
    `<iq type="result" id="${id}" from="${ROOM}">
       <fin xmlns="urn:xmpp:mam:2"${opts.complete ? ` complete="${opts.complete}"` : ''}>
         ${
           opts.first || opts.last || opts.count
             ? `<set xmlns="http://jabber.org/protocol/rsm">
                  ${opts.first ? `<first index="0">${opts.first}</first>` : ''}
                  ${opts.last ? `<last>${opts.last}</last>` : ''}
                  ${opts.count ? `<count>${opts.count}</count>` : ''}
                </set>`
             : ''
         }
       </fin>
     </iq>`
  );

const seed = (messages: any[] = [], cursor?: number) => {
  store.dispatch(deleteAllRooms());
  store.dispatch(
    addRoom({
      roomData: { jid: ROOM, name: ROOM, title: ROOM, messages: [] } as unknown as IRoom,
    })
  );
  if (messages.length) {
    store.dispatch(setRoomMessages({ roomJID: ROOM, messages }));
  }
  if (cursor !== undefined) {
    store.dispatch(
      updateRoom({
        jid: ROOM,
        updates: {
          messageStats: {
            firstMessageTimestamp: cursor,
            lastMessageTimestamp: 9e15,
          },
        },
      })
    );
  }
};

const room = () => store.getState().rooms.rooms[ROOM];
const cursorNow = () => room().messageStats?.firstMessageTimestamp;
const cached = (id: string) =>
  ({ id, body: 'x', date: new Date().toISOString(), roomJid: ROOM } as any);

beforeEach(() => __resetMamRouter());

const tick = () => new Promise((r) => setImmediate(r));

describe('fin parsing', () => {
  beforeEach(() => seed());

  it('reads complete=true with first, last and count', async () => {
    const { client, send } = makeClient();
    const p = fetchHistoryPage(client, ROOM, 20, { id: 'a' });
    expect(sentIq(send).attrs.id).toBe('a');
    client.trigger(
      'stanza',
      fin('a', {
        complete: 'true',
        first: '1700000000000001',
        last: '1700000000000009',
        count: '42',
      })
    );
    const page = await p;
    expect(page).toMatchObject({
      ok: true,
      complete: true,
      first: 1700000000000001,
      last: 1700000000000009,
      count: 42,
      finSeen: true,
      roomJid: ROOM,
    });
  });

  it('reads complete=false', async () => {
    const { client } = makeClient();
    const p = fetchHistoryPage(client, ROOM, 20, { id: 'b' });
    client.trigger('stanza', fin('b', { complete: 'false', first: '1700000000000001', last: '1700000000000002' }));
    expect(await p).toMatchObject({ ok: true, complete: false, first: 1700000000000001 });
  });

  it('an empty fin gives null bounds and not complete', async () => {
    const { client } = makeClient();
    const p = fetchHistoryPage(client, ROOM, 20, { id: 'c' });
    client.trigger('stanza', fin('c'));
    expect(await p).toMatchObject({
      ok: true,
      complete: false,
      first: null,
      last: null,
      count: null,
      finSeen: true,
      messages: [],
    });
  });

  it('a result without any fin is ok but flagged finSeen=false', async () => {
    const { client } = makeClient();
    const p = fetchHistoryPage(client, ROOM, 20, { id: 'd' });
    client.trigger('stanza', parse(`<iq type="result" id="d"/>`));
    expect(await p).toMatchObject({ ok: true, finSeen: false });
  });

  it('an iq error settles with ok=false and unsubscribes', async () => {
    const { client } = makeClient();
    const p = fetchHistoryPage(client, ROOM, 20, { id: 'e' });
    client.trigger('stanza', parse(`<iq type="error" id="e"/>`));
    expect(await p).toMatchObject({ ok: false, messages: [] });
    expect(client.listenerCount('stanza')).toBe(0);
  });

  it('collects the rows of its own query and ignores a sibling query on the same room', async () => {
    const { client } = makeClient();
    const p = fetchHistoryPage(client, ROOM, 20, { id: 'mine' });
    client.trigger('stanza', row('mine', '1700000000000001', 'hello'));
    client.trigger('stanza', row('other', '1700000000000002', 'not mine'));
    client.trigger('stanza', fin('mine', { first: '1700000000000001', last: '1700000000000001' }));
    const page = await p;
    expect(page.messages.map((m) => m.body)).toEqual(['hello']);
    expect(page.received).toBe(1);
  });

  it('times out and releases its handler', async () => {
    jest.useFakeTimers();
    const { client } = makeClient();
    const p = fetchHistoryPage(client, ROOM, 20, { id: 'f', timeoutMs: 500 });
    jest.advanceTimersByTime(501);
    expect(await p).toMatchObject({ ok: false, messages: [] });
    expect(client.listenerCount('stanza')).toBe(0);
    jest.useRealTimers();
  });
});

describe('query shape', () => {
  beforeEach(() => seed());

  it('latest page: empty <before/>, queryid equals the iq id', () => {
    const { client, send } = makeClient();
    void getHistoryPage(client, ROOM, 30, { id: 'q1', timeoutMs: 1 });
    const iq = sentIq(send);
    const query = iq.getChild('query');
    expect(query.attrs.queryid).toBe('q1');
    expect(query.getChild('set').getChild('max').getText()).toBe('30');
    expect(query.getChild('set').getChild('before')).toBeDefined();
    expect(query.getChild('x')).toBeUndefined();
  });

  it('before page carries the cursor', () => {
    const { client, send } = makeClient();
    void getHistoryPage(client, ROOM, 30, { before: 1700000000000000, id: 'q2', timeoutMs: 1 });
    expect(sentIq(send).getChild('query').getChild('set').getChild('before').getText()).toBe('1700000000000000');
  });

  it('after page carries <after> and a window-tagged id', () => {
    const { client, send } = makeClient();
    void fetchHistoryPage(client, ROOM, 11, { after: 1700000000000000, timeoutMs: 1 });
    const iq = sentIq(send);
    expect(iq.attrs.id.startsWith('window:')).toBe(true);
    expect(iq.getChild('query').attrs.queryid).toBe(iq.attrs.id);
    const set = iq.getChild('query').getChild('set');
    expect(set.getChild('after').getText()).toBe('1700000000000000');
    expect(set.getChild('before')).toBeUndefined();
  });

  it('time filter: a mam:2 data form with start/end and no empty <before/>', () => {
    const { client, send } = makeClient();
    void getHistoryPage(client, ROOM, 50, {
      start: '2026-06-01T10:00:00.000Z',
      end: '2026-06-01T10:00:10.000Z',
      timeoutMs: 1,
    });
    const iq = sentIq(send);
    expect(iq.attrs.id.startsWith('window:')).toBe(true);
    const form = iq.getChild('query').getChild('x');
    expect(form.attrs.xmlns).toBe('jabber:x:data');
    expect(form.attrs.type).toBe('submit');
    const fields = form.getChildren('field');
    const byVar = (v: string) => fields.find((f: any) => f.attrs.var === v);
    expect(byVar('FORM_TYPE').getChild('value').getText()).toBe('urn:xmpp:mam:2');
    expect(byVar('start').getChild('value').getText()).toBe('2026-06-01T10:00:00.000Z');
    expect(byVar('end').getChild('value').getText()).toBe('2026-06-01T10:00:10.000Z');
    expect(iq.getChild('query').getChild('set').getChild('before')).toBeUndefined();
  });

  it('start only omits the end field', () => {
    const { client, send } = makeClient();
    void fetchHistoryPage(client, ROOM, 5, { start: '2026-06-01T10:00:00.000Z', timeoutMs: 1 });
    const fields = sentIq(send).getChild('query').getChild('x').getChildren('field');
    expect(fields.map((f: any) => f.attrs.var)).toEqual(['FORM_TYPE', 'start']);
  });
});

describe('paging cursor by the server fin', () => {
  it('a late LATEST-page fin does not pull the cursor forward past an older one', async () => {
    seed([cached('1700000000000005')], 1500000000000000);
    const { client } = makeClient(true);
    const p = getHistoryPage(client, ROOM, 20, { id: 'a' });
    client.trigger('stanza', fin('a', { first: '1700000000000000', last: '1700000000000009' }));
    await p;
    expect(cursorNow()).toBe(1500000000000000);
  });

  it('an older page (before set) moves the cursor back', async () => {
    seed([cached('1700000000000005')], 1700000000000000);
    const { client } = makeClient(true);
    const p = getHistoryPage(client, ROOM, 20, { before: 1700000000000000, id: 'b' });
    client.trigger('stanza', fin('b', { first: '1600000000000000', last: '1699999999999999' }));
    await p;
    expect(cursorNow()).toBe(1600000000000000);
  });

  it('an older page never moves the cursor forward', async () => {
    seed([cached('1700000000000005')], 1600000000000000);
    const { client } = makeClient(true);
    const p = getHistoryPage(client, ROOM, 20, { before: 1700000000000000, id: 'b2' });
    client.trigger('stanza', fin('b2', { first: '1650000000000000', last: '1699999999999999' }));
    await p;
    expect(cursorNow()).toBe(1600000000000000);
  });

  it('a latest page for a room with no messages sets the cursor from the page', async () => {
    seed([], 1500000000000000);
    const { client } = makeClient(true);
    const p = getHistoryPage(client, ROOM, 20, { id: 'c' });
    client.trigger('stanza', fin('c', { first: '1700000000000000', last: '1700000000000009' }));
    await p;
    expect(cursorNow()).toBe(1700000000000000);
    expect(room().messageStats?.lastMessageTimestamp).toBe(1700000000000009);
  });

  it('writes historyComplete from the fin of an older page', async () => {
    seed([cached('1700000000000005')], 1700000000000000);
    const { client } = makeClient(true);
    const p = getHistoryPage(client, ROOM, 20, { before: 1700000000000000, id: 'd' });
    client.trigger('stanza', fin('d', { complete: 'true', first: '1600000000000000', last: '1699999999999999' }));
    await p;
    expect(room().historyComplete).toBe(true);
  });

  it('an older page keeps the known last-message bound', async () => {
    seed([cached('1700000000000005')], 1700000000000000);
    const { client } = makeClient(true);
    const p = getHistoryPage(client, ROOM, 20, { before: 1700000000000000, id: 'e' });
    client.trigger('stanza', fin('e', { first: '1600000000000000', last: '1699999999999999' }));
    await p;
    expect(room().messageStats?.lastMessageTimestamp).toBe(9e15);
  });

  it('a latest page that is not complete leaves a known historyComplete alone', async () => {
    seed([cached('1700000000000005')], 1500000000000000);
    store.dispatch(updateRoom({ jid: ROOM, updates: { historyComplete: true } }));
    const { client } = makeClient(true);
    const p = getHistoryPage(client, ROOM, 20, { id: 'f' });
    client.trigger('stanza', fin('f', { complete: 'false', first: '1700000000000000', last: '1700000000000009' }));
    await p;
    expect(room().historyComplete).toBe(true);
  });

  it('a full latest page that starts after everything cached restarts the cursor at the page', async () => {
    seed([cached('1700000000000005')], 1500000000000000);
    const { client } = makeClient(true);
    const p = getHistoryPage(client, ROOM, 2, { id: 'g' });
    client.trigger('stanza', row('g', '1800000000000001', 'n1'));
    client.trigger('stanza', row('g', '1800000000000002', 'n2'));
    client.trigger('stanza', fin('g', { first: '1800000000000001', last: '1800000000000002' }));
    await p;
    expect(cursorNow()).toBe(1800000000000001);
    expect(room().historyComplete).toBe(false);
  });

  it('a failed or timed-out page writes nothing', async () => {
    seed([cached('1700000000000005')], 1500000000000000);
    const { client } = makeClient(true);
    const p = getHistoryPage(client, ROOM, 20, { id: 'h' });
    client.trigger('stanza', parse(`<iq type="error" id="h"/>`));
    await p;
    expect(cursorNow()).toBe(1500000000000000);
  });
});

describe('windowed query isolation', () => {
  it('a window page never changes messages, messageStats or historyComplete', async () => {
    seed([cached('1700000000000005')], 1500000000000000);
    const before = JSON.stringify(room());
    const { client } = makeClient();
    const p = getHistoryPage(client, ROOM, 20, { after: 1700000000000005 });
    const id = sentIqId(client);
    client.trigger('stanza', row(id, '1700000000000006', 'window row'));
    // The global handler sees the same wire traffic.
    await onMessageHistory(row(id, '1700000000000006', 'window row'));
    client.trigger('stanza', fin(id, { complete: 'true', first: '1700000000000006', last: '1700000000000006' }));
    const page = await p;
    expect(page.ok).toBe(true);
    expect(page.messages.map((m) => m.body)).toEqual(['window row']);
    expect(JSON.stringify(room())).toBe(before);
  });

  it('the global handler still merges a normal page row into the live list', async () => {
    seed();
    await onMessageHistory(row('get-history:1:1', '1700000000000006', 'live row'));
    expect(room().messages.map((m: any) => m.body)).toEqual(['live row']);
  });

  it('a time-filtered page is isolated too', async () => {
    seed([cached('1700000000000005')], 1500000000000000);
    const before = JSON.stringify(room());
    const { client } = makeClient();
    const p = getHistoryPage(client, ROOM, 20, { start: '2026-06-01T10:00:00.000Z' });
    const id = sentIqId(client);
    await onMessageHistory(row(id, '1700000000000007', 'time row'));
    client.trigger('stanza', fin(id, { complete: 'false', first: '1700000000000007', last: '1700000000000007' }));
    await p;
    expect(JSON.stringify(room())).toBe(before);
  });

  function sentIqId(client: any) {
    return client.send.mock.calls[client.send.mock.calls.length - 1][0].attrs.id;
  }
});

describe('reactions', () => {
  beforeEach(() => seed());

  it('merges a reaction onto its in-page target and leaves the stanza out of the messages', async () => {
    const { client } = makeClient();
    const p = fetchHistoryPage(client, ROOM, 20, { id: 'r1' });
    client.trigger('stanza', row('r1', '1700000000000001', 'target'));
    client.trigger('stanza', reactionRow('r1', '1700000000000002', '1700000000000001', ['👍']));
    client.trigger('stanza', fin('r1', { first: '1700000000000001', last: '1700000000000002' }));
    const page = await p;
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0].reaction?.[REACTOR]?.emoji).toEqual(['👍']);
  });

  it('replays a reaction whose target is outside the page with meta.fromHistory', async () => {
    const spy = jest.spyOn(store, 'dispatch');
    const { client } = makeClient();
    const p = fetchHistoryPage(client, ROOM, 20, { id: 'r2' });
    client.trigger('stanza', reactionRow('r2', '1700000000000002', '1699999999999999', ['🔥']));
    client.trigger('stanza', fin('r2', { first: '1700000000000002', last: '1700000000000002' }));
    await p;
    const call = spy.mock.calls
      .map((c) => c[0] as any)
      .find((a) => a.type === 'roomMessages/setReactions');
    expect(call.meta).toEqual({ fromHistory: true });
    expect(call.payload).toMatchObject({ roomJID: ROOM, messageId: '1699999999999999', reactions: ['🔥'] });
    spy.mockRestore();
  });

  it('one failing reaction dispatch does not fail the page', async () => {
    const real = store.dispatch;
    const spy = jest.spyOn(store, 'dispatch').mockImplementation(((a: any) => {
      if (a?.type === 'roomMessages/setReactions') throw new Error('boom');
      return real(a);
    }) as any);
    const { client } = makeClient();
    const p = fetchHistoryPage(client, ROOM, 20, { id: 'r3' });
    client.trigger('stanza', row('r3', '1700000000000001', 'kept'));
    client.trigger('stanza', reactionRow('r3', '1700000000000002', 'absent', ['👍']));
    client.trigger('stanza', fin('r3', { first: '1700000000000001', last: '1700000000000002' }));
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const page = await p;
    logSpy.mockRestore();
    spy.mockRestore();
    expect(page.ok).toBe(true);
    expect(page.messages.map((m) => m.body)).toEqual(['kept']);
  });

  it('an archived reaction applies to the stored message without touching the preview', async () => {
    seed([{ id: '1700000000000001', body: 'target', date: new Date().toISOString(), roomJid: ROOM, user: { id: 'u', name: 'u' } } as any]);
    store.dispatch(updateRoom({ jid: ROOM, updates: { lastMessageTimestamp: 123, lastMessage: { body: 'keep me' } as any } }));
    await onMessageHistory(reactionRow('get-history:9:9', '1700000000000002', '1700000000000001', ['👍']));
    const msg = room().messages.find((m: any) => m.id === '1700000000000001') as any;
    expect(msg.reaction?.[REACTOR]?.emoji).toEqual(['👍']);
    expect((room().lastMessage as any)?.body).toBe('keep me');
    expect(room().lastMessageTimestamp).toBe(123);
  });

  it('an archived reaction survives an empty room and a malformed stanza', async () => {
    seed();
    await expect(
      onMessageHistory(reactionRow('x', '1700000000000002', 'nope', []))
    ).resolves.not.toThrow();
    await expect(onMessageHistory(parse('<message><result/></message>'))).resolves.not.toThrow();
  });

  it('a routed page replays a reaction whose target is outside it with meta.fromHistory', async () => {
    seed([cached('1700000000000005')], 1500000000000000);
    const spy = jest.spyOn(store, 'dispatch');
    const { client } = makeClient(true);
    const p = getHistoryPage(client, ROOM, 20, { id: 'rr' });
    client.trigger('stanza', reactionRow('rr', '1700000000000009', '1700000000000005', ['👍']));
    client.trigger('stanza', fin('rr', { first: '1700000000000009', last: '1700000000000009' }));
    await p;
    const call = spy.mock.calls
      .map((c) => c[0] as any)
      .find((a) => a.type === 'roomMessages/setReactions');
    spy.mockRestore();
    expect(call.meta).toEqual({ fromHistory: true });
    expect(call.payload).toMatchObject({ roomJID: ROOM, messageId: '1700000000000005' });
  });

  it('the reactions of a windowed query are ignored by the global handler', async () => {
    seed([{ id: '1700000000000001', body: 'target', date: new Date().toISOString(), roomJid: ROOM, user: { id: 'u', name: 'u' } } as any]);
    await onMessageHistory(reactionRow('window:1:1', '1700000000000002', '1700000000000001', ['👍']));
    const msg = room().messages.find((m: any) => m.id === '1700000000000001') as any;
    expect(msg.reaction).toBeUndefined();
  });
});

describe('getHistory compatibility', () => {
  beforeEach(() => seed());

  it('still returns IMessage[] and [] on timeout/error, undefined for a non-string jid', async () => {
    const { client } = makeClient(true);
    // @ts-expect-error non-string on purpose
    expect(await getHistory(client, null, 10)).toBeUndefined();
    const p = getHistory(client, ROOM, 10, undefined, 'k');
    client.trigger('stanza', row('k', '1700000000000001', 'hi'));
    client.trigger('stanza', fin('k', { first: '1700000000000001', last: '1700000000000001' }));
    const msgs = await p;
    expect(msgs).toHaveLength(1);
    expect(msgs![0].body).toBe('hi');

    const p2 = getHistory(client, ROOM, 10, undefined, 'k2');
    client.trigger('stanza', parse(`<iq type="error" id="k2"/>`));
    expect(await p2).toEqual([]);
  });

  it('two requests in the same millisecond get distinct default ids', () => {
    const { client, send } = makeClient();
    void getHistory(client, ROOM, 10);
    void getHistory(client, ROOM, 10);
    const ids = send.mock.calls.map((c: any) => c[0].attrs.id);
    expect(new Set(ids).size).toBe(2);
  });
});
