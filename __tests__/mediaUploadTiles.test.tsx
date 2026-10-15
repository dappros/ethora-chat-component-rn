/**
 * Outgoing album tiles: each file of a pending multi-file message shows its
 * own upload progress, or Retry when it failed. A tile still on its way up
 * shows the file on this device and cannot be opened yet.
 */
jest.mock('../src/components/styled/VideoMessage', () => ({
  __esModule: true,
  default: 'VideoMessage',
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import chatSettingsReducer, { setActiveFile, setActiveModal } from '../src/roomStore/chatSettingsSlice';
import roomsReducer from '../src/roomStore/roomsSlice';
import AlbumGrid from '../src/components/MainComponents/AlbumGrid';
import MediaUploadOverlay from '../src/components/MainComponents/MediaUploadOverlay';
import CustomMessageImage from '../src/components/styled/MessageImage';
import { IAttachment } from '../src/types/types';
import { requestMediaRetry } from '../src/helpers/mediaSendRetry';

jest.mock('../src/helpers/mediaSendRetry', () => ({
  ...jest.requireActual('../src/helpers/mediaSendRetry'),
  requestMediaRetry: jest.fn(),
}));

const store = configureStore({
  reducer: { chatSettingStore: chatSettingsReducer, rooms: roomsReducer },
  middleware: (g) => g({ serializableCheck: false, immutableCheck: false }),
});

const outgoing = (n: number, extra: Partial<IAttachment> = {}): IAttachment => ({
  attachmentId: `msg:${n}`,
  location: '',
  mimetype: 'image/jpeg',
  originalName: `${n}.jpg`,
  localUrl: `file:///picked/${n}.jpg`,
  uploadStatus: 'uploading',
  uploadProgress: 0,
  ...extra,
});

const mount = async (attachments: IAttachment[], onRetryTile?: (p: number) => void) => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <AlbumGrid attachments={attachments} width={240} onRetryTile={onRetryTile} />
      </Provider>
    );
  });
  return tree;
};

const overlays = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'media-upload-overlay');

beforeEach(async () => {
  await act(async () => {
    store.dispatch(setActiveFile({ fileName: '', fileURL: '', mimetype: '' }));
    store.dispatch(setActiveModal(undefined));
  });
  (requestMediaRetry as jest.Mock).mockReset();
});

describe('<AlbumGrid /> outgoing tiles', () => {
  it('an uploading tile shows its progress and the file on this device', async () => {
    const tree = await mount([
      outgoing(0, { uploadProgress: 35 }),
      outgoing(1, { uploadStatus: undefined, uploadProgress: undefined, location: 'https://f/1.jpg', localUrl: undefined }),
    ]);
    const images = tree.root.findAllByType(CustomMessageImage);
    expect(images[0].props.fileURL).toBe('file:///picked/0.jpg');
    expect(images[1].props.fileURL).toBe('https://f/1.jpg');
    // Only the tile still going up has an overlay.
    expect(overlays(tree)).toHaveLength(1);
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('35%');
  });

  it('an outgoing tile does not open the viewer', async () => {
    const tree = await mount([outgoing(0), outgoing(1)]);
    const image = tree.root.findAllByType(CustomMessageImage)[0];
    expect(image.props.onOpen).toBeUndefined();
  });

  it('a failed tile offers Retry for that tile only', async () => {
    const onRetryTile = jest.fn();
    const tree = await mount(
      [outgoing(0), outgoing(1, { uploadStatus: 'failed', uploadProgress: 0 })],
      onRetryTile
    );
    const retry = tree.root.find(
      (n) => n.props.testID === 'media-upload-retry' && typeof n.props.onPress === 'function'
    );
    await act(async () => {
      retry.props.onPress();
    });
    expect(onRetryTile).toHaveBeenCalledWith(1);
  });
});

describe('<MediaUploadOverlay />', () => {
  it('shows a percentage while uploading and no Retry', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <Provider store={store}>
          <MediaUploadOverlay status="uploading" progress={72.4} onRetry={jest.fn()} />
        </Provider>
      );
    });
    expect(JSON.stringify(tree.toJSON())).toContain('72%');
    expect(
      tree.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'media-upload-retry')
    ).toHaveLength(0);
  });

  it('a failed file with no retry handler shows the failure without a button', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <Provider store={store}>
          <MediaUploadOverlay status="failed" />
        </Provider>
      );
    });
    expect(
      tree.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'media-upload-retry')
    ).toHaveLength(0);
    expect(overlays(tree)).toHaveLength(1);
  });
});
