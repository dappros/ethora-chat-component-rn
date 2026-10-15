jest.mock('../src/components/styled/VideoMessage', () => ({
  __esModule: true,
  default: 'VideoMessage',
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import chatSettingsReducer, {
  setActiveFile,
  setActiveModal,
} from '../src/roomStore/chatSettingsSlice';
import roomsReducer from '../src/roomStore/roomsSlice';
import { MODAL_TYPES } from '../src/helpers/constants/MODAL_TYPES';
import AlbumGrid from '../src/components/MainComponents/AlbumGrid';
import CustomMessageImage from '../src/components/styled/MessageImage';
import { IAttachment } from '../src/types/types';

const store = configureStore({
  reducer: { chatSettingStore: chatSettingsReducer, rooms: roomsReducer },
  middleware: (g) => g({ serializableCheck: false, immutableCheck: false }),
});

const photo = (n: number, extra: Partial<IAttachment> = {}): IAttachment => ({
  attachmentId: `p${n}`,
  location: `https://f.example/files/${n}.jpg`,
  locationPreview: `https://f.example/files/${n}-s.jpg`,
  mimetype: 'image/jpeg',
  originalName: `${n}.jpg`,
  ...extra,
});

const mount = async (attachments: IAttachment[], width = 240) => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <AlbumGrid attachments={attachments} width={width} />
      </Provider>
    );
  });
  return tree;
};

const tiles = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAll(
    (n) => typeof n.type === 'string' && /^album-tile-\d+$/.test(String(n.props.testID))
  );

beforeEach(async () => {
  await act(async () => {
    store.dispatch(setActiveFile({ fileName: '', fileURL: '', mimetype: '' }));
    store.dispatch(setActiveModal(undefined));
  });
});

describe('<AlbumGrid />', () => {
  it.each([
    [2, 2],
    [3, 3],
    [4, 4],
  ])('draws %i files as %i tiles and no +N', async (count, drawn) => {
    const tree = await mount(Array.from({ length: count }, (_, i) => photo(i)));
    expect(tiles(tree)).toHaveLength(drawn);
    expect(tree.root.findAll((n) => n.props.testID === 'album-more')).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  it('sizes the grid and its tiles from the layout', async () => {
    const tree = await mount([photo(0), photo(1)], 243);
    const grid = tree.root.find(
      (n) => typeof n.type === 'string' && n.props.testID === 'album-grid'
    );
    const flat = (s: any) => Object.assign({}, ...[].concat(s).flat(3).filter(Boolean));
    expect(flat(grid.props.style)).toMatchObject({ width: 243, height: 122 });
    const [a, b] = tiles(tree).map((n) => flat(n.props.style));
    expect(a).toMatchObject({ position: 'absolute', left: 0, top: 0 });
    expect(b!.left).toBeGreaterThan(a!.width);
    await act(async () => tree.unmount());
  });

  it('hands every picture the size of its cell and no size probe', async () => {
    const tree = await mount([photo(0), photo(1), photo(2)]);
    const images = tree.root.findAllByType(CustomMessageImage);
    expect(images).toHaveLength(3);
    expect(images[0]!.props.tile.width).toBeGreaterThan(images[1]!.props.tile.width);
    expect(images[0]!.props.locationPreview).toBe('https://f.example/files/0-s.jpg');
    await act(async () => tree.unmount());
  });

  it('draws four tiles and a +N for the rest of 6 files', async () => {
    const tree = await mount(Array.from({ length: 6 }, (_, i) => photo(i)));
    expect(tiles(tree)).toHaveLength(4);
    const more = tree.root.find((n) => n.props.testID === 'album-more' && n.props.onPress);
    expect(JSON.stringify(tree.toJSON())).toContain('+2');
    expect(more.props.accessibilityLabel).toBe('2 more files');
    await act(async () => tree.unmount());
  });

  it('opens the viewer at the tapped tile with the whole album as siblings', async () => {
    const tree = await mount(Array.from({ length: 6 }, (_, i) => photo(i)));
    const second = tree.root.findAllByType(CustomMessageImage)[1]!;
    await act(async () => second.props.onOpen());

    const { activeFile, activeModal } = store.getState().chatSettingStore;
    expect(activeModal).toBe(MODAL_TYPES.FILE_PREVIEW);
    expect(activeFile).toMatchObject({
      fileURL: 'https://f.example/files/1.jpg',
      mimetype: 'image/jpeg',
      index: 1,
    });
    expect(activeFile?.siblings).toHaveLength(6);
    await act(async () => tree.unmount());
  });

  it('opens the viewer at the +N tile, with the hidden files still in the siblings', async () => {
    const tree = await mount(Array.from({ length: 7 }, (_, i) => photo(i)));
    const more = tree.root.find((n) => n.props.testID === 'album-more' && n.props.onPress);
    await act(async () => more.props.onPress());

    const { activeFile } = store.getState().chatSettingStore;
    expect(activeFile?.index).toBe(3);
    expect(activeFile?.fileURL).toBe('https://f.example/files/3.jpg');
    expect(activeFile?.siblings?.map((s) => s.fileURL)).toContain(
      'https://f.example/files/6.jpg'
    );
    await act(async () => tree.unmount());
  });

  it('draws a video as the poster tile', async () => {
    const tree = await mount([
      photo(0),
      photo(1, {
        mimetype: 'video/mp4',
        originalName: 'clip.mp4',
        location: 'https://f.example/files/clip.mp4',
        locationPreview: 'https://f.example/files/clip-s.jpg',
      }),
    ]);
    const video = tree.root.findAll((n) => n.type === ('VideoMessage' as any));
    expect(video).toHaveLength(1);
    expect(video[0]!.props).toMatchObject({
      fileURL: 'https://f.example/files/clip.mp4',
      previewURL: 'https://f.example/files/clip-s.jpg',
    });
    expect(video[0]!.props.tile).toBeDefined();
    await act(async () => tree.unmount());
  });
});
