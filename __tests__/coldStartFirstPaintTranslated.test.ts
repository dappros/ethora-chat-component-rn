/**
 * The user-visible claim behind the "translations disappear after relaunch"
 * bug, asserted end to end.
 *
 * `persistedMessageFields` proves `translations` survives the AsyncStorage
 * round trip. That is necessary but not the thing QA actually saw. What
 * they saw was the FIRST PAINT of a cold-started room rendering the
 * original language and flipping to the translation a few seconds later,
 * once MAM re-sent the history.
 *
 * So this walks the whole path: persist a translated message -> read it
 * back with the same `readPersistedState()` the app's cold-start
 * rehydration calls -> hand the restored message to
 * `useMessageTranslation`, the single function every bubble asks "do I
 * render a translation here?". If the restored message can't answer "yes",
 * the flash is back, whatever the storage-level tests say.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { configureStore } from '@reduxjs/toolkit';

import roomsReducer, { addRoom } from '../src/roomStore/roomsSlice';
import {
  PERSIST_KEYS,
  persistenceMiddleware,
  readPersistedState,
} from '../src/roomStore/persistence';
import { useMessageTranslation } from '../src/hooks/useMessageTranslation';
import type { IRoom } from '../src/types/types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const ROOM_JID = 'room@conference.host';
const ORIGINAL = 'hi, this message is in english';
const FRENCH = 'salut, ce message est en anglais';

const makeStore = () =>
  configureStore({
    reducer: { rooms: roomsReducer },
    middleware: (gdm) => gdm({ serializableCheck: false }).concat(persistenceMiddleware),
  });

// The persist middleware debounces writes by 200ms.
const flushWrites = async () => {
  jest.advanceTimersByTime(300);
  // Debounce, then the at-rest cipher (SecureStore key + AES) before the
  // multiSet - a deeper async chain than a bare write.
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
};

const room = (): IRoom =>
  ({
    jid: ROOM_JID,
    name: 'r',
    title: 'r',
    messages: [
      {
        id: 'm1',
        body: ORIGINAL,
        date: new Date('2026-08-07T08:39:00.000Z').toISOString(),
        roomJid: ROOM_JID,
        user: { id: 'them', name: 'John Doe' },
        langSource: 'en-CA',
        translations: {
          fr: {
            translatedText: FRENCH,
            language: 'fr',
            languageName: 'French',
          },
        },
      },
    ],
  }) as unknown as IRoom;

describe('cold start paints history already translated', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await AsyncStorage.clear();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('a rehydrated message still answers "yes, render the translation"', async () => {
    const store = makeStore();
    store.dispatch(addRoom({ roomData: room() } as any));
    await flushWrites();

    // Sanity: something actually reached storage.
    const raw = await AsyncStorage.getItem(PERSIST_KEYS.KEY_ROOMS);
    expect(raw).toBeTruthy();

    // The exact call the app makes on cold start, before any MAM traffic.
    const restored = await readPersistedState();
    const restoredMessage = (restored as any).rooms?.rooms?.[ROOM_JID]
      ?.messages?.[0];
    expect(restoredMessage).toBeTruthy();

    // A French reader, on the very first paint, with no network yet.
    const state = useMessageTranslation(restoredMessage, 'fr-CA', true);

    expect(state.hasTranslation).toBe(true);
    expect(state.displayText).toBe(FRENCH);
    expect(state.originalText).toBe(ORIGINAL);
  });

  it('an English reader still sees the original, not a spurious translation', async () => {
    const store = makeStore();
    store.dispatch(addRoom({ roomData: room() } as any));
    await flushWrites();

    const restored = await readPersistedState();
    const restoredMessage = (restored as any).rooms?.rooms?.[ROOM_JID]
      ?.messages?.[0];

    const state = useMessageTranslation(restoredMessage, 'en-CA', true);
    expect(state.hasTranslation).toBe(false);
    expect(state.displayText).toBe(ORIGINAL);
  });
});
