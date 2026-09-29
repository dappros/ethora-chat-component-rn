/**
 * What survives the message cache decides what a restored transcript can
 * render on the very first paint after a cold start.
 *
 * `translations` MUST survive the round trip alongside `langSource`: web's
 * redux-persist config (web/src/roomStore/index.ts) has no per-field
 * message whitelist at all — it persists whatever is in `room.messages`
 * verbatim (capped to the last 50), `translations` included. A previous
 * version of this list dropped `translations` from the RN persist
 * whitelist on the mistaken belief that doing so matched web's contract.
 * It didn't (there is no such whitelist on web), and the effect was a
 * translation flash on EVERY cold start: cached history painted in the
 * original language and only flipped to the translation once MAM
 * re-sent the history a few seconds later (see onMessageHistory in
 * src/networking/stanzaHandlers.ts). Locking the correct contract here —
 * both the write shape and the full read-back round trip — so the
 * regression can't come back in either direction.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { configureStore } from '@reduxjs/toolkit';
import chatSettingsReducer from '../src/roomStore/chatSettingsSlice';
import roomsReducer, { addRoom } from '../src/roomStore/roomsSlice';
import {
  PERSIST_KEYS,
  persistenceMiddleware,
  readPersistedState,
} from '../src/roomStore/persistence';
import type { IRoom } from '../src/types/types';
import { decryptFromPersist } from '../src/helpers/persistCrypto';

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

// The write is debounced (200 ms) and then goes through the at-rest cipher
// (SecureStore-backed key, then AES) before the multiSet, so drain a deep
// microtask chain rather than a couple of turns.
const flush = async () => {
  jest.advanceTimersByTime(250);
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
};

// Stored values are AES envelopes, not plain JSON - decrypt before reading.
const readDecrypted = async (key: string): Promise<any> => {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) {return null;}
  const plain = await decryptFromPersist(raw);
  return plain ? JSON.parse(plain) : null;
};

const translatedMessage = () => ({
  id: 'm1',
  body: 'hi, this message is in english',
  date: new Date('2026-08-07T08:39:00.000Z').toISOString(),
  roomJid: 'r@h',
  user: { id: 'them', name: 'John Doe' },
  langSource: 'en-CA',
  translations: {
    es: {
      translatedText: 'hola, este mensaje está en inglés',
      language: 'es',
      languageName: 'Spanish',
    },
  },
});

describe('persisted message fields', () => {
  it('keeps translations alongside langSource in the serialized write', async () => {
    const store = makeStore();
    const room = {
      jid: 'r@h',
      name: 'r',
      title: 'r',
      messages: [translatedMessage()],
    } as unknown as IRoom;

    store.dispatch(addRoom({ roomData: room }));
    await flush();

    const persisted = await readDecrypted(PERSIST_KEYS.KEY_ROOMS);
    const restored = persisted.rooms['r@h'].messages[0];

    expect(restored.langSource).toBe('en-CA');
    // The whole point: a translation attached before the app was killed
    // must still be there in what gets written to disk, not just
    // `langSource` (which was never the part that was broken).
    expect(restored.translations?.es?.translatedText).toBe(
      'hola, este mensaje está en inglés'
    );
  });

  it('round-trips translations through a full write -> cold-start read cycle', async () => {
    const store = makeStore();
    const room = {
      jid: 'r@h',
      name: 'r',
      title: 'r',
      messages: [translatedMessage()],
    } as unknown as IRoom;

    store.dispatch(addRoom({ roomData: room }));
    await flush();

    // Simulate the app being killed and relaunched: read back through the
    // same function the store's cold-start rehydrate calls
    // (src/roomStore/index.ts `persistorReady`), not the raw AsyncStorage
    // key, so this test breaks if that read path ever stops matching the
    // write path.
    const { rooms } = await readPersistedState();
    const restoredMessage = rooms?.rooms['r@h'].messages[0] as any;

    expect(restoredMessage).toBeDefined();
    expect(restoredMessage.langSource).toBe('en-CA');
    expect(restoredMessage.translations?.es?.translatedText).toBe(
      'hola, este mensaje está en inglés'
    );
  });
});
