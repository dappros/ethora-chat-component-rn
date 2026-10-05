import { AppState } from 'react-native';
(AppState as any).currentState = 'active';

import { runHistoryPreloadScheduler } from '../src/helpers/historyPreloadScheduler';
import { store } from '../src/roomStore';
import { addRoom, deleteAllRooms, updateRoom } from '../src/roomStore/roomsSlice';
import { IRoom } from '../src/types/types';

const ROOM_A = 'rooma@conference.xmpp.example.com';
const ROOM_B = 'roomb@conference.xmpp.example.com';

const seedRoom = (jid: string) => {
  store.dispatch(
    addRoom({
      roomData: {
        jid,
        name: jid,
        messages: [],
        historyPreloadState: 'idle',
      } as unknown as IRoom,
    })
  );
};

const makeClient = (getHistoryStanza: any) =>
  ({
    getHistoryStanza,
    isActiveRoomGateOpen: () => true,
    promoteRoomHistory: jest.fn(),
    client: { jid: { toString: () => 'tester@example.com/web' } },
  }) as any;

const stateOf = (jid: string) => store.getState().rooms.rooms[jid];

describe('historyPreloadScheduler, an empty MAM page is inconclusive, not done', () => {
  beforeEach(() => {
    store.dispatch(deleteAllRooms());
  });

  // Live-observed: rooms whose background preload got an empty page were
  // marked 'done' with an empty transcript, so the sidebar preview stayed
  // blank forever and nothing ever retried them, yet opening the room by
  // hand loaded the history fine.
  it('leaves a room retryable (not done) when the server returns an empty page', async () => {
    seedRoom(ROOM_A);

    const getHistoryStanza = jest.fn().mockResolvedValue([]);
    await runHistoryPreloadScheduler({
      client: makeClient(getHistoryStanza),
      concurrency: 1,
      pageSize: 10,
      retryLimit: 0,
    });

    expect(stateOf(ROOM_A).historyPreloadState).toBe('partial');
    expect(stateOf(ROOM_A).historyPreloadState).not.toBe('done');
  });

  it('retries an empty page within the same sweep', async () => {
    seedRoom(ROOM_A);

    const getHistoryStanza = jest.fn().mockResolvedValue([]);
    await runHistoryPreloadScheduler({
      client: makeClient(getHistoryStanza),
      concurrency: 1,
      pageSize: 10,
      retryLimit: 2,
    });

    // Initial attempt + 2 retries.
    expect(getHistoryStanza).toHaveBeenCalledTimes(3);
  });

  it('still marks a room done when messages actually arrive', async () => {
    seedRoom(ROOM_B);

    const getHistoryStanza = jest.fn().mockResolvedValue([
      {
        id: 'm1',
        body: 'hello',
        date: new Date().toISOString(),
        roomJid: ROOM_B,
        user: { id: 'peer@example.com', name: 'Peer' },
      },
    ]);

    await runHistoryPreloadScheduler({
      client: makeClient(getHistoryStanza),
      concurrency: 1,
      pageSize: 10,
      retryLimit: 0,
    });

    expect(stateOf(ROOM_B).historyPreloadState).toBe('done');
    expect(stateOf(ROOM_B).messages.length).toBeGreaterThan(0);
  });
});

describe('historyPreloadScheduler, reaction-only pages follow the cursor', () => {
  const realMsg = (id: string) => ({
    id,
    body: 'real',
    date: new Date().toISOString(),
    roomJid: ROOM_A,
    user: { id: 'peer@example.com', name: 'Peer' },
  });
  const setCursor = (cursor: number) =>
    store.dispatch(
      updateRoom({
        jid: ROOM_A,
        updates: {
          messageStats: {
            firstMessageTimestamp: cursor,
            lastMessageTimestamp: cursor + 100,
          },
        } as any,
      })
    );

  beforeEach(() => {
    store.dispatch(deleteAllRooms());
  });

  it('pages back by the server cursor until something displayable arrives', async () => {
    seedRoom(ROOM_A);
    let call = 0;
    const getHistoryStanza = jest.fn(async () => {
      call += 1;
      if (call < 3) {
        setCursor(1000 - call);
        return [];
      }
      return [realMsg('m1')];
    });

    await runHistoryPreloadScheduler({
      client: makeClient(getHistoryStanza),
      concurrency: 1,
      pageSize: 15,
      retryLimit: 0,
    });

    expect(getHistoryStanza).toHaveBeenCalledTimes(3);
    expect((getHistoryStanza.mock.calls as any[])[1][2]).toBe(999);
    expect((getHistoryStanza.mock.calls as any[])[2][2]).toBe(998);
    expect(stateOf(ROOM_A).historyPreloadState).toBe('done');
    expect(stateOf(ROOM_A).messages.length).toBe(1);
  });

  it('is bounded and ends partial, not error, when nothing displayable is found', async () => {
    seedRoom(ROOM_A);
    let call = 0;
    const getHistoryStanza = jest.fn(async () => {
      call += 1;
      setCursor(1000 - call);
      return [];
    });

    await runHistoryPreloadScheduler({
      client: makeClient(getHistoryStanza),
      concurrency: 1,
      pageSize: 1,
      retryLimit: 2,
    });

    expect(getHistoryStanza).toHaveBeenCalledTimes(5);
    expect(stateOf(ROOM_A).historyPreloadState).toBe('partial');
  });

  it('a real failure ends in error, and a later sweep retries it to success', async () => {
    seedRoom(ROOM_A);
    await runHistoryPreloadScheduler({
      client: makeClient(jest.fn().mockResolvedValue(undefined)),
      concurrency: 1,
      pageSize: 10,
      retryLimit: 0,
    });
    expect(stateOf(ROOM_A).historyPreloadState).toBe('error');

    await runHistoryPreloadScheduler({
      client: makeClient(jest.fn().mockResolvedValue([realMsg('m2')])),
      concurrency: 1,
      pageSize: 10,
      retryLimit: 0,
    });
    expect(stateOf(ROOM_A).historyPreloadState).toBe('done');
  });
});
