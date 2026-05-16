/**
 * resendMessage — L1 utility test.
 *
 * The cluster D "send + duplication" retry path. Confirms:
 *   - Generates a `resend-text-message-<uuid>` correlation id.
 *   - Drops a pending optimistic bubble into the room.
 *   - Calls the right XMPP client method: `sendMessage` by default,
 *     `sendTextMessageWithTranslateTagStanza` when both
 *     `respectTranslateConfig: true` AND `config.translates.enabled`.
 *   - Forwards the id as the final arg (so the server echo can flip
 *     the pending bubble in place, mirroring the original send path).
 */

// `jest.mock` calls are hoisted above the imports, so module factories
// must build their fakes lazily inside the factory body (any reference
// to a module-scoped variable would be undefined at hoist time).

jest.mock('../src/utils/clientRegistry', () => {
  const stub = {
    sendMessage: jest.fn(),
    sendTextMessageWithTranslateTagStanza: jest.fn(),
  };
  return {
    __esModule: true,
    __mockClient: stub,
    requireXmppClient: jest.fn(() => stub),
  };
});

jest.mock('../src/roomStore', () => {
  const { configureStore } = require('@reduxjs/toolkit');
  const roomsReducer = require('../src/roomStore/roomsSlice').default;
  const chatSettingsReducer =
    require('../src/roomStore/chatSettingsSlice').default;
  const _store = configureStore({
    reducer: {
      chatSettingStore: chatSettingsReducer,
      rooms: roomsReducer,
    },
  });
  return { __esModule: true, store: _store };
});

// uuid is non-deterministic — stub it so the correlation id is
// predictable.
jest.mock('uuid', () => {
  let counter = 0;
  return {
    __esModule: true,
    v4: jest.fn(() => `uuid-${++counter}`),
    __reset: () => {
      counter = 0;
    },
  };
});

import { addRoom } from '../src/roomStore/roomsSlice';
import { setConfig, setUser } from '../src/roomStore/chatSettingsSlice';
import { resendMessage } from '../src/utils/resendMessage';
import { store as sharedStore } from '../src/roomStore';
const { __mockClient: mockClient } = jest.requireMock(
  '../src/utils/clientRegistry'
);

beforeEach(() => {
  mockClient.sendMessage.mockReset();
  mockClient.sendTextMessageWithTranslateTagStanza.mockReset();
  (jest.requireMock('uuid') as any).__reset();
  // Reset the slices between tests.
  sharedStore.dispatch({ type: 'chat/logout' });
  sharedStore.dispatch({ type: 'roomMessages/setLogoutState' });
  // Seed a user + a room.
  sharedStore.dispatch(
    setUser({
      _id: 'u',
      firstName: 'Alice',
      lastName: 'Anderson',
      walletAddress: '0xabc',
      xmppUsername: '0xabc',
      defaultWallet: { walletAddress: '0xabc' },
    } as any)
  );
  sharedStore.dispatch(
    addRoom({
      roomData: {
        id: 'r@h',
        name: 'r',
        jid: 'r@h',
        title: 'r',
        usersCnt: 1,
        messages: [],
        isLoading: false,
        roomBg: '',
      } as any,
    })
  );
});

describe('resendMessage', () => {
  it('returns a resend-text-message-<uuid> correlation id', async () => {
    const id = await resendMessage({ body: 'hi', roomJid: 'r@h' });
    expect(id).toMatch(/^resend-text-message-uuid-\d+$/);
  });

  it('drops a pending optimistic bubble into the target room', async () => {
    const id = await resendMessage({ body: 'hello world', roomJid: 'r@h' });
    const msgs = sharedStore.getState().rooms.rooms['r@h'].messages;
    expect(msgs).toHaveLength(1);
    const bubble: any = msgs[0];
    expect(bubble.id).toBe(id);
    expect(bubble.body).toBe('hello world');
    expect(bubble.roomJid).toBe('r@h');
    expect(bubble.pending).toBe(true);
    expect(bubble.user.id).toBe('0xabc');
    expect(bubble.user.name).toBe('Alice Anderson');
    expect(bubble.xmppFrom).toBe('r@h/0xabc');
  });

  it('calls sendMessage by default with the resend id as the final arg', async () => {
    const id = await resendMessage({ body: 'hi', roomJid: 'r@h' });
    expect(mockClient.sendMessage).toHaveBeenCalledTimes(1);
    const args = mockClient.sendMessage.mock.calls[0];
    expect(args[0]).toBe('r@h'); // roomJid
    expect(args[1]).toBe('Alice'); // firstName
    expect(args[2]).toBe('Anderson'); // lastName
    expect(args[4]).toBe('0xabc'); // walletAddress
    expect(args[5]).toBe('hi'); // body
    expect(args[args.length - 1]).toBe(id); // resend id
    expect(
      mockClient.sendTextMessageWithTranslateTagStanza
    ).not.toHaveBeenCalled();
  });

  it('routes through the translate stanza when both respectTranslateConfig + config.translates.enabled', async () => {
    sharedStore.dispatch(
      setConfig({
        colors: { primary: '#0052CD', secondary: '#F3F6FC' },
        translates: { enabled: true },
      } as any)
    );

    const id = await resendMessage(
      { body: 'hi', roomJid: 'r@h' },
      { respectTranslateConfig: true }
    );

    expect(
      mockClient.sendTextMessageWithTranslateTagStanza
    ).toHaveBeenCalledTimes(1);
    expect(mockClient.sendMessage).not.toHaveBeenCalled();
    const args =
      mockClient.sendTextMessageWithTranslateTagStanza.mock.calls[0];
    expect(args[0]).toBe('r@h');
    expect(args[5]).toBe('hi');
    expect(args[args.length - 1]).toBe(id);
  });

  it('stays on the non-translate path when translates.enabled is false even with respectTranslateConfig', async () => {
    sharedStore.dispatch(
      setConfig({
        colors: { primary: '#0052CD', secondary: '#F3F6FC' },
        translates: { enabled: false },
      } as any)
    );
    await resendMessage(
      { body: 'hi', roomJid: 'r@h' },
      { respectTranslateConfig: true }
    );
    expect(mockClient.sendMessage).toHaveBeenCalledTimes(1);
    expect(
      mockClient.sendTextMessageWithTranslateTagStanza
    ).not.toHaveBeenCalled();
  });

  it('forwards isReply / showInChannel / mainMessage flags through to the stanza call', async () => {
    await resendMessage({
      body: 'reply body',
      roomJid: 'r@h',
      isReply: true,
      showInChannel: 'true',
      mainMessage: 'parent-id',
    });
    const args = mockClient.sendMessage.mock.calls[0];
    // Signature: (roomJid, first, last, _, wallet, body, _, isReply,
    //             showInChannel, mainMessage, id)
    expect(args[7]).toBe(true);
    expect(args[8]).toBe(true);
    expect(args[9]).toBe('parent-id');
  });
});
