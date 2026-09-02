import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Image, Modal, Platform, Text } from 'react-native';
import { Provider } from 'react-redux';
import AttachSheet, {
  shouldClaimVerticalDrag,
  shouldDismissOnDrag,
} from '../src/components/Modals/AttachSheet/AttachSheet';
import { store } from '../src/roomStore';

// The sheet reads recent photos through expo-media-library (an optional
// peer). Since SDK 54 the function API only works when imported from the
// `/legacy` subpath — the root's same-named exports throw on call — so the
// mock stands in for the subpath, which is what the runtime helper picks.
jest.mock('expo-media-library/legacy', () => ({
  MediaType: { photo: 'photo', video: 'video' },
  SortBy: { creationTime: 'creationTime' },
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getAssetsAsync: jest.fn(async () => ({
    assets: [
      { id: 'a1', uri: 'ph://a1', filename: 'IMG_0001.HEIC', mediaType: 'photo' },
      { id: 'a2', uri: 'ph://a2', filename: 'IMG_0002.JPG', mediaType: 'photo' },
    ],
  })),
  getAssetInfoAsync: jest.fn(async (asset: any) => ({
    localUri: `file:///local/${asset.filename}`,
  })),
}));

const MediaLibrary = require('expo-media-library/legacy');

const originalOS = Platform.OS;

// The strip loads 250ms after the sheet opens, so the entry animation
// isn't competing with the library query for the JS thread.
const flushRecentsLoad = async () => {
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
};
const setOS = (os: 'ios' | 'android') =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  MediaLibrary.getAssetInfoAsync.mockImplementation(async (asset: any) => ({
    localUri: `file:///local/${asset.filename}`,
  }));
  jest.useRealTimers();
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  jest.clearAllMocks();
});

const renderSheet = async (overrides: Partial<Record<string, any>> = {}) => {
  const props = {
    onClose: jest.fn(),
    onCamera: jest.fn(),
    onGallery: jest.fn(),
    onDocument: jest.fn(),
    onPickMedia: jest.fn(),
    ...overrides,
  };
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <AttachSheet visible {...(props as any)} />
      </Provider>
    );
  });
  await flushRecentsLoad();
  return { tree, props };
};

describe('AttachSheet recents strip', () => {
  it('renders the camera tile plus a thumbnail per recent asset', async () => {
    const { tree } = await renderSheet();
    expect(tree.root.find((n) => n.props?.testID === 'attach-row-Camera')).toBeTruthy();
    expect(tree.root.find((n) => n.props?.testID === 'attach-recent-a1')).toBeTruthy();
    expect(tree.root.find((n) => n.props?.testID === 'attach-recent-a2')).toBeTruthy();
  });

  it('never hands a ph:// uri to <Image> — RN has no loader for it', async () => {
    const { tree } = await renderSheet();
    const uris = tree.root.findAllByType(Image).map((n) => (n.props.source as any)?.uri);
    expect(uris).toEqual(
      expect.arrayContaining([
        'file:///local/IMG_0001.HEIC',
        'file:///local/IMG_0002.JPG',
      ])
    );
    expect(uris.some((u) => u?.startsWith('ph://'))).toBe(false);
  });

  it('passes an already-file uri through without a native round-trip', async () => {
    // Android hands out file:// straight from getAssetsAsync.
    MediaLibrary.getAssetsAsync.mockResolvedValueOnce({
      assets: [{ id: 'd1', uri: 'file:///storage/DCIM/a.jpg', filename: 'a.jpg', mediaType: 'photo' }],
    });
    const { tree } = await renderSheet();
    expect(tree.root.find((n) => n.props?.testID === 'attach-recent-d1')).toBeTruthy();
    expect(MediaLibrary.getAssetInfoAsync).not.toHaveBeenCalled();
  });

  it('drops iCloud-only assets rather than downloading them for a thumbnail', async () => {
    MediaLibrary.getAssetInfoAsync.mockImplementation(async (asset: any) =>
      asset.id === 'a1' ? { isNetworkAsset: true } : { localUri: `file:///local/${asset.filename}` }
    );
    const { tree } = await renderSheet();
    expect(tree.root.findAll((n) => n.props?.testID === 'attach-recent-a1')).toHaveLength(0);
    expect(tree.root.find((n) => n.props?.testID === 'attach-recent-a2')).toBeTruthy();
    // …and it asked the library not to fetch over the network.
    expect(MediaLibrary.getAssetInfoAsync).toHaveBeenCalledWith(
      expect.anything(),
      { shouldDownloadFromNetwork: false }
    );
  });

  it('asks the library for photos only — <Image> cannot decode a video file', async () => {
    await renderSheet();
    const options = MediaLibrary.getAssetsAsync.mock.calls[0][0];
    expect(options.mediaType).toEqual(['photo']);
    expect(options.first).toBeLessThanOrEqual(12);
  });

  it('keeps the full-library and document routes available', async () => {
    const { tree } = await renderSheet();
    expect(tree.root.find((n) => n.props?.testID === 'attach-view-library')).toBeTruthy();
    expect(tree.root.find((n) => n.props?.testID === 'attach-row-Document')).toBeTruthy();
  });

  it('hands the tapped photo over once the sheet has dismissed', async () => {
    setOS('ios');
    const { tree, props } = await renderSheet();
    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'attach-recent-a1').props.onPress();
    });
    // Deferred like every other row: nothing fires until the modal dismissed.
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onPickMedia).not.toHaveBeenCalled();

    await act(async () => {
      tree.root.findByType(Modal).props.onDismiss();
    });
    expect(props.onPickMedia).toHaveBeenCalledWith({
      uri: 'file:///local/IMG_0001.HEIC',
      name: 'IMG_0001.HEIC',
      // Typed from the extension so the HEIC→JPEG pass still triggers.
      mimeType: 'image/heic',
      isVideo: false,
    });
  });

  it('falls back to the library picker when the host handles no thumbnails', async () => {
    setOS('ios');
    const { tree, props } = await renderSheet({ onPickMedia: undefined });
    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'attach-recent-a1').props.onPress();
    });
    await act(async () => {
      tree.root.findByType(Modal).props.onDismiss();
    });
    expect(props.onGallery).toHaveBeenCalledTimes(1);
  });

  it('shows just the camera tile when library access is refused', async () => {
    MediaLibrary.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true });
    const { tree } = await renderSheet();
    expect(tree.root.findAll((n) => n.props?.testID === 'attach-recent-a1')).toHaveLength(0);
    // The camera never depends on library access, and the full-library
    // route stays reachable.
    expect(tree.root.find((n) => n.props?.testID === 'attach-row-Camera')).toBeTruthy();
    expect(tree.root.find((n) => n.props?.testID === 'attach-view-library')).toBeTruthy();
  });

  it('never prompts for permission itself — iOS cannot present an alert over the modal', async () => {
    MediaLibrary.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true });
    await renderSheet();
    expect(MediaLibrary.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('does not re-query the library when reopened moments later', async () => {
    const { tree, props } = await renderSheet();
    expect(MediaLibrary.getAssetsAsync).toHaveBeenCalledTimes(1);
    const element = (v: boolean) => (
      <Provider store={store}>
        <AttachSheet visible={v} {...(props as any)} />
      </Provider>
    );
    await act(async () => {
      tree.update(element(false));
    });
    await act(async () => {
      tree.update(element(true));
    });
    await flushRecentsLoad();
    expect(MediaLibrary.getAssetsAsync).toHaveBeenCalledTimes(1);
  });

  it('decodes thumbnails at display size instead of full resolution', async () => {
    const { tree } = await renderSheet();
    const source = tree.root
      .find((n) => n.props?.testID === 'attach-recent-a1')
      .findByType(Image).props.source as any;
    expect(source.width).toBeGreaterThan(0);
    expect(source.height).toBeGreaterThan(0);
    expect(source.width).toBeLessThanOrEqual(256);
  });
});

describe('AttachSheet drag to dismiss', () => {
  it('claims a pull on the grab handle the moment it is touched', async () => {
    const { tree } = await renderSheet();
    const grabber = tree.root.find((n) => n.props?.testID === 'attach-grabber');
    // Touch-down claim: nothing to negotiate against, so the handle always
    // drags rather than waiting for a movement threshold.
    expect(grabber.props.onStartShouldSetResponder()).toBe(true);
    expect(typeof grabber.props.onResponderRelease).toBe('function');
  });

  it('keeps a move-threshold drag on the sheet body', async () => {
    const { tree } = await renderSheet();
    const body = tree.root.find(
      (n) =>
        typeof n.props?.onMoveShouldSetResponder === 'function' &&
        n.props?.testID !== 'attach-grabber' &&
        typeof n.props?.onResponderRelease === 'function'
    );
    expect(body.props.onStartShouldSetResponder()).toBe(false);
  });

  it('has no Cancel button — the backdrop, back gesture and drag all close it', async () => {
    const { tree } = await renderSheet();
    const labels = tree.root
      .findAllByType(Text)
      .map((n) => n.props.children)
      .filter((c) => typeof c === 'string');
    expect(labels).not.toContain('Cancel');
  });

  it('claims only downward drags, never taps or horizontal swipes', () => {
    expect(shouldClaimVerticalDrag(20, 0)).toBe(true);
    expect(shouldClaimVerticalDrag(2, 0)).toBe(false); // tap jitter
    expect(shouldClaimVerticalDrag(-30, 0)).toBe(false); // upward
    expect(shouldClaimVerticalDrag(10, 40)).toBe(false); // strip scroll
  });

  it('dismisses on a long pull or a fast flick, snaps back otherwise', () => {
    expect(shouldDismissOnDrag(120, 0)).toBe(true);
    expect(shouldDismissOnDrag(20, 1.5)).toBe(true);
    expect(shouldDismissOnDrag(40, 0.2)).toBe(false);
  });
});
