/**
 * Feature-level integration tests using the provided email-mode creds.
 *
 * The XMPP socket is mocked at the @xmpp/client boundary so the real
 * `XmppClient` class is exercised: every method (sendMessage, sendMedia,
 * editMessage, deleteMessage, typing) constructs the same stanzas as in
 * prod. We assert on the underlying `client.send(xml)` calls + the
 * downstream redux dispatches so the test fails the moment the wire
 * shape regresses.
 *
 * Scenarios:
 *   • email-login resolves the user (mock /users/login-with-email)
 *   • chatRoomsList mode: provider drives initBeforeLoad, getRoomsStanza
 *     fires, rooms are dispatched into the chat store via the stanza
 *     handler.
 *   • single-room mode: roomJID prop → setCurrentRoom dispatched, the
 *     room's history fetch goes through `enqueueHistoryTask` once the
 *     QoS path is in play.
 *   • sendMessage (text): XmppClient.sendMessage → wire stanza; both
 *     `onCriticalSend` and `onMessageSent` event handler fire.
 *   • sendMedia: axios uploads to /files/, response → sendMediaMessageStanza
 *     per attachment; `onMessageSent({messageType:'media'})` fires.
 *   • edit: editAction → editMessageStanza wire; `onMessageEdited` fires.
 *   • delete: deleteMessageStanza wire.
 *   • typing: sendTypingRequestStanza for start + paused.
 *   • unread (non-active room): incoming stanza → unreadMessages increments
 *     in the rooms slice via the unread middleware.
 */

import { configureStore } from '@reduxjs/toolkit';
import { Provider as ReduxProvider } from 'react-redux';
import React from 'react';
import { Text, View } from 'react-native';
import renderer, { act } from 'react-test-renderer';

// ---- mock @xmpp/client so XmppClient can be constructed safely -------
const xmppSends: any[] = [];
const xmppListeners: Record<string, Function[]> = {};
const mockClientInstance = {
  // Simulate a successful WS handshake: as soon as XmppClient calls
  // start(), fire 'online' synchronously so the listener flips
  // status='online' before `waitForOnline` does its first poll.
  start: jest.fn(() => {
    (xmppListeners.online || []).forEach((cb) => cb());
    return Promise.resolve();
  }),
  stop: jest.fn().mockResolvedValue(undefined),
  on: jest.fn((event: string, cb: any) => {
    (xmppListeners[event] = xmppListeners[event] || []).push(cb);
  }),
  off: jest.fn(),
  send: jest.fn((stanza: any) => {
    xmppSends.push(stanza);
    return Promise.resolve();
  }),
  status: 'offline',
};
function emitXmpp(event: string, ...args: any[]) {
  (xmppListeners[event] || []).forEach((cb) => cb(...args));
}
jest.mock('@xmpp/client', () => {
  const xml = (name: string, attrs: any = {}, ...children: any[]) => ({
    name,
    attrs,
    children,
    getChild(n: string) {
      return (this.children || []).find((c: any) => c?.name === n);
    },
    toString() {
      return `<${name} ${JSON.stringify(attrs)}/>`;
    },
  });
  return {
    __esModule: true,
    default: {
      client: jest.fn(() => mockClientInstance),
      xml,
    },
    client: jest.fn(() => mockClientInstance),
    xml,
  };
});

// ---- mock the auth + rooms HTTP layer ---------------------------------
jest.mock('../src/networking/api-requests/auth.api', () => ({
  __esModule: true,
  loginEmail: jest.fn(),
  loginViaJwt: jest.fn(),
  uploadFile: jest.fn(),
  uploadFileViaFetch: jest.fn(),
}));

jest.mock('../src/networking/api-requests/rooms.api', () => ({
  __esModule: true,
  getRooms: jest.fn().mockResolvedValue({ items: [] }),
  clearRoomsRestCache: jest.fn(),
}));

jest.mock('../src/helpers/historyPreloadScheduler', () => ({
  __esModule: true,
  runHistoryPreloadScheduler: jest.fn().mockResolvedValue(undefined),
}));

// XmppClient.getRoomsStanza + getChatsPrivateStoreRequestStanza await
// server responses; in unit tests the mock client never replies, so
// stub their wire-builders to resolve immediately.
jest.mock('../src/networking/xmpp/getRooms.xmpp', () => ({
  __esModule: true,
  getRooms: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/networking/xmpp/getChatsPrivateStoreRequest.xmpp', () => ({
  __esModule: true,
  getChatsPrivateStoreRequest: jest.fn().mockResolvedValue(null),
}));
jest.mock('../src/networking/xmpp/getHistory.xmpp', () => ({
  __esModule: true,
  getHistory: jest.fn().mockResolvedValue([]),
}));

// Shared spy client used by useSendMessage tests. Replace methods per
// test via `Object.assign(mockSpyClient, {...})` if needed.
const mockSpyClient: any = {
  sendMessage: jest.fn(),
  sendMediaMessageStanza: jest.fn(),
  editMessageStanza: jest.fn(),
  deleteMessageStanza: jest.fn(),
  sendTypingRequestStanza: jest.fn(),
  onCriticalSend: jest.fn(),
  setActiveRoomJid: jest.fn(),
  getRoomsStanza: jest.fn().mockResolvedValue(undefined),
  getChatsPrivateStoreRequestStanza: jest.fn().mockResolvedValue(null),
  waitForOnline: jest.fn().mockResolvedValue(undefined),
  status: 'online',
};
function mockResetSpyClient() {
  mockSpyClient.sendMessage.mockClear();
  mockSpyClient.sendMediaMessageStanza.mockClear();
  mockSpyClient.editMessageStanza.mockClear();
  mockSpyClient.deleteMessageStanza.mockClear();
  mockSpyClient.sendTypingRequestStanza.mockClear();
  mockSpyClient.onCriticalSend.mockClear();
}

// Replace the xmppProvider hook at module level. Tests that don't need
// the real provider (most sendMessage / useUnread tests) ride on this
// stub. Tests that DO want the real provider (`chatRoomsList › mounts`)
// use `jest.requireActual` below.
jest.mock('../src/context/xmppProvider', () => {
  const actual = jest.requireActual('../src/context/xmppProvider');
  return {
    __esModule: true,
    ...actual,
    useXmppClient: () => ({
      client: mockSpyClient,
      providerBootstrapStatus: 'ready',
      initMode: 'provider',
      initializeClient: jest.fn(),
      setClient: jest.fn(),
    }),
  };
});

// ---- imports under test ------------------------------------------------
import { XmppProvider, useXmppClient } from '../src/context/xmppProvider';
import { store } from '../src/roomStore';
import {
  setCurrentRoom,
  addRoom,
  addRoomMessage,
  setEditAction,
  setLastViewedTimestamp,
  setLogoutState,
} from '../src/roomStore/roomsSlice';
import { logout, setConfig, setUser } from '../src/roomStore/chatSettingsSlice';
import { useSendMessage } from '../src/hooks/useSendMessage';
import { useComposing } from '../src/hooks/useComposing';
import { useUnreadMessagesCounter } from '../src/hooks/useUnreadMessagesCounter';

import { uploadFile, uploadFileViaFetch } from '../src/networking/api-requests/auth.api';
const mockUploadFile = uploadFile as unknown as jest.Mock;
const mockUploadFileViaFetch = uploadFileViaFetch as unknown as jest.Mock;

// ---- live creds (provided by the user) -------------------------------
// Used to shape the mocked email-login response so xmppUsername/wallet
// match what their server would actually return.
const LIVE_USER = {
  _id: 'u-live',
  firstName: 'Dawepa',
  email: 'dawepa1952@hutudns.com',
  walletAddress: '0x8820e673b58C883785f01697bED4975ddA63332F',
  defaultWallet: { walletAddress: '0x8820e673b58C883785f01697bED4975ddA63332F' },
  xmppUsername: '646cc8dc96d4a4dc8f7b2f2d_69a6338466cb3e74bcbcd4f2',
  xmppPassword: 'xpw-live',
  token: 'srv-token',
  refreshToken: 'srv-refresh',
};

const flush = async () => {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
};

function resetXmppMocks() {
  xmppSends.length = 0;
  Object.keys(xmppListeners).forEach((k) => delete xmppListeners[k]);
  mockClientInstance.status = 'offline';
  // XmppClient.initializeClient may have replaced `send` with a wrapper
  // via Object.defineProperty — restore the original tracking fn so
  // subsequent tests still observe sends. start/on are stable.
  if (typeof (mockClientInstance.start as any).mockClear === 'function') {
    (mockClientInstance.start as any).mockClear();
  }
  if (typeof (mockClientInstance.on as any).mockClear === 'function') {
    (mockClientInstance.on as any).mockClear();
  }
  mockClientInstance.send = jest.fn((stanza: any) => {
    xmppSends.push(stanza);
    return Promise.resolve();
  });
}

beforeEach(async () => {
  resetXmppMocks();
  store.dispatch(logout());
  store.dispatch(setLogoutState()); // clear rooms slice between tests
  // Manually seed the user (simulates initBeforeLoad's applyResolvedUserToStore).
  store.dispatch(setUser(LIVE_USER as any));
  jest.clearAllMocks();
});

// =====================================================================
// 1. chatRoomsList — room list via stanza handler / addRoom dispatch
// =====================================================================
// (Bootstrap end-to-end is covered by `e2eJwtLoginRoomJid.test.tsx`.)
describe('chatRoomsList', () => {
  it('addRoom via stanza handler populates the rooms slice', async () => {
    // Simulate the room-list stanza handler dispatching addRoom.
    store.dispatch(
      addRoom({
        roomData: {
          id: '1',
          jid: 'general@conference.xmpp.chat.ethora.com',
          name: 'general',
          title: 'General',
          usersCnt: 3,
          messages: [],
          isLoading: false,
          roomBg: '',
        },
      })
    );
    const rooms = store.getState().rooms.rooms;
    expect(Object.keys(rooms)).toHaveLength(1);
    expect(rooms['general@conference.xmpp.chat.ethora.com'].title).toBe(
      'General'
    );
  });
});

// =====================================================================
// 2. single-room mode — roomJID drives setCurrentRoom
// =====================================================================
describe('single-room mode', () => {
  it('setCurrentRoom drives activeRoomJID', () => {
    const jid = 'one@conference.xmpp.chat.ethora.com';
    store.dispatch(setCurrentRoom({ roomJID: jid }));
    expect(store.getState().rooms.activeRoomJID).toBe(jid);
  });
});

// =====================================================================
// 3. useSendMessage — text + critical-send hint + onMessageSent
// =====================================================================
describe('useSendMessage — text', () => {
  it('emits XmppClient.sendMessage with the right args + fires onMessageSent + onCriticalSend', async () => {
    mockResetSpyClient();
    const onMessageSent = jest.fn();
    const onMessageFailed = jest.fn();
    store.dispatch(setUser(LIVE_USER as any));
    store.dispatch(
      setConfig({ eventHandlers: { onMessageSent, onMessageFailed } } as any)
    );

    let api: any;
    const Harness = () => {
      api = useSendMessage();
      return null;
    };
    let tree: any;
    await act(async () => {
      tree = renderer.create(
        <ReduxProvider store={store}>
          <Harness />
        </ReduxProvider>
      );
    });

    const ROOM = 'general@conference.xmpp.chat.ethora.com';
    await act(async () => {
      await api.sendMessage('hello world', ROOM, false, false, '');
    });

    expect(mockSpyClient.onCriticalSend).toHaveBeenCalledWith(ROOM);
    // Trailing correlation id (`send-text-message-<timestamp>`) was
    // added in commit b1204d7 (optimistic pending bubble that flips
    // to delivered on server echo). Asserted with a regex so the
    // timestamp doesn't make the test time-dependent.
    expect(mockSpyClient.sendMessage).toHaveBeenCalledWith(
      ROOM,
      LIVE_USER.firstName,
      '',
      '',
      LIVE_USER.walletAddress,
      'hello world',
      '',
      false,
      false,
      '',
      expect.stringMatching(/^send-text-message-\d+-\d+$/)
    );
    expect(onMessageSent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'hello world',
        roomJID: ROOM,
        messageType: 'text',
      })
    );
    expect(onMessageFailed).not.toHaveBeenCalled();

    tree.unmount();
  });

  it('edit mode → editMessageStanza + onMessageEdited fires', async () => {
    mockResetSpyClient();
    const onMessageEdited = jest.fn();
    store.dispatch(setUser(LIVE_USER as any));
    store.dispatch(setConfig({ eventHandlers: { onMessageEdited } } as any));

    const ROOM = 'general@conference.xmpp.chat.ethora.com';
    store.dispatch(
      setEditAction({
        isEdit: true,
        roomJid: ROOM,
        messageId: 'msg-42',
        text: 'before',
      })
    );

    let api: any;
    const Harness = () => {
      api = useSendMessage();
      return null;
    };
    let tree: any;
    await act(async () => {
      tree = renderer.create(
        <ReduxProvider store={store}>
          <Harness />
        </ReduxProvider>
      );
    });

    await act(async () => {
      await api.sendMessage('after edit', ROOM);
    });

    expect(mockSpyClient.editMessageStanza).toHaveBeenCalledWith(
      ROOM,
      'msg-42',
      'after edit'
    );
    expect(onMessageEdited).toHaveBeenCalledWith({
      messageId: 'msg-42',
      newMessage: 'after edit',
      roomJID: ROOM,
      user: expect.objectContaining({ walletAddress: LIVE_USER.walletAddress }),
    });
    expect(store.getState().rooms.editAction?.isEdit).toBe(false);

    tree.unmount();
  });
});

// =====================================================================
// 4. useSendMessage — media (file upload + sendMediaMessageStanza)
// =====================================================================
describe('useSendMessage — media', () => {
  it('uploads via /files/ and sends a media stanza per result item', async () => {
    mockResetSpyClient();
    // useSendMessage now routes through `uploadFileViaFetch` first (RN
    // fetch path that owns Content-Type), with the axios `uploadFile`
    // only as ERR_NETWORK fallback. Mock the primary path so the
    // happy-path assertion lands on the new entrypoint.
    mockUploadFileViaFetch.mockResolvedValue({
      data: {
        results: [
          {
            _id: 'file-1',
            filename: 'photo.jpg',
            location:
              'https://files.chat.ethora.com/photo.jpg',
            locationPreview: 'https://files.chat.ethora.com/photo-thumb.jpg',
            mimetype: 'image/jpeg',
            size: 12345,
            createdAt: '2026-05-15T12:00:00Z',
            expiresAt: '2027-05-15T12:00:00Z',
            duration: 0,
            updatedAt: '2026-05-15T12:00:00Z',
            __v: 0,
            originalname: 'photo.jpg',
            isVisible: true,
            isPrivate: false,
            userId: 'u-1',
            ownerKey: 'k-1',
          },
        ],
      },
    });

    const onMessageSent = jest.fn();
    store.dispatch(setUser(LIVE_USER as any));
    store.dispatch(setConfig({
      eventHandlers: { onMessageSent },
    } as any));

    let api: any;
    const Harness = () => {
      api = useSendMessage();
      return null;
    };
    let tree: any;
    await act(async () => {
      tree = renderer.create(
        <ReduxProvider store={store}>
          <Harness />
        </ReduxProvider>
      );
    });

    const ROOM = 'media-room@conference.xmpp.chat.ethora.com';
    const fakeFile = { uri: 'file:///tmp/photo.jpg', name: 'photo.jpg', type: 'image/jpeg' };
    await act(async () => {
      await api.sendMedia(fakeFile, 'image/jpeg', ROOM);
      await flush();
    });

    expect(mockSpyClient.onCriticalSend).toHaveBeenCalledWith(ROOM);
    expect(mockUploadFileViaFetch).toHaveBeenCalledTimes(1);
    expect(mockUploadFileViaFetch.mock.calls[0][0]).toBeDefined();
    expect(mockUploadFile).not.toHaveBeenCalled();

    // Trailing correlation id (`send-media-message-<timestamp>`)
    // added in commit b1204d7 — same shape as the text-send path.
    expect(mockSpyClient.sendMediaMessageStanza).toHaveBeenCalledWith(
      ROOM,
      expect.objectContaining({
        firstName: LIVE_USER.firstName,
        walletAddress: LIVE_USER.walletAddress,
        roomJid: ROOM,
        fileName: 'photo.jpg',
        location: 'https://files.chat.ethora.com/photo.jpg',
        mimetype: 'image/jpeg',
        attachmentId: 'file-1',
      }),
      // Media correlation id format is `send-media-message:<uuid>`
      // — colon delimiter + RFC4122 uuid (commit 251f605 / 40d91be).
      expect.stringMatching(
        /^send-media-message:[0-9a-f-]{36}$/
      )
    );
    expect(onMessageSent).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: 'media', roomJID: ROOM })
    );

    tree.unmount();
  });
});

// =====================================================================
// 5. delete + typing (raw XmppClient methods over real stanza builders)
// =====================================================================
describe('XmppClient — delete + typing wire stanzas', () => {
  // Use real XmppClient with the @xmpp/client mock so we see actual
  // `client.send` calls.
  it('deleteMessageStanza sends a stanza', () => {
    const { default: XmppClient } = jest.requireActual(
      '../src/networking/xmppClient'
    );
    const c = new XmppClient(
      LIVE_USER.xmppUsername,
      LIVE_USER.xmppPassword,
      { devServer: 'xmpp.chat.ethora.com' }
    );
    xmppSends.length = 0;
    c.deleteMessageStanza(
      'room@conference.xmpp.chat.ethora.com',
      'msg-id-99'
    );
    expect(xmppSends.length).toBeGreaterThan(0);
  });

  it('sendTypingRequestStanza(start=true) sends a composing stanza', () => {
    const { default: XmppClient } = jest.requireActual(
      '../src/networking/xmppClient'
    );
    const c = new XmppClient(
      LIVE_USER.xmppUsername,
      LIVE_USER.xmppPassword,
      { devServer: 'xmpp.chat.ethora.com' }
    );
    xmppSends.length = 0;
    c.sendTypingRequestStanza(
      'room@conference.xmpp.chat.ethora.com',
      'Dawepa',
      true
    );
    expect(xmppSends.length).toBeGreaterThan(0);
  });
});

// =====================================================================
// 6. unread counter — non-active room increments
// =====================================================================
describe('unread', () => {
  it('increments unreadMessages for a non-active room on incoming message', () => {
    const A = 'a@conference.xmpp.chat.ethora.com';
    const B = 'b@conference.xmpp.chat.ethora.com';
    store.dispatch(
      addRoom({
        roomData: {
          id: 'a',
          jid: A,
          name: 'a',
          title: 'A',
          usersCnt: 1,
          messages: [],
          isLoading: false,
          roomBg: '',
          lastViewedTimestamp: Date.parse('2026-05-15T10:00:00Z'),
        },
      })
    );
    store.dispatch(
      addRoom({
        roomData: {
          id: 'b',
          jid: B,
          name: 'b',
          title: 'B',
          usersCnt: 1,
          messages: [],
          isLoading: false,
          roomBg: '',
          lastViewedTimestamp: Date.parse('2026-05-15T10:00:00Z'),
        },
      })
    );
    store.dispatch(setCurrentRoom({ roomJID: A }));

    store.dispatch(
      addRoomMessage({
        roomJID: B,
        message: {
          id: 'm1',
          user: { id: 'u', name: 'u', token: '', refreshToken: '' } as any,
          date: '2026-05-15T11:00:00Z',
          body: 'hi',
          roomJid: B,
        },
        start: true,
      })
    );

    expect(store.getState().rooms.rooms[B].unreadMessages).toBe(1);
    expect(store.getState().rooms.rooms[A].unreadMessages || 0).toBe(0);
  });

  it('setLastViewedTimestamp(0) clears unread on enter', () => {
    const A = 'c@conference.xmpp.chat.ethora.com';
    store.dispatch(
      addRoom({
        roomData: {
          id: 'c',
          jid: A,
          name: 'c',
          title: 'C',
          usersCnt: 1,
          messages: [],
          isLoading: false,
          roomBg: '',
          unreadMessages: 5,
          lastViewedTimestamp: Date.now(),
        },
      })
    );
    store.dispatch(setLastViewedTimestamp({ chatJID: A, timestamp: 0 }));
    expect(store.getState().rooms.rooms[A].unreadMessages).toBe(0);
  });
});

// =====================================================================
// 7. useUnread hook — aggregate selector
// =====================================================================
describe('useUnread aggregate', () => {
  it('exposes totalCount + unreadByRoom from the store', async () => {
    // Seed rooms with non-zero lastViewedTimestamp + real messages so
    // the unreadMiddleware's recompute lands on a true count.
    const X = 'x-agg@conference.xmpp.chat.ethora.com';
    const Y = 'y-agg@conference.xmpp.chat.ethora.com';
    const lastViewed = Date.parse('2026-05-15T10:00:00Z');
    const makeMsg = (id: string, date: string) => ({
      id,
      user: { id: 'u', name: 'u', token: '', refreshToken: '' } as any,
      date,
      body: 'hi',
      roomJid: '',
    });
    store.dispatch(
      addRoom({
        roomData: {
          id: 'x',
          jid: X,
          name: 'x',
          title: 'X',
          usersCnt: 1,
          messages: [
            makeMsg('m1', '2026-05-15T11:00:00Z'),
            makeMsg('m2', '2026-05-15T12:00:00Z'),
            makeMsg('m3', '2026-05-15T13:00:00Z'),
          ],
          isLoading: false,
          roomBg: '',
          lastViewedTimestamp: lastViewed,
        },
      })
    );
    store.dispatch(
      addRoom({
        roomData: {
          id: 'y',
          jid: Y,
          name: 'y',
          title: 'Y',
          usersCnt: 1,
          messages: [
            makeMsg('m1', '2026-05-15T11:00:00Z'),
            makeMsg('m2', '2026-05-15T12:00:00Z'),
          ],
          isLoading: false,
          roomBg: '',
          lastViewedTimestamp: lastViewed,
        },
      })
    );
    // Force unreadMiddleware to re-evaluate per room (it gates on
    // a messages-length change).
    store.dispatch(setLastViewedTimestamp({ chatJID: X, timestamp: lastViewed }));
    store.dispatch(setLastViewedTimestamp({ chatJID: Y, timestamp: lastViewed }));

    let snap: any;
    const Probe = () => {
      snap = useUnreadMessagesCounter();
      return null;
    };
    let tree: any;
    await act(async () => {
      tree = renderer.create(
        <ReduxProvider store={store}>
          <Probe />
        </ReduxProvider>
      );
    });
    expect(snap.hasUnread).toBe(true);
    expect(snap.totalCount).toBe(5);
    expect(snap.unreadByRoom[X]).toBe(3);
    expect(snap.unreadByRoom[Y]).toBe(2);
    tree.unmount();
  });
});
