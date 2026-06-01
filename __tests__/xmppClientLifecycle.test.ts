/**
 * XmppClient — lifecycle + reconnect + status state machine.
 *
 * Complements `xmppClientQoS.test.ts` (which covers the active-room
 * boost / soft-pause / MAM coalescing surface). This file pins the
 * connection state machine and the small delegating stanza helpers:
 *
 *   - constructor back-compat: 3rd arg as string vs object
 *   - default QoS knobs when no `historyQoS` is supplied
 *   - initial status `connecting`, then `online` / `offline` / `error`
 *     driven by the underlying @xmpp/client event emitter
 *   - `attachEventListeners` wires the four expected events
 *   - `waitForOnline` immediate / polling / error / timeout paths
 *   - `scheduleReconnect` exponential backoff, max attempts cap, and
 *     `suppressReconnect` short-circuit
 *   - `reconnect` stops the current client and re-initializes
 *   - `disconnect({suppressReconnect})` sets the flag + delegates to
 *     close; `close` swallows stop() errors and parks status=offline
 *   - thin delegating helpers (sendMessage / getRoomsStanza / etc.)
 *     forward the right args to the underlying *.xmpp.ts helpers
 *   - stubs that warn + no-op or fall back (setVCardStanza,
 *     sendMessageReactionStanza, sendTextMessageWithTranslateTagStanza)
 */

// ---- @xmpp/client fake ----------------------------------------------
// Captures the registered listeners and exposes them as `triggerEvent`
// so tests can synthesize 'online' / 'disconnect' / 'error' / 'stanza'
// events. Also tracks start/stop call counts + an array of every
// FakeClient instance the constructor created (for reconnect tests).

interface FakeXmppClient {
  status: 'offline' | 'connecting' | 'online' | 'error';
  start: jest.Mock;
  stop: jest.Mock;
  on: jest.Mock;
  off: jest.Mock;
  send: jest.Mock;
  _listeners: Record<string, Array<(arg: any) => void>>;
  triggerEvent: (name: string, payload?: any) => void;
}

const fakeClientInstances: FakeXmppClient[] = [];

jest.mock('@xmpp/client', () => {
  const xml = jest.fn();
  const client = jest.fn(() => {
    const listeners: Record<string, Array<(arg: any) => void>> = {};
    const inst: FakeXmppClient = {
      status: 'offline',
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      on: jest.fn((event: string, fn: (arg: any) => void) => {
        (listeners[event] = listeners[event] || []).push(fn);
      }),
      off: jest.fn(),
      send: jest.fn().mockResolvedValue(undefined),
      _listeners: listeners,
      triggerEvent: (name, payload) => {
        (listeners[name] || []).forEach((fn) => fn(payload));
      },
    };
    fakeClientInstances.push(inst);
    return inst;
  });
  return { __esModule: true, default: { client, xml }, client, xml };
});

// ---- stanza-helper module mocks --------------------------------------
// Each xmppClient method we're checking delegates to a helper in
// src/networking/xmpp/*.xmpp.ts — stub them so we can assert args.

jest.mock('../src/networking/xmpp/getRooms.xmpp', () => ({
  getRooms: jest.fn(async () => undefined),
}));
jest.mock('../src/networking/xmpp/sendTextMessage.xmpp', () => ({
  sendTextMessage: jest.fn(),
}));
jest.mock('../src/networking/xmpp/getHistory.xmpp', () => ({
  getHistory: jest.fn(async () => []),
}));
jest.mock('../src/networking/xmpp/createRoom.xmpp', () => ({
  createRoom: jest.fn(async () => 'created'),
}));
jest.mock('../src/networking/xmpp/leaveTheRoom.xmpp', () => ({
  leaveTheRoom: jest.fn(),
}));
jest.mock('../src/networking/xmpp/presenceInRoom.xmpp', () => ({
  presenceInRoom: jest.fn(),
}));
jest.mock('../src/networking/xmpp/deleteMessage.xmpp', () => ({
  deleteMessage: jest.fn(),
}));
jest.mock('../src/networking/xmpp/editMessage.xmpp', () => ({
  editMessage: jest.fn(),
}));
jest.mock('../src/networking/xmpp/sendTypingRequest.xmpp', () => ({
  sendTypingRequest: jest.fn(),
}));
jest.mock('../src/networking/xmpp/getChatsPrivateStoreRequest.xmpp', () => ({
  getChatsPrivateStoreRequest: jest.fn(async () => 'cps'),
}));
jest.mock('../src/networking/xmpp/actionSetTimestampToPrivateStore.xmpp', () => ({
  actionSetTimestampToPrivateStore: jest.fn(async () => undefined),
}));
jest.mock('../src/networking/xmpp/sendMediaMessage.xmpp', () => ({
  sendMediaMessage: jest.fn(() => 'media-id'),
}));
jest.mock('../src/networking/xmpp/handleStanzas.xmpp', () => ({
  handleStanza: jest.fn(),
}));
jest.mock('../src/networking/xmpp/getLastMessageArchive.xmpp', () => ({
  getLastMessage: jest.fn(),
}));
jest.mock('../src/networking/xmpp/setRoomImage.xmpp', () => ({
  setRoomImage: jest.fn(),
}));
jest.mock('../src/networking/xmpp/getRoomInfo.xmpp', () => ({
  getRoomInfo: jest.fn(),
}));
jest.mock('../src/networking/xmpp/getRoomMembers.xmpp', () => ({
  getRoomMembers: jest.fn(),
}));
jest.mock('../src/networking/xmpp/inviteRoomRequest.xmpp', () => ({
  inviteRoomRequest: jest.fn(),
}));

import XmppClient from '../src/networking/xmppClient';
import { getRooms } from '../src/networking/xmpp/getRooms.xmpp';
import { sendTextMessage } from '../src/networking/xmpp/sendTextMessage.xmpp';
import { getHistory } from '../src/networking/xmpp/getHistory.xmpp';
import { createRoom } from '../src/networking/xmpp/createRoom.xmpp';
import { presenceInRoom } from '../src/networking/xmpp/presenceInRoom.xmpp';
import { deleteMessage } from '../src/networking/xmpp/deleteMessage.xmpp';
import { editMessage } from '../src/networking/xmpp/editMessage.xmpp';
import { getChatsPrivateStoreRequest } from '../src/networking/xmpp/getChatsPrivateStoreRequest.xmpp';
import { actionSetTimestampToPrivateStore } from '../src/networking/xmpp/actionSetTimestampToPrivateStore.xmpp';
import { sendMediaMessage } from '../src/networking/xmpp/sendMediaMessage.xmpp';
import { handleStanza } from '../src/networking/xmpp/handleStanzas.xmpp';
import { clearOutboundSends } from '../src/networking/outboundQueue';

beforeEach(() => {
  fakeClientInstances.length = 0;
  jest.clearAllMocks();
  jest.useRealTimers();
  // The outbound queue is module-global; clear it so a buffered send from
  // one test can't replay into another's 'online' flush.
  clearOutboundSends();
});

// Helper: latest FakeClient instance the SUT created.
const last = () => fakeClientInstances[fakeClientInstances.length - 1];

// ---- constructor + status transitions -------------------------------

describe('XmppClient — constructor + status', () => {
  it('back-compat: a string 3rd arg becomes xmppSettings.devServer', () => {
    const c = new XmppClient('u', 'p', 'host.test' as any);
    expect(c.xmppSettings).toEqual({ devServer: 'host.test' });
    expect(c.devServer).toBe('host.test');
  });

  it('uses xmppSettings.devServer / host / conference when provided', () => {
    const c = new XmppClient('u', 'p', {
      devServer: 'host.test',
      host: 'h.test',
      conference: 'conf.test',
    } as any);
    expect(c.service).toBe('wss://host.test/ws');
    expect(c.host).toBe('h.test');
    expect(c.conference).toBe('conf.test');
  });

  it('falls back to the canonical default xmpp.chat.ethora.com', () => {
    const c = new XmppClient('u', 'p');
    expect(c.service).toBe('wss://xmpp.chat.ethora.com/ws');
    expect(c.host).toBe('xmpp.chat.ethora.com');
    expect(c.conference).toBe('conference.xmpp.chat.ethora.com');
  });

  it('applies QoS defaults when no historyQoS is supplied', () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    // Default maxInFlightHistory=3 → gate is open with 0 in-flight.
    expect(c.isActiveRoomGateOpen()).toBe(true);
    // disableLastRead defaults to false → the private-store path is
    // NOT short-circuited.
    expect(c.disableLastRead).toBe(false);
  });

  it('initial status is `connecting` and the underlying client.start is called', () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    expect(c.status).toBe('connecting');
    expect(last().start).toHaveBeenCalled();
  });

  it('flips status to `error` if client.start() rejects', async () => {
    const xmpp = require('@xmpp/client').default;
    // Override the next client to reject on start.
    xmpp.client.mockImplementationOnce(() => {
      const inst: any = {
        status: 'offline',
        start: jest.fn().mockRejectedValue(new Error('boom')),
        stop: jest.fn(),
        on: jest.fn(),
        off: jest.fn(),
        send: jest.fn(),
      };
      fakeClientInstances.push(inst);
      return inst;
    });
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    // Let the start() rejection microtask flush.
    await new Promise((r) => setTimeout(r, 5));
    expect(c.status).toBe('error');
  });
});

// ---- event listener wiring ------------------------------------------

describe('XmppClient — event listener wiring', () => {
  it('attaches listeners for online / disconnect / error / stanza', () => {
    new XmppClient('u', 'p', { devServer: 'h' });
    const events = last().on.mock.calls.map((c) => c[0]);
    expect(events).toEqual(
      expect.arrayContaining(['online', 'disconnect', 'error', 'stanza'])
    );
  });

  it('online event flips status to `online` and resets reconnectAttempts', () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    c.reconnectAttempts = 4;
    last().triggerEvent('online');
    expect(c.status).toBe('online');
    expect(c.reconnectAttempts).toBe(0);
  });

  it('disconnect event flips status to `offline`', () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    // Force to online first so the transition is observable.
    last().triggerEvent('online');
    last().triggerEvent('disconnect');
    expect(c.status).toBe('offline');
  });

  it('stanza event invokes handleStanza with the stanza', () => {
    new XmppClient('u', 'p', { devServer: 'h' });
    const stanza = { name: 'message', attrs: { id: 'x' } };
    last().triggerEvent('stanza', stanza);
    expect(handleStanza).toHaveBeenCalled();
  });

  it('checkOnline reflects the underlying client.status', () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    last().status = 'online';
    expect(c.checkOnline()).toBe(true);
    last().status = 'offline';
    expect(c.checkOnline()).toBe(false);
  });
});

// ---- waitForOnline / ensureConnected --------------------------------

describe('XmppClient — waitForOnline / ensureConnected', () => {
  it('resolves immediately when status is already `online`', async () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    c.status = 'online';
    await expect(c.waitForOnline()).resolves.toBeUndefined();
  });

  it('polls and resolves once status transitions to `online`', async () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    const p = c.waitForOnline();
    setTimeout(() => last().triggerEvent('online'), 50);
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects when status becomes `error`', async () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    const p = c.waitForOnline();
    setTimeout(() => {
      c.status = 'error';
    }, 50);
    await expect(p).rejects.toThrow('XMPP client error');
  });

  it('rejects on timeout', async () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    // Keep status at "connecting" so the polling never resolves.
    await expect(c.waitForOnline(100)).rejects.toThrow('XMPP connect timeout');
  });

  it('ensureConnected delegates to waitForOnline', async () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    c.status = 'online';
    await expect(c.ensureConnected()).resolves.toBeUndefined();
  });
});

// ---- reconnect ------------------------------------------------------

describe('XmppClient — reconnect', () => {
  it('scheduleReconnect uses exponential backoff and runs reconnect()', () => {
    jest.useFakeTimers();
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    const reconnectSpy = jest.spyOn(c, 'reconnect').mockImplementation(() => {});

    c.scheduleReconnect();
    // attempts=1, delay=2000 * 2^0 = 2000
    expect(c.reconnectAttempts).toBe(1);
    jest.advanceTimersByTime(1999);
    expect(reconnectSpy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(reconnectSpy).toHaveBeenCalledTimes(1);

    c.scheduleReconnect();
    // attempts=2, delay=2000 * 2^1 = 4000
    expect(c.reconnectAttempts).toBe(2);
    jest.advanceTimersByTime(4000);
    expect(reconnectSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps retrying past maxReconnectAttempts with the delay clamped (no permanent give-up)', () => {
    jest.useFakeTimers();
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    const reconnectSpy = jest.spyOn(c, 'reconnect').mockImplementation(() => {});
    // At the old hard cap scheduleReconnect used to bail and log "Max
    // reconnect attempts reached". Now it keeps going so a long outage
    // still recovers without a NetInfo/foreground kick.
    c.reconnectAttempts = c.maxReconnectAttempts;
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    c.scheduleReconnect();
    expect(c.reconnectAttempts).toBe(c.maxReconnectAttempts + 1);
    expect(errSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Max reconnect attempts reached')
    );
    // Delay is clamped to maxReconnectDelay instead of growing unbounded.
    jest.advanceTimersByTime(c.maxReconnectDelay - 1);
    expect(reconnectSpy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(reconnectSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it('suppressReconnect short-circuits scheduleReconnect', () => {
    jest.useFakeTimers();
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    c.suppressReconnect = true;
    const reconnectSpy = jest.spyOn(c, 'reconnect').mockImplementation(() => {});
    c.scheduleReconnect();
    jest.advanceTimersByTime(60_000);
    expect(c.reconnectAttempts).toBe(0);
    expect(reconnectSpy).not.toHaveBeenCalled();
  });

  it('forceReconnect debounces bursty triggers (NetInfo + AppState + watchdog)', () => {
    jest.useRealTimers();
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    const reconnectSpy = jest.spyOn(c, 'reconnect').mockImplementation(() => {});
    c.forceReconnect();
    c.forceReconnect(); // within the 2s debounce window → ignored
    c.forceReconnect();
    expect(reconnectSpy).toHaveBeenCalledTimes(1);
  });

  it('forceReconnect short-circuits when suppressReconnect=true', () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    c.suppressReconnect = true;
    const reconnectSpy = jest.spyOn(c, 'reconnect').mockImplementation(() => {});
    c.forceReconnect();
    expect(reconnectSpy).not.toHaveBeenCalled();
  });

  it('reconnect() short-circuits when suppressReconnect=true', () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    c.suppressReconnect = true;
    const before = fakeClientInstances.length;
    c.reconnect();
    // No new client instantiated.
    expect(fakeClientInstances.length).toBe(before);
  });

  it('reconnect() stops the current client and re-initialises a new one', async () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    const initialClient = last();
    c.reconnect();
    expect(initialClient.stop).toHaveBeenCalled();
    // Let the stop() promise's `.finally` fire.
    await new Promise((r) => setTimeout(r, 5));
    expect(fakeClientInstances.length).toBe(2);
    expect(last()).not.toBe(initialClient);
  });
});

// ---- credentialsProvider (JWT refresh on not-authorized) ------------

describe('XmppClient — credentialsProvider', () => {
  it('reconnect() calls credentialsProvider when lastAuthError=not-authorized and swaps creds', async () => {
    const c = new XmppClient('old-user', 'old-pass', { devServer: 'h' });
    const provider = jest
      .fn()
      .mockResolvedValue({ username: 'new-user', password: 'new-pass' });
    c.setCredentialsProvider(provider);
    c.lastAuthError = 'not-authorized';

    await c.reconnect();
    // Drain the stop().finally microtask before asserting on creds.
    await new Promise((r) => setTimeout(r, 5));

    expect(provider).toHaveBeenCalledTimes(1);
    expect(c.username).toBe('new-user');
    expect(c.password).toBe('new-pass');
    expect(c.lastAuthError).toBeNull();
  });

  it('reconnect() does NOT call credentialsProvider when there was no auth error', async () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    const provider = jest.fn();
    c.setCredentialsProvider(provider);
    // lastAuthError stays null (e.g. a transient network blip).

    await c.reconnect();
    await new Promise((r) => setTimeout(r, 5));
    expect(provider).not.toHaveBeenCalled();
  });

  it('reconnect() swallows credentialsProvider errors and still attempts to reconnect with cached creds', async () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    c.setCredentialsProvider(() => Promise.reject(new Error('refresh-fail')));
    c.lastAuthError = 'not-authorized';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await c.reconnect();
    await new Promise((r) => setTimeout(r, 5));

    // Still attempted a fresh client.
    expect(fakeClientInstances.length).toBeGreaterThan(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('credential refresh failed'),
      expect.any(Error)
    );
    warnSpy.mockRestore();
  });

  it('concurrent reconnect() calls share a single in-flight credentialsProvider call', async () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    let resolveFn: ((v: any) => void) | undefined;
    const provider = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        })
    );
    c.setCredentialsProvider(provider);
    c.lastAuthError = 'not-authorized';

    const p1 = c.reconnect();
    const p2 = c.reconnect();
    expect(provider).toHaveBeenCalledTimes(1);
    resolveFn!({ username: 'fresh', password: 'fresh-pw' });
    await Promise.all([p1, p2]);
    await new Promise((r) => setTimeout(r, 5));

    expect(c.password).toBe('fresh-pw');
  });
});

// ---- disconnect / close ---------------------------------------------

describe('XmppClient — disconnect / close', () => {
  it('disconnect({suppressReconnect}) sets the flag and parks status=offline', async () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    last().triggerEvent('online');
    await c.disconnect({ suppressReconnect: true });
    expect(c.suppressReconnect).toBe(true);
    expect(c.status).toBe('offline');
    expect(last().stop).toHaveBeenCalled();
  });

  it('close swallows a stop() rejection and still parks status=offline', async () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    last().stop.mockRejectedValueOnce(new Error('stop-failed'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await c.close();
    expect(c.status).toBe('offline');
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error closing the xmpp client'),
      expect.any(Error)
    );
    errSpy.mockRestore();
  });
});

// ---- delegating stanza helpers --------------------------------------

describe('XmppClient — delegating stanza helpers', () => {
  it('getRoomsStanza calls getRooms(client)', async () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    await c.getRoomsStanza();
    expect(getRooms).toHaveBeenCalledWith(last());
  });

  it('sendMessage forwards args + appends devServer + customId to sendTextMessage', () => {
    const c = new XmppClient('u', 'p', { devServer: 'h.test' });
    // Stream must be online or sendMessage buffers instead of forwarding.
    last().triggerEvent('online');
    c.sendMessage(
      'r@h',
      'Alice',
      'Anderson',
      '',
      '0xabc',
      'hi',
      '',
      false,
      false,
      '',
      'send-id-1'
    );
    expect(sendTextMessage).toHaveBeenCalledWith(
      last(),
      'r@h',
      'Alice',
      'Anderson',
      '',
      '0xabc',
      'hi',
      '',
      false,
      false,
      '',
      'h.test',
      'send-id-1'
    );
  });

  it('sendMediaMessageStanza returns whatever the helper returns + forwards devServer', () => {
    const c = new XmppClient('u', 'p', { devServer: 'h.test' });
    last().triggerEvent('online');
    const out = c.sendMediaMessageStanza('r@h', { foo: 'bar' }, 'media-id-1');
    expect(out).toBe('media-id');
    expect(sendMediaMessage).toHaveBeenCalledWith(
      last(),
      'r@h',
      { foo: 'bar' },
      'media-id-1',
      'h.test'
    );
  });

  it('createRoomStanza / presenceInRoomStanza / deleteMessageStanza / editMessageStanza delegate', async () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    // createRoomStanza's 3rd `to?` arg is vestigial (web parity keeps the
    // param but the createRoom helper only takes title/desc/client).
    await c.createRoomStanza('title', 'desc', 'to@h');
    expect(createRoom).toHaveBeenCalledWith('title', 'desc', last());

    c.presenceInRoomStanza('r@h');
    expect(presenceInRoom).toHaveBeenCalledWith(last(), 'r@h');

    c.deleteMessageStanza('r@h', 'm1');
    expect(deleteMessage).toHaveBeenCalledWith(last(), 'r@h', 'm1');

    c.editMessageStanza('r@h', 'm1', 'new body');
    expect(editMessage).toHaveBeenCalledWith(last(), 'r@h', 'm1', 'new body');
  });

  it('getHistoryStanza without coalesceRoom delegates directly to getHistory', async () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    await c.getHistoryStanza('r@h', 10, 1700000000000, 'mid');
    expect(getHistory).toHaveBeenCalledWith(
      last(),
      'r@h',
      10,
      1700000000000,
      'mid'
    );
  });

  it('getChatsPrivateStoreRequestStanza short-circuits to null when disableLastRead=true', async () => {
    const c = new XmppClient('u', 'p', {
      devServer: 'h',
      disableLastRead: true,
    } as any);
    const out = await c.getChatsPrivateStoreRequestStanza();
    expect(out).toBeNull();
    expect(getChatsPrivateStoreRequest).not.toHaveBeenCalled();
  });

  it('getChatsPrivateStoreRequestStanza returns null and logs when the helper throws', async () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    (getChatsPrivateStoreRequest as jest.Mock).mockRejectedValueOnce(
      new Error('boom')
    );
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const out = await c.getChatsPrivateStoreRequestStanza();
    expect(out).toBeNull();
    expect(logSpy).toHaveBeenCalledWith(expect.any(Error));
    logSpy.mockRestore();
  });

  it('actionSetTimestampToPrivateStoreStanza short-circuits when disableLastRead=true', async () => {
    const c = new XmppClient('u', 'p', {
      devServer: 'h',
      disableLastRead: true,
    } as any);
    await c.actionSetTimestampToPrivateStoreStanza('r@h', 123);
    expect(actionSetTimestampToPrivateStore).not.toHaveBeenCalled();
  });
});

// ---- stubs that warn or fall back -----------------------------------

describe('XmppClient — not-implemented stubs', () => {
  it('setVCardStanza warns and no-ops', () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    c.setVCardStanza('0xabc');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('setVCardStanza: not implemented')
    );
    warn.mockRestore();
  });

  it('sendMessageReactionStanza warns and no-ops', () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    c.sendMessageReactionStanza('m1', 'r@h', ['🎉']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('sendMessageReactionStanza: not implemented')
    );
    warn.mockRestore();
  });

  it('sendTextMessageWithTranslateTagStanza falls back to sendMessage', () => {
    const c = new XmppClient('u', 'p', { devServer: 'h' });
    last().triggerEvent('online');
    c.sendTextMessageWithTranslateTagStanza(
      'r@h',
      'Alice',
      'A',
      '',
      '0xabc',
      'hi',
      '',
      false,
      false,
      '',
      'en'
    );
    // The translate path delegates to sendMessage, which itself routes
    // through the mocked sendTextMessage. Final call should include the
    // devServer string.
    expect(sendTextMessage).toHaveBeenCalled();
    const args = (sendTextMessage as jest.Mock).mock.calls[0];
    expect(args[1]).toBe('r@h');
    expect(args[6]).toBe('hi');
  });
});
