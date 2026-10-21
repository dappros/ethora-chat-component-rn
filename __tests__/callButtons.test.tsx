/**
 * Call buttons in the chat header: offered in 1:1 and members-only group
 * rooms (subject to allowedRoomTypes), never in public rooms. A group call
 * has no single peer to signal.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';

jest.mock('../src/calls/startCall', () => ({
  requestOutgoingCall: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/networking/callTokenStanza', () => ({
  __esModule: true,
  sendCallStateSignal: jest.fn(),
  sendCallInviteSignal: jest.fn(),
}));

import { store } from '../src/roomStore';
import { setConfig, setUser } from '../src/roomStore/chatSettingsSlice';
import { addRoom, setCurrentRoom } from '../src/roomStore/roomsSlice';
import { resetCall } from '../src/roomStore/callSlice';
import { requestOutgoingCall } from '../src/calls/startCall';
import { sendCallInviteSignal } from '../src/networking/callTokenStanza';
import { CallButtons } from '../src/components/VideoCalls/CallButtons';

const DM = 'app_me-app_bob@conference.xmpp.example.com';
const GROUP = 'app_group-uuid@conference.xmpp.example.com';
const PUBLIC = 'app_public-uuid@conference.xmpp.example.com';

const configure = (videoCalls: Record<string, unknown> = {}) =>
  store.dispatch(
    setConfig({
      videoCalls: {
        enabled: true,
        livekitUrl: 'wss://lk',
        enableAudioCalls: true,
        ...videoCalls,
      },
    } as any)
  );

let tree: renderer.ReactTestRenderer | null = null;
const mount = async (roomJid: string) => {
  await act(async () => {
    store.dispatch(setCurrentRoom({ roomJID: roomJid } as any));
  });
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <CallButtons />
      </Provider>
    );
  });
  return tree!;
};

const button = (t: renderer.ReactTestRenderer, label: string) =>
  t.root.findAll((n) => n.props.accessibilityLabel === label && !!n.props.onPress, {
    deep: false,
  });

beforeEach(() => {
  jest.clearAllMocks();
  store.dispatch(resetCall());
  store.dispatch(setUser({ xmppUsername: 'app_me' } as any));
  configure();
  store.dispatch(
    addRoom({
      roomData: {
        jid: DM,
        name: 'Bob B',
        title: 'Bob B',
        type: 'private',
        usersCnt: 2,
        members: [
          { xmppUsername: 'app_me', firstName: 'Me', lastName: 'M' },
          { xmppUsername: 'app_bob', firstName: 'Bob', lastName: 'B' },
        ],
      } as any,
    })
  );
  store.dispatch(
    addRoom({
      roomData: {
        jid: GROUP,
        name: 'Design team',
        title: 'Design team',
        type: 'group',
        usersCnt: 6,
        members: [
          { xmppUsername: 'app_me' },
          { xmppUsername: 'app_ann' },
          { xmppUsername: 'app_bob' },
        ],
      } as any,
    })
  );
  store.dispatch(
    addRoom({
      roomData: { jid: PUBLIC, name: 'Town square', type: 'public', usersCnt: 90 } as any,
    })
  );
});

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
    tree = null;
  });
});

describe('where the call buttons are offered', () => {
  it('in a 1:1 room', async () => {
    const t = await mount(DM);
    expect(button(t, 'Start video call')).toHaveLength(1);
    expect(button(t, 'Start audio call')).toHaveLength(1);
  });

  it('in a members-only group room, by default', async () => {
    const t = await mount(GROUP);
    expect(button(t, 'Start video call')).toHaveLength(1);
  });

  it('never in a public room', async () => {
    const t = await mount(PUBLIC);
    expect(button(t, 'Start video call')).toHaveLength(0);
  });

  it('a host that lists only private keeps calls 1:1', async () => {
    configure({ allowedRoomTypes: ['private'] });
    const group = await mount(GROUP);
    expect(button(group, 'Start video call')).toHaveLength(0);
    await act(async () => {
      group.unmount();
    });
    const dm = await mount(DM);
    expect(button(dm, 'Start video call')).toHaveLength(1);
  });

  it('a host that lists only group offers it in groups only', async () => {
    configure({ allowedRoomTypes: ['group'] });
    expect(button(await mount(GROUP), 'Start video call')).toHaveLength(1);
  });
});

describe('placing a call', () => {
  it('1:1: dials the room, signals the peer and asks the server for the call', async () => {
    const t = await mount(DM);
    await act(async () => {
      button(t, 'Start video call')[0].props.onPress();
    });
    expect(store.getState().call).toMatchObject({
      phase: 'requesting',
      isGroup: false,
      peerXmppUsername: 'app_bob',
      roomName: 'Bob B',
    });
    expect(sendCallInviteSignal).toHaveBeenCalledWith(
      'video',
      expect.objectContaining({ peerXmppUsername: 'app_bob' })
    );
    expect(requestOutgoingCall).toHaveBeenCalledWith({
      chatName: 'app_me-app_bob',
      kind: 'video',
      peerXmppUsername: 'app_bob',
    });
  });

  it('group: no single peer, flagged as a group call, named after the room', async () => {
    const t = await mount(GROUP);
    await act(async () => {
      button(t, 'Start audio call')[0].props.onPress();
    });
    expect(store.getState().call).toMatchObject({
      phase: 'requesting',
      isGroup: true,
      peerXmppUsername: null,
      roomName: 'Design team',
      kind: 'audio',
    });
    expect(sendCallInviteSignal).not.toHaveBeenCalled();
    expect(requestOutgoingCall).toHaveBeenCalledWith({
      chatName: 'app_group-uuid',
      kind: 'audio',
      peerXmppUsername: null,
    });
  });

  it('shows the error when the server refuses', async () => {
    (requestOutgoingCall as jest.Mock).mockRejectedValueOnce(new Error('Error creating chat call'));
    const t = await mount(GROUP);
    await act(async () => {
      button(t, 'Start video call')[0].props.onPress();
    });
    expect(store.getState().call).toMatchObject({
      phase: 'error',
      error: 'Error creating chat call',
    });
  });

  it('hides the buttons while a call is on', async () => {
    const t = await mount(DM);
    await act(async () => {
      button(t, 'Start video call')[0].props.onPress();
    });
    expect(button(t, 'Start video call')).toHaveLength(0);
  });
});
