/**
 * useComposing — XMPP chat-state (composing / paused) emitter.
 *
 * Wraps client.sendTypingRequestStanza with a stable callback per
 * (active room, user). Auto-emits a `paused` 100ms after each mount.
 * config?.disableTypingIndicator short-circuits both directions.
 *
 * Mocks `useXmppClient`, `useSelector`, and `useChatSettingState` so
 * the hook can run under react-test-renderer without standing up the
 * full provider stack.
 */

const mockSendTypingRequestStanza = jest.fn();

jest.mock('../src/context/xmppProvider', () => ({
  useXmppClient: jest.fn(),
}));
jest.mock('react-redux', () => {
  const actual = jest.requireActual('react-redux');
  return { ...actual, useSelector: jest.fn() };
});
jest.mock('../src/hooks/useChatSettingState', () => ({
  useChatSettingState: jest.fn(),
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import useComposing from '../src/hooks/useComposing';
import { useXmppClient } from '../src/context/xmppProvider';
import { useSelector } from 'react-redux';
import { useChatSettingState } from '../src/hooks/useChatSettingState';

const Probe: React.FC<{
  config?: any;
  onReady: (api: {
    start: () => void;
    end: () => void;
  }) => void;
}> = ({ config, onReady }) => {
  const api = useComposing(config);
  React.useEffect(() => {
    onReady({ start: api.sendStartComposing, end: api.sendEndComposing });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <Text>probe</Text>;
};

const mount = async (
  config?: any
): Promise<{
  api: { start: () => void; end: () => void };
  tree: renderer.ReactTestRenderer;
}> => {
  let api!: { start: () => void; end: () => void };
  let tree: renderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderer.create(<Probe config={config} onReady={(a) => (api = a)} />);
  });
  return { api: api!, tree: tree! };
};

beforeEach(() => {
  mockSendTypingRequestStanza.mockReset();
  (useXmppClient as jest.Mock).mockReturnValue({
    client: {
      sendTypingRequestStanza: mockSendTypingRequestStanza,
    },
  });
  (useSelector as jest.Mock).mockImplementation(
    (selector: any) =>
      selector({
        rooms: { activeRoomJID: 'r@h' },
        chatSettingStore: {
          user: { firstName: 'Alice', lastName: 'Anderson' },
        },
      })
  );
  (useChatSettingState as jest.Mock).mockReturnValue({
    user: { firstName: 'Alice', lastName: 'Anderson' },
  });
});

describe('useComposing', () => {
  it('sendStartComposing calls sendTypingRequestStanza(roomJid, fullName, true)', async () => {
    const { api } = await mount();
    // Drain the auto-paused-after-mount timer first so we can isolate
    // the start call.
    mockSendTypingRequestStanza.mockClear();
    act(() => api.start());
    expect(mockSendTypingRequestStanza).toHaveBeenCalledWith(
      'r@h',
      'Alice Anderson',
      true
    );
  });

  it('sendEndComposing calls sendTypingRequestStanza(roomJid, fullName, false)', async () => {
    const { api } = await mount();
    mockSendTypingRequestStanza.mockClear();
    act(() => api.end());
    expect(mockSendTypingRequestStanza).toHaveBeenCalledWith(
      'r@h',
      'Alice Anderson',
      false
    );
  });

  it('passes an empty roomJid when activeRoomJID is null', async () => {
    (useSelector as jest.Mock).mockImplementation((selector: any) =>
      selector({
        rooms: { activeRoomJID: null },
        chatSettingStore: {
          user: { firstName: 'Alice', lastName: 'Anderson' },
        },
      })
    );
    const { api } = await mount();
    mockSendTypingRequestStanza.mockClear();
    act(() => api.start());
    expect(mockSendTypingRequestStanza).toHaveBeenCalledWith(
      '',
      'Alice Anderson',
      true
    );
  });

  it('respects config.disableTypingIndicator — both directions become no-ops', async () => {
    const { api } = await mount({ disableTypingIndicator: true });
    mockSendTypingRequestStanza.mockClear();
    act(() => api.start());
    act(() => api.end());
    expect(mockSendTypingRequestStanza).not.toHaveBeenCalled();
  });

  it('no-ops gracefully when the xmpp client is absent', async () => {
    (useXmppClient as jest.Mock).mockReturnValue({ client: null });
    const { api } = await mount();
    mockSendTypingRequestStanza.mockClear();
    act(() => api.start());
    act(() => api.end());
    expect(mockSendTypingRequestStanza).not.toHaveBeenCalled();
  });

  it('auto-emits `paused` ~100ms after mount (cleanup on the user-id keystroke)', async () => {
    jest.useFakeTimers();
    let api!: { start: () => void; end: () => void };
    let tree: renderer.ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(
        <Probe onReady={(a) => (api = a)} />
      );
    });
    // The auto-pause runs via setTimeout(100). Advance fake timers
    // and let the callback fire.
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(mockSendTypingRequestStanza).toHaveBeenCalledWith(
      'r@h',
      'Alice Anderson',
      false
    );
    tree!.unmount();
    jest.useRealTimers();
  });
});
