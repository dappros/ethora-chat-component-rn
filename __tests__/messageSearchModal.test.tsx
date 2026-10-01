import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TextInput, TouchableOpacity } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { addRoom, setCurrentRoom } from '../src/roomStore/roomsSlice';
import { setActiveModal, setConfig, setUser } from '../src/roomStore/chatSettingsSlice';
import { MODAL_TYPES } from '../src/helpers/constants/MODAL_TYPES';

const mockSearch = jest.fn();
jest.mock('../src/networking/api-requests/messageSearch.api', () => ({
  ...jest.requireActual('../src/networking/api-requests/messageSearch.api'),
  searchMessages: (...a: unknown[]) => mockSearch(...a),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

import MessageSearchModal from '../src/components/Modals/MessageSearchModal/MessageSearchModal';
import {
  MessageSearchButton,
  isMessageSearchEnabled,
} from '../src/components/MainComponents/MessageSearchButton';
import { openSearchHit, resolveHitRoomJid } from '../src/components/Modals/MessageSearchModal/openHit';

const JID = 'general@conference.xmpp.test';
const OTHER = 'other@conference.xmpp.test';

const hit = (over: any = {}) => ({
  id: 'row1',
  chatId: 'general',
  chatType: 'groupchat',
  room: JID,
  from: 'app_u1@xmpp.test',
  fromUserId: 'u1',
  body: 'hello world',
  messageId: '',
  stanzaId: '',
  createdAt: '2026-03-04T10:00:00.000Z',
  ...over,
});
const pageOf = (items: any[], total = items.length) => ({
  items,
  total,
  offset: 0,
  limit: 20,
  nextOffset: items.length,
});

const seed = async (config: any = { appId: 'app1' }) => {
  await act(async () => {
    for (const [jid, title] of [[JID, 'General'], [OTHER, 'Other']] as const) {
      store.dispatch(
        addRoom({
          roomData: {
            id: jid, jid, name: jid.split('@')[0], title, usersCnt: 2,
            messages: [], isLoading: false, roomBg: '',
          } as any,
        })
      );
    }
    store.dispatch(setCurrentRoom({ roomJID: JID }));
    store.dispatch(setUser({ xmppUsername: 'me' } as any));
    store.dispatch(setConfig(config));
    store.dispatch({
      type: 'roomMessages/updateRoom',
      payload: {
        jid: JID,
        updates: {
          members: [
            { _id: 'u1', firstName: 'Ann', lastName: 'Lee' },
            { _id: 'u2', firstName: 'Bob', lastName: 'Ray' },
          ],
        },
      },
    });
  });
};

const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
};

const render = async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <MessageSearchModal handleCloseModal={jest.fn()} />
      </Provider>,
      { createNodeMock: () => ({ focus: jest.fn() }) }
    );
  });
  const byId = (id: string) =>
    tree.root.findAll((n) => n.props?.testID === id && typeof n.type !== 'string');
  const press = async (id: string) => {
    await act(async () => {
      byId(id)[0].props.onPress();
    });
  };
  const type = async (id: string, text: string) => {
    await act(async () => {
      byId(id)[0].props.onChangeText(text);
    });
  };
  const texts = () =>
    tree.root
      .findAllByType(Text)
      .flatMap((n) => (Array.isArray(n.props.children) ? n.props.children : [n.props.children]))
      .filter((c) => typeof c === 'string') as string[];
  return { tree, byId, press, type, texts };
};

beforeEach(() => {
  jest.useFakeTimers();
  mockSearch.mockReset();
  store.dispatch(setActiveModal(MODAL_TYPES.MESSAGE_SEARCH));
});
afterEach(() => jest.useRealTimers());

describe('MessageSearchModal', () => {
  it('focuses the field on open and shows the hint before typing', async () => {
    await seed();
    const { byId } = await render();
    const input = byId('message-search-input').find((n) => n.instance)!;
    const focus = jest.spyOn(input.instance, 'focus');
    await advance(100);
    expect(focus).toHaveBeenCalled();
    expect(byId('message-search-input')[0].props.autoFocus).toBe(true);
    expect(byId('message-search-hint').length).toBeGreaterThan(0);
  });

  it('does not search below two characters, then debounces into one request scoped to this chat', async () => {
    await seed();
    mockSearch.mockResolvedValue(pageOf([hit()]));
    const { type, texts } = await render();
    await type('message-search-input', 'h');
    await advance(400);
    expect(mockSearch).not.toHaveBeenCalled();
    await type('message-search-input', 'he');
    await type('message-search-input', 'hel');
    await advance(400);
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch.mock.calls[0][0]).toMatchObject({ q: 'hel', chatId: 'general', offset: 0 });
    expect(texts().join(' ')).toContain('1 found');
  });

  it('emphasises the match in the snippet', async () => {
    await seed();
    mockSearch.mockResolvedValue(pageOf([hit({ body: 'say hello there' })]));
    const { type, tree } = await render();
    await type('message-search-input', 'hello');
    await advance(400);
    const matched = tree.root
      .findAllByType(Text)
      .filter((n) => n.props.children === 'hello');
    expect(matched.length).toBe(1);
  });

  it('sends the sender id and the whole local day for the date filters', async () => {
    await seed();
    mockSearch.mockResolvedValue(pageOf([]));
    const { type, press, byId } = await render();
    await press('message-search-filters-toggle');
    await type('message-search-sender-input', 'ann');
    await press('message-search-sender-u1');
    await type('message-search-since', '2026-03-01');
    await type('message-search-until', '2026-03-04');
    await type('message-search-input', 'hello');
    await advance(400);
    const args = mockSearch.mock.calls[mockSearch.mock.calls.length - 1][0];
    expect(args.fromUserId).toBe('u1');
    expect(args.since).toBe(new Date(2026, 2, 1, 0, 0, 0, 0).toISOString());
    expect(args.until).toBe(new Date(2026, 2, 4, 23, 59, 59, 999).toISOString());
    expect(byId('message-search-sender-clear').length).toBeGreaterThan(0);
  });

  it('searches nothing and says so for a backwards date range', async () => {
    await seed();
    const { type, press, byId } = await render();
    await press('message-search-filters-toggle');
    await type('message-search-since', '2026-03-10');
    await type('message-search-until', '2026-03-01');
    await type('message-search-input', 'hello');
    await advance(400);
    expect(mockSearch).not.toHaveBeenCalled();
    expect(byId('message-search-date-order').length).toBeGreaterThan(0);
  });

  it('switches to all chats and drops the chatId', async () => {
    await seed();
    mockSearch.mockResolvedValue(pageOf([hit({ room: OTHER, chatId: 'other' })]));
    const { type, press, texts } = await render();
    await press('message-search-scope-all');
    await type('message-search-input', 'hello');
    await advance(400);
    expect(mockSearch.mock.calls[0][0].chatId).toBeUndefined();
    expect(texts().join(' ')).toContain('Other');
  });

  it('tapping a hit opens its room, requests the jump and closes the screen', async () => {
    await seed();
    mockSearch.mockResolvedValue(
      pageOf([hit({ room: OTHER, chatId: 'other', stanzaId: 's9', messageId: 'm9' })])
    );
    const { type, press } = await render();
    await press('message-search-scope-all');
    await type('message-search-input', 'hello');
    await advance(400);
    await press('message-search-hit-row1');
    const state = store.getState();
    expect(state.rooms.activeRoomJID).toBe(OTHER);
    expect(state.rooms.pendingJump).toMatchObject({
      roomJID: OTHER,
      ids: ['s9', 'm9'],
      body: 'hello world',
    });
    expect(state.chatSettingStore.activeModal).toBeUndefined();
  });

  it('a hit from a chat this device does not know is not tappable', async () => {
    await seed();
    mockSearch.mockResolvedValue(pageOf([hit({ room: 'gone@conference.xmpp.test', chatId: 'gone' })]));
    const { type, press, byId } = await render();
    await press('message-search-scope-all');
    await type('message-search-input', 'hello');
    await advance(400);
    expect(byId('message-search-hit-row1')[0].props.disabled).toBe(true);
    expect(resolveHitRoomJid(store.getState().rooms.rooms, hit({ room: 'gone@x', chatId: 'gone' }))).toBeUndefined();
    expect(openSearchHit(store.dispatch as any, store.getState().rooms.rooms, JID, hit({ room: 'gone@x', chatId: 'gone' }))).toBe(false);
  });

  it('offers a retry after a failed request and a "show more" page', async () => {
    await seed();
    mockSearch.mockRejectedValueOnce(new Error('boom'));
    const { type, press, byId } = await render();
    await type('message-search-input', 'hello');
    await advance(400);
    expect(byId('message-search-error').length).toBeGreaterThan(0);
    mockSearch.mockResolvedValueOnce({ ...pageOf([hit()], 40) });
    await press('message-search-retry');
    expect(byId('message-search-more').length).toBeGreaterThan(0);
    mockSearch.mockResolvedValueOnce({ ...pageOf([hit({ id: 'row2' })], 40), nextOffset: 40 });
    await press('message-search-more');
    expect(mockSearch.mock.calls[2][0]).toMatchObject({ offset: 1 });
  });
});

describe('entry point gating', () => {
  it('needs an appId and honours disableMessageSearch', () => {
    expect(isMessageSearchEnabled({ appId: 'a' } as any)).toBe(true);
    expect(isMessageSearchEnabled({} as any)).toBe(false);
    expect(isMessageSearchEnabled({ appId: 'a', disableMessageSearch: true } as any)).toBe(false);
    expect(isMessageSearchEnabled(undefined)).toBe(false);
  });

  const renderButton = async (config: any) => {
    await act(async () => {
      store.dispatch(setConfig(config));
      store.dispatch(setActiveModal(undefined));
    });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <Provider store={store}>
          <MessageSearchButton />
        </Provider>
      );
    });
    return tree;
  };

  it('the header button opens the search screen', async () => {
    const tree = await renderButton({ appId: 'app1' });
    const btn = tree.root.findAllByType(TouchableOpacity)[0];
    await act(async () => btn.props.onPress());
    expect(store.getState().chatSettingStore.activeModal).toBe(MODAL_TYPES.MESSAGE_SEARCH);
  });

  it('renders nothing when disabled or without an appId', async () => {
    expect((await renderButton({ appId: 'app1', disableMessageSearch: true })).toJSON()).toBeNull();
    expect((await renderButton({})).toJSON()).toBeNull();
  });
});
