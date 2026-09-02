import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Modal, Text } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { setConfig, setUser } from '../src/roomStore/chatSettingsSlice';
import NewChatModal from '../src/components/Modals/NewChatModal/NewChatModal';
import { postRoom } from '../src/networking/api-requests/rooms.api';

jest.mock('../src/networking/api-requests/rooms.api', () => ({
  ...jest.requireActual('../src/networking/api-requests/rooms.api'),
  postRoom: jest.fn(async () => ({
    _id: 'r1',
    name: 'newroom',
    title: 'New room',
    type: 'public',
  })),
}));

jest.mock('expo-image-picker', () => ({
  __esModule: true,
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
}));

jest.mock('../src/context/xmppProvider', () => ({
  useXmppClient: () => ({ client: { getRoomsStanza: jest.fn(), createRoomStanza: jest.fn() } }),
}));

jest.mock('../src/context/ToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

const postRoomMock = postRoom as jest.Mock;

const PRIMARY = '#22C55E';

const render = async (props: { handleCloseModal?: jest.Mock } = {}) => {
  await act(async () => {
    store.dispatch(setUser({ firstName: 'Ann', token: 'jwt' } as any));
    store.dispatch(
      setConfig({ newArch: true, colors: { primary: PRIMARY } } as any)
    );
  });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <NewChatModal {...props} />
      </Provider>
    );
  });
  const node = (id: string) => tree.root.find((n) => n.props?.testID === id);
  const has = (id: string) =>
    tree.root.findAll((n) => n.props?.testID === id).length > 0;
  const texts = () =>
    tree.root
      .findAllByType(Text)
      .map((n) => n.props.children)
      .filter((c) => typeof c === 'string') as string[];
  const type = async (id: string, value: string) => {
    await act(async () => {
      node(id).props.onChangeText(value);
    });
  };
  return { tree, node, has, texts, type };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Create new chat modal', () => {
  it('covers the whole window with a real Modal, not an in-tree overlay', async () => {
    const { tree, node } = await render();
    const modal = tree.root.findByType(Modal);
    expect(modal.props.visible).toBe(true);
    expect(modal.props.transparent).toBe(true);
    // Without this the host's own chrome (status bar area, tab bars) stays lit.
    expect(modal.props.statusBarTranslucent).toBe(true);
    // And the ground is opaque — the chat list must not read through it.
    const ground = node('new-chat-backdrop').parent!.props.style;
    const color = (Array.isArray(ground) ? ground : [ground])
      .map((s: any) => s?.backgroundColor)
      .find(Boolean);
    expect(color).toBeTruthy();
    expect(String(color)).not.toMatch(/rgba|transparent/i);
  });

  it('paints the primary action with the configured colour, not the old blue', async () => {
    const { node } = await render();
    const style = node('new-chat-submit').props.style.flat();
    expect(style).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: PRIMARY })])
    );
    expect(JSON.stringify(style)).not.toContain('0052CD');
  });

  it('keeps Create disabled until the name is long enough', async () => {
    const { node, type, has } = await render();
    expect(node('new-chat-submit').props.disabled).toBe(true);

    await type('new-chat-name', 'ab');
    expect(node('new-chat-submit').props.disabled).toBe(true);
    expect(has('new-chat-name-error')).toBe(true);

    await type('new-chat-name', 'Team room');
    expect(node('new-chat-submit').props.disabled).toBe(false);
    expect(has('new-chat-name-error')).toBe(false);
  });

  it('creates the room with the typed name and description', async () => {
    const handleCloseModal = jest.fn();
    const { node, type } = await render({ handleCloseModal });
    await type('new-chat-name', 'Team room');
    await type('new-chat-description', 'For the team');
    await act(async () => {
      node('new-chat-submit').props.onPress();
    });
    expect(postRoomMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Team room',
        description: 'For the team',
        type: 'public',
      })
    );
    expect(handleCloseModal).toHaveBeenCalled();
  });

  it('falls back to a placeholder description when none is typed', async () => {
    const { node, type } = await render({ handleCloseModal: jest.fn() });
    await type('new-chat-name', 'Team room');
    await act(async () => {
      node('new-chat-submit').props.onPress();
    });
    expect(postRoomMock).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'No description' })
    );
  });

  it('Cancel and the backdrop both close and reset the form', async () => {
    const handleCloseModal = jest.fn();
    const { node, type } = await render({ handleCloseModal });
    await type('new-chat-name', 'Team room');
    await act(async () => {
      node('new-chat-cancel').props.onPress();
    });
    expect(handleCloseModal).toHaveBeenCalledTimes(1);
    expect(node('new-chat-name').props.value).toBe('');

    await act(async () => {
      node('new-chat-backdrop').props.onPress();
    });
    expect(handleCloseModal).toHaveBeenCalledTimes(2);
  });

  it('has no private-chat toggle', async () => {
    const { texts } = await render();
    expect(texts().some((label) => /private/i.test(label))).toBe(false);
  });
});
