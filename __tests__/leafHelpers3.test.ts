/**
 * Third leaf-helper bundle.
 *
 *   - createRoomFromApi    — REST room → IRoom mapper
 *   - ensureScopedChatCache — purge persisted state on app-scope change
 *   - initRoomsPresence    — fan-out presenceInRoom + push-subscribe
 *   - XmppListenerManager  — registry + de-dup of XMPP event listeners
 */

import { createRoomFromApi } from '../src/helpers/createRoomFromApi';
import { XmppListenerManager } from '../src/networking/xmpp/listenerManager';

// ---- createRoomFromApi ---------------------------------------------

describe('createRoomFromApi', () => {
  const baseApiRoom: any = {
    name: 'r1',
    title: 'Room 1',
    members: [{ _id: 'u1' }, { _id: 'u2' }],
    picture: 'http://img/r1.png',
  };

  it('builds an IRoom with jid = `<name>@<service>`, title fallback to name, default service', () => {
    const out = createRoomFromApi(baseApiRoom);
    expect(out?.jid).toBe('r1@conference.dev.xmpp.ethoradev.com');
    expect(out?.title).toBe('Room 1');
    expect(out?.name).toBe('Room 1');
    expect(out?.usersCnt).toBe(2);
    expect(out?.messages).toEqual([]);
    expect(out?.isLoading).toBe(false);
    expect(out?.unreadMessages).toBe(0);
    expect(out?.lastViewedTimestamp).toBe(0);
    expect(out?.icon).toBe('http://img/r1.png');
  });

  it('uses the supplied service argument when given', () => {
    const out = createRoomFromApi(baseApiRoom, 'conference.my.host');
    expect(out?.jid).toBe('r1@conference.my.host');
  });

  it('falls back to usersArrayLength + 1 when members is absent', () => {
    const { members, ...noMembers } = baseApiRoom;
    const out = createRoomFromApi(noMembers, undefined, 4);
    expect(out?.usersCnt).toBe(5);
  });

  it('drops the icon when picture === "none"', () => {
    const out = createRoomFromApi({ ...baseApiRoom, picture: 'none' });
    expect(out?.icon).toBeNull();
  });

  it('returns null on input that throws during spread (defensive)', () => {
    // Pass a Proxy that throws on any property access — getters throw,
    // spread throws, caught by the try/catch.
    const throwingProxy: any = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('boom');
        },
      }
    );
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const out = createRoomFromApi(throwingProxy);
    expect(out).toBeNull();
    logSpy.mockRestore();
  });
});

// ---- XmppListenerManager -------------------------------------------

describe('XmppListenerManager', () => {
  const makeFakeClient = () => ({
    _on: new Map<string, Set<(s: any) => void>>(),
    on: jest.fn(function (this: any, event: string, fn: any) {
      if (!this._on.has(event)) {this._on.set(event, new Set());}
      this._on.get(event).add(fn);
    }),
    off: jest.fn(function (this: any, event: string, fn: any) {
      this._on.get(event)?.delete(fn);
    }),
  });

  afterEach(() => {
    XmppListenerManager.clearAllListeners();
  });

  it('addListener registers the handler against the client', () => {
    const client: any = makeFakeClient();
    const handler = jest.fn();
    XmppListenerManager.addListener(client, 'stanza', 'key-1', handler);
    expect(client.on).toHaveBeenCalledWith('stanza', handler);
    expect(XmppListenerManager.getActiveListenerCount()).toBe(1);
  });

  it('addListener with the same key removes the previous handler before adding the new one (de-dup)', () => {
    const client: any = makeFakeClient();
    const first = jest.fn();
    const second = jest.fn();
    XmppListenerManager.addListener(client, 'stanza', 'shared', first);
    XmppListenerManager.addListener(client, 'stanza', 'shared', second);
    expect(client.off).toHaveBeenCalledWith('stanza', first);
    expect(XmppListenerManager.getActiveListenerCount()).toBe(1);
  });

  it('removeListener returns true when the key was registered, false otherwise', () => {
    const client: any = makeFakeClient();
    const handler = jest.fn();
    XmppListenerManager.addListener(client, 'stanza', 'rk', handler);
    expect(XmppListenerManager.removeListener('rk')).toBe(true);
    expect(XmppListenerManager.removeListener('rk')).toBe(false);
    expect(client.off).toHaveBeenCalledWith('stanza', handler);
  });

  it('removeAllListenersForClient drops every listener for the given client only', () => {
    const a: any = makeFakeClient();
    const b: any = makeFakeClient();
    XmppListenerManager.addListener(a, 'stanza', 'a-1', jest.fn());
    XmppListenerManager.addListener(a, 'stanza', 'a-2', jest.fn());
    XmppListenerManager.addListener(b, 'stanza', 'b-1', jest.fn());

    XmppListenerManager.removeAllListenersForClient(a);
    expect(XmppListenerManager.getActiveListenerCount()).toBe(1);
    // The remaining listener is the one for `b`.
    const info = XmppListenerManager.getActiveListenersInfo();
    expect(info[0].key).toBe('b-1');
  });

  it('getListenerKey composes operation + identifier', () => {
    expect(XmppListenerManager.getListenerKey('history', 'r@h')).toBe(
      'history-r@h'
    );
  });

  it('clearAllListeners empties the registry', () => {
    const client: any = makeFakeClient();
    XmppListenerManager.addListener(client, 'stanza', 'k1', jest.fn());
    XmppListenerManager.addListener(client, 'stanza', 'k2', jest.fn());
    XmppListenerManager.clearAllListeners();
    expect(XmppListenerManager.getActiveListenerCount()).toBe(0);
  });

  it('getActiveListenersInfo exposes key + eventType + non-negative age', () => {
    const client: any = makeFakeClient();
    XmppListenerManager.addListener(client, 'stanza', 'kx', jest.fn());
    const info = XmppListenerManager.getActiveListenersInfo();
    expect(info).toHaveLength(1);
    expect(info[0].key).toBe('kx');
    expect(info[0].eventType).toBe('stanza');
    expect(info[0].age).toBeGreaterThanOrEqual(0);
  });
});
