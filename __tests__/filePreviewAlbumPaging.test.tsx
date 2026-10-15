jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({}),
  VideoView: 'VideoView',
}));
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
import roomsReducer from '../src/roomStore/roomsSlice';
import FilePreviewModal from '../src/components/Modals/FilePreviewModal/FilePreviewModal';
import { FILES } from './fixtures/mediaStanzas';

const makeStore = () =>
  configureStore({
    reducer: { chatSettingStore: chatSettingsReducer, rooms: roomsReducer },
    middleware: (g) => g({ serializableCheck: false, immutableCheck: false }),
  });

const siblings = [0, 1, 2].map((n) => ({
  fileName: `${n}.jpg`,
  fileURL: `${FILES}/${n}.jpg`,
  mimetype: 'image/jpeg',
}));

const open = async (index: number, withSiblings = true) => {
  const store = makeStore();
  store.dispatch(
    setActiveFile({
      ...siblings[index]!,
      ...(withSiblings ? { siblings, index } : {}),
    })
  );
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <FilePreviewModal handleCloseModal={jest.fn()} />
      </Provider>
    );
  });
  const byId = (id: string) =>
    tree.root.find((n) => n.props?.testID === id && n.props?.onPress);
  return { store, tree, byId };
};

describe('paging through an album in the viewer', () => {
  it('shows the position and steps to the next and previous file', async () => {
    const { store, tree, byId } = await open(1);
    expect(JSON.stringify(tree.toJSON())).toContain('2 of 3');

    await act(async () => byId('file-preview-next').props.onPress());
    expect(store.getState().chatSettingStore.activeFile).toMatchObject({
      fileURL: `${FILES}/2.jpg`,
      index: 2,
    });
    expect(store.getState().chatSettingStore.activeFile?.siblings).toHaveLength(3);

    await act(async () => byId('file-preview-prev').props.onPress());
    await act(async () => byId('file-preview-prev').props.onPress());
    expect(store.getState().chatSettingStore.activeFile?.index).toBe(0);
    expect(JSON.stringify(tree.toJSON())).toContain('1 of 3');
    await act(async () => tree.unmount());
  });

  it('has no paging for a single file', async () => {
    const { tree } = await open(0, false);
    expect(
      tree.root.findAll((n) => n.props?.testID === 'file-preview-album-nav')
    ).toHaveLength(0);
    await act(async () => tree.unmount());
  });
});
