/**
 * The call outside the app: CallKit on iOS (Dynamic Island / status-bar
 * pill with the system mute and end buttons) and the host's ongoing-call
 * notification (Android), both driven from the call state.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { NativeModules } from 'react-native';

const mockCallKeep = {
  setup: jest.fn().mockResolvedValue(undefined),
  setAvailable: jest.fn(),
  displayIncomingCall: jest.fn(),
  startCall: jest.fn(),
  answerIncomingCall: jest.fn(),
  reportConnectingOutgoingCallWithUUID: jest.fn(),
  reportConnectedOutgoingCallWithUUID: jest.fn(),
  setMutedCall: jest.fn(),
  endCall: jest.fn(),
  endAllCalls: jest.fn(),
  listeners: {} as Record<string, Function>,
  addEventListener: jest.fn((event: string, fn: Function) => {
    mockCallKeep.listeners[event] = fn;
  }),
  removeEventListener: jest.fn(),
};
jest.mock('react-native-callkeep', () => mockCallKeep, { virtual: true });

jest.mock('../src/networking/callTokenStanza', () => ({
  __esModule: true,
  sendCallStateSignal: jest.fn(),
  sendCallInviteSignal: jest.fn(),
}));

const mockTerminate = jest.fn();
jest.mock('../src/components/VideoCalls/callActions', () => ({
  __esModule: true,
  terminateActiveCall: (...args: any[]) => mockTerminate(...args),
  translateCallString: (key: string) => key,
}));

const mockSession = {
  micOn: true,
  cameraOn: true,
  connected: true,
  anchorAt: null as number | null,
};
const mockSetMic = jest.fn();
const mockToggleMic = jest.fn();
const mockToggleCamera = jest.fn();
jest.mock('../src/components/VideoCalls/callSessionController', () => ({
  __esModule: true,
  useCallSession: () => mockSession,
  setCallMicEnabled: (...args: any[]) => mockSetMic(...args),
  toggleCallMic: () => mockToggleMic(),
  toggleCallCamera: () => mockToggleCamera(),
}));

import { Provider as ReduxProvider } from 'react-redux';
import { store } from '../src/roomStore';
import {
  resetCall,
  setCallPhase,
  setIncomingCallToken,
  setOutgoingCallToken,
  startOutgoingCall,
} from '../src/roomStore/callSlice';
import { useCallKeep } from '../src/components/VideoCalls/useCallKeep';
import { useOngoingCallNotification } from '../src/components/VideoCalls/useOngoingCallNotification';
import { getCallUiState, setCallMinimized } from '../src/components/VideoCalls/callUiStore';

const flush = async () => {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

const CallKeepProbe = () => {
  useCallKeep();
  return null;
};

const render = async (node: React.ReactElement) => {
  let tree: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<ReduxProvider store={store}>{node}</ReduxProvider>);
  });
  await flush();
  return tree!;
};

const rerender = async (tree: renderer.ReactTestRenderer, node: React.ReactElement) => {
  await act(async () => {
    tree.update(<ReduxProvider store={store}>{node}</ReduxProvider>);
  });
};

beforeAll(() => {
  (NativeModules as any).RNCallKeep = {};
});

beforeEach(() => {
  jest.clearAllMocks();
  store.dispatch(resetCall());
  mockSession.micOn = true;
  mockSession.anchorAt = null;
});

describe('CallKit (iOS)', () => {
  it('reports an outgoing call from the first ring to the end', async () => {
    const tree = await render(<CallKeepProbe />);
    await act(async () => {
      store.dispatch(
        startOutgoingCall({ roomJid: 'room@conf', roomName: 'Alice', kind: 'video' })
      );
    });
    expect(mockCallKeep.startCall).toHaveBeenCalledWith(
      expect.any(String),
      'Alice',
      'Alice',
      'generic',
      true
    );
    const uuid = mockCallKeep.startCall.mock.calls[0][0];

    await act(async () => {
      store.dispatch(setOutgoingCallToken({ roomJid: 'room@conf', token: 't' }));
    });
    expect(mockCallKeep.reportConnectingOutgoingCallWithUUID).toHaveBeenCalledWith(uuid);

    mockSession.anchorAt = Date.now();
    await act(async () => {
      store.dispatch(setCallPhase('in-call'));
    });
    await rerender(tree, <CallKeepProbe />);
    expect(mockCallKeep.reportConnectedOutgoingCallWithUUID).toHaveBeenCalledWith(uuid);

    await act(async () => {
      store.dispatch(resetCall());
    });
    expect(mockCallKeep.endCall).toHaveBeenCalledWith(uuid);
  });

  it('routes the system mute and end buttons into the call', async () => {
    await render(<CallKeepProbe />);
    await act(async () => {
      store.dispatch(startOutgoingCall({ roomJid: 'room@conf', roomName: 'Alice' }));
      store.dispatch(setOutgoingCallToken({ roomJid: 'room@conf', token: 't' }));
    });

    mockCallKeep.listeners.didPerformSetMutedCallAction({ muted: true });
    expect(mockSetMic).toHaveBeenCalledWith(false);

    mockCallKeep.listeners.endCall();
    expect(mockTerminate).toHaveBeenCalledWith('ended');
  });
  it('lets the CallKit banner be the only ring UI, and falls back if it is refused', async () => {
    await render(<CallKeepProbe />);
    await act(async () => {
      store.dispatch(
        setIncomingCallToken({
          roomJid: 'room@conf',
          roomName: 'Alice',
          token: 't',
          callId: 'c1',
        } as any)
      );
    });
    expect(mockCallKeep.displayIncomingCall).toHaveBeenCalled();
    expect(getCallUiState().systemRinging).toBe(true);

    await act(async () => {
      mockCallKeep.listeners.didDisplayIncomingCall({
        error: 'unentitled',
        errorCode: 'Unentitled',
      });
    });
    expect(getCallUiState().systemRinging).toBe(false);
  });
});

describe('ongoing-call notification', () => {
  const makeAdapter = () => {
    let listener: ((action: any) => void) | null = null;
    return {
      show: jest.fn(),
      hide: jest.fn(),
      addActionListener: jest.fn((fn: any) => {
        listener = fn;
        return () => {
          listener = null;
        };
      }),
      fire: (action: string) => listener?.(action),
    };
  };

  const NotificationProbe = ({ adapter }: { adapter: any }) => {
    useOngoingCallNotification(adapter);
    return null;
  };

  it('shows while the call runs, hides after, and its buttons act on the call', async () => {
    const adapter = makeAdapter();
    await render(<NotificationProbe adapter={adapter} />);
    expect(adapter.show).not.toHaveBeenCalled();

    await act(async () => {
      store.dispatch(startOutgoingCall({ roomJid: 'room@conf', roomName: 'Alice' }));
      store.dispatch(setOutgoingCallToken({ roomJid: 'room@conf', token: 't' }));
    });
    expect(adapter.show).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Alice', kind: 'video', micOn: true })
    );

    adapter.fire('toggleMic');
    adapter.fire('toggleCamera');
    adapter.fire('hangUp');
    expect(mockToggleMic).toHaveBeenCalled();
    expect(mockToggleCamera).toHaveBeenCalled();
    expect(mockTerminate).toHaveBeenCalledWith('ended');

    setCallMinimized(true);
    adapter.fire('open');
    expect(getCallUiState().minimized).toBe(false);

    await act(async () => {
      store.dispatch(resetCall());
    });
    expect(adapter.hide).toHaveBeenCalled();
  });
});
