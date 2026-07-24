/**
 * Heavy hooks bundle.
 *
 *   - useEventHandlers       — config.eventHandlers dispatch + error swallow
 *   - useMessageLoaderQueue  — background page-by-page room fetch via setInterval
 *   - useSendMessage         — edit-path, normal-send optimistic bubble,
 *                              correlation id wiring, no-client failure,
 *                              disableSentLogic skip
 *
 * Heaviest leaf hooks (usePushNotifications / useHeapSender /
 * useChatWrapperInit / useCustomTypingIndicator) are deferred — they
 * pull in service singletons (push-fcm, presence-ready globals, the
 * full bootstrap pipeline) that need wider mocks than the cluster of
 * hooks here.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

import roomsReducer, {
  addRoom,
  setEditAction,
} from '../src/roomStore/roomsSlice';
import chatSettingsReducer, {
  setConfig,
  setUser,
} from '../src/roomStore/chatSettingsSlice';
import { useEventHandlers } from '../src/hooks/useEventHandlers';
import useMessageLoaderQueue from '../src/hooks/useMessageLoaderQueue';

// useSendMessage reaches into xmppProvider — stub it.
jest.mock('../src/context/xmppProvider', () => ({
  useXmppClient: jest.fn(),
}));
jest.mock('../src/networking/api-requests/auth.api', () => ({
  uploadFile: jest.fn(),
  uploadFileViaFetch: jest.fn().mockResolvedValue({ data: { results: [] } }),
}));

import { useSendMessage } from '../src/hooks/useSendMessage';
import { useXmppClient } from '../src/context/xmppProvider';

const makeStore = () =>
  configureStore({
    reducer: {
      chatSettingStore: chatSettingsReducer,
      rooms: roomsReducer,
    },
  });

const renderWithStore = async (
  store: ReturnType<typeof makeStore>,
  ui: React.ReactElement
): Promise<renderer.ReactTestRenderer> => {
  let tree: renderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderer.create(<Provider store={store}>{ui}</Provider>);
  });
  return tree!;
};

// ---- useEventHandlers ----------------------------------------------

const EventProbe: React.FC<{
  config?: any;
  onReady: (api: ReturnType<typeof useEventHandlers>) => void;
}> = ({ config, onReady }) => {
  const api = useEventHandlers(config);
  React.useEffect(() => { onReady(api); });
  return <Text>events</Text>;
};

describe('useEventHandlers', () => {
  it('handleMessageSent awaits config.eventHandlers.onMessageSent', async () => {
    const onSent = jest.fn().mockResolvedValue(undefined);
    let api!: ReturnType<typeof useEventHandlers>;
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(
        <EventProbe
          config={{ eventHandlers: { onMessageSent: onSent } }}
          onReady={(a) => (api = a)}
        />
      );
    });
    await act(async () => {
      await api.handleMessageSent({
        message: 'hi',
        roomJID: 'r@h',
        user: { id: 'u1' },
        messageType: 'text',
      });
    });
    expect(onSent).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'hi', roomJID: 'r@h' })
    );
    tree!.unmount();
  });

  it('handleMessageSent re-throws when the user handler throws', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const onSent = jest.fn().mockRejectedValue(new Error('boom'));
    let api!: ReturnType<typeof useEventHandlers>;
    await act(async () => {
      renderer.create(
        <EventProbe
          config={{ eventHandlers: { onMessageSent: onSent } }}
          onReady={(a) => (api = a)}
        />
      );
    });
    await expect(
      api.handleMessageSent({
        message: 'x',
        roomJID: 'r@h',
        user: {},
        messageType: 'text',
      })
    ).rejects.toThrow('boom');
    errSpy.mockRestore();
  });

  it('handleMessageFailed swallows handler throws (does NOT propagate)', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const onFailed = jest.fn(() => {
      throw new Error('handler-boom');
    });
    let api!: ReturnType<typeof useEventHandlers>;
    await act(async () => {
      renderer.create(
        <EventProbe
          config={{ eventHandlers: { onMessageFailed: onFailed } }}
          onReady={(a) => (api = a)}
        />
      );
    });
    expect(() =>
      api.handleMessageFailed({
        message: 'x',
        roomJID: 'r@h',
        error: new Error('orig'),
        messageType: 'text',
      })
    ).not.toThrow();
    expect(onFailed).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('handleMessageEdited swallows handler throws', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const onEdited = jest.fn(() => {
      throw new Error('handler-edit-boom');
    });
    let api!: ReturnType<typeof useEventHandlers>;
    await act(async () => {
      renderer.create(
        <EventProbe
          config={{ eventHandlers: { onMessageEdited: onEdited } }}
          onReady={(a) => (api = a)}
        />
      );
    });
    expect(() =>
      api.handleMessageEdited({
        messageId: 'm1',
        newMessage: 'edited',
        roomJID: 'r@h',
        user: {},
      })
    ).not.toThrow();
    expect(onEdited).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('is a no-op when no eventHandlers are configured', async () => {
    let api!: ReturnType<typeof useEventHandlers>;
    await act(async () => {
      renderer.create(<EventProbe onReady={(a) => (api = a)} />);
    });
    await expect(
      api.handleMessageSent({
        message: 'x',
        roomJID: 'r@h',
        user: {},
        messageType: 'text',
      })
    ).resolves.toBeUndefined();
  });
});

// ---- useMessageLoaderQueue ------------------------------------------

const LoaderProbe: React.FC<{
  rooms: any;
  roomsList: string[];
  globalLoading: boolean;
  loading: boolean;
  loadMore: (jid: string, max: number) => Promise<unknown>;
  pollInterval?: number;
}> = ({ rooms, roomsList, globalLoading, loading, loadMore, pollInterval }) => {
  useMessageLoaderQueue(
    roomsList,
    rooms,
    globalLoading,
    loading,
    loadMore,
    5,
    10,
    pollInterval ?? 1000
  );
  return <Text>loader</Text>;
};

describe('useMessageLoaderQueue', () => {
  it('does NOT start the interval while globalLoading=true', () => {
    jest.useFakeTimers();
    const loadMore = jest.fn();
    renderer.create(
      <LoaderProbe
        rooms={{ 'a@h': { jid: 'a@h', messages: [] } } as any}
        roomsList={['a@h']}
        globalLoading
        loading={false}
        loadMore={loadMore}
      />
    );
    jest.advanceTimersByTime(5000);
    expect(loadMore).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('starts the interval when loading flags are false and at least one room is queued', async () => {
    jest.useFakeTimers();
    const loadMore = jest.fn().mockResolvedValue(undefined);
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(
        <LoaderProbe
          rooms={{ 'a@h': { jid: 'a@h', messages: [] } } as any}
          roomsList={['a@h']}
          globalLoading={false}
          loading={false}
          loadMore={loadMore}
          pollInterval={100}
        />
      );
    });
    // Advance past one interval tick + the per-room delay inside the
    // batch.
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(loadMore).toHaveBeenCalledWith('a@h', 10);
    tree!.unmount();
    jest.useRealTimers();
  });

  it('skips rooms with historyComplete=true', async () => {
    jest.useFakeTimers();
    const loadMore = jest.fn();
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(
        <LoaderProbe
          rooms={{
            'a@h': { jid: 'a@h', messages: [], historyComplete: true },
            'b@h': { jid: 'b@h', messages: [] },
          } as any}
          roomsList={['a@h', 'b@h']}
          globalLoading={false}
          loading={false}
          loadMore={loadMore}
          pollInterval={50}
        />
      );
    });
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
    expect(loadMore).toHaveBeenCalledTimes(1);
    expect(loadMore).toHaveBeenCalledWith('b@h', 10);
    tree!.unmount();
    jest.useRealTimers();
  });

  it('catches loadMore rejections and continues', async () => {
    jest.useFakeTimers();
    const loadMore = jest.fn().mockRejectedValue(new Error('net'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(
        <LoaderProbe
          rooms={{ 'a@h': { jid: 'a@h', messages: [] } } as any}
          roomsList={['a@h']}
          globalLoading={false}
          loading={false}
          loadMore={loadMore}
          pollInterval={50}
        />
      );
    });
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
    expect(loadMore).toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error loading messages for a@h'),
      expect.any(Error)
    );
    errSpy.mockRestore();
    tree!.unmount();
    jest.useRealTimers();
  });
});

// ---- useSendMessage -------------------------------------------------

const sendMessageMock = jest.fn();
// useSendMessage sends every text message through the translate-tag path now
// (mirrors the web SDK: outgoing messages declare their source language so
// the backend can translate them). This is the method the hook actually calls.
const sendTranslateMock = jest.fn();
const editMessageStanzaMock = jest.fn();
const onCriticalSendMock = jest.fn();
const sendMediaMessageStanzaMock = jest.fn(() => 'media-id');

const SendProbe: React.FC<{
  onReady: (api: ReturnType<typeof useSendMessage>) => void;
}> = ({ onReady }) => {
  const api = useSendMessage();
  React.useEffect(() => { onReady(api); });
  return <Text>send</Text>;
};

beforeEach(() => {
  sendMessageMock.mockReset();
  sendTranslateMock.mockReset();
  editMessageStanzaMock.mockReset();
  onCriticalSendMock.mockReset();
  sendMediaMessageStanzaMock.mockReset();
  (useXmppClient as jest.Mock).mockReturnValue({
    client: {
      // useSendMessage now only sends through a client whose underlying
      // stream reports `status: 'online'` (otherwise it buffers for the
      // reconnect flush). A live mock client must say so.
      status: 'online',
      sendMessage: sendMessageMock,
      sendTextMessageWithTranslateTagStanza: sendTranslateMock,
      editMessageStanza: editMessageStanzaMock,
      onCriticalSend: onCriticalSendMock,
      sendMediaMessageStanza: sendMediaMessageStanzaMock,
    },
  });
});

const seedUser = (store: ReturnType<typeof makeStore>) => {
  store.dispatch(
    setUser({
      _id: 'u1',
      firstName: 'Alice',
      lastName: 'Anderson',
      xmppUsername: '0xabc',
      walletAddress: '0xabc',
      defaultWallet: { walletAddress: '0xabc' },
    } as any)
  );
  store.dispatch(
    addRoom({
      roomData: {
        id: 'r@h',
        name: 'r',
        jid: 'r@h',
        title: 'r',
        usersCnt: 0,
        messages: [],
        isLoading: false,
        roomBg: '',
      } as any,
    })
  );
};

describe('useSendMessage', () => {
  it('normal send: drops an optimistic pending bubble and forwards (room, names, wallet, text, …, optimisticId) to sendMessage', async () => {
    const store = makeStore();
    seedUser(store);
    let api!: ReturnType<typeof useSendMessage>;
    await renderWithStore(
      store,
      <SendProbe onReady={(a) => (api = a)} />
    );
    await act(async () => {
      await api.sendMessage('hello', 'r@h');
    });

    // optimistic bubble in redux
    const msgs = store.getState().rooms.rooms['r@h'].messages;
    expect(msgs).toHaveLength(1);
    expect((msgs[0] as any).pending).toBe(true);
    expect((msgs[0] as any).body).toBe('hello');
    expect((msgs[0] as any).id).toMatch(/^send-text-message-\d+-\d+$/);
    expect((msgs[0] as any).user.id).toBe('0xabc');
    expect((msgs[0] as any).user.name).toBe('Alice Anderson');

    // QoS critical-send hint fires.
    expect(onCriticalSendMock).toHaveBeenCalledWith('r@h');

    // The send id from the optimistic bubble flows through as the LAST arg
    // (the correlation id / customId) of the translate-tag send. The plain
    // sendMessage is no longer used for text sends.
    expect(sendMessageMock).not.toHaveBeenCalled();
    const args = sendTranslateMock.mock.calls[0];
    expect(args[0]).toBe('r@h');
    expect(args[1]).toBe('Alice');
    expect(args[2]).toBe('Anderson');
    expect(args[4]).toBe('0xabc');
    expect(args[5]).toBe('hello');
    // langSource defaults to 'en' when the reader hasn't picked a language.
    expect(args[10]).toBe('en');
    expect(args[args.length - 1]).toBe((msgs[0] as any).id);
  });

  it('edit path: calls editMessageStanza, fires onMessageEdited, clears editAction, no optimistic bubble', async () => {
    const onEdited = jest.fn();
    const store = makeStore();
    seedUser(store);
    store.dispatch(
      setConfig({
        colors: { primary: '#0052CD', secondary: '#000' },
        eventHandlers: { onMessageEdited: onEdited } as any,
      } as any)
    );
    store.dispatch(
      setEditAction({
        isEdit: true,
        roomJid: 'r@h',
        messageId: 'msg-42',
        text: 'old',
      })
    );

    let api!: ReturnType<typeof useSendMessage>;
    await renderWithStore(
      store,
      <SendProbe onReady={(a) => (api = a)} />
    );
    await act(async () => {
      await api.sendMessage('edited body', 'r@h');
    });

    expect(editMessageStanzaMock).toHaveBeenCalledWith(
      'r@h',
      'msg-42',
      'edited body'
    );
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(onEdited).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-42',
        newMessage: 'edited body',
        roomJID: 'r@h',
      })
    );
    // Edit action cleared.
    expect(store.getState().rooms.editAction?.isEdit).toBe(false);
    // No optimistic bubble was added for the edit path.
    expect(store.getState().rooms.rooms['r@h'].messages).toHaveLength(0);
  });

  it('edit path: a thrown editMessageStanza routes to handleMessageFailed', async () => {
    const onFailed = jest.fn();
    editMessageStanzaMock.mockImplementationOnce(() => {
      throw new Error('edit boom');
    });

    const store = makeStore();
    seedUser(store);
    store.dispatch(
      setConfig({
        colors: { primary: '#0052CD', secondary: '#000' },
        eventHandlers: { onMessageFailed: onFailed } as any,
      } as any)
    );
    store.dispatch(
      setEditAction({
        isEdit: true,
        roomJid: 'r@h',
        messageId: 'msg-42',
        text: 'old',
      })
    );

    let api!: ReturnType<typeof useSendMessage>;
    await renderWithStore(
      store,
      <SendProbe onReady={(a) => (api = a)} />
    );
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      await api.sendMessage('edited', 'r@h');
    });

    expect(onFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'text',
        roomJID: 'r@h',
      })
    );
    errSpy.mockRestore();
  });

  it('disableSentLogic skips the optimistic bubble but still hits sendMessage', async () => {
    const store = makeStore();
    seedUser(store);
    store.dispatch(
      setConfig({
        colors: { primary: '#0052CD', secondary: '#000' },
        disableSentLogic: true,
      } as any)
    );

    let api!: ReturnType<typeof useSendMessage>;
    await renderWithStore(
      store,
      <SendProbe onReady={(a) => (api = a)} />
    );
    await act(async () => {
      await api.sendMessage('quiet', 'r@h');
    });

    expect(store.getState().rooms.rooms['r@h'].messages).toHaveLength(0);
    expect(sendTranslateMock).toHaveBeenCalled();
  });
});
