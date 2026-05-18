/**
 * initRoomsPresence + subscribeToRoomMessages.
 *
 * Both helpers join the user to all known rooms after the XMPP client
 * comes online — initRoomsPresence sends `<presence>` per room and
 * registers each for push, subscribeToRoomMessages sends a MUC-sub
 * subscription stanza and resolves on the matching IQ result.
 */

jest.mock('../src/services/pushSubscriptionService', () => ({
  pushSubscriptionService: {
    subscribeToRooms: jest.fn(async () => undefined),
  },
}));

jest.mock('../src/networking/xmpp/presenceInRoom.xmpp', () => ({
  presenceInRoom: jest.fn(async () => undefined),
}));

import { initRoomsPresence } from '../src/helpers/initRoomsPresence';
import { presenceInRoom } from '../src/networking/xmpp/presenceInRoom.xmpp';
import { pushSubscriptionService } from '../src/services/pushSubscriptionService';
import { subscribeToRoomMessages } from '../src/networking/xmpp/subscribeToRoomMessages.xmpp';

function makeXmppClientWrapper() {
  const listeners: Record<string, ((arg: any) => void)[]> = {};
  const send = jest.fn(async () => undefined);
  const inner: any = {
    send,
    on: jest.fn((event: string, fn: any) => {
      (listeners[event] = listeners[event] || []).push(fn);
    }),
    off: jest.fn((event: string, fn: any) => {
      listeners[event] = (listeners[event] || []).filter((l) => l !== fn);
    }),
    jid: {
      toString: () => '0xabc@xmpp.test/web',
      getLocal: () => '0xabc',
    },
    trigger: (event: string, payload: any) =>
      (listeners[event] || []).slice().forEach((fn) => fn(payload)),
  };
  return { wrapper: { client: inner } as any, inner, send };
}

beforeEach(() => {
  (presenceInRoom as jest.Mock).mockClear();
  (pushSubscriptionService.subscribeToRooms as jest.Mock).mockClear();
});

// ---- initRoomsPresence ----------------------------------------------

describe('initRoomsPresence', () => {
  it('returns null when there is no client', async () => {
    const result = await initRoomsPresence(null as any, {} as any);
    expect(result).toBeNull();
    expect(presenceInRoom).not.toHaveBeenCalled();
  });

  it('returns null when the rooms map is empty', async () => {
    const { wrapper } = makeXmppClientWrapper();
    const result = await initRoomsPresence(wrapper, {});
    expect(result).toBeNull();
    expect(presenceInRoom).not.toHaveBeenCalled();
  });

  it('sends presenceInRoom for every room jid and subscribes them to push', async () => {
    const { wrapper, inner } = makeXmppClientWrapper();
    await initRoomsPresence(wrapper, {
      'a@h': {} as any,
      'b@h': {} as any,
    });
    expect(presenceInRoom).toHaveBeenCalledTimes(2);
    expect(presenceInRoom).toHaveBeenCalledWith(inner, 'a@h');
    expect(presenceInRoom).toHaveBeenCalledWith(inner, 'b@h');
    expect(pushSubscriptionService.subscribeToRooms).toHaveBeenCalledWith(
      inner,
      ['a@h', 'b@h'],
      '0xabc'
    );
  });

  it('swallows individual presenceInRoom rejections and still subscribes', async () => {
    (presenceInRoom as jest.Mock)
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce(undefined);
    const { wrapper } = makeXmppClientWrapper();
    await initRoomsPresence(wrapper, {
      'a@h': {} as any,
      'b@h': {} as any,
    });
    expect(pushSubscriptionService.subscribeToRooms).toHaveBeenCalledTimes(1);
  });

  it('logs but does not throw when subscribeToRooms rejects', async () => {
    (pushSubscriptionService.subscribeToRooms as jest.Mock).mockRejectedValueOnce(
      new Error('push failed')
    );
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { wrapper } = makeXmppClientWrapper();
    await expect(
      initRoomsPresence(wrapper, { 'a@h': {} as any })
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(
      'Failed to subscribe to rooms for push:',
      expect.any(Error)
    );
    errSpy.mockRestore();
  });
});

// ---- subscribeToRoomMessages ----------------------------------------

describe('subscribeToRoomMessages', () => {
  it('sends an MUC-sub iq and resolves true on matching `result`', async () => {
    const { inner } = makeXmppClientWrapper();
    jest.useFakeTimers();
    const p = subscribeToRoomMessages(inner, 'r@h', 'me');
    const stanza = inner.send.mock.calls[0][0];
    expect(stanza.name).toBe('iq');
    expect(stanza.attrs.type).toBe('set');
    expect(stanza.attrs.to).toBe('r@h');
    expect(stanza.attrs.id).toMatch(/^newSubscription:\d+$/);
    const sub = stanza.getChild('subscribe');
    expect(sub?.attrs?.xmlns).toBe('urn:xmpp:mucsub:0');
    expect(sub?.attrs?.nick).toBe('me');

    // Simulate the server response.
    inner.trigger('stanza', {
      is: (n: string) => n === 'iq',
      attrs: { id: stanza.attrs.id, type: 'result' },
    });
    // finish() defers by 500ms.
    jest.advanceTimersByTime(500);
    await expect(p).resolves.toBe(true);
    jest.useRealTimers();
  });

  it('resolves false on matching `error`', async () => {
    const { inner } = makeXmppClientWrapper();
    jest.useFakeTimers();
    const p = subscribeToRoomMessages(inner, 'r@h');
    const stanza = inner.send.mock.calls[0][0];
    inner.trigger('stanza', {
      is: (n: string) => n === 'iq',
      attrs: { id: stanza.attrs.id, type: 'error' },
    });
    jest.advanceTimersByTime(500);
    await expect(p).resolves.toBe(false);
    jest.useRealTimers();
  });

  it('falls back to client.jid.getLocal() for the nick when no userNick is passed', async () => {
    const { inner } = makeXmppClientWrapper();
    jest.useFakeTimers();
    const p = subscribeToRoomMessages(inner, 'r@h');
    const stanza = inner.send.mock.calls[0][0];
    expect(stanza.getChild('subscribe').attrs.nick).toBe('0xabc');
    inner.trigger('stanza', {
      is: (n: string) => n === 'iq',
      attrs: { id: stanza.attrs.id, type: 'result' },
    });
    jest.advanceTimersByTime(500);
    await p;
    jest.useRealTimers();
  });

  it('rejects when client.send throws synchronously', async () => {
    const { inner } = makeXmppClientWrapper();
    inner.send.mockImplementationOnce(() => {
      throw new Error('send boom');
    });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(subscribeToRoomMessages(inner, 'r@h')).rejects.toThrow(
      'send boom'
    );
    errSpy.mockRestore();
  });
});
