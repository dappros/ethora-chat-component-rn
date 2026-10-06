/**
 * Sender names when the room roster cannot supply them.
 *
 * `/chats/my` used to list every member of every room, and `usersSet` -
 * built from those lists - named every sender. The backend now previews at
 * most 30 members per room, so in a larger room most senders are not in
 * `usersSet`, and what the message itself carries decides what is shown.
 * That exposed three things:
 *   - messages from the web SDK's translate-tagged send path spell the name
 *     `firstName` / `lastName`, which was not read: a raw id on screen;
 *   - the fallback id for such a message was the ROOM's, not the sender's;
 *   - an account registered by email has that email as first and last name.
 */

const mockHttpGet = jest.fn();
jest.mock('../src/networking/apiClient', () => ({
  __esModule: true,
  default: { get: (...args: any[]) => mockHttpGet(...args) },
  getCurrentBaseURL: () => '',
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { addRoom } from '../src/roomStore/roomsSlice';
import { setUser } from '../src/roomStore/chatSettingsSlice';
import { createMessageFromXml } from '../src/helpers/createMessageFromXml';
import { composeName } from '../src/helpers/displayName';
import { createUserNameFromSetUser } from '../src/helpers/createUserNameFromSetUser';
import {
  clearRoomsRestCache,
  getRooms,
  loadRoomMembers,
} from '../src/networking/api-requests/rooms.api';
import { resolveRecipients, __resetE2eeForTests } from '../src/e2ee';
import ChatRoomItem from '../src/components/RoomComponents/ChatRoomItem';
import type { IRoom } from '../src/types/types';

const APP = '646cc8dc96d4a4dc8f7b2f2d';
const ROOM = `${APP}_6a271b95ef26ca2d3e1b8af8@conference.host`;
const SENDER = `${APP}_6abce19b4677c11e66602ea2`;

const quiet = async (fn: () => unknown) => {
  jest.useFakeTimers();
  await fn();
  jest.clearAllTimers();
  jest.useRealTimers();
};

describe('composeName', () => {
  it('shows an email that fills both name fields once', () => {
    expect(composeName('randomroman@gmail.com', 'randomroman@gmail.com')).toBe(
      'randomroman@gmail.com'
    );
    expect(composeName('A@b.c', 'a@B.C ')).toBe('A@b.c');
  });

  it('leaves real names alone, including identical ones', () => {
    expect(composeName('user', 'user')).toBe('user user');
    expect(composeName(' Ann ', 'Owner')).toBe('Ann Owner');
    expect(composeName('Ann', '')).toBe('Ann');
    expect(composeName(undefined, null)).toBe('');
    expect(composeName('a@b.c', 'Smith')).toBe('a@b.c Smith');
  });

  it('is what the identity cache answers with', () => {
    const usersSet: any = {
      u1: { firstName: 'randomroman@gmail.com', lastName: 'randomroman@gmail.com' },
    };
    expect(createUserNameFromSetUser(usersSet, 'u1')).toBe('randomroman@gmail.com');
  });
});

describe('a message from the web translate path', () => {
  // <data> as that path builds it: bare firstName/lastName, no senderJID -
  // the stanza handlers fill senderJID in from the occupant `from`.
  const wire = {
    roomJID: ROOM,
    firstName: 'mwuser',
    lastName: 'wsuser',
    userMessage: '++',
    senderJID: `${ROOM}/${SENDER}`,
  };

  it('carries its sender name and the sender id, in both parse conventions', async () => {
    const wrapped = await createMessageFromXml({
      data: wire,
      id: '1',
      body: '++',
      roomJid: ROOM,
      xmppFrom: `${ROOM}/${SENDER}`,
      date: '2026-09-30T10:17:32Z',
    } as any);
    expect(wrapped.user.name).toBe('mwuser wsuser');
    expect(wrapped.user.id).toBe(SENDER);

    const positional = await createMessageFromXml(wire as any, '++', '2', `${ROOM}/${SENDER}`, false);
    expect(positional.user.name).toBe('mwuser wsuser');
    expect(positional.user.id).toBe(SENDER);
  });

  it('falls back to the sender, never to the room, when it carries no name', async () => {
    const nameless = await createMessageFromXml({
      data: { senderJID: `${ROOM}/${SENDER}` },
      id: '3',
      body: 'x',
      roomJid: ROOM,
      date: '2026-09-30T10:17:32Z',
    } as any);
    expect(nameless.user.name).toBe(SENDER);
    expect(nameless.user.id).toBe(SENDER);

    // A sender-stamped JID is still read the ordinary way.
    const own = await createMessageFromXml({
      data: { senderJID: `${SENDER}@host/resource` },
      id: '4',
      body: 'x',
      roomJid: ROOM,
      date: '2026-09-30T10:17:32Z',
    } as any);
    expect(own.user.name).toBe(SENDER);
  });

  it('prefers the spelling this SDK sends', async () => {
    const message = await createMessageFromXml({
      data: { senderFirstName: 'Ann', senderLastName: 'Owner', firstName: 'x', lastName: 'y' },
      id: '5',
      body: 'x',
      roomJid: ROOM,
      date: '2026-09-30T10:17:32Z',
    } as any);
    expect(message.user.name).toBe('Ann Owner');
  });
});

describe('the room row', () => {
  const row = async (name: string) => {
    const room = {
      id: ROOM,
      jid: ROOM,
      name: 'r',
      title: 'new test',
      usersCnt: 440,
      messages: [
        {
          id: '1',
          body: '++',
          date: '2026-09-30T10:17:32Z',
          roomJid: ROOM,
          user: { id: SENDER, name },
        },
      ],
      isLoading: false,
      roomBg: null,
    } as unknown as IRoom;
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(
        <Provider store={store}>
          <ChatRoomItem chat={room} />
        </Provider>
      );
    });
    const text = JSON.stringify(tree!.toJSON());
    // Unmounted, or the store updates of the tests below re-render it after
    // this suite's environment is gone.
    await act(async () => tree!.unmount());
    return text;
  };

  it('shows the name the message carries', async () => {
    expect(await row('mwuser wsuser')).toContain('mwuser wsuser');
  });

  it('shows no name rather than an id', async () => {
    // What a message cached before this fix still holds.
    const text = await row(`${APP}_6a271b95ef26ca2d3e1b8af8`);
    expect(text).not.toContain(APP);
    expect(text).toContain('++');
  });
});

describe('room members beyond the preview', () => {
  const member = (i: number) => ({
    _id: `m${i}`,
    firstName: `First${i}`,
    lastName: `Last${i}`,
    xmppUsername: `${APP}_m${i}`,
  });
  const all = Array.from({ length: 45 }, (_, i) => member(i));
  const item = (members: any[], extra: any = {}) => ({
    _id: 'big',
    name: 'big',
    jid: 'big@conference.host',
    title: 'Big',
    type: 'public',
    usersCnt: 45,
    members,
    ...extra,
  });

  beforeEach(async () => {
    mockHttpGet.mockReset();
    __resetE2eeForTests();
    await quiet(() => {
      store.dispatch(setUser({ xmppUsername: `${APP}_m0`, token: 'tok' } as any));
      clearRoomsRestCache();
    });
  });

  it('keeps each member\'s picture, so avatars are not all initials', async () => {
    mockHttpGet.mockResolvedValueOnce({
      data: {
        items: [
          item(
            [
              { ...member(1), profileImage: 'https://files.host/files/a.jpg', description: 'hi' },
              // What the backend sends for "no picture".
              { ...member(2), profileImage: '' },
              { ...member(3), profileImage: 'none' },
            ],
            { name: 'pics', jid: 'pics@conference.host', usersCnt: 3 }
          ),
        ],
      },
    });
    await quiet(() => getRooms());
    const state = store.getState().rooms;
    // Under the key a message sender is looked up by...
    expect(state.usersSet[`${APP}_m1`]).toMatchObject({
      profileImage: 'https://files.host/files/a.jpg',
      description: 'hi',
    });
    expect(state.usersSet[`${APP}_m2`]!.profileImage).toBe('');
    expect(state.usersSet[`${APP}_m3`]!.profileImage).toBe('');
    // ...and in the roster the chat profile lists.
    expect(state.rooms['pics@conference.host']!.roomMembers![0]).toMatchObject({
      profileImage: 'https://files.host/files/a.jpg',
    });
  });

  it('counts members by usersCnt, not by the 30 the list previews', async () => {
    mockHttpGet.mockResolvedValueOnce({ data: { items: [item(all.slice(0, 30))] } });
    await quiet(() => getRooms());
    const room = store.getState().rooms.rooms['big@conference.host']!;
    expect(room.usersCnt).toBe(45);
    expect(room.roomMembers).toHaveLength(30);
    // The 31st member is nobody yet.
    expect(store.getState().rooms.usersSet[`${APP}_m40`]).toBeUndefined();
  });

  it('loads the whole roster when the room is opened, once', async () => {
    mockHttpGet.mockResolvedValueOnce({ data: { items: [item(all.slice(0, 30))] } });
    await quiet(() => getRooms());

    mockHttpGet.mockResolvedValue({ data: { result: item(all) } });
    await quiet(async () => {
      expect(await loadRoomMembers('big@conference.host')).toBe(true);
    });
    expect(mockHttpGet).toHaveBeenLastCalledWith('/v1/chats/my/big', expect.anything());

    const state = store.getState().rooms;
    expect(state.rooms['big@conference.host']!.roomMembers).toHaveLength(45);
    expect(state.usersSet[`${APP}_m40`]).toMatchObject({ firstName: 'First40', lastName: 'Last40' });

    // Complete now: nothing more to fetch.
    const calls = mockHttpGet.mock.calls.length;
    expect(await loadRoomMembers('big@conference.host')).toBe(false);
    expect(mockHttpGet.mock.calls.length).toBe(calls);

    // The next list refresh previews 30 again and must not cut the roster back.
    await quiet(async () => {
      clearRoomsRestCache();
      mockHttpGet.mockResolvedValueOnce({ data: { items: [item(all.slice(0, 30))] } });
      await getRooms();
    });
    expect(store.getState().rooms.rooms['big@conference.host']!.roomMembers).toHaveLength(45);
  });

  it('does not ask for a room whose list is already whole, and survives a failure', async () => {
    mockHttpGet.mockResolvedValueOnce({
      data: { items: [item(all.slice(0, 3), { name: 'small', jid: 'small@conference.host', usersCnt: 3 })] },
    });
    await quiet(() => getRooms());
    const calls = mockHttpGet.mock.calls.length;
    expect(await loadRoomMembers('small@conference.host')).toBe(false);
    expect(await loadRoomMembers('unknown@conference.host')).toBe(false);
    expect(mockHttpGet.mock.calls.length).toBe(calls);

    await quiet(() =>
      store.dispatch(
        addRoom({
          roomData: {
            id: 'f', jid: 'flaky@conference.host', name: 'flaky', title: 'f',
            usersCnt: 40, messages: [], isLoading: false, roomBg: null, roomMembers: [],
          } as unknown as IRoom,
        })
      )
    );
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockHttpGet.mockRejectedValueOnce(new Error('offline'));
    expect(await loadRoomMembers('flaky@conference.host')).toBe(false);
    warn.mockRestore();
    // A failure is not remembered: the next open tries again.
    mockHttpGet.mockResolvedValueOnce({ data: { result: item(all, { name: 'flaky' }) } });
    await quiet(async () => {
      expect(await loadRoomMembers('flaky@conference.host')).toBe(true);
    });
  });

  it('learns that a room which came through XMPP is encrypted', async () => {
    // The room list stanza knows nothing of encryption: the row shows no
    // padlock until the room's REST record has been asked for.
    await quiet(() =>
      store.dispatch(
        addRoom({
          roomData: {
            id: '', jid: 'sealed@conference.host', name: 'sealed', title: 'sealed',
            usersCnt: 2, messages: [], isLoading: false, roomBg: null,
          } as unknown as IRoom,
        })
      )
    );
    expect(store.getState().rooms.rooms['sealed@conference.host']!.e2ee).toBeUndefined();
    mockHttpGet.mockResolvedValueOnce({
      data: { result: item(all.slice(0, 2), { name: 'sealed', jid: 'sealed@conference.host', usersCnt: 2, e2ee: true, picture: 'p.png' }) },
    });
    await quiet(async () => {
      expect(await loadRoomMembers('sealed@conference.host', { force: true })).toBe(true);
    });
    const room = store.getState().rooms.rooms['sealed@conference.host']!;
    expect(room.e2ee).toBe(true);
    expect(room.members).toHaveLength(2);
    expect(room.icon).toBe('p.png');
    // A record without members still tells about encryption.
    await quiet(() =>
      store.dispatch(
        addRoom({
          roomData: {
            id: '', jid: 'bare@conference.host', name: 'bare', title: 'bare',
            usersCnt: 0, messages: [], isLoading: false, roomBg: null,
          } as unknown as IRoom,
        })
      )
    );
    mockHttpGet.mockResolvedValueOnce({
      data: { result: { name: 'bare', jid: 'bare@conference.host', e2ee: true } },
    });
    await quiet(async () => {
      await loadRoomMembers('bare@conference.host', { force: true });
    });
    expect(store.getState().rooms.rooms['bare@conference.host']!.e2ee).toBe(true);
  });

  it('encrypts for the whole room, not for the 30 the list previews', async () => {
    mockHttpGet.mockResolvedValueOnce({
      data: { items: [item(all.slice(0, 30), { name: 'sealed', jid: 'sealed@conference.host', e2ee: true })] },
    });
    await quiet(() => getRooms());
    mockHttpGet.mockResolvedValue({ data: { result: item(all, { name: 'sealed', e2ee: true }) } });
    const recipients = await resolveRecipients('sealed@conference.host', 'host');
    expect(recipients).toHaveLength(45);
    expect(recipients).toContain(`${APP}_m44@host`);
  });

  it('does not lose pictures to the full roster, which does not carry them', async () => {
    // `/chats/my` describes a member with a picture...
    const pictured = all.slice(0, 30).map((m, i) => ({
      ...m,
      profileImage: i === 1 ? '' : `https://files.host/files/${m._id}.jpg`,
      description: `about ${m._id}`,
    }));
    mockHttpGet.mockResolvedValueOnce({
      data: { items: [item(pictured, { name: 'roster', jid: 'roster@conference.host' })] },
    });
    await quiet(() => getRooms());
    expect(store.getState().rooms.usersSet[`${APP}_m0`]!.profileImage).toBe(
      'https://files.host/files/m0.jpg'
    );

    // ...`/chats/my/{name}` only with a name. Opening the room loads it.
    mockHttpGet.mockResolvedValue({ data: { result: item(all, { name: 'roster' }) } });
    await quiet(async () => {
      expect(await loadRoomMembers('roster@conference.host')).toBe(true);
    });

    const state = store.getState().rooms;
    // The picture a sender is looked up by is still there...
    expect(state.usersSet[`${APP}_m0`]).toMatchObject({
      firstName: 'First0',
      profileImage: 'https://files.host/files/m0.jpg',
      description: 'about m0',
    });
    expect(state.usersSet.m0!.profileImage).toBe('https://files.host/files/m0.jpg');
    // ...a member who has none still has none, and one beyond the preview
    // is known by name.
    expect(state.usersSet[`${APP}_m1`]!.profileImage).toBe('');
    expect(state.usersSet[`${APP}_m40`]).toMatchObject({ firstName: 'First40', profileImage: '' });
    // The member list of the chat profile keeps the pictures too.
    const roster = state.rooms['roster@conference.host']!.roomMembers!;
    expect(roster).toHaveLength(45);
    expect(roster[0]!.profileImage).toBe('https://files.host/files/m0.jpg');

    // A list refresh that says the picture is gone is believed.
    await quiet(async () => {
      clearRoomsRestCache();
      mockHttpGet.mockResolvedValueOnce({
        data: {
          items: [
            item([{ ...all[0], profileImage: '' }, ...pictured.slice(1)], {
              name: 'roster',
              jid: 'roster@conference.host',
            }),
          ],
        },
      });
      await getRooms();
    });
    expect(store.getState().rooms.usersSet[`${APP}_m0`]!.profileImage).toBe('');
  });
});
