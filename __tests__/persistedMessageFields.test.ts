/**
 * What survives the message cache decides what a restored transcript can
 * render — and what must come back through MAM instead.
 *
 * Mirrors the web SDK's persist contract (web src/roomStore/index.ts
 * PERSISTED_MESSAGE_FIELDS): `langSource` survives the round trip,
 * `translations` deliberately does not — the history parser re-hydrates
 * it on the next MAM page. The bug this guards against was RN's history
 * parser NOT reading <translations> at all, which combined with this drop
 * to make translation look completely dead after every restart.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { configureStore } from '@reduxjs/toolkit';
import chatSettingsReducer from '../src/roomStore/chatSettingsSlice';
import roomsReducer, { addRoom } from '../src/roomStore/roomsSlice';
import {
  PERSIST_KEYS,
  persistenceMiddleware,
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
  jest.advanceTimersByTime(250);
  await Promise.resolve();
  await Promise.resolve();
};

describe('persisted message fields', () => {
  it('keeps translations alongside langSource', async () => {
    const store = makeStore();
    const room = {
      jid: 'r@h',
      name: 'r',
      title: 'r',
      messages: [
        {
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
        },
      ],
    } as unknown as IRoom;

    store.dispatch(addRoom({ roomData: room }));
    await flush();

    const persisted = JSON.parse(
      (await AsyncStorage.getItem(PERSIST_KEYS.KEY_ROOMS))!
    );
    const restored = persisted.rooms['r@h'].messages[0];

    expect(restored.langSource).toBe('en-CA');
    // Deliberately dropped — same as the web SDK's persist list. MAM
    // re-hydration restores translations on the next history page, now
    // that onMessageHistory parses the <translations> element at all.
    // Locking this so nobody "fixes" the divergence in either direction
    // without meaning to.
    expect(restored.translations).toBeUndefined();
  });
});
