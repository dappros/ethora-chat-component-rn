/**
 * E2EE, phase 5 - sealed attachments on the device: reading the picked
 * file, parking the ciphertext, downloading and opening, and the card that
 * drives it. The file system is an in-memory stand-in.
 */

const mockDisk = new Map<string, Uint8Array>();
const mockDirs = new Set<string>();
const mockJoin = (parts: any[]) => {
  const [head, ...rest] = parts.map((p) => (typeof p === 'string' ? p : p.uri));
  return [String(head).replace(/\/+$/, ''), ...rest.map((p) => String(p).replace(/^\/+|\/+$/g, ''))].join('/');
};

jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...parts: any[]) {
      this.uri = mockJoin(parts);
    }
    get exists() {
      return mockDisk.has(this.uri);
    }
    get size() {
      return mockDisk.get(this.uri)?.length ?? null;
    }
    async bytes() {
      const data = mockDisk.get(this.uri);
      if (!data) {throw new Error(`no such file ${this.uri}`);}
      return data.slice();
    }
    async text() {
      return Buffer.from(await this.bytes()).toString('utf8');
    }
    write(content: string | Uint8Array) {
      mockDisk.set(
        this.uri,
        typeof content === 'string' ? new Uint8Array(Buffer.from(content, 'utf8')) : content.slice()
      );
    }
    delete() {
      mockDisk.delete(this.uri);
    }
    async copy(target: File) {
      mockDisk.set(target.uri, (await this.bytes()).slice());
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: any[]) {
      this.uri = mockJoin(parts);
    }
    get exists() {
      return mockDirs.has(this.uri) || [...mockDisk.keys()].some((k) => k.startsWith(this.uri + '/'));
    }
    create() {
      mockDirs.add(this.uri);
    }
    delete() {
      mockDirs.delete(this.uri);
      for (const key of [...mockDisk.keys()]) {
        if (key.startsWith(this.uri + '/')) {mockDisk.delete(key);}
      }
    }
  }
  return { __esModule: true, File, Directory, Paths: { cache: { uri: 'file:///cache' } } };
});

const mockDownload = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  __esModule: true,
  cacheDirectory: 'file:///cache/',
  downloadAsync: (...args: any[]) => mockDownload(...args),
}));

// The players pull in native modules; what matters here is which component
// an opened attachment is handed to, and with what.
jest.mock('../src/components/styled/AudioMessage', () => 'AudioMessage');
jest.mock('../src/components/styled/VideoMessage', () => 'VideoMessage');

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { setConfig } from '../src/roomStore/chatSettingsSlice';
import {
  MAX_SEAL_BYTES,
  clearOpenedFiles,
  findOpened,
  openSealedAttachment,
  rememberOpened,
  sealPickedFile,
} from '../src/e2ee/sealedFiles';
import { openSealedFile, sealFileForUpload } from '../src/e2ee/fileEnvelope';
import SealedAttachment, {
  sealedAttachmentsOf,
} from '../src/components/MainComponents/SealedAttachment';
import FileDownload from '../src/components/styled/UnsupportedType';
import CustomMessageImage from '../src/components/styled/MessageImage';

const photo = Uint8Array.from({ length: 50_000 }, (_, i) => (i * 13) & 0xff);
const LOCATION = 'https://secure-files.host/secure-media/f3a9';

/** Puts a sealed copy of `bytes` on the "server" and returns its key. */
const upload = async (bytes: Uint8Array, name: string, type: string) => {
  const sealed = await sealFileForUpload({ bytes, name, type });
  mockDownload.mockImplementation(async (_url: string, to: string) => {
    mockDisk.set(to, sealed.ciphertext.slice());
    return { status: 200, uri: to };
  });
  return sealed.keyMaterial;
};

beforeEach(() => {
  mockDisk.clear();
  mockDirs.clear();
  mockDownload.mockReset();
});

describe('sealing a picked file', () => {
  it('parks ciphertext under a random name and hands back the key', async () => {
    mockDisk.set('file:///picked/IMG_0001.jpg', photo);
    const sealed = await sealPickedFile({
      uri: 'file:///picked/IMG_0001.jpg',
      name: 'IMG_0001.jpg',
      type: 'image/jpeg',
      size: photo.length,
    });

    expect(sealed.name).toMatch(/^[0-9a-f]{32}$/);
    expect(sealed.uri).toBe(`file:///cache/ethora-seal-${sealed.name}`);
    const parked = mockDisk.get(sealed.uri)!;
    expect(Buffer.from(parked).toString('latin1')).not.toContain('IMG_0001');
    const opened = await openSealedFile(parked, sealed.keyMaterial);
    expect(opened.meta).toEqual({ mimetype: 'image/jpeg', originalname: 'IMG_0001.jpg', size: photo.length });

    sealed.dispose();
    expect(mockDisk.has(sealed.uri)).toBe(false);
    // Twice is fine.
    sealed.dispose();
  });

  it('refuses what is too large for this device, by declared and by real size', async () => {
    await expect(
      sealPickedFile({ uri: 'file:///picked/big.mov', size: MAX_SEAL_BYTES + 1 })
    ).rejects.toThrow('sealed_attachment_too_large');

    // A picker that under-reports does not get the file through either.
    mockDisk.set('file:///picked/liar.mov', new Uint8Array(MAX_SEAL_BYTES + 1));
    await expect(
      sealPickedFile({ uri: 'file:///picked/liar.mov', size: 10 })
    ).rejects.toThrow('sealed_attachment_too_large');
    expect([...mockDisk.keys()].filter((k) => k.includes('ethora-seal-'))).toEqual([]);
  });
});

describe('opening a sealed attachment', () => {
  it('downloads, opens, and keeps the file under its real name', async () => {
    const key = await upload(photo, 'holiday.jpg', 'image/jpeg');
    const progress: number[] = [];
    const opened = await openSealedAttachment(LOCATION, `${LOCATION}?ft=tok`, key, (f) => progress.push(f));

    expect(mockDownload.mock.calls[0]![0]).toBe(`${LOCATION}?ft=tok`);
    expect(opened).toMatchObject({ name: 'holiday.jpg', mimetype: 'image/jpeg', size: photo.length });
    expect(opened.uri).toMatch(/^file:\/\/\/cache\/ethora-sealed\/[a-z0-9]+\/holiday\.jpg$/);
    expect(Buffer.from(mockDisk.get(opened.uri)!).equals(Buffer.from(photo))).toBe(true);
    expect(progress[progress.length - 1]).toBe(1);
    // The downloaded ciphertext does not stay behind.
    expect([...mockDisk.keys()].filter((k) => k.includes('ethora-open-'))).toEqual([]);
  });

  it('is found again later, whatever token the url carries, without another download', async () => {
    const key = await upload(photo, 'holiday.jpg', 'image/jpeg');
    const first = await openSealedAttachment(LOCATION, `${LOCATION}?ft=one`, key);
    expect(await findOpened(`${LOCATION}?ft=two`)).toEqual(first);

    const again = await openSealedAttachment(LOCATION, `${LOCATION}?ft=two`, key);
    expect(again).toEqual(first);
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(await findOpened('https://secure-files.host/secure-media/other')).toBeNull();
  });

  it('downloads once for callers that ask at the same time', async () => {
    const key = await upload(photo, 'a.jpg', 'image/jpeg');
    const [a, b] = await Promise.all([
      openSealedAttachment(LOCATION, LOCATION, key),
      openSealedAttachment(LOCATION, LOCATION, key),
    ]);
    expect(a).toEqual(b);
    expect(mockDownload).toHaveBeenCalledTimes(1);
  });

  it('gives a name with no extension one, and keeps path separators out of it', async () => {
    const key = await upload(photo, '../../etc/voice note', 'audio/mp4');
    const opened = await openSealedAttachment(LOCATION, LOCATION, key);
    expect(opened.name).toBe('../../etc/voice note');
    expect(opened.uri).toMatch(/\/ethora-sealed\/[a-z0-9]+\/[^/]+$/);
    // No segment of the path is a way up, and the name does not start with a dot.
    expect(opened.uri).not.toMatch(/\/\.\.?(\/|$)/);
    expect(opened.uri.split('/').pop()).not.toMatch(/^\./);
    expect(opened.uri).toMatch(/\.m4a$|\.mp4$/);
  });

  it('fails cleanly on a refused download, a wrong key and a foreign file', async () => {
    mockDownload.mockResolvedValue({ status: 403, uri: 'x' });
    await expect(openSealedAttachment(LOCATION, LOCATION, 'AAAA')).rejects.toThrow('sealed_attachment_http_403');

    const key = await upload(photo, 'a.jpg', 'image/jpeg');
    const other = (await sealFileForUpload({ bytes: photo })).keyMaterial;
    await expect(openSealedAttachment(LOCATION, LOCATION, other)).rejects.toThrow('Payload authentication failed');
    // Nothing half-opened is left to be "found".
    expect(await findOpened(LOCATION)).toBeNull();
    // ...and the right key still works afterwards.
    await expect(openSealedAttachment(LOCATION, LOCATION, key)).resolves.toMatchObject({ name: 'a.jpg' });
  });

  it("keeps the sender's own copy as already opened, and forgets everything on logout", async () => {
    mockDisk.set('file:///picked/doc.pdf', photo);
    await rememberOpened(LOCATION, {
      uri: 'file:///picked/doc.pdf',
      name: 'doc.pdf',
      type: 'application/pdf',
      size: photo.length,
    });
    const kept = await findOpened(LOCATION);
    expect(kept).toMatchObject({ name: 'doc.pdf', mimetype: 'application/pdf', size: photo.length });
    expect(mockDownload).not.toHaveBeenCalled();

    clearOpenedFiles();
    expect(await findOpened(LOCATION)).toBeNull();
    expect([...mockDisk.keys()].filter((k) => k.includes('ethora-sealed'))).toEqual([]);
    // The picked original is not ours to delete.
    expect(mockDisk.has('file:///picked/doc.pdf')).toBe(true);
  });
});

describe('which attachments a message has', () => {
  it('reads the multi-attach payload, or the flat fields', () => {
    expect(sealedAttachmentsOf({ location: 'a', size: '10' } as any)).toEqual([{ location: 'a', size: '10' }]);
    expect(
      sealedAttachmentsOf({
        location: 'a',
        attachments: JSON.stringify([{ location: 'a', size: 1 }, { location: 'b', size: 2 }]),
      } as any)
    ).toEqual([
      { location: 'a', size: 1 },
      { location: 'b', size: 2 },
    ]);
    expect(sealedAttachmentsOf({ location: 'a', attachments: '{broken' } as any)).toEqual([{ location: 'a', size: undefined }]);
    expect(sealedAttachmentsOf({} as any)).toEqual([]);
    expect(sealedAttachmentsOf(undefined)).toEqual([]);
  });
});

describe('the attachment card', () => {
  const message = (extra: any = {}) =>
    ({
      id: '1',
      body: 'media',
      roomJid: 'r@conference.host',
      date: '2026-10-05T10:00:00Z',
      user: { id: 'u', name: 'U' },
      isMediafile: 'true',
      clientEncrypted: 'true',
      mimetype: 'application/octet-stream',
      location: LOCATION,
      size: '51200',
      ...extra,
    } as any);

  const render = async (node: React.ReactElement) => {
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(<Provider store={store}>{node}</Provider>);
    });
    return tree!;
  };
  const text = (tree: renderer.ReactTestRenderer) => JSON.stringify(tree.toJSON());
  const settle = async () => {
    for (let i = 0; i < 12; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };
  const withE2ee = async (enabled: boolean) => {
    jest.useFakeTimers();
    await act(async () => {
      store.dispatch(setConfig({ e2ee: { enabled } } as any));
    });
    jest.clearAllTimers();
    jest.useRealTimers();
  };

  it('says the file cannot be opened when the message carried no key', async () => {
    await withE2ee(true);
    const tree = await render(<SealedAttachment message={message()} isUser={false} />);
    expect(text(tree)).toContain('Encrypted attachment could not be opened');
    await act(async () => tree.unmount());

    // An app that does not decrypt at all says that instead.
    await withE2ee(false);
    const off = await render(<SealedAttachment message={message()} isUser={false} />);
    expect(text(off)).toContain("Can't be opened in this version of the app yet");
    await act(async () => off.unmount());
  });

  it('opens on a tap, then shows the file as what it is and previews it', async () => {
    await withE2ee(true);
    const key = await upload(photo, 'report.pdf', 'application/pdf');
    const tree = await render(<SealedAttachment message={message({ e2eeKeys: [key] })} isUser />);
    await settle();
    // Nothing is fetched until the viewer asks.
    expect(mockDownload).not.toHaveBeenCalled();
    expect(text(tree)).toContain('Encrypted file');
    expect(text(tree)).toContain('50 KB');

    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'sealed-attachment' && n.props?.onPress).props.onPress();
    });
    await settle();
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(text(tree)).toContain('report.pdf');
    expect(text(tree)).not.toContain('Encrypted file');

    // From here on it is the ordinary file card, fed the decrypted copy -
    // an opened attachment must not look different from any other file.
    const card = tree.root.findByType(FileDownload);
    expect(card.props).toMatchObject({
      fileName: 'report.pdf',
      mimetype: 'application/pdf',
      isUser: true,
    });
    expect(card.props.fileURL).toMatch(/^file:\/\/\/cache\/ethora-sealed\//);
    // Labelled the way an ordinary PDF is.
    expect(text(tree)).toContain('PDF');

    // A tap on it opens the preview on the decrypted copy, with its type.
    await act(async () => {
      card.find((n) => typeof n.props?.onPress === 'function').props.onPress();
    });
    const active = store.getState().chatSettingStore.activeFile!;
    expect(active.mimetype).toBe('application/pdf');
    expect(active.fileName).toBe('report.pdf');
    expect(active.fileURL).toMatch(/^file:\/\/\/cache\/ethora-sealed\//);
    expect(mockDownload).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  it('shows an opened picture as a picture', async () => {
    await withE2ee(true);
    const key = await upload(photo, 'holiday.jpg', 'image/jpeg');
    await openSealedAttachment(LOCATION, LOCATION, key);
    const getSize = jest
      .spyOn(require('react-native').Image, 'getSize')
      .mockImplementation(((_uri: string, ok: (w: number, h: number) => void) => ok(400, 300)) as any);
    const tree = await render(<SealedAttachment message={message({ e2eeKeys: [key] })} isUser={false} />);
    await settle();
    expect(tree.root.findAll((n) => n.props?.testID === 'sealed-attachment-image').length).toBeGreaterThan(0);
    // The ordinary image bubble, drawing the decrypted file itself.
    const image = tree.root.findByType(CustomMessageImage);
    expect(image.props.mimetype).toBe('image/jpeg');
    expect(image.props.fileURL).toMatch(/^file:\/\/\/cache\/ethora-sealed\//);
    expect(image.props.locationPreview).toBe(image.props.fileURL);
    await act(async () => tree.unmount());
    getSize.mockRestore();
  });

  it('hands an opened video and an opened voice note to their own players', async () => {
    await withE2ee(true);
    for (const [name, type, player] of [
      ['clip.mp4', 'video/mp4', 'VideoMessage'],
      ['voice.m4a', 'audio/mp4', 'AudioMessage'],
    ] as const) {
      mockDisk.clear();
      const key = await upload(photo, name, type);
      await openSealedAttachment(LOCATION, LOCATION, key);
      const tree = await render(<SealedAttachment message={message({ e2eeKeys: [key] })} isUser={false} />);
      await settle();
      const node = tree.root.find((n) => (n.type as any) === player);
      expect(node.props.mimetype ?? node.props.mimeType).toBe(type);
      expect(node.props.fileURL ?? node.props.src).toMatch(/^file:\/\/\/cache\/ethora-sealed\//);
      await act(async () => tree.unmount());
    }
  });

  it('offers a retry when the download fails', async () => {
    await withE2ee(true);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockDownload.mockResolvedValue({ status: 500, uri: 'x' });
    const tree = await render(<SealedAttachment message={message({ e2eeKeys: ['AAAA'] })} isUser={false} />);
    await settle();
    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'sealed-attachment' && n.props?.onPress).props.onPress();
    });
    await settle();
    warn.mockRestore();
    expect(text(tree)).toContain('Download failed');
    await act(async () => tree.unmount());
  });

  it('renders one card per attachment, each with its own key', async () => {
    await withE2ee(true);
    const tree = await render(
      <SealedAttachment
        message={message({
          attachments: JSON.stringify([{ location: `${LOCATION}-1`, size: 10 }, { location: `${LOCATION}-2`, size: 20 }]),
          // The second attachment has no key: it cannot be opened.
          e2eeKeys: ['K1'],
        })}
        isUser={false}
      />
    );
    await settle();
    const cards = tree.root.findAll((n) => n.props?.testID === 'sealed-attachment' && typeof n.type !== 'string');
    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(text(tree)).toContain('Encrypted attachment could not be opened');
    await act(async () => tree.unmount());
  });
});
