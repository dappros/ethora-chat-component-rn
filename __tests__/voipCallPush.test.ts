import { store } from '../src/roomStore';
import { setConfig } from '../src/roomStore/chatSettingsSlice';
import { resetCall } from '../src/roomStore/callSlice';
import {
  __resetCallPushForTests,
  answerCallFromPush,
  declineCallFromPush,
  handleCallPush,
} from '../src/helpers/incomingCallFromPush';
import { callPushDataOf } from '../src/push/sealedPushTask';
import {
  __resetSystemCallForTests,
  callKitUuid,
  rememberSystemCallAction,
  takeSystemCallAction,
} from '../src/components/VideoCalls/systemCall';

// A VoIP push is reported to CallKit by the host's native code under
// callKitUuid(callId) before JS runs; the SDK must arrive at the same UUID.
// These vectors are also checked against the host's Swift port.
describe('callKitUuid', () => {
  it.each([
    ['call-1', '5290daef-7aa4-470d-bb0a-07e18aec221b'],
    ['6710f0c2a1b3', '89a3b039-a994-475a-8909-ffd343054ee3'],
    ['Ж-звонок-é', '29057453-c313-455c-8b3b-813be875bbd5'],
    [
      'a-very-long-call-id-that-is-longer-than-thirty-two-characters',
      '2c26fad6-e0ba-4b08-ad6e-cdaf406a3011',
    ],
  ])('maps %s to a fixed v4-shaped UUID', (seed, uuid) => {
    expect(callKitUuid(seed)).toBe(uuid);
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});

describe('system call actions before the call arrives', () => {
  beforeEach(() => __resetSystemCallForTests());

  it('keeps an answer for the call and hands it over once', () => {
    const uuid = callKitUuid('call-1');
    rememberSystemCallAction(uuid.toUpperCase(), 'answer');
    expect(takeSystemCallAction(uuid)).toBe('answer');
    expect(takeSystemCallAction(uuid)).toBeNull();
  });

  it('forgets an action after the ring window', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    rememberSystemCallAction('u', 'end');
    now.mockReturnValue(1_000 + 3 * 60 * 1000);
    expect(takeSystemCallAction('u')).toBeNull();
    now.mockRestore();
  });
});

describe('handleCallPush', () => {
  const push = {
    type: 'call',
    callId: 'call-1',
    callToken: 'jwt',
    room: 'appid_alice-appid_bob',
    kind: 'audio',
    callerName: 'Alice',
    callerXmppUsername: 'appid_alice',
  };

  beforeEach(() => {
    __resetCallPushForTests();
    store.dispatch(resetCall());
    store.dispatch(setConfig(undefined));
  });

  it('holds a push that comes before the chat is configured, then rings it', () => {
    expect(handleCallPush(push)).toBe(true);
    expect(store.getState().call.phase).toBe('idle');

    store.dispatch(
      setConfig({
        videoCalls: { enabled: true, livekitUrl: 'wss://lk' },
        xmppSettings: { conference: 'conference.xmpp.example.com' },
      } as any)
    );

    const call = store.getState().call;
    expect(call.phase).toBe('ringing-incoming');
    expect(call.callId).toBe('call-1');
    expect(call.kind).toBe('audio');
    // The room list is not loaded yet: the JID comes from the conference.
    expect(call.roomJid).toBe('appid_alice-appid_bob@conference.xmpp.example.com');
    expect(call.peerXmppUsername).toBe('appid_alice');
  });

  it('drops a held push older than the token lifetime', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    handleCallPush(push);
    now.mockReturnValue(1_000 + 61_000);
    store.dispatch(
      setConfig({
        videoCalls: { enabled: true, livekitUrl: 'wss://lk' },
        xmppSettings: { conference: 'conference.xmpp.example.com' },
      } as any)
    );
    now.mockRestore();
    expect(store.getState().call.phase).toBe('idle');
  });

  it('does not ring when calls are off', () => {
    store.dispatch(setConfig({ videoCalls: { enabled: false } } as any));
    expect(handleCallPush(push)).toBe(true);
    expect(store.getState().call.phase).toBe('idle');
  });

  it('is not a call push for a chat message', () => {
    expect(handleCallPush({ jid: 'room@conference.x', msgID: '1' })).toBe(false);
  });

  const configure = () =>
    store.dispatch(
      setConfig({
        videoCalls: { enabled: true, livekitUrl: 'wss://lk' },
        xmppSettings: { conference: 'conference.xmpp.example.com' },
      } as any)
    );

  it('answers a call taken on the notification, once the chat is up', () => {
    expect(answerCallFromPush(push)).toBe(true);
    expect(store.getState().call.phase).toBe('idle');
    configure();
    const call = store.getState().call;
    expect(call.phase).toBe('connecting');
    expect(call.token).toBe('jwt');
  });

  it('answers a call that is already ringing from the XMPP invite', () => {
    configure();
    handleCallPush(push);
    expect(store.getState().call.phase).toBe('ringing-incoming');
    answerCallFromPush(push);
    expect(store.getState().call.phase).toBe('connecting');
  });

  it('declines a call refused on the notification', () => {
    configure();
    expect(declineCallFromPush(push)).toBe(true);
    expect(store.getState().call.phase).toBe('idle');
  });
});

describe('callPushDataOf', () => {
  it('finds the call fields wherever expo-notifications put them', () => {
    const fields = { type: 'call', callId: 'c', callToken: 'jwt', room: 'r' };
    expect(callPushDataOf({ data: fields })).toEqual(fields);
    expect(callPushDataOf({ data: { dataString: JSON.stringify(fields) } })).toEqual(fields);
    expect(callPushDataOf({ data: { data: fields } })).toEqual(fields);
  });

  it('ignores chat pushes', () => {
    expect(callPushDataOf({ data: { jid: 'room@conference.x', msgID: '1' } })).toBeNull();
  });
});
