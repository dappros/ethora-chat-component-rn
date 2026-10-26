/**
 * The app icon badge: the backend sets it only with a push, so in the
 * foreground the SDK keeps it equal to the unread total (0 once read).
 */
const mockSetBadgeCountAsync = jest.fn(() => Promise.resolve(true));
jest.mock('expo-notifications', () => ({
  setBadgeCountAsync: mockSetBadgeCountAsync,
}), { virtual: true });

let appStateListener: ((state: string) => void) | null = null;
let appState = 'active';
const mockListeners: Array<() => void> = [];
let mockState: any;
jest.mock('../src/roomStore', () => ({
  store: {
    getState: () => mockState,
    subscribe: (cb: () => void) => {
      mockListeners.push(cb);
      return () => undefined;
    },
  },
}));

import { AppState } from 'react-native';

jest.spyOn(AppState, 'addEventListener').mockImplementation(((
  _: string,
  cb: (state: string) => void
) => {
  appStateListener = cb;
  return { remove: jest.fn() };
}) as any);
Object.defineProperty(AppState, 'currentState', {
  configurable: true,
  get: () => appState,
});

const { installAppBadgeSync } = require('../src/services/appBadge');

const setRooms = (unread: number[], config: any = {}) => {
  mockState = {
    rooms: {
      rooms: Object.fromEntries(
        unread.map((n, i) => [`room${i}@conf`, { unreadMessages: n }])
      ),
    },
    chatSettingStore: { config },
  };
  mockListeners.forEach((cb) => cb());
};

const flush = () => new Promise((r) => setImmediate(r));

beforeAll(() => {
  setRooms([]);
  installAppBadgeSync();
});

beforeEach(() => {
  mockSetBadgeCountAsync.mockClear();
});

it('follows the unread total while the app is in the foreground', async () => {
  setRooms([2, 3]);
  await flush();
  expect(mockSetBadgeCountAsync).toHaveBeenLastCalledWith(5);

  setRooms([0, 0]);
  await flush();
  expect(mockSetBadgeCountAsync).toHaveBeenLastCalledWith(0);
});

it('does not touch the badge in the background, and resets it on the way back', async () => {
  appState = 'background';
  setRooms([4]);
  await flush();
  expect(mockSetBadgeCountAsync).not.toHaveBeenCalled();

  appState = 'active';
  appStateListener?.('active');
  await flush();
  expect(mockSetBadgeCountAsync).toHaveBeenCalledWith(4);
});

it('sets the same count again after coming back: a push may have changed it', async () => {
  appState = 'background';
  appStateListener?.('background');
  appState = 'active';
  appStateListener?.('active');
  await flush();
  expect(mockSetBadgeCountAsync).toHaveBeenCalledWith(4);
});

it('leaves the badge alone with pushNotifications.syncAppBadge: false', async () => {
  setRooms([7], { pushNotifications: { syncAppBadge: false } });
  appStateListener?.('active');
  await flush();
  expect(mockSetBadgeCountAsync).not.toHaveBeenCalled();
});
