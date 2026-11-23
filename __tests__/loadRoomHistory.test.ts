import {
  loadInitialRoomHistory,
  loadRoomHistory,
  resolveHistoryBefore,
} from '../src/helpers/loadRoomHistory';

const ROOM = 'room@conference.example.com';
const msg = (id: string) => ({ id, body: id }) as any;
const room = (over: Record<string, unknown> = {}) =>
  ({ jid: ROOM, messages: [], ...over }) as any;

describe('resolveHistoryBefore', () => {
  it('uses the explicit anchor when given', () => {
    expect(resolveHistoryBefore(room(), 42)).toBe(42);
  });

  it('prefers the server cursor when it is older than the oldest numeric id', () => {
    const r = room({
      messages: [msg('500'), msg('600')],
      messageStats: { firstMessageTimestamp: 300 },
    });
    expect(resolveHistoryBefore(r)).toBe(300);
  });

  it('uses the oldest numeric id when it is older than the cursor', () => {
    const r = room({
      messages: [msg('delimiter-new'), msg('500'), msg('send-text-1'), msg('600')],
      messageStats: { firstMessageTimestamp: 900 },
    });
    expect(resolveHistoryBefore(r)).toBe(500);
  });

  it('is undefined when nothing carries an archive id', () => {
    expect(resolveHistoryBefore(room({ messages: [msg('delimiter-new')] }))).toBeUndefined();
    expect(resolveHistoryBefore(undefined)).toBeUndefined();
  });
});

describe('loadRoomHistory', () => {
  const makeClient = () => ({ getHistoryStanza: jest.fn().mockResolvedValue([]) });

  it('does nothing for a complete room, an unknown room or no client', async () => {
    const client = makeClient();
    const inFlight = new Set<string>();
    await loadRoomHistory({ client, room: room({ historyComplete: true }), inFlight, chatJID: ROOM, max: 50 });
    await loadRoomHistory({ client, room: undefined, inFlight, chatJID: ROOM, max: 50 });
    await loadRoomHistory({ client: null, room: room(), inFlight, chatJID: ROOM, max: 50 });
    expect(client.getHistoryStanza).not.toHaveBeenCalled();
  });

  it('requests with the given cursor and the active source', async () => {
    const client = makeClient();
    await loadRoomHistory({
      client,
      room: room(),
      inFlight: new Set(),
      chatJID: ROOM,
      max: 100,
      before: 777,
    });
    expect(client.getHistoryStanza).toHaveBeenCalledWith(ROOM, 100, 777, undefined, {
      source: 'active',
    });
  });

  it('does not overlap requests for the same room, and frees it afterwards', async () => {
    let release!: () => void;
    const client = {
      getHistoryStanza: jest.fn(
        () => new Promise<void>((resolve) => { release = resolve; })
      ),
    };
    const inFlight = new Set<string>();
    const busy: boolean[] = [];
    const first = loadRoomHistory({
      client, room: room(), inFlight, chatJID: ROOM, max: 50, before: 1,
      onBusyChange: (b) => busy.push(b),
    });
    await loadRoomHistory({ client, room: room(), inFlight, chatJID: ROOM, max: 50, before: 1 });
    expect(client.getHistoryStanza).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(busy).toEqual([true, false]);
    expect(inFlight.size).toBe(0);
  });

  it('settles on error and frees the room for the next request', async () => {
    const client = { getHistoryStanza: jest.fn().mockRejectedValue(new Error('timeout')) };
    const inFlight = new Set<string>();
    await expect(
      loadRoomHistory({ client, room: room(), inFlight, chatJID: ROOM, max: 50, before: 1 })
    ).resolves.toBeUndefined();
    expect(inFlight.has(ROOM)).toBe(false);
  });

  it('falls back to the cursor, not to a list position, when no anchor is given', async () => {
    const client = makeClient();
    await loadRoomHistory({
      client,
      room: room({
        // A page of receipts: the list still ends in the same two messages.
        messages: [msg('900'), msg('950')],
        messageStats: { firstMessageTimestamp: 400 },
      }),
      inFlight: new Set(),
      chatJID: ROOM,
      max: 50,
    });
    expect(client.getHistoryStanza.mock.calls[0][2]).toBe(400);
  });
});

describe('loadInitialRoomHistory', () => {
  // An archive page as the client reports it: `received` rows, of which
  // `messages` are messages (the rest receipts, markers, reactions).
  const page = (over: Record<string, unknown> = {}) => ({
    ok: true,
    messages: [] as any[],
    complete: false,
    first: null as number | null,
    last: null as number | null,
    count: null,
    received: 0,
    finSeen: true,
    roomJid: ROOM,
    ...over,
  });
  const receiptsOnly = (first: number, received = 100) => page({ first, received });

  it('reads one page when it brings a message', async () => {
    const client = {
      getHistoryPage: jest.fn().mockResolvedValueOnce(
        page({ messages: [msg('900')], first: 800, received: 30 })
      ),
    };
    const res = await loadInitialRoomHistory(client, ROOM, 30);
    expect(client.getHistoryPage).toHaveBeenCalledTimes(1);
    expect(client.getHistoryPage).toHaveBeenCalledWith(ROOM, 30);
    expect(res.map((m) => m.id)).toEqual(['900']);
  });

  it('pages back past pages of receipts only until one brings a message', async () => {
    const client = {
      getHistoryPage: jest
        .fn()
        .mockResolvedValueOnce(receiptsOnly(700, 30))
        .mockResolvedValueOnce(receiptsOnly(600))
        .mockResolvedValueOnce(page({ messages: [msg('550')], first: 500, received: 100 })),
    };
    const res = await loadInitialRoomHistory(client, ROOM, 30);
    expect(client.getHistoryPage.mock.calls).toEqual([
      [ROOM, 30],
      [ROOM, 100, { before: 700 }],
      [ROOM, 100, { before: 600 }],
    ]);
    expect(res.map((m) => m.id)).toEqual(['550']);
  });

  it('stops at the start of the archive', async () => {
    const client = {
      getHistoryPage: jest
        .fn()
        .mockResolvedValueOnce(receiptsOnly(700, 30))
        .mockResolvedValueOnce(page({ first: 650, received: 12, complete: true })),
    };
    const res = await loadInitialRoomHistory(client, ROOM, 30);
    expect(client.getHistoryPage).toHaveBeenCalledTimes(2);
    expect(res).toEqual([]);
  });

  it('stops on a failed page or an empty archive', async () => {
    const failed = { getHistoryPage: jest.fn().mockResolvedValue(page({ ok: false, finSeen: false })) };
    await loadInitialRoomHistory(failed, ROOM, 30);
    expect(failed.getHistoryPage).toHaveBeenCalledTimes(1);

    const empty = { getHistoryPage: jest.fn().mockResolvedValue(page({ received: 0 })) };
    await loadInitialRoomHistory(empty, ROOM, 30);
    expect(empty.getHistoryPage).toHaveBeenCalledTimes(1);
  });

  it('gives up after the page cap', async () => {
    let first = 10_000;
    const client = {
      getHistoryPage: jest.fn().mockImplementation(async () => receiptsOnly((first -= 100))),
    };
    const res = await loadInitialRoomHistory(client, ROOM, 30, { maxSkipPages: 3 });
    expect(client.getHistoryPage).toHaveBeenCalledTimes(4);
    expect(res).toEqual([]);
  });
});
