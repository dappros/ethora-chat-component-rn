import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import {
  addRoom,
  addRoomMessage,
  setActiveMessage,
  setLogoutState,
  updateRoom,
} from '../src/roomStore/roomsSlice';
import { setConfig } from '../src/roomStore/chatSettingsSlice';
import { BUILTIN_STRINGS } from '../src/i18n/strings';
import ThreadWrapper, {
  THREAD_HISTORY_PAGE_SIZE,
} from '../src/components/Thread/ThreadWrapper';
import ThreadHeader from '../src/components/Thread/ThreadHeader';
import { createMainMessageForThread } from '../src/helpers/createMainMessageForThread';

const mockGetHistoryStanza = jest.fn();
const mockSendMessage = jest.fn();
const mockSendMedia = jest.fn();
let mockListProps: any = null;
let mockInputProps: any = null;
let mockHeaderProps: any = null;

jest.mock('../src/context/xmppProvider', () => ({
  useXmppClient: () => ({
    client: {
      getHistoryStanza: (...a: any[]) => mockGetHistoryStanza(...a),
      sendTypingRequestStanza: jest.fn(),
    },
  }),
}));
jest.mock('../src/hooks/useSendMessage', () => ({
  useSendMessage: () => ({
    sendMessage: (...a: any[]) => mockSendMessage(...a),
    sendMedia: (...a: any[]) => mockSendMedia(...a),
    sendEditMessage: jest.fn(),
    isLastMessageFromUserAndProcessing: () => false,
  }),
}));
jest.mock('../src/components/MainComponents/MessageList', () => ({
  __esModule: true,
  default: (props: any) => {
    mockListProps = props;
    return null;
  },
}));
jest.mock('../src/components/styled/SendInput', () => ({
  __esModule: true,
  default: (props: any) => {
    mockInputProps = props;
    return null;
  },
}));
jest.mock('../src/components/Modals/ModalHeaderComponent', () => ({
  __esModule: true,
  default: (props: any) => {
    mockHeaderProps = props;
    return null;
  },
}));
jest.mock('../src/components/MainComponents/EditWrapper', () => ({
  EditWrapper: () => null,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

const JID = 'room@conference.xmpp.example.com';
const PARENT_ID = '1700000000000000';
const user: any = { _id: 'u1', firstName: 'A', lastName: 'B', xmppUsername: 'u1' };

const parentMsg: any = {
  id: PARENT_ID,
  body: 'parent',
  roomJid: JID,
  date: new Date().toISOString(),
  user: { id: 'x', name: 'X' },
};

const reply = (id: string, parentId = PARENT_ID): any => ({
  id,
  body: 'r' + id,
  roomJid: JID,
  date: new Date(Number(id) / 1000).toISOString(),
  user: { id: 'x', name: 'X' },
  isReply: 'true',
  mainMessage: JSON.stringify({ id: parentId }),
});

const seed = async (opts: {
  cursor?: number;
  complete?: boolean;
  replies?: any[];
}) => {
  await act(async () => {
    store.dispatch(setLogoutState());
    store.dispatch(setConfig({} as any));
    store.dispatch(
      addRoom({
        roomData: {
          id: '1',
          jid: JID,
          name: 'General',
          title: 'General',
          usersCnt: 2,
          messages: [],
          isLoading: false,
          roomBg: null,
        } as any,
      })
    );
    store.dispatch(
      updateRoom({
        jid: JID,
        updates: {
          messageStats: { firstMessageTimestamp: opts.cursor } as any,
          historyComplete: opts.complete,
        } as any,
      })
    );
    for (const m of opts.replies ?? []) {
      store.dispatch(addRoomMessage({ roomJID: JID, message: m }));
    }
  });
};

const mounted: renderer.ReactTestRenderer[] = [];

const mount = async (active: any = { ...parentMsg, activeMessage: true }) => {
  let r!: renderer.ReactTestRenderer;
  await act(async () => {
    r = renderer.create(
      <Provider store={store}>
        <ThreadWrapper activeMessage={active} user={user} />
      </Provider>
    );
  });
  mounted.push(r);
  return r;
};

const loaders = (r: renderer.ReactTestRenderer) =>
  r.root.findAll(
    (n: any) => n.props.testID === 'thread-history-loader' && typeof n.type === 'string'
  ).length;

const flush = () => act(async () => { await Promise.resolve(); });

afterEach(async () => {
  await act(async () => {
    while (mounted.length) mounted.pop()!.unmount();
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mockListProps = null;
  mockInputProps = null;
  mockHeaderProps = null;
  mockGetHistoryStanza.mockResolvedValue(undefined);
});

describe('ThreadWrapper history', () => {
  it('auto-loads by the room cursor when it is newer than the parent', async () => {
    await seed({ cursor: 1800000000000000 });
    await mount();
    expect(mockGetHistoryStanza).toHaveBeenCalledTimes(1);
    expect(mockGetHistoryStanza).toHaveBeenCalledWith(
      JID,
      THREAD_HISTORY_PAGE_SIZE,
      1800000000000000
    );
  });

  it('does not request once the cursor has reached the parent', async () => {
    await seed({ cursor: Number(PARENT_ID) });
    await mount();
    expect(mockGetHistoryStanza).not.toHaveBeenCalled();
  });

  it('does not request when history is complete', async () => {
    await seed({ cursor: 1800000000000000, complete: true });
    await mount();
    expect(mockGetHistoryStanza).not.toHaveBeenCalled();
  });

  it('keeps paging as the cursor advances and stops at the parent', async () => {
    await seed({ cursor: 1800000000000000 });
    await mount();
    await act(async () => {
      store.dispatch(
        updateRoom({
          jid: JID,
          updates: { messageStats: { firstMessageTimestamp: 1750000000000000 } } as any,
        })
      );
    });
    await flush();
    expect(mockGetHistoryStanza).toHaveBeenLastCalledWith(
      JID,
      THREAD_HISTORY_PAGE_SIZE,
      1750000000000000
    );
    await act(async () => {
      store.dispatch(
        updateRoom({
          jid: JID,
          updates: { messageStats: { firstMessageTimestamp: 1600000000000000 } } as any,
        })
      );
    });
    await flush();
    expect(mockGetHistoryStanza).toHaveBeenCalledTimes(2);
  });

  it('does not request the same page twice when the cursor does not move', async () => {
    await seed({ cursor: 1800000000000000 });
    await mount();
    await flush();
    await act(async () => {
      await mockListProps.loadMoreMessages(JID, 15, 1800000000000000);
    });
    expect(mockGetHistoryStanza).toHaveBeenCalledTimes(1);
  });

  it('uses the hint when it is lower than the cursor', async () => {
    await seed({ cursor: Number(PARENT_ID) + 1, complete: false });
    mockGetHistoryStanza.mockClear();
    await mount();
    // cursor is just above the parent so auto-load fires with the cursor;
    // a lower hint from the list wins on the next call
    mockGetHistoryStanza.mockClear();
    await act(async () => {
      await mockListProps.loadMoreMessages(JID, 15, Number(PARENT_ID) + 0.5);
    });
    expect(mockGetHistoryStanza).toHaveBeenCalledWith(
      JID,
      15,
      Number(PARENT_ID) + 0.5
    );
  });

  it('retries the same page after an error', async () => {
    await seed({ cursor: 1800000000000000 });
    mockGetHistoryStanza.mockRejectedValueOnce(new Error('boom'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await mount();
    await flush();
    await act(async () => {
      await mockListProps.loadMoreMessages(JID, 15, 1800000000000000);
    });
    expect(mockGetHistoryStanza.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('returns the real promise to the list', async () => {
    await seed({ cursor: 1800000000000000 });
    await mount();
    await flush();
    const p = mockListProps.loadMoreMessages(JID, 15, 1700000000000001);
    expect(typeof p.then).toBe('function');
    await act(async () => { await p; });
  });

  it('shows the spinner with zero replies while loading, not when replies exist', async () => {
    let resolve!: () => void;
    mockGetHistoryStanza.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    await seed({ cursor: 1800000000000000 });
    let r = await mount();
    expect(loaders(r)).toBe(1);
    await act(async () => { r.unmount(); resolve(); });

    await seed({ cursor: 1800000000000000, replies: [reply('1700000000000100')] });
    r = await mount();
    expect(loaders(r)).toBe(0);
    await act(async () => { r.unmount(); resolve(); });
  });

  it('ignores replies of other parents for the spinner decision', async () => {
    mockGetHistoryStanza.mockReturnValue(new Promise<void>(() => {}));
    await seed({
      cursor: 1800000000000000,
      replies: [reply('1700000000000100', 'other')],
    });
    const r = await mount();
    expect(loaders(r)).toBe(1);
  });

  it('passes the right props to the list and a translated title', async () => {
    await seed({ cursor: Number(PARENT_ID) });
    await mount();
    expect(mockListProps.isReply).toBe(true);
    expect(mockListProps.roomJID).toBe(JID);
    expect(mockListProps.activeMessage.id).toBe(PARENT_ID);
    expect(mockListProps.user).toBe(user);
    expect(mockHeaderProps.headerTitle).toBe(BUILTIN_STRINGS.en['thread.title']);
  });

  it('renders the translated also-send-to label', async () => {
    await seed({ cursor: Number(PARENT_ID) });
    const r = await mount();
    const texts = r.root
      .findAllByType(require('react-native').Text)
      .map((t: any) => [].concat(t.props.children).join(''));
    expect(texts).toContain(BUILTIN_STRINGS.en['thread.alsoSendTo']);
    expect(texts).toContain('General');
  });

  it('sends text and media with showInChannel false by default, true when toggled', async () => {
    await seed({ cursor: Number(PARENT_ID) });
    const r = await mount();
    const main = createMainMessageForThread(parentMsg as any);
    mockInputProps.sendMessage('hi');
    expect(mockSendMessage).toHaveBeenLastCalledWith(
      'hi', JID, true, false, main
    );
    mockInputProps.sendMedia({ uri: 'x' }, 'image/png');
    expect(mockSendMedia).toHaveBeenLastCalledWith(
      { uri: 'x' }, 'image/png', JID, true, false, main
    );
    // Press the also-send container (first pressable ancestor of the label)
    const label = r.root
      .findAllByType(require('react-native').Text)
      .find((t: any) => [].concat(t.props.children).join('') === 'Also send to')!;
    let node: any = label;
    while (node && typeof node.props.onPress !== 'function') node = node.parent;
    await act(async () => { node.props.onPress(); });
    mockInputProps.sendMessage('hi2');
    expect(mockSendMessage).toHaveBeenLastCalledWith('hi2', JID, true, true, main);
    mockInputProps.sendMedia({ uri: 'y' }, 'image/png');
    expect(mockSendMedia).toHaveBeenLastCalledWith(
      { uri: 'y' }, 'image/png', JID, true, true, main
    );
  });

  it('stays open when a live message arrives', async () => {
    await seed({ cursor: Number(PARENT_ID), replies: [{ ...parentMsg }] });
    await act(async () => {
      store.dispatch(setActiveMessage({ id: PARENT_ID, chatJID: JID }));
    });
    await act(async () => {
      store.dispatch(
        addRoomMessage({
          roomJID: JID,
          message: { ...parentMsg, id: '1900000000000000', body: 'live' },
        })
      );
    });
    const msgs = store.getState().rooms.rooms[JID].messages;
    expect(msgs.find((m: any) => m.id === PARENT_ID)?.activeMessage).toBe(true);
  });
});

describe('ThreadHeader', () => {
  it('shows the translated title and closes the thread', async () => {
    await seed({});
    await act(async () => {
      store.dispatch(setActiveMessage({ id: 'none', chatJID: JID }));
    });
    const dispatchSpy = jest.spyOn(store, 'dispatch');
    let r!: renderer.ReactTestRenderer;
    await act(async () => {
      r = renderer.create(
        <Provider store={store}>
          <ThreadHeader chatJID={JID} />
        </Provider>
      );
    });
    const texts = r.root
      .findAllByType(require('react-native').Text)
      .map((t: any) => [].concat(t.props.children).join(''));
    expect(texts).toContain(BUILTIN_STRINGS.en['thread.title']);
    mounted.push(r);
    dispatchSpy.mockClear();
    const btn = r.root.findAll((n: any) => typeof n.props.onPress === 'function')[0];
    await act(async () => { btn.props.onPress(); });
    expect(dispatchSpy).toHaveBeenCalled();
    dispatchSpy.mockRestore();
  });
});
