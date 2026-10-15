jest.mock('../src/components/styled/AudioMessage', () => ({
  __esModule: true,
  default: 'AudioMessage',
}));
jest.mock('../src/components/styled/VideoMessage', () => ({
  __esModule: true,
  default: 'VideoMessage',
}));
jest.mock('../src/e2ee/sealedFiles', () => ({
  __esModule: true,
  findOpened: jest.fn(async () => null),
  openSealedAttachment: jest.fn(),
}));

import React from 'react';
import { Image } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import chatSettingsReducer from '../src/roomStore/chatSettingsSlice';
import roomsReducer from '../src/roomStore/roomsSlice';
import MediaMessage from '../src/components/MainComponents/MediaMessage';
import AlbumGrid from '../src/components/MainComponents/AlbumGrid';
import MediaCaption from '../src/components/MessageBubble/MediaCaption';
import CustomMessageImage from '../src/components/styled/MessageImage';
import FileDownload from '../src/components/styled/UnsupportedType';
import { toMessage, multiStanza, COMMA_LIST_STANZA, FILES } from './fixtures/mediaStanzas';

const makeStore = () =>
  configureStore({
    reducer: { chatSettingStore: chatSettingsReducer, rooms: roomsReducer },
    middleware: (g) => g({ serializableCheck: false, immutableCheck: false }),
  });

beforeEach(() => {
  jest.spyOn(Image, 'getSize').mockImplementation((() => {}) as any);
});
afterEach(() => {
  jest.restoreAllMocks();
});

const mount = async (message: any, isUser = false) => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={makeStore()}>
        <MediaMessage
          mimeType={message.mimetype}
          messageText={message.locationPreview}
          location={message.location}
          message={message}
          isUser={isUser}
        />
      </Provider>
    );
  });
  return tree;
};

const hosts = (tree: renderer.ReactTestRenderer, name: string) =>
  tree.root.findAll((n) => (n.type as any) === name);
const album = (tree: renderer.ReactTestRenderer) => tree.root.findAllByType(AlbumGrid);
const captionText = (tree: renderer.ReactTestRenderer) =>
  tree.root
    .findAll((n) => n.props?.testID === 'media-caption' && typeof n.type === 'string')
    .map((n) => n.props.children);

const base = (extra: Record<string, unknown> = {}) => ({
  id: 'm1',
  body: 'media',
  roomJid: 'r@conference.x',
  date: '2026-10-14T10:00:00Z',
  user: { id: 'u', name: 'U' },
  isMediafile: 'true',
  ...extra,
});

const file = (n: number, extra: Record<string, unknown> = {}) => ({
  attachmentId: `a${n}`,
  location: `${FILES}/${n}.jpg`,
  locationPreview: `${FILES}/${n}-s.jpg`,
  mimetype: 'image/jpeg',
  originalName: `${n}.jpg`,
  ...extra,
});

const pdf = (n: number) =>
  file(n, {
    location: `${FILES}/${n}.pdf`,
    locationPreview: undefined,
    mimetype: 'application/pdf',
    originalName: `doc-${n}.pdf`,
  });

describe('a single file renders as it always did', () => {
  it('is the bare picture component, with the same props and no album or caption', async () => {
    const message = base({ ...file(0) });
    const tree = await mount(message);
    const images = tree.root.findAllByType(CustomMessageImage);
    expect(images).toHaveLength(1);
    expect(images[0]!.props).toMatchObject({
      fileName: '0.jpg',
      originalName: '0.jpg',
      fileURL: `${FILES}/0.jpg`,
      locationPreview: `${FILES}/0-s.jpg`,
      mimetype: 'image/jpeg',
    });
    expect(images[0]!.props.tile).toBeUndefined();
    expect(album(tree)).toHaveLength(0);
    expect(captionText(tree)).toHaveLength(0);
  });

  it('renders the same tree the picture component alone renders', async () => {
    const message = base({ ...file(0) });
    const tree = await mount(message);
    let direct!: renderer.ReactTestRenderer;
    await act(async () => {
      direct = renderer.create(
        <Provider store={makeStore()}>
          <CustomMessageImage
            fileName="0.jpg"
            originalName="0.jpg"
            fileURL={`${FILES}/0.jpg`}
            locationPreview={`${FILES}/0-s.jpg`}
            mimetype="image/jpeg"
          />
        </Provider>
      );
    });
    // Same host tree: no wrapper view around the lone picture.
    expect(JSON.stringify(tree.toJSON())).toBe(JSON.stringify(direct.toJSON()));
  });

  it('is the bare file card for a document', async () => {
    const tree = await mount(base({ ...pdf(1) }));
    const cards = tree.root.findAllByType(FileDownload);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.props).toMatchObject({
      fileName: 'doc-1.pdf',
      fileURL: `${FILES}/1.pdf`,
      mimetype: 'application/pdf',
    });
  });

  it('plays a voice note in the audio player', async () => {
    const tree = await mount(
      base({
        location: `${FILES}/v.webm`,
        mimetype: 'application/octet-stream',
        originalName: 'blob',
        duration: '12',
        waveForm: 'abc',
      })
    );
    const audio = hosts(tree, 'AudioMessage');
    expect(audio).toHaveLength(1);
    expect(audio[0]!.props).toMatchObject({
      src: `${FILES}/v.webm`,
      duration: '12',
      waveForm: 'abc',
    });
  });

  it('keeps a message with no file at all as "Unsupported media type"', async () => {
    const tree = await mount(base());
    expect(JSON.stringify(tree.toJSON())).toContain('Unsupported media type');
  });
});

describe('several files', () => {
  it('draws three pictures as one album and no per-file cards', async () => {
    const message = base({ ...file(0), attachments: [file(0), file(1), file(2)] });
    const tree = await mount(message);
    expect(album(tree)).toHaveLength(1);
    expect(album(tree)[0]!.props.attachments).toHaveLength(3);
    expect(tree.root.findAllByType(FileDownload)).toHaveLength(0);
  });

  it('draws a stanza from the wire, end to end', async () => {
    const message = await toMessage(multiStanza(5, { caption: 'five shots' }));
    const tree = await mount(message);
    expect(album(tree)[0]!.props.attachments).toHaveLength(5);
    expect(JSON.stringify(tree.toJSON())).toContain('+1');
    expect(captionText(tree)).toEqual(['five shots']);
  });

  it('draws a legacy comma list as an album of two', async () => {
    const message = await toMessage(COMMA_LIST_STANZA);
    const tree = await mount(message);
    expect(album(tree)[0]!.props.attachments).toHaveLength(2);
    // The old client's text sits in <body> and is the caption.
    expect(captionText(tree)).toEqual(['two shots']);
  });

  it('puts documents under the album, one card each', async () => {
    const message = base({
      ...file(0),
      attachments: [file(0), pdf(1), file(2), pdf(3)],
    });
    const tree = await mount(message);
    expect(album(tree)[0]!.props.attachments.map((a: any) => a.attachmentId)).toEqual([
      'a0',
      'a2',
    ]);
    const cards = tree.root.findAllByType(FileDownload);
    expect(cards.map((c) => c.props.fileName)).toEqual(['doc-1.pdf', 'doc-3.pdf']);
  });

  it('keeps a lone picture beside a document as the ordinary picture', async () => {
    const message = base({ ...file(0), attachments: [file(0), pdf(1)] });
    const tree = await mount(message);
    expect(album(tree)).toHaveLength(0);
    expect(tree.root.findAllByType(CustomMessageImage)).toHaveLength(1);
    expect(tree.root.findAllByType(FileDownload)).toHaveLength(1);
  });

  it('draws only documents as a stack of cards', async () => {
    const message = base({ ...pdf(0), attachments: [pdf(0), pdf(1), pdf(2)] });
    const tree = await mount(message);
    expect(album(tree)).toHaveLength(0);
    expect(tree.root.findAllByType(FileDownload)).toHaveLength(3);
  });

  it('draws a voice note in a mixed message with the player', async () => {
    const voice = file(9, {
      location: `${FILES}/v.mp3`,
      locationPreview: undefined,
      mimetype: 'audio/mpeg',
      originalName: 'v.mp3',
    });
    const message = base({ ...file(0), attachments: [file(0), file(1), voice] });
    const tree = await mount(message);
    expect(album(tree)).toHaveLength(1);
    expect(hosts(tree, 'AudioMessage')).toHaveLength(1);
  });

  it('renders at most the capped number of files', async () => {
    const message = await toMessage(multiStanza(14));
    const tree = await mount(message);
    expect(album(tree)[0]!.props.attachments).toHaveLength(10);
  });
});

describe('the caption', () => {
  it('shows under a single file as plain text', async () => {
    const tree = await mount(base({ ...file(0), caption: 'a sunset' }));
    expect(tree.root.findAllByType(CustomMessageImage)).toHaveLength(1);
    expect(captionText(tree)).toEqual(['a sunset']);
  });

  it('shows no caption element for the placeholder body', async () => {
    const tree = await mount(base({ ...file(0), attachments: [file(0), file(1)] }));
    expect(tree.root.findAllByType(MediaCaption)[0]!.props.text).toBeUndefined();
    expect(captionText(tree)).toHaveLength(0);
  });
});

describe('sealed (e2ee) messages', () => {
  const sealed = (extra: Record<string, unknown> = {}) =>
    base({
      clientEncrypted: 'true',
      mimetype: 'application/octet-stream',
      location: `${FILES}/c0`,
      attachments: [
        { location: `${FILES}/c0`, size: '10' },
        { location: `${FILES}/c1`, size: '20' },
        { location: `${FILES}/c2`, size: '30' },
      ],
      e2eeKeys: ['k0', 'k1', 'k2'],
      ...extra,
    });

  it('draws one sealed card per attachment, never an album', async () => {
    const tree = await mount(sealed());
    const cards = tree.root.findAll(
      (n) => n.props?.testID === 'sealed-attachment' && typeof n.type === 'string'
    );
    expect(cards).toHaveLength(3);
    expect(album(tree)).toHaveLength(0);
  });

  it('shows the caption lifted from the encrypted body', async () => {
    const tree = await mount(sealed({ caption: 'inside the seal' }));
    expect(captionText(tree)).toEqual(['inside the seal']);
  });

  it('shows no text for a sealed message whose body says something else', async () => {
    const tree = await mount(sealed({ body: 'sneaky plain text' }));
    expect(captionText(tree)).toHaveLength(0);
  });
});
