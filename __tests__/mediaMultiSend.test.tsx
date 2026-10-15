/**
 * useSendMessage.sendMedia with several files.
 *
 *   - the files upload in parallel and go out as ONE stanza, in selection order
 *   - the optimistic bubble carries one tile per file, with its upload state
 *   - one failed file keeps the message, marks that tile, and Retry re-uploads
 *     only that file before the single stanza goes out
 *   - the cap (maxFiles, default 10) and the size guard are enforced here too
 *   - a single file keeps the one-file behaviour
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

import roomsReducer, { addRoom } from '../src/roomStore/roomsSlice';
import roomHeapReducer from '../src/roomStore/roomHeapSlice';
import chatSettingsReducer, { setConfig, setUser } from '../src/roomStore/chatSettingsSlice';

jest.mock('../src/context/xmppProvider', () => ({
  useXmppClient: jest.fn(),
}));
jest.mock('../src/networking/api-requests/auth.api', () => ({
  uploadFileV2: jest.fn(),
}));

import { useSendMessage } from '../src/hooks/useSendMessage';
import { useXmppClient } from '../src/context/xmppProvider';
import { uploadFileV2 } from '../src/networking/api-requests/auth.api';
import { hasMediaRetry } from '../src/helpers/mediaSendRetry';

const ROOM = 'r@h';

const makeStore = () =>
  configureStore({
    reducer: {
      chatSettingStore: chatSettingsReducer,
      rooms: roomsReducer,
      roomHeapSlice: roomHeapReducer,
    },
  });

type Store = ReturnType<typeof makeStore>;

const SendProbe: React.FC<{
  onReady: (api: ReturnType<typeof useSendMessage>) => void;
}> = ({ onReady }) => {
  const api = useSendMessage();
  React.useEffect(() => {
    onReady(api);
  });
  return <Text>send</Text>;
};

let client: any;

const seed = (store: Store, config?: Record<string, unknown>) => {
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
  if (config) {
    store.dispatch(setConfig({ colors: { primary: '#0052CD' }, ...config } as any));
  }
  store.dispatch(
    addRoom({
      roomData: {
        id: ROOM,
        name: 'r',
        jid: ROOM,
        title: 'r',
        usersCnt: 0,
        messages: [],
        isLoading: false,
        roomBg: '',
      } as any,
    })
  );
};

const mount = async (store: Store) => {
  let api!: ReturnType<typeof useSendMessage>;
  await act(async () => {
    renderer.create(
      <Provider store={store}>
        <SendProbe onReady={(a) => (api = a)} />
      </Provider>
    );
  });
  return () => api;
};

const pick = (n: number, type = 'image/jpeg') => ({
  uri: `file:///picked/photo-${n}.jpg`,
  type,
  name: `photo-${n}.jpg`,
  size: 1000 + n,
});

/** The upload response the server gives for one file. */
const uploaded = (n: number) => ({
  data: {
    results: [
      {
        _id: `att-${n}`,
        location: `https://files.example/${n}.jpg`,
        locationPreview: `https://files.example/${n}-p.jpg`,
        mimetype: 'image/jpeg',
        originalname: `photo-${n}.jpg`,
        filename: `stored-${n}.jpg`,
        size: 1000 + n,
      },
    ],
  },
});

/**
 * An upload mock that answers the Nth call with the Nth file's response.
 * Files start uploading in selection order, so the call order names the file.
 */
const answerInOrder = () => {
  let call = 0;
  return () => Promise.resolve(uploaded(call++));
};

const optimisticOf = (store: Store) =>
  store
    .getState()
    .rooms.rooms[ROOM].messages.find((m: any) => m.isMediafile === 'true');

beforeEach(() => {
  (uploadFileV2 as jest.Mock).mockReset();
  client = {
    status: 'online',
    onCriticalSend: jest.fn(),
    setActiveRoomJid: jest.fn(),
    prioritizeRoomPresence: jest.fn(async () => true),
    ensureStreamAlive: jest.fn(),
    sendMediaMessageStanza: jest.fn(() => 'media-id'),
  };
  (useXmppClient as jest.Mock).mockReturnValue({ client });
});

describe('sendMedia with several files', () => {
  it('uploads in parallel and sends ONE stanza with the files in selection order', async () => {
    const store = makeStore();
    seed(store);
    const api = await mount(store);

    const pending: Array<{ resolve: (v: any) => void }> = [];
    (uploadFileV2 as jest.Mock).mockImplementation(
      () => new Promise((resolve) => pending.push({ resolve }))
    );

    let done!: Promise<boolean>;
    await act(async () => {
      done = api().sendMedia([pick(0), pick(1), pick(2)], 'image/jpeg', ROOM);
    });

    // All three are on the way before any of them has finished.
    expect(uploadFileV2).toHaveBeenCalledTimes(3);
    expect(client.sendMediaMessageStanza).not.toHaveBeenCalled();

    // The optimistic bubble shows one tile per file, each with its local copy.
    const bubble = optimisticOf(store);
    expect(bubble.attachments).toHaveLength(3);
    for (const tile of bubble.attachments) {
      expect(tile.uploadStatus).toBe('uploading');
      expect(tile.localUrl).toMatch(/^file:\/\/\/picked\/photo-\d\.jpg$/);
    }

    // Finish them out of order: the stanza still lists them in selection order.
    await act(async () => {
      pending[2]!.resolve(uploaded(2));
      pending[0]!.resolve(uploaded(0));
      pending[1]!.resolve(uploaded(1));
      await done;
    });

    expect(client.sendMediaMessageStanza).toHaveBeenCalledTimes(1);
    const [roomJID, payload, id] = client.sendMediaMessageStanza.mock.calls[0];
    expect(roomJID).toBe(ROOM);
    expect(id).toBe(bubble.id);
    expect(payload.attachments.map((a: any) => a.attachmentId)).toEqual([
      'att-0',
      'att-1',
      'att-2',
    ]);
    // The flat fields describe attachment #0 for older readers.
    expect(payload.location).toBe('https://files.example/0.jpg');
    expect(payload.caption).toBeUndefined();

    // The sent bubble no longer shows upload state, and keeps its local copies.
    const sent = optimisticOf(store);
    expect(sent.attachments.map((a: any) => a.attachmentId)).toEqual([
      'att-0',
      'att-1',
      'att-2',
    ]);
    expect(sent.attachments.every((a: any) => a.uploadStatus === undefined)).toBe(true);
    // Only the server echo confirms the message; until then it stays pending,
    // so the send watchdog and the restart check still see it as in flight.
    expect(sent.pending).toBe(true);
    expect(store.getState().roomHeapSlice.failedMessages[bubble.id]).toBeUndefined();
  });

  it('reports each file upload progress on its own tile', async () => {
    const store = makeStore();
    seed(store);
    const api = await mount(store);
    const finishers: Array<(v: any) => void> = [];
    (uploadFileV2 as jest.Mock).mockImplementation(
      () => new Promise((resolve) => finishers.push(resolve))
    );

    let done!: Promise<boolean>;
    await act(async () => {
      done = api().sendMedia([pick(0), pick(1)], 'image/jpeg', ROOM);
    });
    const options = (uploadFileV2 as jest.Mock).mock.calls[1][2];
    await act(async () => {
      options.onProgress(40);
    });
    const bubble = optimisticOf(store);
    expect(bubble.attachments[0].uploadProgress).toBe(0);
    expect(bubble.attachments[1].uploadProgress).toBe(40);

    await act(async () => {
      finishers[0]!(uploaded(0));
      finishers[1]!(uploaded(1));
      await done;
    });
  });

  it('keeps the message when one file fails, and Retry re-uploads only that file', async () => {
    const store = makeStore();
    seed(store);
    const api = await mount(store);

    // Calls 0-2 are the first round (file 1 fails). Call 3 is the retry of
    // file 1, which succeeds.
    let call = 0;
    (uploadFileV2 as jest.Mock).mockImplementation(() => {
      const index = call++;
      if (index === 1) {
        return Promise.reject(new Error('Network request failed'));
      }
      return Promise.resolve(uploaded(index < 3 ? index : 1));
    });

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await api().sendMedia([pick(0), pick(1), pick(2)], 'image/jpeg', ROOM);
    });
    expect(outcome).toBe(false);
    expect(client.sendMediaMessageStanza).not.toHaveBeenCalled();

    const bubble = optimisticOf(store);
    expect(bubble.attachments[1].uploadStatus).toBe('failed');
    expect(bubble.attachments[0].uploadStatus).toBe('uploading');

    // The failed payload holds every file, so Retry (and a restart) can replay them.
    const failed = store.getState().roomHeapSlice.failedMessages[bubble.id] as any;
    expect(failed.kind).toBe('media');
    expect(failed.files).toHaveLength(3);
    expect(failed.files.map((f: any) => f.uri)).toEqual([
      'file:///picked/photo-0.jpg',
      'file:///picked/photo-1.jpg',
      'file:///picked/photo-2.jpg',
    ]);
    expect(hasMediaRetry(bubble.id)).toBe(true);

    (uploadFileV2 as jest.Mock).mockClear();
    await act(async () => {
      await api().retryMessage(bubble.id);
    });

    // Only the file that failed goes up again, then the one stanza goes out.
    expect(uploadFileV2).toHaveBeenCalledTimes(1);
    expect(client.sendMediaMessageStanza).toHaveBeenCalledTimes(1);
    const [, payload, id] = client.sendMediaMessageStanza.mock.calls[0];
    expect(id).toBe(bubble.id);
    expect(payload.attachments.map((a: any) => a.attachmentId)).toEqual([
      'att-0',
      'att-1',
      'att-2',
    ]);
    expect(store.getState().roomHeapSlice.failedMessages[bubble.id]).toBeUndefined();
  });

  it('a restart replays the saved file list, not only the first file', async () => {
    const store = makeStore();
    seed(store);
    const api = await mount(store);
    (uploadFileV2 as jest.Mock).mockImplementation(answerInOrder());
    const bubbleId = 'send-media-message:restart-1';
    // A failure saved by an earlier session: no runner registered any more.
    store.dispatch({
      type: 'roomHeapStore/markMessageFailed',
      payload: {
        kind: 'media',
        id: bubbleId,
        roomJID: ROOM,
        data: pick(0),
        type: 'image/jpeg',
        files: [pick(0), pick(1)],
        caption: 'a caption',
      },
    });
    await act(async () => {
      await api().retryMessage(bubbleId);
    });
    expect(uploadFileV2).toHaveBeenCalledTimes(2);
    const [, payload] = client.sendMediaMessageStanza.mock.calls[0];
    expect(payload.attachments).toHaveLength(2);
    expect(payload.caption).toBe('a caption');
  });

  it('sends the typed text as the caption of the single message', async () => {
    const store = makeStore();
    seed(store);
    const api = await mount(store);
    (uploadFileV2 as jest.Mock).mockImplementation(answerInOrder());
    await act(async () => {
      await api().sendMedia([pick(0), pick(1)], 'image/jpeg', ROOM, false, false, '', undefined, {
        text: 'look at these',
      });
    });
    expect(client.sendMediaMessageStanza).toHaveBeenCalledTimes(1);
    expect(client.sendMediaMessageStanza.mock.calls[0][1].caption).toBe('look at these');
    expect(optimisticOf(store).caption).toBe('look at these');
  });

  it('caps one message at 10 files (the 11th and 12th are dropped)', async () => {
    const store = makeStore();
    seed(store);
    const api = await mount(store);
    (uploadFileV2 as jest.Mock).mockImplementation(answerInOrder());
    const twelve = Array.from({ length: 12 }, (_, n) => pick(n));
    await act(async () => {
      await api().sendMedia(twelve, 'image/jpeg', ROOM);
    });
    expect(uploadFileV2).toHaveBeenCalledTimes(10);
    const [, payload] = client.sendMediaMessageStanza.mock.calls[0];
    expect(payload.attachments).toHaveLength(10);
  });

  it('honours config.attachments.maxFiles', async () => {
    const store = makeStore();
    seed(store, { attachments: { maxFiles: 2 } });
    const api = await mount(store);
    (uploadFileV2 as jest.Mock).mockImplementation(answerInOrder());
    await act(async () => {
      await api().sendMedia([pick(0), pick(1), pick(2)], 'image/jpeg', ROOM);
    });
    expect(uploadFileV2).toHaveBeenCalledTimes(2);
    expect(client.sendMediaMessageStanza.mock.calls[0][1].attachments).toHaveLength(2);
  });

  it('refuses a file over config.attachments.maxSizeMB before anything uploads', async () => {
    const store = makeStore();
    seed(store, { attachments: { maxSizeMB: 1 } });
    const api = await mount(store);
    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await api().sendMedia(
        [pick(0), { ...pick(1), size: 2 * 1024 * 1024 }],
        'image/jpeg',
        ROOM
      );
    });
    expect(outcome).toBe(false);
    expect(uploadFileV2).not.toHaveBeenCalled();
    expect(client.sendMediaMessageStanza).not.toHaveBeenCalled();
  });
});

describe('sendMedia with a single file (unchanged behaviour)', () => {
  it('uploads once and sends one stanza with no attachments list', async () => {
    const store = makeStore();
    seed(store);
    const api = await mount(store);
    (uploadFileV2 as jest.Mock).mockResolvedValue(uploaded(0));
    await act(async () => {
      await api().sendMedia(pick(0), 'image/jpeg', ROOM);
    });
    expect(uploadFileV2).toHaveBeenCalledTimes(1);
    expect(client.sendMediaMessageStanza).toHaveBeenCalledTimes(1);
    const [, payload] = client.sendMediaMessageStanza.mock.calls[0];
    expect(payload.attachments).toBeUndefined();
    expect(payload.location).toBe('https://files.example/0.jpg');
    expect(payload.attachmentId).toBe('att-0');
    expect(payload.e2eeKeys).toBeUndefined();
    // The flat fields stay the local file until the echo lands; the tile now
    // carries the server copy, with the local one kept for the preview.
    expect(optimisticOf(store).location).toBe('file:///picked/photo-0.jpg');
    expect(optimisticOf(store).attachments[0].location).toBe('https://files.example/0.jpg');
    expect(optimisticOf(store).attachments[0].localUrl).toBe('file:///picked/photo-0.jpg');
  });
});
