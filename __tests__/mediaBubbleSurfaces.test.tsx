/**
 * Where a multi-attachment / captioned media message shows up besides its own
 * album: inside the full bubble (with the jump highlight), as the room-list
 * preview, and as the reply quote.
 */
jest.mock('../src/components/styled/AudioMessage', () => ({
  __esModule: true,
  default: 'AudioMessage',
}));
jest.mock('../src/components/styled/VideoMessage', () => ({
  __esModule: true,
  default: 'VideoMessage',
}));
jest.mock('../src/helpers/userResolver', () => ({
  getUserLookupStatus: () => 'resolved',
  requestUsers: jest.fn(),
  subscribeUserResolver: () => () => {},
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
jest.mock('react-native-gesture-handler', () => {
  const chain: any = new Proxy({}, { get: () => () => chain });
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: any) => children,
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

import React from 'react';
import { AccessibilityInfo, Image, Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { setLogoutState } from '../src/roomStore/roomsSlice';
import { setConfig, setUser } from '../src/roomStore/chatSettingsSlice';
import { Message } from '../src/components/MessageBubble/Message';
import AlbumGrid from '../src/components/MainComponents/AlbumGrid';
import LastMessageItem from '../src/components/RoomComponents/LastMessageItem';
import { setBubbleHighlight } from '../src/helpers/bubbleHighlight';
import { createMainMessageForThread } from '../src/helpers/createMainMessageForThread';
import { FILES } from './fixtures/mediaStanzas';

const file = (n: number, extra: Record<string, unknown> = {}) => ({
  attachmentId: `a${n}`,
  location: `${FILES}/${n}.jpg`,
  locationPreview: `${FILES}/${n}-s.jpg`,
  mimetype: 'image/jpeg',
  originalName: `${n}.jpg`,
  ...extra,
});

const media = (extra: Record<string, unknown> = {}) => ({
  id: 'm1',
  body: 'media',
  roomJid: 'room1@conference.example.com',
  date: new Date('2026-10-14T10:00:00Z').toISOString(),
  user: { id: 'app_user1', name: 'Ann Lee' },
  isMediafile: 'true',
  ...file(0),
  ...extra,
});

const textOf = (tree: renderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map((n) =>
      (Array.isArray(n.props.children) ? n.props.children : [n.props.children])
        .filter((c: unknown) => typeof c === 'string')
        .join('')
    );

beforeEach(() => {
  jest.spyOn(Image, 'getSize').mockImplementation((() => {}) as any);
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  setBubbleHighlight(null);
});
afterEach(() => {
  jest.restoreAllMocks();
  setBubbleHighlight(null);
});

describe('the bubble of a media message', () => {
  const mountBubble = async (message: any) => {
    await act(async () => {
      store.dispatch(setLogoutState());
      store.dispatch(setConfig({} as any));
      store.dispatch(setUser({ xmppUsername: 'app_me' } as any));
    });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <Provider store={store}>
          <Message message={message} isUser={false} isReply={false} />
        </Provider>
      );
    });
    return tree;
  };

  it('holds the album and the caption, and still takes the jump highlight', async () => {
    const tree = await mountBubble(
      media({ attachments: [file(0), file(1), file(2)], caption: 'trip photos' })
    );
    expect(tree.root.findAllByType(AlbumGrid)).toHaveLength(1);
    expect(textOf(tree)).toContain('trip photos');

    await act(async () => setBubbleHighlight('m1'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      tree.root.findAll((n) => n.props?.testID === 'bubble-highlight' && typeof n.type === 'string')
    ).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  it('shows no stray text for the placeholder body of a plain file', async () => {
    const tree = await mountBubble(media());
    expect(textOf(tree)).not.toContain('media');
    await act(async () => tree.unmount());
  });
});

describe('the room-list preview', () => {
  const preview = async (lastMessage: any) => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <Provider store={store}>
          <LastMessageItem lastMessage={lastMessage} />
        </Provider>
      );
    });
    return textOf(tree).join('|');
  };

  it('keeps the file name for a single file', async () => {
    expect(await preview(media())).toContain('0.jpg');
  });

  it('says how many files a multi-attachment message has', async () => {
    const text = await preview(media({ attachments: [file(0), file(1), file(2)] }));
    expect(text).toContain('3 attachments');
    expect(text).not.toContain('0.jpg');
  });

  it('prefers the caption', async () => {
    const text = await preview(
      media({ attachments: [file(0), file(1)], caption: 'weekend trip' })
    );
    expect(text).toContain('weekend trip');
    expect(text).not.toContain('2 attachments');
  });

  it('shows the caption of a single file too', async () => {
    expect(await preview(media({ caption: 'a sunset' }))).toContain('a sunset');
  });
});

describe('the reply quote of a media message', () => {
  it('quotes the caption, or the placeholder body without one', () => {
    expect(JSON.parse(createMainMessageForThread(media({ caption: 'look' }) as any)).text).toBe(
      'look'
    );
    expect(JSON.parse(createMainMessageForThread(media() as any)).text).toBe('media');
  });
});
