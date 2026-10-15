/**
 * Receipt state is session-only: a delivered or seen tick is re-learned from
 * live stanzas, so a reload shows "sent" again. Nothing about receipts may
 * reach the on-disk cache.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { configureStore } from '@reduxjs/toolkit';
import chatSettingsReducer from '../src/roomStore/chatSettingsSlice';
import roomsReducer, {
  addRoom,
  setDisplayedMarker,
  setReceivedReceipt,
} from '../src/roomStore/roomsSlice';
import {
  persistenceMiddleware,
  readPersistedState,
} from '../src/roomStore/persistence';
import type { IRoom } from '../src/types/types';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

const makeStore = () =>
  configureStore({
    reducer: { chatSettingStore: chatSettingsReducer, rooms: roomsReducer },
    middleware: (g) =>
      g({ serializableCheck: false }).concat(persistenceMiddleware),
  });

const flush = async () => {
  jest.advanceTimersByTime(1100);
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
};

describe('receipt state is not persisted', () => {
  it('drops receivedBy from the persisted messages and lastDisplayedByUser from the room', async () => {
    const store = makeStore();
    const roomJid = 'r@conference.example.com';
    store.dispatch(
      addRoom({
        roomData: {
          jid: roomJid,
          name: 'r',
          title: 'r',
          messages: [
            {
              id: '1700000000001',
              body: 'hello',
              date: new Date('2026-10-15T10:00:00.000Z').toISOString(),
              roomJid,
              user: { id: 'me', name: 'Me' },
            },
          ],
        } as unknown as IRoom,
      })
    );
    store.dispatch(
      setReceivedReceipt({
        roomJID: roomJid,
        messageId: '1700000000001',
        fromXmppUsername: 'them',
        timestamp: 1700000005000,
      })
    );
    store.dispatch(
      setDisplayedMarker({ roomJID: roomJid, xmppUsername: 'them', messageId: '1700000000001' })
    );
    // The live state does carry the receipts.
    expect(store.getState().rooms.rooms[roomJid].messages[0].receivedBy).toEqual({ them: 1700000005000 });
    expect(store.getState().rooms.rooms[roomJid].lastDisplayedByUser).toEqual({ them: '1700000000001' });

    await flush();
    const { rooms } = await readPersistedState();
    const restored = rooms?.rooms[roomJid] as any;

    expect(restored).toBeDefined();
    expect(restored.messages[0].body).toBe('hello');
    expect(restored.messages[0].receivedBy).toBeUndefined();
    expect(restored.lastDisplayedByUser).toBeUndefined();
  });
});
