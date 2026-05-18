/**
 * updateMessagesTillLast — backfill loop that walks history page by
 * page until the cached lastMessageTimestamp is found (or the retry
 * cap is hit), then dispatches setRoomMessages with the accumulated
 * batch.
 *
 * The source was previously broken at import time (referenced
 * `getLastMessageTimestamp` + `insertUsers` that don't exist in
 * roomsSlice). Round-11 fixed both — these tests pin the cluster D
 * behaviour the helper provides.
 */

jest.mock('../src/helpers/checkUniqueUsers', () => ({
  checkUniqueUsers: jest.fn(async () => undefined),
}));

jest.mock('../src/roomStore', () => {
  const { configureStore } = require('@reduxjs/toolkit');
  const roomsReducer = require('../src/roomStore/roomsSlice').default;
  const chatSettingsReducer =
    require('../src/roomStore/chatSettingsSlice').default;
  const store = configureStore({
    reducer: {
      chatSettingStore: chatSettingsReducer,
      rooms: roomsReducer,
    },
  });
  return { __esModule: true, store };
});

import { updateMessagesTillLast } from '../src/helpers/updateMessagesTillLast';
import { store as sharedStore } from '../src/roomStore';
import { addRoom, setRoomMessages } from '../src/roomStore/roomsSlice';
import type { IMessage } from '../src/types/types';
import { checkUniqueUsers } from '../src/helpers/checkUniqueUsers';

function makeRoom(jid: string, overrides: any = {}) {
  return {
    id: jid,
    name: jid.split('@')[0],
    jid,
    title: jid,
    usersCnt: 0,
    messages: [],
    isLoading: false,
    roomBg: '',
    lastViewedTimestamp: 0,
    unreadMessages: 0,
    ...overrides,
  };
}

function makeMsg(id: string): IMessage {
  return {
    id,
    user: { id: 'u', name: 'u' } as any,
    date: '2026-05-15T00:00:00Z',
    body: id,
    roomJid: 'r@h',
  };
}

function makeClient(overrides: any = {}) {
  return {
    getHistoryStanza: jest.fn(async () => []),
    ...overrides,
  } as any;
}

beforeEach(() => {
  (checkUniqueUsers as jest.Mock).mockReset();
  (checkUniqueUsers as jest.Mock).mockResolvedValue(undefined);
  sharedStore.dispatch({ type: 'roomMessages/setLogoutState' });
});

describe('updateMessagesTillLast', () => {
  it('is a no-op when the rooms map is empty', async () => {
    const client = makeClient();
    await updateMessagesTillLast({}, client);
    expect(client.getHistoryStanza).not.toHaveBeenCalled();
  });

  it('skips rooms with no cached lastMessageTimestamp', async () => {
    sharedStore.dispatch(
      addRoom({
        roomData: makeRoom('a@h', { lastMessageTimestamp: 0 }) as any,
      })
    );
    const client = makeClient();
    await updateMessagesTillLast(
      { 'a@h': makeRoom('a@h') as any },
      client
    );
    expect(client.getHistoryStanza).not.toHaveBeenCalled();
  });

  it('stops fetching once a message matching the cached lastMessageTimestamp appears', async () => {
    const TARGET_TS = 1700000000000;
    sharedStore.dispatch(
      addRoom({
        roomData: makeRoom('a@h', { lastMessageTimestamp: TARGET_TS }) as any,
      })
    );
    const client = makeClient({
      getHistoryStanza: jest
        .fn()
        .mockResolvedValueOnce([
          makeMsg(String(TARGET_TS)),
          makeMsg('1700000001000'),
        ]),
    });
    await updateMessagesTillLast(
      { 'a@h': makeRoom('a@h') as any },
      client,
      1
    );
    expect(client.getHistoryStanza).toHaveBeenCalledTimes(1);
  });

  it('retries up to maxFetchAttempts then dispatches setRoomMessages with the accumulated batch', async () => {
    const TARGET_TS = 9999999999999;
    sharedStore.dispatch(
      addRoom({
        roomData: makeRoom('a@h', { lastMessageTimestamp: TARGET_TS }) as any,
      })
    );
    const client = makeClient({
      // 4 pages, none containing TARGET_TS.
      getHistoryStanza: jest
        .fn()
        .mockResolvedValueOnce([makeMsg('1')])
        .mockResolvedValueOnce([makeMsg('2')])
        .mockResolvedValueOnce([makeMsg('3')])
        .mockResolvedValueOnce([makeMsg('4')]),
    });

    const dispatchSpy = jest.spyOn(sharedStore, 'dispatch');

    await updateMessagesTillLast(
      { 'a@h': makeRoom('a@h') as any },
      client,
      1,
      4,
      1
    );
    expect(client.getHistoryStanza).toHaveBeenCalledTimes(4);
    // The setRoomMessages dispatch happens once retries exhaust.
    const setRoomCall = dispatchSpy.mock.calls.find(
      ([action]) => (action as any)?.type === 'roomMessages/setRoomMessages'
    );
    expect(setRoomCall).toBeDefined();
    expect((setRoomCall![0] as any).payload.roomJID).toBe('a@h');
    expect((setRoomCall![0] as any).payload.messages).toHaveLength(4);

    // checkUniqueUsers was called on the final batch.
    expect(checkUniqueUsers).toHaveBeenCalled();
    dispatchSpy.mockRestore();
  });

  it('breaks out of the retry loop early when getHistoryStanza returns []', async () => {
    sharedStore.dispatch(
      addRoom({
        roomData: makeRoom('a@h', { lastMessageTimestamp: 1700 }) as any,
      })
    );
    const client = makeClient({
      getHistoryStanza: jest
        .fn()
        .mockResolvedValueOnce([makeMsg('1')])
        .mockResolvedValueOnce([]),
    });
    await updateMessagesTillLast(
      { 'a@h': makeRoom('a@h') as any },
      client,
      1
    );
    expect(client.getHistoryStanza).toHaveBeenCalledTimes(2);
  });

  it('processes rooms in batches of `batchSize`', async () => {
    const ts = 1700000000000;
    ['a@h', 'b@h', 'c@h'].forEach((jid) =>
      sharedStore.dispatch(
        addRoom({
          roomData: makeRoom(jid, { lastMessageTimestamp: ts }) as any,
        })
      )
    );
    const client = makeClient({
      // Each room gets a single page with the matching message.
      getHistoryStanza: jest.fn(async () => [makeMsg(String(ts))]),
    });
    await updateMessagesTillLast(
      {
        'a@h': makeRoom('a@h') as any,
        'b@h': makeRoom('b@h') as any,
        'c@h': makeRoom('c@h') as any,
      },
      client,
      2
    );
    expect(client.getHistoryStanza).toHaveBeenCalledTimes(3);
  });

  it('catches per-room errors so a single bad room does not abort the batch', async () => {
    const ts = 1700000000000;
    ['a@h', 'b@h'].forEach((jid) =>
      sharedStore.dispatch(
        addRoom({
          roomData: makeRoom(jid, { lastMessageTimestamp: ts }) as any,
        })
      )
    );
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const client = makeClient({
      getHistoryStanza: jest.fn(async (jid: string) => {
        if (jid === 'a@h') {throw new Error('boom');}
        return [makeMsg(String(ts))];
      }),
    });
    await updateMessagesTillLast(
      {
        'a@h': makeRoom('a@h') as any,
        'b@h': makeRoom('b@h') as any,
      },
      client,
      2
    );
    expect(errSpy).toHaveBeenCalledWith(
      'Error processing room a@h:',
      expect.any(Error)
    );
    // The good room still completed (its getHistoryStanza was called).
    expect(client.getHistoryStanza).toHaveBeenCalledWith('b@h', 5, NaN);
    errSpy.mockRestore();
  });
});
