/**
 * Per-file upload state of an outgoing media message, and what a failed
 * media send keeps for its retry.
 *
 *   - setMediaUploadState moves one tile's uploadStatus / uploadProgress
 *   - the room and the id it names must pass the isSafeKey guard
 *   - a failed multi-file payload keeps every file (and its caption) across a
 *     restart, while the transient upload state never reaches the cache
 */
import { configureStore } from '@reduxjs/toolkit';
import roomsReducer, {
  addRoom,
  addRoomMessage,
  setMediaUploadState,
  setMessageAttachments,
} from '../src/roomStore/roomsSlice';
import { reconstructFailedMessagePayload } from '../src/roomStore/persistence';

const ROOM = 'room@conference.example';
const MSG = 'send-media-message:one';

const makeStore = () =>
  configureStore({
    reducer: { rooms: roomsReducer } as any,
    middleware: (g) => g({ serializableCheck: false, immutableCheck: false }),
  });

const seed = (store: ReturnType<typeof makeStore>) => {
  store.dispatch(
    addRoom({
      roomData: { id: ROOM, name: 'room', jid: ROOM, title: 'room', usersCnt: 0, messages: [], isLoading: false, roomBg: '' } as any,
    })
  );
  store.dispatch(
    addRoomMessage({
      roomJID: ROOM,
      message: {
        id: MSG,
        body: 'media',
        roomJid: ROOM,
        date: '2026-06-01T10:00:00Z',
        pending: true,
        isMediafile: 'true',
        attachments: [
          { attachmentId: `${MSG}:0`, location: '', mimetype: 'image/jpeg', uploadStatus: 'uploading', uploadProgress: 0, localUrl: 'file:///a.jpg' },
          { attachmentId: `${MSG}:1`, location: '', mimetype: 'image/jpeg', uploadStatus: 'uploading', uploadProgress: 0, localUrl: 'file:///b.jpg' },
        ],
      } as any,
    })
  );
};

const tiles = (store: ReturnType<typeof makeStore>) =>
  (store.getState() as any).rooms.rooms[ROOM].messages[0].attachments as Array<Record<string, any>>;

describe('setMediaUploadState', () => {
  it('moves one tile to failed and clamps its progress', () => {
    const store = makeStore();
    seed(store);
    store.dispatch(setMediaUploadState({ roomJID: ROOM, messageId: MSG, attachmentId: `${MSG}:1`, uploadStatus: 'failed', uploadProgress: 0 }));
    store.dispatch(setMediaUploadState({ roomJID: ROOM, messageId: MSG, attachmentId: `${MSG}:0`, uploadProgress: 140 }));
    expect(tiles(store)[1]).toMatchObject({ uploadStatus: 'failed', uploadProgress: 0 });
    expect(tiles(store)[0]).toMatchObject({ uploadStatus: 'uploading', uploadProgress: 100 });
  });

  it('a null status clears the upload state of that tile', () => {
    const store = makeStore();
    seed(store);
    store.dispatch(setMediaUploadState({ roomJID: ROOM, messageId: MSG, attachmentId: `${MSG}:0`, uploadStatus: null }));
    expect(tiles(store)[0].uploadStatus).toBeUndefined();
    expect(tiles(store)[0].uploadProgress).toBeUndefined();
    expect(tiles(store)[1].uploadStatus).toBe('uploading');
  });

  it('ignores a tile it does not know', () => {
    const store = makeStore();
    seed(store);
    const before = JSON.stringify(tiles(store));
    store.dispatch(setMediaUploadState({ roomJID: ROOM, messageId: MSG, attachmentId: 'nope', uploadStatus: 'failed' }));
    expect(JSON.stringify(tiles(store))).toBe(before);
  });

  it.each([
    ['__proto__', '__proto__'],
    ['constructor', 'constructor'],
    ['prototype', 'prototype'],
  ])('refuses an unsafe room key (%s) and writes nothing', (roomKey) => {
    const store = makeStore();
    seed(store);
    const before = JSON.stringify(store.getState().rooms.rooms);
    store.dispatch(
      setMediaUploadState({ roomJID: roomKey, messageId: MSG, attachmentId: `${MSG}:0`, uploadStatus: 'failed', uploadProgress: 5 })
    );
    expect(JSON.stringify(store.getState().rooms.rooms)).toBe(before);
    expect(({} as any).uploadStatus).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(store.getState().rooms.rooms, roomKey)).toBe(false);
  });

  it('refuses an unsafe message or attachment id', () => {
    const store = makeStore();
    seed(store);
    const before = JSON.stringify(store.getState().rooms.rooms);
    store.dispatch(setMediaUploadState({ roomJID: ROOM, messageId: '__proto__', attachmentId: `${MSG}:0`, uploadStatus: 'failed' }));
    store.dispatch(setMediaUploadState({ roomJID: ROOM, messageId: MSG, attachmentId: 'constructor', uploadStatus: 'failed' }));
    expect(JSON.stringify(store.getState().rooms.rooms)).toBe(before);
  });
});

describe('setMessageAttachments', () => {
  it('replaces the tiles and leaves pending alone', () => {
    const store = makeStore();
    seed(store);
    store.dispatch(
      setMessageAttachments({
        roomJID: ROOM,
        messageId: MSG,
        attachments: [{ attachmentId: 'srv-0', location: 'https://f/0.jpg', mimetype: 'image/jpeg' }],
      })
    );
    const message = (store.getState() as any).rooms.rooms[ROOM].messages[0];
    expect(message.attachments).toEqual([
      { attachmentId: 'srv-0', location: 'https://f/0.jpg', mimetype: 'image/jpeg' },
    ]);
    expect(message.pending).toBe(true);
  });

  it.each(['__proto__', 'constructor'])('refuses an unsafe room key (%s)', (roomKey) => {
    const store = makeStore();
    seed(store);
    const before = JSON.stringify(store.getState().rooms.rooms);
    store.dispatch(setMessageAttachments({ roomJID: roomKey, messageId: MSG, attachments: [] }));
    expect(JSON.stringify(store.getState().rooms.rooms)).toBe(before);
  });
});

describe('a failed multi-file send across a restart', () => {
  it('rebuilds every local file of a pending album, not only the first', () => {
    const payload = reconstructFailedMessagePayload(
      {
        id: MSG,
        body: 'media',
        isMediafile: 'true',
        location: 'file:///a.jpg',
        caption: 'two pictures',
        attachments: [
          { attachmentId: `${MSG}:0`, location: 'file:///a.jpg', mimetype: 'image/jpeg', originalName: 'a.jpg' },
          { attachmentId: `${MSG}:1`, location: 'https://files.example/b.jpg', mimetype: 'image/jpeg', originalName: 'b.jpg' },
        ],
      } as any,
      ROOM
    );
    expect(payload?.kind).toBe('media');
    if (payload?.kind !== 'media') {return;}
    expect(payload.files).toHaveLength(2);
    // An uploaded file has no local copy to send again.
    expect(payload.files?.[0]?.uri).toBe('file:///a.jpg');
    expect(payload.files?.[1]?.uri).toBeUndefined();
    expect(payload.caption).toBe('two pictures');
  });

  it('a single-file pending message keeps the one-file shape', () => {
    const payload = reconstructFailedMessagePayload(
      { id: MSG, body: 'media', isMediafile: 'true', location: 'file:///only.jpg', mimetype: 'image/jpeg', fileName: 'only.jpg' } as any,
      ROOM
    );
    expect(payload?.kind).toBe('media');
    if (payload?.kind !== 'media') {return;}
    expect(payload.files).toBeUndefined();
    expect(payload.data).toMatchObject({ uri: 'file:///only.jpg', name: 'only.jpg' });
  });
});
