import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import {
  addRoom,
  setCurrentRoom,
} from '../src/roomStore/roomsSlice';
import { setConfig } from '../src/roomStore/chatSettingsSlice';

const CONF = 'conference.xmpp.test';
const NEW_JID = `newroom@${CONF}`;

let mockPresence: () => Promise<unknown>;
const mockClient = {
  presenceInRoomStanza: (...a: any[]) => (mockPresence as any)(...a),
  getRoomsStanza: jest.fn(async () => undefined),
  getHistoryStanza: jest.fn(async () => []),
  setActiveRoomJid: jest.fn(),
  promoteRoomHistory: jest.fn(),
  getRoomInfoStanza: jest.fn(),
  prioritizeRoomPresence: jest.fn(async () => undefined),
};
jest.mock('../src/context/xmppProvider', () => ({
  useXmppClient: () => ({ client: mockClient }),
}));
jest.mock('../src/hooks/useGetNewArchRoom', () => ({
  __esModule: true,
  default: () => jest.fn(async () => []),
}));

import { useRoomInitialization } from '../src/hooks/useRoomInitialization';
import { useRoomState } from '../src/hooks/useRoomState';

const Probe = () => {
  const { roomsList, activeRoomJID } = useRoomState();
  useRoomInitialization(activeRoomJID || '', roomsList, {} as any, 0);
  return null;
};

const seedRoom = () =>
  store.dispatch(
    addRoom({
      roomData: {
        id: 'x', jid: `other@${CONF}`, name: 'other', title: 'Other',
        usersCnt: 1, messages: [], isLoading: false, roomBg: '',
      } as any,
    })
  );

describe('joining a room that is not in the list yet', () => {
  it('raises joiningRoomJID for the join and clears it once the join settles', async () => {
    let release!: () => void;
    mockPresence = () => new Promise<void>((r) => (release = r));
    let seen: (string | null)[] = [];
    const unsubscribe = store.subscribe(() => {
      seen.push(store.getState().rooms.joiningRoomJID);
    });
    await act(async () => {
      store.dispatch(setConfig({} as any));
      seedRoom();
    });
    await act(async () => {
      renderer.create(
        <Provider store={store}>
          <Probe />
        </Provider>
      );
    });
    await act(async () => {
      store.dispatch(setCurrentRoom({ roomJID: NEW_JID }));
    });
    expect(store.getState().rooms.joiningRoomJID).toBe(NEW_JID);
    await act(async () => {
      release();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    unsubscribe();
    expect(store.getState().rooms.joiningRoomJID).toBeNull();
    expect(mockClient.getRoomsStanza).toHaveBeenCalled();
    expect(seen).toContain(NEW_JID);
  });
});

describe('isJoiningRoom (the ChatRoom guard)', () => {
  const { isJoiningRoom } = require('../src/helpers/joiningRoom');
  it('is true only for the requested room, while it is not in the list', () => {
    expect(isJoiningRoom('a@x', {}, 'a@x')).toBe(true);
    expect(isJoiningRoom('a@x', { 'a@x': {} }, 'a@x')).toBe(false);
    expect(isJoiningRoom('a@x', {}, 'b@x')).toBe(false);
    expect(isJoiningRoom('', {}, '')).toBe(false);
    expect(isJoiningRoom(null, {}, null)).toBe(false);
  });
});
