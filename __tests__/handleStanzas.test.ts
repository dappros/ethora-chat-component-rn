/**
 * handleStanza — XMPP stanza dispatch table.
 *
 * Pins which sub-handlers fire for each `<message>` / `<presence>` /
 * `<iq>` / `<room-config>` stanza name, plus the headline short-circuit.
 * Every handler is mocked; we only assert on the routing.
 */

jest.mock('../src/networking/stanzaHandlers', () => ({
  onDeleteMessage: jest.fn(),
  onEditMessage: jest.fn(),
  onRealtimeMessage: jest.fn(),
  onMessageHistory: jest.fn(),
  onGetLastMessageArchive: jest.fn(),
  handleComposing: jest.fn(),
  onChatInvite: jest.fn(),
  onPresenceInRoom: jest.fn(),
  onGetChatRooms: jest.fn(),
  onGetMembers: jest.fn(),
  onGetRoomInfo: jest.fn(),
  onNewRoomCreated: jest.fn(),
  onReactionMessage: jest.fn(),
  onReactionHistory: jest.fn(),
  onRoomKicked: jest.fn(),
  onMessageError: jest.fn(),
}));

import { handleStanza } from '../src/networking/xmpp/handleStanzas.xmpp';
const handlers = jest.requireMock(
  '../src/networking/stanzaHandlers'
) as Record<string, jest.Mock>;

const HANDLER_NAMES = [
  'onDeleteMessage',
  'onEditMessage',
  'onRealtimeMessage',
  'onMessageHistory',
  'onGetLastMessageArchive',
  'handleComposing',
  'onChatInvite',
  'onPresenceInRoom',
  'onGetChatRooms',
  'onGetMembers',
  'onGetRoomInfo',
  'onNewRoomCreated',
  'onReactionMessage',
  'onReactionHistory',
  'onRoomKicked',
  'onMessageError',
];

const fakeXmpp = { username: '0xself' } as any;

const stanza = (name: string, attrs: Record<string, string> = {}) =>
  ({ name, attrs } as any);

beforeEach(() => jest.clearAllMocks());

describe('handleStanza — dispatch table', () => {
  it('short-circuits on `type=headline` without firing any handler', () => {
    handleStanza(stanza('message', { type: 'headline' }), fakeXmpp);
    HANDLER_NAMES.forEach((name) => {
      expect(handlers[name]).not.toHaveBeenCalled();
    });
  });

  it('<message> fans out to the full message-handler chain', () => {
    const s = stanza('message');
    handleStanza(s, fakeXmpp);
    expect(handlers.onMessageError).toHaveBeenCalledWith(s, fakeXmpp);
    expect(handlers.onReactionMessage).toHaveBeenCalledWith(s);
    expect(handlers.onReactionHistory).toHaveBeenCalledWith(s);
    expect(handlers.onDeleteMessage).toHaveBeenCalledWith(s);
    expect(handlers.onEditMessage).toHaveBeenCalledWith(s);
    expect(handlers.onChatInvite).toHaveBeenCalledWith(s, fakeXmpp);
    expect(handlers.onRealtimeMessage).toHaveBeenCalledWith(s);
    expect(handlers.onMessageHistory).toHaveBeenCalledWith(s);
    expect(handlers.handleComposing).toHaveBeenCalledWith(s, '0xself');
    expect(handlers.onPresenceInRoom).toHaveBeenCalledWith(s);
    // Presence/IQ-only handlers stay quiet.
    expect(handlers.onRoomKicked).not.toHaveBeenCalled();
    expect(handlers.onGetChatRooms).not.toHaveBeenCalled();
    expect(handlers.onNewRoomCreated).not.toHaveBeenCalled();
  });

  it('<presence> fires onRoomKicked + onPresenceInRoom only', () => {
    const s = stanza('presence');
    handleStanza(s, fakeXmpp);
    expect(handlers.onRoomKicked).toHaveBeenCalledWith(s);
    expect(handlers.onPresenceInRoom).toHaveBeenCalledWith(s);
    expect(handlers.onMessageHistory).not.toHaveBeenCalled();
    expect(handlers.onChatInvite).not.toHaveBeenCalled();
  });

  it('<iq> fires the iq-chain (rooms / realtime / presence / members / info / last-archive)', () => {
    const s = stanza('iq');
    handleStanza(s, fakeXmpp);
    expect(handlers.onGetChatRooms).toHaveBeenCalledWith(s, fakeXmpp);
    expect(handlers.onRealtimeMessage).toHaveBeenCalledWith(s);
    expect(handlers.onPresenceInRoom).toHaveBeenCalledWith(s);
    expect(handlers.onGetMembers).toHaveBeenCalledWith(s);
    expect(handlers.onGetRoomInfo).toHaveBeenCalledWith(s);
    // onGetLastMessageArchive receives the xmppWs ref too (same as
    // onGetChatRooms / onNewRoomCreated) so it can drive follow-up sends.
    expect(handlers.onGetLastMessageArchive).toHaveBeenCalledWith(s, fakeXmpp);
    expect(handlers.onDeleteMessage).not.toHaveBeenCalled();
    expect(handlers.onChatInvite).not.toHaveBeenCalled();
  });

  it('<room-config> fires onNewRoomCreated only', () => {
    const s = stanza('room-config');
    handleStanza(s, fakeXmpp);
    expect(handlers.onNewRoomCreated).toHaveBeenCalledWith(s, fakeXmpp);
    expect(handlers.onMessageHistory).not.toHaveBeenCalled();
    expect(handlers.onGetChatRooms).not.toHaveBeenCalled();
  });

  it('logs an unhandled stanza name without firing handlers', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    handleStanza(stanza('weird'), fakeXmpp);
    expect(log).toHaveBeenCalledWith('Unhandled stanza type:', 'weird');
    HANDLER_NAMES.forEach((name) => {
      expect(handlers[name]).not.toHaveBeenCalled();
    });
    log.mockRestore();
  });

  // Regression: every room is mucsub-subscribed
  // (urn:xmpp:mucsub:nodes:messages), so ejabberd delivers live room
  // traffic wrapped in a pubsub <event> envelope, not as a bare <message>.
  // Reading `<data>`/`<body>` off the OUTER envelope finds nothing —
  // onRealtimeMessage logged "Missing data elements" and silently dropped
  // every live message, which only ever showed up later via MAM history
  // (i.e. after restarting the app). handleStanza must unwrap to the real
  // inner <message> before handing it to any handler.
  it('<message> wrapped in a mucsub pubsub <event> unwraps to the inner message before dispatch', () => {
    const innerAttrs = { from: 'room@conference.h/nick', id: 'abc123' };
    const inner = { name: 'message', attrs: innerAttrs } as any;
    const item = { getChild: (n: string) => (n === 'message' ? inner : undefined) } as any;
    const items = { getChild: (n: string) => (n === 'item' ? item : undefined) } as any;
    const event = { getChild: (n: string) => (n === 'items' ? items : undefined) } as any;
    const outer = {
      name: 'message',
      attrs: { from: 'room@conference.h', id: 'mucsub-push-1' },
      getChild: (n: string, xmlns?: string) =>
        n === 'event' && xmlns === 'http://jabber.org/protocol/pubsub#event'
          ? event
          : undefined,
    } as any;

    handleStanza(outer, fakeXmpp);

    expect(handlers.onRealtimeMessage).toHaveBeenCalledWith(inner);
    expect(handlers.onMessageHistory).toHaveBeenCalledWith(inner);
    expect(handlers.onDeleteMessage).toHaveBeenCalledWith(inner);
    expect(handlers.onEditMessage).toHaveBeenCalledWith(inner);
    // Never the outer envelope — that's the exact bug being guarded against.
    expect(handlers.onRealtimeMessage).not.toHaveBeenCalledWith(outer);
  });

  it('a plain (non-mucsub) <message> passes through unchanged', () => {
    const s = stanza('message');
    handleStanza(s, fakeXmpp);
    expect(handlers.onRealtimeMessage).toHaveBeenCalledWith(s);
  });
});
