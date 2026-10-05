/**
 * History requests always settle and release their in-flight keys; the
 * watchdog frees a stuck slot and re-asks once; windowed pages are returned
 * without being stored.
 */
jest.mock('@xmpp/client', () => {
  const xml = jest.fn();
  const client = jest.fn(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    off: jest.fn(),
    send: jest.fn().mockResolvedValue(undefined),
    status: 'offline',
  }));
  return { __esModule: true, default: { client, xml }, client, xml };
});

jest.mock('../src/networking/xmpp/getHistory.xmpp', () => ({
  getHistory: jest.fn(),
  getHistoryPage: jest.fn(),
  fetchHistoryPage: jest.fn(),
}));

import XmppClient, { HISTORY_WATCHDOG_MS } from '../src/networking/xmppClient';
import {
  fetchHistoryPage,
  getHistory,
  getHistoryPage,
} from '../src/networking/xmpp/getHistory.xmpp';

const mockedGetHistory = getHistory as jest.Mock;
const mockedFetch = fetchHistoryPage as jest.Mock;
const mockedPage = getHistoryPage as jest.Mock;

const ROOM = 'room1@conference.example.com';
const msg = (id: string) => ({ id, body: id }) as any;

const makeClient = (qos: Record<string, unknown> = {}) =>
  new XmppClient('u', 'p', {
    devServer: 'host',
    historyQoS: { maxInFlightHistory: 2, ...qos },
  } as any) as any;

describe('history requests always settle and release their keys', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedGetHistory.mockReset();
    mockedFetch.mockReset();
    mockedPage.mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('keys are released when the task throws, and the caller still settles', async () => {
    const c = makeClient();
    mockedGetHistory.mockRejectedValue(new Error('boom'));
    const p = c.enqueueHistoryTask({ chatJID: ROOM, max: 15, source: 'active' });
    await expect(p).resolves.toBeUndefined();
    expect(c.mamInFlightByRoom.size).toBe(0);
  });

  it('keys are released after a normal answer and the watchdog timer is cleared', async () => {
    const c = makeClient();
    mockedGetHistory.mockResolvedValue([msg('1')]);
    await expect(
      c.enqueueHistoryTask({ chatJID: ROOM, max: 15, source: 'active' })
    ).resolves.toHaveLength(1);
    expect(c.mamInFlightByRoom.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('watchdog: a read that never returns frees the slot and is re-asked once', async () => {
    const c = makeClient();
    mockedGetHistory
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce([msg('2')]);
    const p = c.enqueueHistoryTask({ chatJID: ROOM, max: 15, source: 'active' });
    expect(c.mamInFlightByRoom.size).toBe(1);
    await jest.advanceTimersByTimeAsync(HISTORY_WATCHDOG_MS + 1);
    await expect(p).resolves.toHaveLength(1);
    expect(mockedGetHistory).toHaveBeenCalledTimes(2);
    expect(c.mamInFlightByRoom.size).toBe(0);
  });

  it('watchdog: the re-issue happens once, then the request settles empty', async () => {
    const c = makeClient();
    mockedGetHistory.mockImplementation(() => new Promise(() => {}));
    const p = c.enqueueHistoryTask({ chatJID: ROOM, max: 15, source: 'active' });
    await jest.advanceTimersByTimeAsync(HISTORY_WATCHDOG_MS + 1);
    expect(mockedGetHistory).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(HISTORY_WATCHDOG_MS + 1);
    await expect(p).resolves.toBeUndefined();
    expect(mockedGetHistory).toHaveBeenCalledTimes(2);
    expect(c.mamInFlightByRoom.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('watchdog: a background request is released but not re-asked', async () => {
    const c = makeClient();
    mockedGetHistory.mockImplementation(() => new Promise(() => {}));
    const p = c.enqueueHistoryTask({ chatJID: ROOM, max: 15, source: 'background' });
    await jest.advanceTimersByTimeAsync(HISTORY_WATCHDOG_MS + 1);
    await expect(p).resolves.toBeUndefined();
    expect(mockedGetHistory).toHaveBeenCalledTimes(1);
    expect(c.mamInFlightByRoom.size).toBe(0);
  });

  it('a request stuck behind the gate is aborted without ever being sent', async () => {
    const c = makeClient({ maxInFlightHistory: 1, alwaysPrioritizeActiveRoom: false });
    // One hung request fills the only slot.
    mockedGetHistory.mockImplementation(() => new Promise(() => {}));
    void c.enqueueHistoryTask({ chatJID: 'other@conference.example.com', max: 5, source: 'active' });
    const waiting = c.enqueueHistoryTask({ chatJID: ROOM, max: 5, source: 'background' });
    await jest.advanceTimersByTimeAsync(HISTORY_WATCHDOG_MS + 1);
    await expect(waiting).resolves.toBeUndefined();
    // The hung one was released by its own watchdog as well.
    expect(mockedGetHistory.mock.calls.filter((a) => a[1] === ROOM)).toHaveLength(0);
  });

  it('a stale read finishing after its watchdog abort does not wipe the newer entry', async () => {
    const c = makeClient();
    let finishOld!: (v: any) => void;
    mockedGetHistory
      .mockImplementationOnce(() => new Promise((r) => (finishOld = r)))
      .mockImplementationOnce(() => new Promise(() => {}));
    const p = c.enqueueHistoryTask({ chatJID: ROOM, max: 15, source: 'active' });
    await jest.advanceTimersByTimeAsync(HISTORY_WATCHDOG_MS + 1);
    // The re-issue is now the entry in flight.
    expect(c.mamInFlightByRoom.size).toBe(1);
    finishOld([msg('late')]);
    await jest.advanceTimersByTimeAsync(10);
    expect(c.mamInFlightByRoom.size).toBe(1);
    await jest.advanceTimersByTimeAsync(HISTORY_WATCHDOG_MS + 1);
    await p;
    expect(c.mamInFlightByRoom.size).toBe(0);
  });

  it('coalesces the same page but not a different one', async () => {
    const c = makeClient();
    const finishers: ((v: any) => void)[] = [];
    mockedGetHistory.mockImplementation(
      () => new Promise((r) => finishers.push(r))
    );
    const a = c.enqueueHistoryTask({ chatJID: ROOM, max: 20, source: 'active' });
    const same = c.enqueueHistoryTask({ chatJID: ROOM, max: 20, source: 'active' });
    expect(mockedGetHistory).toHaveBeenCalledTimes(1);
    const older = c.enqueueHistoryTask({
      chatJID: ROOM,
      max: 20,
      before: 1700000000000000,
      source: 'active',
    });
    expect(mockedGetHistory).toHaveBeenCalledTimes(2);
    finishers.forEach((f) => f([msg('x')]));
    await jest.advanceTimersByTimeAsync(5);
    await Promise.all([a, same, older]);
  });

  it('a one-message teaser in flight is not reused for an opened room full page', async () => {
    const c = makeClient();
    mockedGetHistory.mockImplementation(() => new Promise(() => {}));
    void c.enqueueHistoryTask({ chatJID: ROOM, max: 1, source: 'background' });
    void c.enqueueHistoryTask({ chatJID: ROOM, max: 30, source: 'active' });
    expect(mockedGetHistory).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(HISTORY_WATCHDOG_MS * 3);
  });

  it('getHistoryStanza without coalesceRoom keeps delegating to getHistory unchanged', async () => {
    const c = makeClient();
    mockedGetHistory.mockResolvedValue([msg('1')]);
    await c.getHistoryStanza(ROOM, 10, 1700000000000000, 'mid');
    expect(mockedGetHistory).toHaveBeenCalledWith(c.client, ROOM, 10, 1700000000000000, 'mid');
  });
});

describe('getHistoryPage / getHistoryWindow on the client', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedPage.mockReset();
  });

  it('getHistoryPage passes the cursor through and never throws', async () => {
    const c = makeClient();
    mockedPage.mockResolvedValueOnce({ ok: true, messages: [], complete: true, first: 1, last: 2 });
    await expect(c.getHistoryPage(ROOM, 20, { before: 5 })).resolves.toMatchObject({ ok: true, complete: true });
    expect(mockedPage).toHaveBeenCalledWith(c.client, ROOM, 20, { before: 5 });
    mockedPage.mockRejectedValueOnce(new Error('x'));
    await expect(c.getHistoryPage(ROOM, 20)).resolves.toMatchObject({ ok: false, messages: [] });
  });

  it('getHistoryWindow fails fast while offline', async () => {
    const c = makeClient();
    c.status = 'offline';
    await expect(c.getHistoryWindow(ROOM, 10, { before: 5 })).resolves.toEqual({
      ok: false,
      messages: [],
      complete: false,
      first: null,
      last: null,
    });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('getHistoryWindow returns the page without storing, as a window query', async () => {
    const c = makeClient();
    c.status = 'online';
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      finSeen: true,
      messages: [msg('1'), msg('2')],
      complete: false,
      first: 10,
      last: 20,
      count: 99,
      received: 2,
      roomJid: ROOM,
    });
    const page = await c.getHistoryWindow(ROOM, 10, { after: 5 });
    expect(page).toEqual({
      ok: true,
      messages: [msg('1'), msg('2')],
      complete: false,
      first: 10,
      last: 20,
    });
    expect(mockedFetch).toHaveBeenCalledWith(c.client, ROOM, 10, { after: 5, window: true });
    expect(mockedPage).not.toHaveBeenCalled();
  });

  it('getHistoryWindow is not ok when the answer carried no fin or failed', async () => {
    const c = makeClient();
    c.status = 'online';
    mockedFetch.mockResolvedValueOnce({ ok: true, finSeen: false, messages: [msg('1')], complete: false, first: null, last: null });
    await expect(c.getHistoryWindow(ROOM, 10, { before: 5 })).resolves.toMatchObject({ ok: false, messages: [] });
    mockedFetch.mockRejectedValueOnce(new Error('x'));
    await expect(c.getHistoryWindow(ROOM, 10, { before: 5 })).resolves.toMatchObject({ ok: false });
  });
});
