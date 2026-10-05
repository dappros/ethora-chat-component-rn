/**
 * Message sender name chain (RN):
 * usersSet > a real message.user.name > muted placeholder while the lookup is
 * pending > the stanza's <data> name (last resort, never stored) >
 * 'Unknown user' > 'Deleted User' only for a confirmed 404 with no <data>.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { setLogoutState, mergeUsersSet } from '../src/roomStore/roomsSlice';
import { setConfig, setUser } from '../src/roomStore/chatSettingsSlice';
import { Message } from '../src/components/MessageBubble/Message';

const mockStatus = { value: 'pending' as string };
const mockRequestUsers = jest.fn();
jest.mock('../src/helpers/userResolver', () => ({
  getUserLookupStatus: () => mockStatus.value,
  requestUsers: (ids: string[]) => mockRequestUsers(ids),
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
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

const APP = '646cc8dc96d4a4dc8f7b2f2d';
const SENDER = `${APP}_6ab3a116d1f5c231da4c84fd`;
const ROOM = 'room1@conference.example.com';

const message = (over: any = {}) =>
  ({
    id: 'm1',
    body: 'hello',
    date: new Date().toISOString(),
    roomJid: ROOM,
    user: { id: SENDER },
    ...over,
  }) as any;

const mount = async (msg: any, usersSet: Record<string, any> = {}) => {
  await act(async () => {
    store.dispatch(setLogoutState());
    store.dispatch(setConfig({} as any));
    store.dispatch(setUser({ xmppUsername: `${APP}_me` } as any));
    if (Object.keys(usersSet).length) {
      store.dispatch(mergeUsersSet({ members: usersSet }));
    }
  });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <Message message={msg} isUser={false} isReply={false} />
      </Provider>
    );
  });
  const labels = () =>
    tree.root
      .findAllByType(Text)
      .map((n) =>
        (Array.isArray(n.props.children) ? n.props.children : [n.props.children])
          .filter((c: unknown) => typeof c === 'string')
          .join('')
      );
  return { tree, labels };
};

beforeEach(() => {
  mockStatus.value = 'pending';
  mockRequestUsers.mockClear();
});

describe('Message sender name chain', () => {
  it('prefers the usersSet name and does not request the sender', async () => {
    const { labels } = await mount(message({ user: { id: SENDER, name: 'Stale' } }), {
      [SENDER]: { xmppUsername: SENDER, firstName: 'Fresh', lastName: 'Name' },
    });
    expect(labels()).toContain('Fresh Name');
    expect(mockRequestUsers).not.toHaveBeenCalled();
  });

  it('requests an unknown sender', async () => {
    await mount(message());
    expect(mockRequestUsers).toHaveBeenCalledWith([SENDER]);
  });

  it('shows a muted placeholder, not Unknown user, while the lookup is pending', async () => {
    const { labels, tree } = await mount(message());
    expect(labels()).toContain('…');
    expect(labels()).not.toContain('Unknown user');
    const caption = tree.root
      .findAllByType(Text)
      .find((n) => n.props.children === '…');
    expect(JSON.stringify(caption!.props.style)).toContain('0.5');
  });

  it('falls back to the <data> sender name only after a failed lookup, last resort', async () => {
    mockStatus.value = 'failed';
    const { labels } = await mount(
      message({ senderFirstName: 'Data', senderLastName: 'Name' })
    );
    expect(labels()).toContain('Data Name');
    // never stored as if it were a profile
    expect(store.getState().rooms.usersSet[SENDER]).toBeUndefined();
  });

  it('does not show the <data> name while the lookup is still pending', async () => {
    const { labels } = await mount(
      message({ senderFirstName: 'Data', senderLastName: 'Name' })
    );
    expect(labels()).not.toContain('Data Name');
  });

  it('shows Unknown user after a failed lookup with no other name', async () => {
    mockStatus.value = 'failed';
    const { labels } = await mount(message());
    expect(labels()).toContain('Unknown user');
    expect(labels()).not.toContain(SENDER);
  });

  it('shows Deleted User only for a confirmed 404 with no <data>', async () => {
    mockStatus.value = 'notfound';
    const a = await mount(message());
    expect(a.labels()).toContain('Deleted User');

    const b = await mount(message({ fullName: 'Still Here' }));
    expect(b.labels()).toContain('Still Here');
    expect(b.labels()).not.toContain('Deleted User');
  });

  it('ignores a baked-in raw id or Deleted User as a name', async () => {
    mockStatus.value = 'forbidden';
    const { labels } = await mount(
      message({ user: { id: SENDER, name: 'Deleted User' } })
    );
    expect(labels()).toContain('Unknown user');
  });
});
