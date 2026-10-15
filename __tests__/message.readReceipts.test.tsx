/**
 * Own-message ticks (RN bubble): sent = single grey tick, delivered = double
 * grey (someone else acked it), seen = double accent (someone else displayed
 * it, at or after this message). Tapping the tick names who, in groups; a 1:1
 * room only says Read / Delivered.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Alert } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import {
  addRoom,
  deleteAllRooms,
  mergeUsersSet,
  setDisplayedMarker,
  setLogoutState,
  setReceivedReceipt,
  setRoomMessages,
} from '../src/roomStore/roomsSlice';
import { setConfig, setUser } from '../src/roomStore/chatSettingsSlice';
import { Message } from '../src/components/MessageBubble/Message';
import { DoubleTick, SingleTick } from '../src/assets/icons';

jest.mock('../src/helpers/userResolver', () => ({
  getUserLookupStatus: () => 'resolved',
  requestUsers: jest.fn(),
  subscribeUserResolver: () => () => {},
}));
jest.mock('../src/components/MainComponents/MediaMessage', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../src/components/MessageBubble/MessageInteractions', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('expo-clipboard', () => ({ __esModule: true, setStringAsync: jest.fn() }));
jest.mock('../src/context/ToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));
jest.mock('../src/context/xmppProvider', () => ({
  useXmppClient: () => ({ client: { sendMessageReactionStanza: jest.fn() } }),
}));
jest.mock('react-native-gesture-handler', () => {
  const chain: any = new Proxy({}, { get: () => () => chain });
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: any) => children,
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

const APP = '646cc8dc96d4a4dc8f7b2f2d';
const ME = `${APP}_me`;
const THEM = `${APP}_them`;
const ROOM = 'room1@conference.example.com';
const MINE = '1747303200000000';
const LATER = '1747303201000000';
const EARLIER = '1747303199000000';

const mine = (over: any = {}) =>
  ({
    id: MINE,
    body: 'my message',
    date: new Date(1747303200000).toISOString(),
    roomJid: ROOM,
    user: { id: ME, name: 'Me' },
    ...over,
  }) as any;

const theirs = (id: string) =>
  ({
    id,
    body: `their ${id}`,
    date: new Date(Number(id.slice(0, 13))).toISOString(),
    roomJid: ROOM,
    user: { id: THEM, name: 'Them' },
  }) as any;

const setRoom = (type: 'private' | 'public', messages: any[]) => {
  store.dispatch(deleteAllRooms());
  store.dispatch(
    addRoom({
      roomData: { jid: ROOM, name: ROOM, title: ROOM, usersCnt: 2, messages: [], type } as any,
    })
  );
  store.dispatch(setRoomMessages({ roomJID: ROOM, messages }));
};

const mount = async (msg: any, isUser = true) => {
  await act(async () => {
    store.dispatch(setConfig({} as any));
    store.dispatch(setUser({ xmppUsername: ME } as any));
  });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <Message message={msg} isUser={isUser} isReply={false} />
      </Provider>
    );
  });
  const tick = () => tree.root.findAll((n) => n.props?.testID === 'message-receipt-tick')[0];
  const tickIcon = () => {
    const single = tree.root.findAllByType(SingleTick);
    if (single.length) return { kind: 'sent', stroke: single[0].props.stroke };
    const double = tree.root.findAllByType(DoubleTick);
    if (double.length) return { kind: 'double', stroke: double[0].props.stroke };
    return null;
  };
  return { tree, tick, tickIcon };
};

beforeEach(() => {
  // Reset once per test (not inside mount): a reset there would wipe the
  // room, its watermark and usersSet that the test has just set up.
  store.dispatch(setLogoutState());
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('own message ticks', () => {
  it('a message nobody has acked shows a single tick', async () => {
    setRoom('public', [mine()]);
    const { tickIcon } = await mount(mine());
    expect(tickIcon()?.kind).toBe('sent');
  });

  it('delivered: another occupant acked it, a double tick in the muted colour', async () => {
    setRoom('public', [mine()]);
    const sent = await mount(mine());
    const sentStroke = sent.tickIcon()?.stroke;
    store.dispatch(setReceivedReceipt({ roomJID: ROOM, messageId: MINE, fromXmppUsername: THEM, timestamp: 1 }));
    const delivered = await mount(store.getState().rooms.rooms[ROOM].messages[0]);
    expect(delivered.tickIcon()?.kind).toBe('double');
    // Delivered is still the muted grey, the same colour as the single tick.
    expect(delivered.tickIcon()?.stroke).toBe(sentStroke);
  });

  it('seen: another occupant displayed it, a double tick in the accent colour', async () => {
    setRoom('public', [mine(), theirs(LATER)]);
    store.dispatch(setDisplayedMarker({ roomJID: ROOM, xmppUsername: THEM, messageId: LATER }));
    const seen = await mount(store.getState().rooms.rooms[ROOM].messages[0]);
    expect(seen.tickIcon()?.kind).toBe('double');
    const seenStroke = seen.tickIcon()?.stroke;
    // Delivered-only is the muted colour, seen is the accent: they must differ.
    setRoom('public', [mine()]);
    store.dispatch(setReceivedReceipt({ roomJID: ROOM, messageId: MINE, fromXmppUsername: THEM, timestamp: 1 }));
    const delivered = await mount(store.getState().rooms.rooms[ROOM].messages[0]);
    expect(delivered.tickIcon()?.stroke).not.toBe(seenStroke);
  });

  it('a watermark that sits before this message does not mark it seen', async () => {
    setRoom('public', [theirs(EARLIER), mine(), theirs(LATER)]);
    store.dispatch(setDisplayedMarker({ roomJID: ROOM, xmppUsername: THEM, messageId: EARLIER }));
    const { tickIcon } = await mount(store.getState().rooms.rooms[ROOM].messages[1]);
    expect(tickIcon()?.kind).toBe('sent');
  });

  it('our own watermark is never a viewer', async () => {
    setRoom('public', [mine(), theirs(LATER)]);
    store.dispatch(setDisplayedMarker({ roomJID: ROOM, xmppUsername: ME, messageId: LATER }));
    const { tickIcon } = await mount(store.getState().rooms.rooms[ROOM].messages[0]);
    expect(tickIcon()?.kind).toBe('sent');
  });

  it('the bubble re-renders when a reader watermark arrives while it is on screen', async () => {
    setRoom('public', [mine(), theirs(LATER)]);
    const { tickIcon } = await mount(store.getState().rooms.rooms[ROOM].messages[0]);
    expect(tickIcon()?.kind).toBe('sent');
    await act(async () => {
      store.dispatch(setDisplayedMarker({ roomJID: ROOM, xmppUsername: THEM, messageId: LATER }));
    });
    // Same mounted bubble, now showing the seen double tick.
    expect(tickIcon()?.kind).toBe('double');
  });

  it('no tick on someone else message, nor while the message is still pending', async () => {
    setRoom('public', [theirs(LATER)]);
    const other = await mount(theirs(LATER), false);
    expect(other.tick()).toBeUndefined();
    const pending = await mount(mine({ pending: true }));
    expect(pending.tick()).toBeUndefined();
  });
});

describe('tapping the tick', () => {
  it('a 1:1 room says Sent, Delivered or Read', async () => {
    setRoom('private', [mine()]);
    const sent = await mount(mine());
    await act(async () => sent.tick().props.onPress());
    expect(Alert.alert).toHaveBeenLastCalledWith('Sent');

    setRoom('private', [mine()]);
    store.dispatch(setReceivedReceipt({ roomJID: ROOM, messageId: MINE, fromXmppUsername: THEM, timestamp: 1 }));
    const delivered = await mount(store.getState().rooms.rooms[ROOM].messages[0]);
    await act(async () => delivered.tick().props.onPress());
    expect(Alert.alert).toHaveBeenLastCalledWith('Delivered');

    setRoom('private', [mine(), theirs(LATER)]);
    store.dispatch(setDisplayedMarker({ roomJID: ROOM, xmppUsername: THEM, messageId: LATER }));
    const seen = await mount(store.getState().rooms.rooms[ROOM].messages[0]);
    await act(async () => seen.tick().props.onPress());
    expect(Alert.alert).toHaveBeenLastCalledWith('Read');
  });

  it('a group names who read it, using the member names', async () => {
    store.dispatch(
      mergeUsersSet({
        members: { [THEM]: { xmppUsername: THEM, firstName: 'Ann', lastName: 'Lee' } } as any,
      })
    );
    setRoom('public', [mine(), theirs(LATER)]);
    store.dispatch(setDisplayedMarker({ roomJID: ROOM, xmppUsername: THEM, messageId: LATER }));
    const { tick } = await mount(store.getState().rooms.rooms[ROOM].messages[0]);
    await act(async () => tick().props.onPress());
    expect(Alert.alert).toHaveBeenLastCalledWith('Read by Ann Lee');
  });

  it('a group caps the list at five names and adds +N for the rest', async () => {
    const readers = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'].map((n) => `${APP}_${n}`);
    setRoom('public', [mine(), theirs(LATER)]);
    readers.forEach((xmppUsername) =>
      store.dispatch(setDisplayedMarker({ roomJID: ROOM, xmppUsername, messageId: LATER }))
    );
    const { tick } = await mount(store.getState().rooms.rooms[ROOM].messages[0]);
    await act(async () => tick().props.onPress());
    const text = (Alert.alert as jest.Mock).mock.calls.at(-1)[0] as string;
    expect(text.startsWith('Read by ')).toBe(true);
    expect(text.endsWith(' +2')).toBe(true);
    expect(text.split(',').length).toBe(5);
  });

  it('a group delivered to lists the recipients', async () => {
    setRoom('public', [mine()]);
    store.dispatch(setReceivedReceipt({ roomJID: ROOM, messageId: MINE, fromXmppUsername: `${APP}_u9`, timestamp: 1 }));
    const { tick } = await mount(store.getState().rooms.rooms[ROOM].messages[0]);
    await act(async () => tick().props.onPress());
    // No usersSet entry for this occupant: the raw username is the fallback.
    expect(Alert.alert).toHaveBeenLastCalledWith(`Delivered to ${APP}_u9`);
  });
});
