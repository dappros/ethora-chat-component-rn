/**
 * SendInput with several files.
 *
 *   - the document and library pickers allow several files; the library
 *     takes only as many as the tray has room for; the camera adds one shot
 *   - picks ADD to the tray; the tray caps at config.attachments.maxFiles
 *     (default 10) and refuses an oversize file with a localized message
 *   - the text typed with files goes out as the caption of ONE message
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Alert } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';

const mockLaunchImageLibrary = jest.fn();
const mockLaunchCamera = jest.fn();
const mockGetDocument = jest.fn();

jest.mock('expo-audio', () => ({
  __esModule: true,
  RecordingPresets: { HIGH_QUALITY: { extension: '.m4a' } },
  setAudioModeAsync: jest.fn(async () => {}),
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  useAudioRecorder: () => ({ prepareToRecordAsync: jest.fn(), record: jest.fn(), stop: jest.fn(async () => {}), getStatus: () => ({}) }),
}));
jest.mock('expo-file-system/legacy', () => ({
  __esModule: true,
  getInfoAsync: jest.fn(async () => ({ exists: false })),
}));
jest.mock('expo-image-picker', () => ({
  __esModule: true,
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: (...args: unknown[]) => (mockLaunchCamera as any)(...args),
  launchImageLibraryAsync: (...args: unknown[]) => (mockLaunchImageLibrary as any)(...args),
  UIImagePickerControllerQualityType: { Medium: 1 },
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 1 },
}));
jest.mock('expo-document-picker', () => ({
  __esModule: true,
  getDocumentAsync: (...args: unknown[]) => (mockGetDocument as any)(...args),
}));
jest.mock('expo-video', () => ({
  __esModule: true,
  useVideoPlayer: jest.fn(() => ({ play: jest.fn(), pause: jest.fn() })),
  VideoView: () => null,
}));
jest.mock('expo-image-manipulator', () => ({
  __esModule: true,
  manipulateAsync: jest.fn(async () => ({ uri: 'file:///out.jpg' })),
  SaveFormat: { JPEG: 'jpeg' },
}));

import SendInput from '../src/components/styled/SendInput';

const flush = async () => {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

const docs = (...names: string[]) => ({
  canceled: false,
  assets: names.map((name, i) => ({
    uri: `file:///docs/${name}`,
    name,
    mimeType: 'application/pdf',
    size: 1000 + i,
  })),
});

const photo = (n: number, size = 2000) => ({
  uri: `file:///photos/${n}.jpg`,
  type: 'image',
  mimeType: 'image/jpeg',
  fileName: `${n}.jpg`,
  fileSize: size,
});

const render = async (props: Record<string, unknown> = {}) => {
  const sendMedia = jest.fn(async () => true);
  const sendMessage = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <SendInput
          sendMessage={sendMessage}
          sendMedia={sendMedia}
          isLoading={false}
          config={{ enableAudio: false, ...(props.config as object) } as any}
          maxMediaBytes={props.maxMediaBytes as number | undefined}
        />
      </Provider>
    );
  });
  return { tree, sendMedia, sendMessage };
};

const findWithProp = (tree: renderer.ReactTestRenderer, prop: string) =>
  tree.root.find((n) => typeof (n.props as any)?.[prop] === 'function');

const pressTestID = async (tree: renderer.ReactTestRenderer, testID: string) => {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  );
  await act(async () => {
    node.props.onPress();
  });
  await flush();
};

// Host nodes only: a styled wrapper and the view under it share the testID.
const trayCount = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAll(
    (n) =>
      typeof n.type === 'string' &&
      typeof n.props?.testID === 'string' &&
      /^media-tray-remove-\d+$/.test(n.props.testID)
  ).length;

const typeText = async (tree: renderer.ReactTestRenderer, text: string) => {
  const input = tree.root.find(
    (n) => n.props?.testID === 'chat-message-input' && typeof n.props?.onChangeText === 'function'
  );
  await act(async () => {
    input.props.onChangeText(text);
  });
};

const sendButtonDisabled = (tree: renderer.ReactTestRenderer) =>
  tree.root.find(
    (n) => n.props?.testID === 'chat-send-button' && typeof n.props?.onPress === 'function'
  ).props.disabled;

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  mockLaunchImageLibrary.mockReset();
  mockLaunchCamera.mockReset();
  mockGetDocument.mockReset();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('SendInput: picking several files', () => {
  it('the document picker allows several files and each joins the tray', async () => {
    mockGetDocument.mockResolvedValue(docs('a.pdf', 'b.pdf'));
    const { tree } = await render();
    await act(async () => {
      findWithProp(tree, 'onDocument').props.onDocument();
    });
    await flush();

    expect(mockGetDocument).toHaveBeenCalledWith(expect.objectContaining({ multiple: true }));
    expect(trayCount(tree)).toBe(2);
  });

  it('the library asks for as many as the tray has room for', async () => {
    mockGetDocument.mockResolvedValue(docs('a.pdf', 'b.pdf'));
    mockLaunchImageLibrary.mockResolvedValue({ canceled: false, assets: [photo(1)] });
    const { tree } = await render({ config: { attachments: { maxFiles: 5 } } });

    await act(async () => {
      findWithProp(tree, 'onDocument').props.onDocument();
    });
    await flush();
    await act(async () => {
      findWithProp(tree, 'onGallery').props.onGallery();
    });
    await flush();

    expect(mockLaunchImageLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ allowsMultipleSelection: true, selectionLimit: 3 })
    );
    expect(trayCount(tree)).toBe(3);
  });

  it('a camera shot adds to the tray instead of replacing it', async () => {
    mockGetDocument.mockResolvedValue(docs('a.pdf'));
    mockLaunchCamera.mockResolvedValue({ canceled: false, assets: [photo(9)] });
    const { tree } = await render();

    await act(async () => {
      findWithProp(tree, 'onDocument').props.onDocument();
    });
    await flush();
    await act(async () => {
      findWithProp(tree, 'onCamera').props.onCamera();
    });
    await flush();

    expect(trayCount(tree)).toBe(2);
  });

  it('caps the tray at config.attachments.maxFiles and says so', async () => {
    mockGetDocument.mockResolvedValue(docs('a.pdf', 'b.pdf', 'c.pdf'));
    const { tree } = await render({ config: { attachments: { maxFiles: 2 } } });
    await act(async () => {
      findWithProp(tree, 'onDocument').props.onDocument();
    });
    await flush();

    expect(trayCount(tree)).toBe(2);
    expect(alertSpy).toHaveBeenCalled();
  });

  it('refuses a file over the size limit with a message and keeps the rest', async () => {
    mockGetDocument.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file:///docs/small.pdf', name: 'small.pdf', mimeType: 'application/pdf', size: 1000 },
        { uri: 'file:///docs/huge.pdf', name: 'huge.pdf', mimeType: 'application/pdf', size: 5 * 1024 * 1024 },
      ],
    });
    const { tree } = await render({ config: { attachments: { maxSizeMB: 1 } } });
    await act(async () => {
      findWithProp(tree, 'onDocument').props.onDocument();
    });
    await flush();

    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('huge.pdf'));
    expect(trayCount(tree)).toBe(1);
  });

  it('a full tray does not open the library', async () => {
    mockGetDocument.mockResolvedValue(docs('a.pdf', 'b.pdf'));
    const { tree } = await render({ config: { attachments: { maxFiles: 2 } } });
    await act(async () => {
      findWithProp(tree, 'onDocument').props.onDocument();
    });
    await flush();
    await act(async () => {
      findWithProp(tree, 'onGallery').props.onGallery();
    });
    await flush();
    expect(mockLaunchImageLibrary).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalled();
  });
});

describe('SendInput: sending the tray', () => {
  it('the send button is disabled while there is nothing to send', async () => {
    const { tree } = await render();
    expect(sendButtonDisabled(tree)).toBe(true);
  });

  it('sends the files as ONE message, with the typed text as its caption', async () => {
    mockGetDocument.mockResolvedValue(docs('a.pdf', 'b.pdf'));
    const { tree, sendMedia, sendMessage } = await render();
    await act(async () => {
      findWithProp(tree, 'onDocument').props.onDocument();
    });
    await flush();
    await typeText(tree, 'here they are');
    await pressTestID(tree, 'chat-send-button');

    expect(sendMedia).toHaveBeenCalledTimes(1);
    const [files, type, caption] = (sendMedia.mock.calls as any[])[0];
    expect(files).toHaveLength(2);
    expect(files.map((f: any) => f.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(type).toBe('application/pdf');
    expect(caption).toEqual({ text: 'here they are' });
    // The text is never a separate message.
    expect(sendMessage).not.toHaveBeenCalled();
    expect(trayCount(tree)).toBe(0);
  });

  it('sends the files without a caption when no text was typed', async () => {
    mockGetDocument.mockResolvedValue(docs('a.pdf'));
    const { tree, sendMedia } = await render();
    await act(async () => {
      findWithProp(tree, 'onDocument').props.onDocument();
    });
    await flush();
    await pressTestID(tree, 'chat-send-button');
    expect(sendMedia).toHaveBeenCalledWith(expect.any(Array), 'application/pdf', undefined);
  });

  it('a remove button takes one file out of the tray', async () => {
    mockGetDocument.mockResolvedValue(docs('a.pdf', 'b.pdf'));
    const { tree } = await render();
    await act(async () => {
      findWithProp(tree, 'onDocument').props.onDocument();
    });
    await flush();
    await pressTestID(tree, 'media-tray-remove-0');
    expect(trayCount(tree)).toBe(1);
  });
});
