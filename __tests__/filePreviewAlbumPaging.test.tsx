/**
 * The media viewer (pictures and videos opened from a bubble): a sideways
 * swipe pages through an album, a tap hides and shows the chrome, a long
 * enough drag up or down closes it, and the bottom bar offers Reply / Delete
 * for the message the file came from. Gestures are recorded by the mock below
 * and driven by hand.
 */
const mockGestures: Record<string, Record<string, (e: any) => void>> = {};
jest.mock('react-native-gesture-handler', () => {
  const make = (kind: string) => {
    const handlers: Record<string, (e: any) => void> = {};
    mockGestures[kind] = handlers;
    const chain: any = new Proxy(
      {},
      {
        get: (_target, key: string) => (arg: any) => {
          if (typeof arg === 'function') {handlers[key] = arg;}
          return chain;
        },
      }
    );
    return chain;
  };
  return {
    Gesture: new Proxy({}, { get: (_target, kind: string) => () => make(kind) }),
    GestureDetector: ({ children }: any) => children,
  };
});
jest.mock('../src/components/Modals/FilePreviewModal/PdfView', () => ({
  __esModule: true,
  default: 'PdfViewer',
}));
jest.mock('../src/components/Modals/FilePreviewModal/DocumentViewer', () => ({
  __esModule: true,
  default: 'DocumentViewer',
}));
jest.mock('../src/components/styled/AudioMessage', () => ({
  __esModule: true,
  default: 'AudioMessage',
}));
jest.mock('../src/context/ToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import chatSettingsReducer, { setActiveFile } from '../src/roomStore/chatSettingsSlice';
import roomsReducer, { addRoom, setRoomMessages } from '../src/roomStore/roomsSlice';
import FilePreviewModal from '../src/components/Modals/FilePreviewModal/FilePreviewModal';
import type { ModalFile } from '../src/types/types';
import { FILES } from './fixtures/mediaStanzas';

const settle = () => act(() => new Promise((r) => setTimeout(r, 450)));

const makeStore = (actions: string[]) =>
  configureStore({
    reducer: { chatSettingStore: chatSettingsReducer, rooms: roomsReducer },
    middleware: (g) =>
      g({ serializableCheck: false, immutableCheck: false }).concat(
        () => (next: any) => (action: any) => {
          actions.push(action.type);
          return next(action);
        }
      ),
  });

const ROOM = 'room@conference.x';

const siblings = [0, 1, 2].map((n) => ({
  fileName: `${n}.jpg`,
  fileURL: `${FILES}/${n}.jpg`,
  mimetype: 'image/jpeg',
}));

const open = async (file: ModalFile, messages?: any[]) => {
  const actions: string[] = [];
  const store = makeStore(actions);
  if (messages) {
    store.dispatch(
      addRoom({
        roomData: { jid: ROOM, name: 'r', title: 'R', usersCnt: 2, messages: [], isLoading: false, roomBg: '', historyComplete: true } as any,
      })
    );
    store.dispatch(setRoomMessages({ roomJID: ROOM, messages }));
  }
  const handleCloseModal = jest.fn();
  store.dispatch(setActiveFile(file));
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <FilePreviewModal handleCloseModal={handleCloseModal} />
      </Provider>
    );
  });
  const all = (id: string) => tree.root.findAll((n) => n.props?.testID === id);
  const byId = (id: string) =>
    tree.root.find((n) => n.props?.testID === id && n.props?.onPress);
  const text = () => JSON.stringify(tree.toJSON());
  const pan = mockGestures.Pan!;
  const drag = async (x: number, y: number) => {
    const e = { translationX: x, translationY: y, velocityX: 0, velocityY: 0 };
    await act(async () => {
      pan.onStart!(e);
      pan.onUpdate!(e);
      pan.onEnd!(e);
    });
    await settle();
  };
  return { store, tree, all, byId, text, drag, actions, handleCloseModal };
};

describe('paging through an album in the viewer', () => {
  it('shows the position and swipes to the next and previous file', async () => {
    const v = await open({ ...siblings[1]!, siblings, index: 1 });
    expect(v.text()).toContain('2 of 3');

    await v.drag(-200, 0);
    expect(v.store.getState().chatSettingStore.activeFile).toMatchObject({
      fileURL: `${FILES}/2.jpg`,
      index: 2,
    });
    expect(v.store.getState().chatSettingStore.activeFile?.siblings).toHaveLength(3);

    // Past the last file the swipe springs back.
    await v.drag(-200, 0);
    expect(v.store.getState().chatSettingStore.activeFile?.index).toBe(2);

    await v.drag(200, 0);
    await v.drag(200, 0);
    expect(v.store.getState().chatSettingStore.activeFile?.index).toBe(0);
    expect(v.text()).toContain('1 of 3');
    await act(async () => v.tree.unmount());
  });

  it('has no position for a single file', async () => {
    const v = await open(siblings[0]!);
    expect(v.text()).not.toContain(' of ');
    await act(async () => v.tree.unmount());
  });
});

describe('paging through the chat from a bubble', () => {
  const at = (minute: number) => `2026-10-20T10:0${minute}:00Z`;
  const message = (id: string, minute: number, over: any = {}) => ({
    id,
    roomJid: ROOM,
    body: 'media',
    date: at(minute),
    isMediafile: 'true',
    location: `${FILES}/${id}.jpg`,
    mimetype: 'image/jpeg',
    user: { id: 'other', firstName: 'Bob' },
    ...over,
  });
  const messages = [
    message('m1', 1),
    message('m2', 2, { location: `${FILES}/doc.pdf`, mimetype: 'application/pdf' }),
    message('m3', 3, { location: `${FILES}/a.jpg,${FILES}/b.jpg` }),
    message('m4', 4),
  ];

  it('swipes across messages, through an album, oldest on the left', async () => {
    const v = await open(
      {
        fileName: 'm1.jpg',
        fileURL: `${FILES}/m1.jpg`,
        mimetype: 'image/jpeg',
        source: { messageId: 'm1', roomJid: ROOM, own: false },
      },
      messages
    );
    expect(v.text()).toContain('1 of 4');

    // Nothing older: the swipe to the right springs back.
    await v.drag(200, 0);
    expect(v.store.getState().chatSettingStore.activeFile?.fileURL).toBe(`${FILES}/m1.jpg`);

    const urls: string[] = [];
    for (let i = 0; i < 3; i++) {
      await v.drag(-200, 0);
      urls.push(v.store.getState().chatSettingStore.activeFile!.fileURL);
    }
    expect(urls).toEqual([`${FILES}/a.jpg`, `${FILES}/b.jpg`, `${FILES}/m4.jpg`]);
    expect(v.text()).toContain('4 of 4');

    await v.drag(200, 0);
    expect(v.store.getState().chatSettingStore.activeFile?.fileURL).toBe(`${FILES}/b.jpg`);
    await act(async () => v.tree.unmount());
  });

  it('keeps the album alone when the message is not in the loaded history', async () => {
    const v = await open(
      { ...siblings[0]!, siblings, index: 0, source: { messageId: 'gone', roomJid: ROOM } },
      messages
    );
    expect(v.text()).toContain('1 of 3');
    await act(async () => v.tree.unmount());
  });
});

describe('the media viewer', () => {
  it('hides the chrome on a tap and brings it back on the next', async () => {
    const v = await open(siblings[0]!);
    const topBar = () =>
      v.tree.root.find((n) => n.props?.pointerEvents && n.findAll((c) => c.props?.testID === 'media-viewer-back').length > 0 && n.props.style);
    expect(topBar().props.pointerEvents).toBe('box-none');
    await act(async () => v.byId('media-viewer-surface').props.onPress());
    expect(topBar().props.pointerEvents).toBe('none');
    await act(async () => v.byId('media-viewer-surface').props.onPress());
    expect(topBar().props.pointerEvents).toBe('box-none');
    await act(async () => v.tree.unmount());
  });

  it('closes on a long enough drag down, and stays on a short one', async () => {
    const v = await open(siblings[0]!);
    await v.drag(0, 40);
    expect(v.handleCloseModal).not.toHaveBeenCalled();
    await v.drag(0, 400);
    expect(v.handleCloseModal).toHaveBeenCalled();
    expect(v.store.getState().chatSettingStore.activeFile?.fileURL).toBe('');
    await act(async () => v.tree.unmount());
  });

  it('has no Reply or Delete for a file without a message', async () => {
    const v = await open(siblings[0]!);
    expect(v.all('media-viewer-reply')).toHaveLength(0);
    expect(v.all('media-viewer-delete')).toHaveLength(0);
    await act(async () => v.tree.unmount());
  });

  it('replies to and deletes the message the file came from', async () => {
    const source = {
      messageId: 'm1',
      roomJid: 'room@conference.x',
      own: true,
      replyTo: { id: 'm1', chatJID: 'room@conference.x' },
      senderName: 'Ann Lee',
    };
    const v = await open({ ...siblings[0]!, source });
    expect(v.text()).toContain('Ann Lee');

    await act(async () => v.byId('media-viewer-delete').props.onPress());
    await settle();
    expect(v.store.getState().chatSettingStore.deleteModal).toEqual({
      isDeleteModal: true,
      roomJid: 'room@conference.x',
      messageId: 'm1',
    });
    expect(v.handleCloseModal).toHaveBeenCalled();
    await act(async () => v.tree.unmount());

    const r = await open({ ...siblings[0]!, source });
    await act(async () => r.byId('media-viewer-reply').props.onPress());
    expect(r.actions).toContain('roomMessages/setActiveMessage');
    await act(async () => r.tree.unmount());
  });

  it('offers no Delete on someone else\'s message', async () => {
    const v = await open({
      ...siblings[0]!,
      source: { messageId: 'm2', roomJid: 'r@c', own: false },
    });
    expect(v.all('media-viewer-delete')).toHaveLength(0);
    expect(v.all('media-viewer-reply')).toHaveLength(0);
    await act(async () => v.tree.unmount());
  });
});
