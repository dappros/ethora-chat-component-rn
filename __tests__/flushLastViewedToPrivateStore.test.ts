jest.mock('../src/networking/xmpp/getChatsPrivateStoreRequest.xmpp', () => ({
  getChatsPrivateStoreRequest: jest.fn(),
}));

jest.mock('../src/networking/xmpp/setChatsPrivateStoreRequest.xmpp', () => ({
  setChatsPrivateStoreRequest: jest.fn(),
}));

import { flushLastViewedToPrivateStore } from '../src/networking/xmpp/flushLastViewedToPrivateStore';
import { getChatsPrivateStoreRequest } from '../src/networking/xmpp/getChatsPrivateStoreRequest.xmpp';
import { setChatsPrivateStoreRequest } from '../src/networking/xmpp/setChatsPrivateStoreRequest.xmpp';

// Server-assigned id shape: 13-digit ms prefix, as read by msgSortableMs.
const serverMsg = (tsMs: number, id = `${tsMs}-abc`) => ({
  id,
  user: { id: 'u', name: 'user' },
  date: new Date(tsMs).toISOString(),
  body: 'hi',
  roomJid: 'room@conf',
});

describe('flushLastViewedToPrivateStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes the newest server-acknowledged message timestamp for the visible room, never the device clock', async () => {
    // If this ever regressed to Date.now(), the assertion below would
    // still pass by coincidence unless the device clock disagreed with
    // the message timestamp - so pin Date.now() far away from the real
    // message time to prove the write did NOT come from the clock.
    jest.spyOn(Date, 'now').mockReturnValue(9_999_999_999_999);
    (getChatsPrivateStoreRequest as jest.Mock).mockResolvedValue({ existing: '100' });
    (setChatsPrivateStoreRequest as jest.Mock).mockResolvedValue(true);

    const ok = await flushLastViewedToPrivateStore(
      { client: { send: jest.fn() } },
      {
        'room@conf': {
          jid: 'room@conf',
          lastViewedTimestamp: 0,
          unreadMessages: 0,
          messages: [serverMsg(1_700_000_000_000), serverMsg(1_700_000_050_000)],
        },
      },
      { visibleRoomJID: 'room@conf' }
    );

    expect(ok).toBe(true);
    expect(setChatsPrivateStoreRequest).toHaveBeenCalledWith(
      { send: expect.any(Function) },
      JSON.stringify({
        existing: '100',
        'room@conf': '1700000050000',
      })
    );
    (Date.now as jest.MockedFunction<typeof Date.now>).mockRestore();
  });

  it('skips the visible room entirely when it has no messages and no boundary (no device-clock fallback)', async () => {
    (getChatsPrivateStoreRequest as jest.Mock).mockResolvedValue({});
    (setChatsPrivateStoreRequest as jest.Mock).mockResolvedValue(true);

    const ok = await flushLastViewedToPrivateStore(
      { client: { send: jest.fn() } },
      {
        'room@conf': {
          jid: 'room@conf',
          lastViewedTimestamp: 0,
          unreadMessages: 0,
          messages: [],
        },
      },
      { visibleRoomJID: 'room@conf' }
    );

    expect(ok).toBe(false);
    expect(setChatsPrivateStoreRequest).not.toHaveBeenCalled();
  });

  it('excludes a pending optimistic message from the visible-room write', async () => {
    (getChatsPrivateStoreRequest as jest.Mock).mockResolvedValue({});
    (setChatsPrivateStoreRequest as jest.Mock).mockResolvedValue(true);

    const ok = await flushLastViewedToPrivateStore(
      { client: { send: jest.fn() } },
      {
        'room@conf': {
          jid: 'room@conf',
          lastViewedTimestamp: 0,
          unreadMessages: 0,
          messages: [
            serverMsg(1_700_000_000_000),
            {
              id: 'send-text-message-9999999999999-1',
              user: { id: 'u', name: 'user' },
              date: new Date(9_999_999_999_999).toISOString(),
              body: 'sending...',
              roomJid: 'room@conf',
              pending: true,
            },
          ],
        },
      },
      { visibleRoomJID: 'room@conf' }
    );

    expect(ok).toBe(true);
    expect(setChatsPrivateStoreRequest).toHaveBeenCalledWith(
      { send: expect.any(Function) },
      JSON.stringify({ 'room@conf': '1700000000000' })
    );
  });

  it('respects an explicit visibleRoomTs boundary over the newest message', async () => {
    (getChatsPrivateStoreRequest as jest.Mock).mockResolvedValue({});
    (setChatsPrivateStoreRequest as jest.Mock).mockResolvedValue(true);

    const ok = await flushLastViewedToPrivateStore(
      { client: { send: jest.fn() } },
      {
        'room@conf': {
          jid: 'room@conf',
          lastViewedTimestamp: 0,
          unreadMessages: 3,
          messages: [serverMsg(1_700_000_000_000), serverMsg(1_700_000_050_000)],
        },
      },
      { visibleRoomJID: 'room@conf', visibleRoomTs: 1_700_000_010_000 }
    );

    expect(ok).toBe(true);
    expect(setChatsPrivateStoreRequest).toHaveBeenCalledWith(
      { send: expect.any(Function) },
      JSON.stringify({ 'room@conf': '1700000010000' })
    );
  });

  it('overwrites a corrupt future stored marker with the correct value (bug #38 self-heal)', async () => {
    // A previous session's device clock ran ahead and stamped a marker
    // far past any real message this room has AND far past real time -
    // normally the forward-only guard (`prevNum >= ts`) would reject
    // every later correct write forever. It must be treated as corrupt
    // instead. Anchored to Date.now() on purpose: a marker that is
    // merely bigger than the local messages but still in the PAST is a
    // stale local cache, not a broken clock, and must NOT be healed.
    (getChatsPrivateStoreRequest as jest.Mock).mockResolvedValue({
      'room@conf': String(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });
    (setChatsPrivateStoreRequest as jest.Mock).mockResolvedValue(true);

    const ok = await flushLastViewedToPrivateStore(
      { client: { send: jest.fn() } },
      {
        'room@conf': {
          jid: 'room@conf',
          lastViewedTimestamp: 0,
          unreadMessages: 0,
          messages: [serverMsg(1_700_000_000_000)],
        },
      },
      { visibleRoomJID: 'room@conf' }
    );

    expect(ok).toBe(true);
    expect(setChatsPrivateStoreRequest).toHaveBeenCalledWith(
      { send: expect.any(Function) },
      JSON.stringify({ 'room@conf': '1700000000000' })
    );
  });

  it('does not "heal" a legitimate newer marker just because THIS device\'s cache is stale', async () => {
    // Multi-device: device A read up to an hour past anything this
    // device has locally (its history for the room hasn't synced yet).
    // That marker is in the PAST, so it is a real read, not a broken
    // clock - the forward-only guard must still protect it, otherwise
    // every stale device drags the shared marker backwards and
    // resurrects already-read messages for everyone.
    const anHourAgo = Date.now() - 60 * 60 * 1000;
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    (getChatsPrivateStoreRequest as jest.Mock).mockResolvedValue({
      'room@conf': String(anHourAgo),
    });

    const ok = await flushLastViewedToPrivateStore(
      { client: { send: jest.fn() } },
      {
        'room@conf': {
          jid: 'room@conf',
          lastViewedTimestamp: 0,
          unreadMessages: 0,
          messages: [serverMsg(twoHoursAgo)],
        },
      },
      { visibleRoomJID: 'room@conf' }
    );

    expect(ok).toBe(false);
    expect(setChatsPrivateStoreRequest).not.toHaveBeenCalled();
  });

  it('keeps forward-only protection for a sane stored marker (does not regress a real read)', async () => {
    (getChatsPrivateStoreRequest as jest.Mock).mockResolvedValue({
      'room@conf': '1700000050000',
    });

    const ok = await flushLastViewedToPrivateStore(
      { client: { send: jest.fn() } },
      {
        'room@conf': {
          jid: 'room@conf',
          lastViewedTimestamp: 0,
          unreadMessages: 0,
          // Newest known message is OLDER than the sane stored marker
          // (e.g. the user already read further, on another device) -
          // must NOT be treated as corrupt and must NOT be overwritten.
          messages: [serverMsg(1_700_000_000_000)],
        },
      },
      { visibleRoomJID: 'room@conf' }
    );

    expect(ok).toBe(false);
    expect(setChatsPrivateStoreRequest).not.toHaveBeenCalled();
  });

  it('writes a non-visible room using its existing lastViewedTimestamp', async () => {
    (getChatsPrivateStoreRequest as jest.Mock).mockResolvedValue({});
    (setChatsPrivateStoreRequest as jest.Mock).mockResolvedValue(true);

    const ok = await flushLastViewedToPrivateStore(
      { client: { send: jest.fn() } },
      {
        'other@conf': {
          jid: 'other@conf',
          lastViewedTimestamp: 1_700_000_000_000,
          unreadMessages: 0,
        },
      },
      {}
    );

    expect(ok).toBe(true);
    expect(setChatsPrivateStoreRequest).toHaveBeenCalledWith(
      { send: expect.any(Function) },
      JSON.stringify({ 'other@conf': '1700000000000' })
    );
  });
});
