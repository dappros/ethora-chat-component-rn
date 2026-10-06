/**
 * The bootstrap subscribes the rooms it has to MucSub pushes. A room that
 * turns up later - the room list stanza after a reconnect or an invite, or
 * a room created in the app - must be subscribed as it arrives, or it is
 * silent until the next app start.
 */
const mockSubscribe = jest.fn(async () => true);
jest.mock('../src/networking/xmpp/subscribeToRoomMessages.xmpp', () => ({
  subscribeToRoomMessages: (...args: any[]) => mockSubscribe(...args),
}));
jest.mock('../src/networking/api-requests/rooms.api', () => ({
  loadRoomMembers: jest.fn(async () => false),
}));
// The store's persistence reaches for the secure store on first use;
// resolve it up front so nothing is required after the suite ends.
jest.mock('../src/helpers/secureStoreRuntime', () => ({
  loadSecureStore: () => null,
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { xml } from '@xmpp/client';
import { store } from '../src/roomStore';
import { addRoomViaApi } from '../src/roomStore/roomsSlice';
import { onGetChatRooms } from '../src/networking/stanzaHandlers';
import { pushSubscriptionService } from '../src/services/pushSubscriptionService';

const underlying = { jid: { getLocal: () => 'me' } };
const xmpp: any = {
  client: underlying,
  presenceInRoomStanza: jest.fn(),
};

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  mockSubscribe.mockClear();
  await AsyncStorage.clear();
  await pushSubscriptionService.reset();
});

describe('push subscription for rooms that arrive after the bootstrap', () => {
  it('subscribes a room the room list stanza brings in', async () => {
    const stanza = xml(
      'iq',
      { id: 'getUserRooms', type: 'result' },
      xml(
        'query',
        {},
        xml('room', {
          jid: 'late@conference.host',
          name: 'Late',
          users_cnt: '2',
          room_background: 'none',
          room_thumbnail: 'none',
        })
      )
    );
    onGetChatRooms(stanza as any, xmpp);
    await flush();
    await flush();
    expect(store.getState().rooms.rooms['late@conference.host']).toBeDefined();
    expect(mockSubscribe).toHaveBeenCalledWith(underlying, 'late@conference.host', 'me');

    // Listed again: already subscribed, nothing sent twice.
    onGetChatRooms(stanza as any, xmpp);
    await flush();
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });

  it('subscribes a room created in the app', async () => {
    await store.dispatch(
      addRoomViaApi({
        room: {
          id: 'n', jid: 'made@conference.host', name: 'made', title: 'Made',
          usersCnt: 1, messages: [], isLoading: false, roomBg: null,
        } as any,
        xmpp,
      })
    );
    await flush();
    expect(mockSubscribe).toHaveBeenCalledWith(underlying, 'made@conference.host', 'me');
  });

  it('does nothing without a live stream', async () => {
    await store.dispatch(
      addRoomViaApi({
        room: {
          id: 'o', jid: 'offline@conference.host', name: 'o', title: 'O',
          usersCnt: 1, messages: [], isLoading: false, roomBg: null,
        } as any,
        xmpp: { client: null } as any,
      })
    );
    await flush();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });
});
