/**
 * historyPreloadScheduler — background MAM preload pump.
 *
 * Drains every room in priority order (selected → defaults → others),
 * coalescing with the XMPP client's MAM queue. We mock the shared
 * store + the AppState foreground check, and use a fake XmppClient.
 */

// AppState is queried via `AppState.currentState !== 'active'`.
// jest-expo's react-native mock already exposes AppState; force its
// currentState to 'active' so `shouldPauseForVisibility` is false.
import { AppState } from 'react-native';
(AppState as any).currentState = 'active';

// Lazy store construction inside the factory — jest.mock is hoisted
// above imports, so module-scope refs (sharedStore) would be TDZ.
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

import { addRoom } from '../src/roomStore/roomsSlice';
import { runHistoryPreloadScheduler } from '../src/helpers/historyPreloadScheduler';
import { store as sharedStore } from '../src/roomStore';
import type { IRoom } from '../src/types/types';

function makeRoom(jid: string, overrides: Partial<IRoom> = {}): IRoom {
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
  } as IRoom;
}

function makeClient(overrides: any = {}) {
  return {
    isActiveRoomGateOpen: jest.fn(() => true),
    getHistoryStanza: jest.fn(async () => []),
    ...overrides,
  } as any;
}

beforeEach(() => {
  sharedStore.dispatch({ type: 'roomMessages/setLogoutState' });
});

describe('historyPreloadScheduler', () => {
  it('returns immediately when the abort signal is already aborted', async () => {
    const client = makeClient();
    const ac = new AbortController();
    ac.abort();
    await runHistoryPreloadScheduler({ client, signal: ac.signal });
    expect(client.getHistoryStanza).not.toHaveBeenCalled();
  });

  it('drains every room and marks each historyPreloadState=done', async () => {
    sharedStore.dispatch({ type: 'roomMessages/setLogoutState' });
    sharedStore.dispatch(addRoom({ roomData: makeRoom('a@h') }));
    sharedStore.dispatch(addRoom({ roomData: makeRoom('b@h') }));
    const client = makeClient({
      getHistoryStanza: jest.fn(async (jid: string) => [
        { id: `${jid}-1`, body: 'hi', date: '2026-05-15T00:00:00Z' },
      ]),
    });

    await runHistoryPreloadScheduler({ client, concurrency: 2, pageSize: 10 });

    expect(client.getHistoryStanza).toHaveBeenCalledTimes(2);
    expect(client.getHistoryStanza).toHaveBeenCalledWith(
      'a@h',
      10,
      undefined,
      undefined,
      expect.objectContaining({ coalesceRoom: true, source: 'background' })
    );
    expect(
      sharedStore.getState().rooms.rooms['a@h'].historyPreloadState
    ).toBe('done');
    expect(
      sharedStore.getState().rooms.rooms['b@h'].historyPreloadState
    ).toBe('done');
  });

  it('skips rooms already at historyPreloadState=done unless forceReload', async () => {
    // The scheduler snapshots each room's preload state BEFORE
    // dispatching the batch-wide 'loading' marker, so the per-task
    // `done`-skip check sees the original value (not the overwritten
    // 'loading'). Without that snapshot the skip was dead and every
    // run re-fetched.
    sharedStore.dispatch(
      addRoom({
        roomData: makeRoom('a@h', { historyPreloadState: 'done' } as any),
      })
    );
    const client = makeClient();
    await runHistoryPreloadScheduler({ client });
    expect(client.getHistoryStanza).not.toHaveBeenCalled();

    // With forceReload, the same room IS fetched.
    await runHistoryPreloadScheduler({ client, forceReload: true });
    expect(client.getHistoryStanza).toHaveBeenCalledTimes(1);
  });

  it('prioritises the selected room first', async () => {
    sharedStore.dispatch(addRoom({ roomData: makeRoom('z@h') }));
    sharedStore.dispatch(addRoom({ roomData: makeRoom('a@h') }));
    sharedStore.dispatch(addRoom({ roomData: makeRoom('selected@h') }));

    const order: string[] = [];
    const client = makeClient({
      getHistoryStanza: jest.fn(async (jid: string) => {
        order.push(jid);
        return [];
      }),
    });
    await runHistoryPreloadScheduler({
      client,
      concurrency: 1,
      selectedRoomJid: 'selected@h',
    });
    expect(order[0]).toBe('selected@h');
  });

  it('prioritises defaultRoomJids after the selected room', async () => {
    sharedStore.dispatch(addRoom({ roomData: makeRoom('other@h') }));
    sharedStore.dispatch(addRoom({ roomData: makeRoom('default@h') }));

    const order: string[] = [];
    const client = makeClient({
      getHistoryStanza: jest.fn(async (jid: string) => {
        order.push(jid);
        return [];
      }),
    });
    await runHistoryPreloadScheduler({
      client,
      concurrency: 1,
      defaultRoomJids: ['default@h'],
    });
    expect(order[0]).toBe('default@h');
  });

  it('caps the queue at roomLimit when supplied', async () => {
    sharedStore.dispatch(addRoom({ roomData: makeRoom('a@h') }));
    sharedStore.dispatch(addRoom({ roomData: makeRoom('b@h') }));
    sharedStore.dispatch(addRoom({ roomData: makeRoom('c@h') }));
    const client = makeClient();
    await runHistoryPreloadScheduler({
      client,
      concurrency: 1,
      roomLimit: 2,
    });
    expect(client.getHistoryStanza).toHaveBeenCalledTimes(2);
  });

  it('flips a room to historyPreloadState=error after retries are exhausted', async () => {
    sharedStore.dispatch(addRoom({ roomData: makeRoom('bad@h') }));
    const client = makeClient({
      getHistoryStanza: jest.fn(async () => {
        throw new Error('boom');
      }),
    });
    await runHistoryPreloadScheduler({
      client,
      concurrency: 1,
      retryLimit: 1, // 2 total attempts
    });
    expect(client.getHistoryStanza).toHaveBeenCalledTimes(2);
    expect(
      sharedStore.getState().rooms.rooms['bad@h'].historyPreloadState
    ).toBe('error');
  });

  it('treats `undefined` from getHistoryStanza as a timeout (retried, then errored)', async () => {
    sharedStore.dispatch(addRoom({ roomData: makeRoom('timeout@h') }));
    const client = makeClient({
      getHistoryStanza: jest.fn(async () => undefined),
    });
    await runHistoryPreloadScheduler({
      client,
      concurrency: 1,
      retryLimit: 0,
    });
    expect(
      sharedStore.getState().rooms.rooms['timeout@h'].historyPreloadState
    ).toBe('error');
  });
});
