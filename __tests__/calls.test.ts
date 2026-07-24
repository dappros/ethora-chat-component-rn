import { isCallPush, parseCallPush } from '../src/helpers/callPush';
import callReducer, {
  acceptIncomingCall,
  endCall,
  setCallKind,
  setCallPhase,
  setIncomingCallToken,
  setOutgoingCallToken,
  startOutgoingCall,
} from '../src/roomStore/callSlice';
import {
  buildLocalCallLogMessage,
  callStateHasLogData,
  formatCallLogLabel,
  isCallLogMessage,
  transformCallLogMessage,
} from '../src/helpers/callLogMessage';
import { resolveTranslateMode } from '../src/utils/translateModePolicy';

const initial = () => callReducer(undefined, { type: '@@INIT' });

describe('callPush', () => {
  it('recognises an explicit call marker', () => {
    expect(isCallPush({ type: 'call', callId: 'abc' })).toBe(true);
    expect(isCallPush({ pushType: 'incoming-call' })).toBe(true);
  });

  it('recognises a callId paired with a call-specific field', () => {
    expect(isCallPush({ callId: 'abc', callToken: 'jwt' })).toBe(true);
    expect(isCallPush({ callId: 'abc', kind: 'audio' })).toBe(true);
  });

  it('does not mistake a normal chat push for a call', () => {
    expect(
      isCallPush({ jid: 'room@conference.x', body: 'hi', senderName: 'Bo' })
    ).toBe(false);
    // A callId alone is not enough: some backends stamp correlation ids on
    // everything.
    expect(isCallPush({ callId: 'abc' })).toBe(false);
    expect(isCallPush(null)).toBe(false);
  });

  it('pulls the call fields out, tolerating field-name variants', () => {
    const parsed = parseCallPush({
      callId: 'call-1',
      livekitToken: 'jwt-token',
      callKind: 'audio',
      callRoom: 'app_abc@conference.xmpp.example.com',
      callerName: 'Roman Test',
      callerXmppUsername: 'romanlocal@xmpp.example.com',
    });
    expect(parsed.callId).toBe('call-1');
    expect(parsed.token).toBe('jwt-token');
    expect(parsed.kind).toBe('audio');
    expect(parsed.roomBareName).toBe('app_abc');
    expect(parsed.callerName).toBe('Roman Test');
    // Localpart only: that's what the hangup signal addresses.
    expect(parsed.callerXmppUsername).toBe('romanlocal');
  });

  it('defaults an unknown kind to video, matching the legacy behaviour', () => {
    expect(parseCallPush({ kind: 'holographic' }).kind).toBe('video');
    expect(parseCallPush({}).kind).toBe('video');
  });
});

describe('callSlice', () => {
  it('derives roomBareName from the JID when not given one', () => {
    const state = callReducer(
      initial(),
      startOutgoingCall({ roomJid: 'app_abc@conference.example.com' })
    );
    expect(state.roomBareName).toBe('app_abc');
    expect(state.phase).toBe('requesting');
    expect(state.direction).toBe('outgoing');
  });

  it('ignores an outgoing token for a different room', () => {
    const dialing = callReducer(
      initial(),
      startOutgoingCall({ roomJid: 'roomA@conf.example.com' })
    );
    const stale = callReducer(
      dialing,
      setOutgoingCallToken({ roomJid: 'roomB@conf.example.com', token: 'jwt' })
    );
    expect(stale.token).toBeNull();
    expect(stale.phase).toBe('requesting');
  });

  it('only accepts an incoming call when one is actually incoming', () => {
    const dialing = callReducer(
      initial(),
      startOutgoingCall({ roomJid: 'roomA@conf.example.com' })
    );
    expect(callReducer(dialing, acceptIncomingCall()).phase).toBe('requesting');

    const ringing = callReducer(
      initial(),
      setIncomingCallToken({
        roomJid: 'roomA@conf.example.com',
        token: 'jwt',
        kind: 'audio',
      })
    );
    expect(callReducer(ringing, acceptIncomingCall()).phase).toBe('connecting');
  });

  it('anchors connectedAt once so a reconnect blip does not reset duration', () => {
    const ringing = callReducer(
      initial(),
      setIncomingCallToken({ roomJid: 'r@c.example.com', token: 'jwt' })
    );
    const connected = callReducer(ringing, setCallPhase('in-call'));
    const firstAnchor = connected.connectedAt;
    expect(firstAnchor).toBeTruthy();

    const blipped = callReducer(connected, setCallPhase('connecting'));
    const reconnected = callReducer(blipped, setCallPhase('in-call'));
    expect(reconnected.connectedAt).toBe(firstAnchor);
  });

  it('patches the kind when the invite hint loses the race to the token', () => {
    const ringing = callReducer(
      initial(),
      setIncomingCallToken({ roomJid: 'r@c.example.com', token: 'jwt' })
    );
    expect(ringing.kind).toBe('video');
    expect(callReducer(ringing, setCallKind('audio')).kind).toBe('audio');
    // But never resurrects a finished call.
    expect(callReducer(initial(), setCallKind('audio')).phase).toBe('idle');
  });

  it('resets fully on endCall and on logout', () => {
    const ringing = callReducer(
      initial(),
      setIncomingCallToken({ roomJid: 'r@c.example.com', token: 'jwt' })
    );
    expect(callReducer(ringing, endCall())).toEqual(initial());
    expect(
      callReducer(ringing, { type: 'chatSettingStore/logout' } as any)
    ).toEqual(initial());
  });
});

describe('call log messages', () => {
  it('only treats a call-state carrying log data as a chat entry', () => {
    expect(callStateHasLogData({ state: 'cancelled' })).toBe(false);
    expect(callStateHasLogData({ durationMs: 0 })).toBe(true);
    expect(callStateHasLogData({ callerXmppUsername: 'bo' })).toBe(true);
  });

  it('derives direction from the caller and marks a zero duration missed', () => {
    const incoming = transformCallLogMessage(
      {
        id: '1',
        body: 'call-state',
        type: 'call-state',
        callerXmppUsername: 'other@xmpp.example.com',
        durationMs: 0,
      } as any,
      'me@xmpp.example.com'
    );
    expect(incoming.callLog?.direction).toBe('incoming');
    expect(incoming.callLog?.missed).toBe(true);
    expect(incoming.isSystemMessage).toBe('true');

    const outgoing = transformCallLogMessage(
      {
        id: '2',
        body: 'call-state',
        type: 'call-state',
        callerXmppUsername: 'me@xmpp.example.com',
        durationMs: 12000,
      } as any,
      'me@xmpp.example.com'
    );
    expect(outgoing.callLog?.direction).toBe('outgoing');
    expect(outgoing.callLog?.missed).toBe(false);
  });

  it('leaves non-call messages untouched', () => {
    const message = { id: '3', body: 'hello', type: 'chat' } as any;
    expect(transformCallLogMessage(message, 'me')).toBe(message);
    expect(isCallLogMessage(message)).toBe(false);
  });

  it('gives the local fallback a deterministic id so re-fires collapse', () => {
    const a = buildLocalCallLogMessage({
      callId: 'call-9',
      direction: 'outgoing',
      durationMs: 1000,
      kind: 'video',
      selfXmppUsername: 'me',
    });
    const b = buildLocalCallLogMessage({
      callId: 'call-9',
      direction: 'outgoing',
      durationMs: 5000,
      kind: 'video',
      selfXmppUsername: 'me',
    });
    expect(a.id).toBe('calllog-call-9');
    expect(b.id).toBe(a.id);
  });

  it('builds the label at render time, so it follows the UI language', () => {
    const t = (key: string, vars?: Record<string, string | number>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key;

    expect(
      formatCallLogLabel(
        { callId: 'x', direction: 'outgoing', durationMs: 0, missed: true, kind: 'video' },
        t
      )
    ).toBe('call.noAnswer');

    expect(
      formatCallLogLabel(
        { callId: 'x', direction: 'incoming', durationMs: 0, missed: true, kind: 'video' },
        t
      )
    ).toBe('call.missed');

    expect(
      formatCallLogLabel(
        { callId: 'x', direction: 'outgoing', durationMs: 12000, missed: false, kind: 'video' },
        t
      )
    ).toContain('call.durationSec');

    // No meta at all falls back to whatever body the message had.
    expect(formatCallLogLabel(undefined, t, 'Outgoing call')).toBe(
      'Outgoing call'
    );
  });
});

describe('translate mode policy', () => {
  it("lets the reader's pick win over the host default", () => {
    expect(resolveTranslateMode({ enabled: true, mode: 'auto' }, 'manual')).toBe(
      'manual'
    );
  });

  it('defaults to auto when neither side has an opinion', () => {
    expect(resolveTranslateMode(undefined, undefined)).toBe('auto');
    expect(resolveTranslateMode({ enabled: true }, undefined)).toBe('auto');
  });

  it('lets forceType override even a leftover reader pick', () => {
    expect(
      resolveTranslateMode(
        { enabled: true, mode: 'manual', forceType: true },
        'auto'
      )
    ).toBe('manual');
  });
});

describe('loadCallKeep — optional native module', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('returns null when the JS package is installed but the native module is not linked', () => {
    // Regression: node_modules can carry react-native-callkeep over from a
    // branch whose build linked it (or a host can skip `pod install`). The
    // package then builds `new NativeEventEmitter(null)` at module scope,
    // which throws an invariant RN surfaces as an uncaught redbox on every
    // render of the call overlay — bricking the app over a feature that was
    // never enabled. Probing NativeModules keeps the dep truly optional.
    jest.doMock('react-native', () => ({
      Platform: { OS: 'ios', select: (o: any) => o.ios },
      NativeModules: {}, // no RNCallKeep => native side absent
    }));
    jest.doMock(
      'react-native-callkeep',
      () => {
        throw new Error(
          '`new NativeEventEmitter()` requires a non-null argument.'
        );
      },
      { virtual: true }
    );

    const { loadCallKeep } = require('../src/components/VideoCalls/useCallKeep');
    expect(loadCallKeep()).toBeNull();
  });

  it('returns the module when the native side IS linked', () => {
    jest.doMock('react-native', () => ({
      Platform: { OS: 'ios', select: (o: any) => o.ios },
      NativeModules: { RNCallKeep: {} },
    }));
    const fake = { setup: jest.fn() };
    jest.doMock('react-native-callkeep', () => fake, { virtual: true });

    const { loadCallKeep } = require('../src/components/VideoCalls/useCallKeep');
    expect(loadCallKeep()).toBe(fake);
  });
});
