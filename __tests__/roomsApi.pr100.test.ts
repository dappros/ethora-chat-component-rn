/**
 * GET /v1/chats/my mapping: usersCnt, unreadCount seed, lastMessage seed,
 * and what is (not) persisted about it.
 */
jest.mock('../src/networking/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), defaults: { baseURL: 'https://api.test' } },
  appToken: 'test-app-token',
  getCurrentAppToken: () => 'test-app-token',
  getCurrentBaseURL: () => 'https://api.test',
  setBaseURL: jest.fn(),
  normalizeApiPath: (path?: string) => (!path || /^\/v\d+\//.test(path) ? path : `/v1${path}`),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import http from '../src/networking/apiClient';
import { store } from '../src/roomStore';
import { setUser, setConfig } from '../src/roomStore/chatSettingsSlice';
import { getRooms, clearRoomsRestCache } from '../src/networking/api-requests/rooms.api';
import { persistedRoomKey } from '../src/roomStore/persistence';
import { decryptFromPersist } from '../src/helpers/persistCrypto';
import { setCurrentRoom } from '../src/roomStore/roomsSlice';

const mockHttp = http as unknown as { get: jest.Mock };
const members = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ _id: `m${i}`, firstName: 'F', lastName: String(i) }));
const roomsMap = () => (store.getState() as any).rooms.rooms;

beforeEach(() => {
  mockHttp.get.mockReset();
  store.dispatch({ type: 'chat/logout' });
  store.dispatch({ type: 'roomMessages/setLogoutState' });
  clearRoomsRestCache();
  store.dispatch(setUser({ token: 'tok' } as any));
  store.dispatch(setConfig({ colors: { primary: '#000', secondary: '#000' }, xmppSettings: { host: 'my.host' } } as any));
});

describe('rooms.api /chats/my mapping', () => {
  it('reads the API total (usersCnt) instead of the truncated members page', async () => {
    mockHttp.get.mockResolvedValueOnce({
      data: { items: [{ name: 'big', _id: 'id1', usersCnt: 435, members: members(30) }] },
    });
    await getRooms();
    expect(roomsMap()['big@conference.my.host'].usersCnt).toBe(435);
  });

  it('falls back to participants, then members length', async () => {
    mockHttp.get.mockResolvedValueOnce({
      data: {
        items: [
          { name: 'p', _id: 'id1', participants: 3 },
          { name: 'm', _id: 'id2', members: members(4) },
        ],
      },
    });
    await getRooms();
    expect(roomsMap()['p@conference.my.host'].usersCnt).toBe(3);
    expect(roomsMap()['m@conference.my.host'].usersCnt).toBe(4);
  });

  it('a refresh never lowers a larger known usersCnt', async () => {
    mockHttp.get.mockResolvedValueOnce({ data: { items: [{ name: 'big', usersCnt: 435, members: members(30) }] } });
    await getRooms();
    clearRoomsRestCache();
    mockHttp.get.mockResolvedValueOnce({ data: { items: [{ name: 'big', members: members(30) }] } });
    await getRooms();
    expect(roomsMap()['big@conference.my.host'].usersCnt).toBe(435);
  });

  it('seeds unread from unreadCount and keeps the API lastMessage', async () => {
    mockHttp.get.mockResolvedValueOnce({
      data: {
        items: [
          {
            name: 'u',
            unreadCount: 5,
            lastMessage: { body: 'hi', createdAt: '2026-01-01T00:00:00.000Z', senderFirstName: 'A' },
          },
        ],
      },
    });
    await getRooms();
    const room = roomsMap()['u@conference.my.host'];
    expect(room.apiUnreadCount).toBe(5);
    expect(room.unreadMessages).toBe(5);
    expect(typeof room.apiUnreadSeededAt).toBe('number');
    expect(room.lastMessage.body).toBe('hi');
    expect(room.lastMessage.user.name).toBe('A');
  });

  it('a refresh without the unread field keeps the old one and the existing unread', async () => {
    mockHttp.get.mockResolvedValueOnce({ data: { items: [{ name: 'u', unreadCount: 5 }] } });
    await getRooms();
    clearRoomsRestCache();
    mockHttp.get.mockResolvedValueOnce({ data: { items: [{ name: 'u' }] } });
    await getRooms();
    const room = roomsMap()['u@conference.my.host'];
    expect(room.apiUnreadCount).toBe(5);
    expect(room.unreadMessages).toBe(5);
  });

  it('opening the room clears it, a refresh while open does not bring it back', async () => {
    mockHttp.get.mockResolvedValueOnce({ data: { items: [{ name: 'u', unreadCount: 5 }] } });
    await getRooms();
    store.dispatch(setCurrentRoom({ roomJID: 'u@conference.my.host' }));
    clearRoomsRestCache();
    mockHttp.get.mockResolvedValueOnce({ data: { items: [{ name: 'u', unreadCount: 9 }] } });
    await getRooms();
    const room = roomsMap()['u@conference.my.host'];
    expect(room.apiUnreadCount).toBeUndefined();
    expect(room.unreadMessages).toBe(0);
  });
});

describe('persistence of volatile room state', () => {
  it('never writes the API unread snapshot to disk', async () => {
    jest.useFakeTimers();
    try {
      await AsyncStorage.clear();
      mockHttp.get.mockResolvedValueOnce({ data: { items: [{ name: 'u', unreadCount: 5 }] } });
      await getRooms();
      jest.advanceTimersByTime(5000);
      for (let i = 0; i < 30; i++) await Promise.resolve();
      const raw = await AsyncStorage.getItem(persistedRoomKey('u@conference.my.host'));
      expect(raw).not.toBeNull();
      // Per-room persistence: one key per room, only the room object itself.
      const plain = JSON.parse((await decryptFromPersist(raw!)) as string);
      const room = plain;
      expect(room.jid).toBe('u@conference.my.host');
      expect(room.apiUnreadCount).toBeUndefined();
      expect(room.apiUnreadSeededAt).toBeUndefined();
      expect(plain.jumpWindow).toBeUndefined();
      expect(plain.pendingJump).toBeUndefined();
      expect(plain.archivedMessage).toBeUndefined();
      expect(plain.usersSet).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});
