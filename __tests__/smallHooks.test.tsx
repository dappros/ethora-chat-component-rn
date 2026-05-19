/**
 * Small hooks bundle.
 *
 *   - usePrevious      — pure ref-based previous-value snapshot
 *   - useLogout        — wraps the logoutService → exercises that
 *                        pure object directly (no need to drive the
 *                        useDispatch/useCallback dance from a test).
 *
 * useComposing isn't included here because it pulls in xmppProvider +
 * chatSettingStore selector chain — covered by the integration tests
 * (chatFeatures + e2eJwtLoginRoomJid).
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { DeviceEventEmitter } from 'react-native';

// Stub the push subscription service before useLogout imports it.
jest.mock('../src/services/pushSubscriptionService', () => ({
  pushSubscriptionService: { reset: jest.fn() },
}));

// useLogout reaches into the real shared store; replace with a tiny
// jest.fn dispatch so we can assert the action sequence. Build the
// spy lazily inside the factory + expose it on the module under a
// well-known property so the test can grab it post-hoist.
jest.mock('../src/roomStore', () => {
  const dispatch = jest.fn();
  return {
    __esModule: true,
    __dispatchSpy: dispatch,
    store: {
      dispatch: (a: any) => dispatch(a),
      // performLogout now reads state before dispatching to figure out
      // whether to flush lastViewed → return an empty shape so the
      // mocked logout path doesn't TypeError on `state.rooms.rooms`.
      getState: () => ({
        rooms: { rooms: {}, activeRoomJID: null },
        chatSettingStore: { client: null },
      }),
    },
  };
});

import usePrevious from '../src/hooks/usePrevious';
import { logoutService } from '../src/hooks/useLogout';
import {
  pushSubscriptionService,
} from '../src/services/pushSubscriptionService';
const dispatchSpy = (jest.requireMock('../src/roomStore') as any)
  .__dispatchSpy as jest.Mock;

// ---- usePrevious ---------------------------------------------------

const Probe: React.FC<{ value: any; onSnapshot: (prev: any) => void }> = ({
  value,
  onSnapshot,
}) => {
  const prev = usePrevious(value);
  onSnapshot(prev);
  return <Text>{String(prev ?? 'undefined')}</Text>;
};

describe('usePrevious', () => {
  it('returns undefined on first render, then the prior value on subsequent renders', async () => {
    const snapshots: any[] = [];
    let tree: renderer.ReactTestRenderer | undefined;

    await act(async () => {
      tree = renderer.create(
        <Probe value="a" onSnapshot={(p) => snapshots.push(p)} />
      );
    });
    expect(snapshots[0]).toBeUndefined();

    await act(async () => {
      tree!.update(
        <Probe value="b" onSnapshot={(p) => snapshots.push(p)} />
      );
    });
    expect(snapshots[1]).toBe('a');

    await act(async () => {
      tree!.update(
        <Probe value="c" onSnapshot={(p) => snapshots.push(p)} />
      );
    });
    expect(snapshots[2]).toBe('b');

    tree!.unmount();
  });

  it('first mount snapshots undefined; subsequent renders with the same value snapshot the value itself', async () => {
    const snapshots: any[] = [];
    const stable = { kind: 'stable' };
    let tree: renderer.ReactTestRenderer | undefined;

    await act(async () => {
      tree = renderer.create(
        <Probe value={stable} onSnapshot={(p) => snapshots.push(p)} />
      );
    });
    await act(async () => {
      tree!.update(
        <Probe value={stable} onSnapshot={(p) => snapshots.push(p)} />
      );
    });
    // Mount: ref.current is undefined; effect runs after render and
    // sets ref.current = stable. Re-render with the same `stable` ref:
    // the [value] dep didn't change so the effect doesn't fire AGAIN,
    // but the previous mount-effect already put `stable` into the ref,
    // so the render reads `stable`.
    expect(snapshots[0]).toBeUndefined();
    expect(snapshots[1]).toBe(stable);

    tree!.unmount();
  });
});

// ---- useLogout (via logoutService) ---------------------------------

describe('logoutService.performLogout', () => {
  beforeEach(() => {
    dispatchSpy.mockReset();
    (pushSubscriptionService.reset as jest.Mock).mockReset();
  });

  it('emits chat:clear-notifications, resets push, and dispatches the 3 logout actions', async () => {
    const emitSpy = jest.spyOn(DeviceEventEmitter, 'emit');

    await logoutService.performLogout();

    expect(emitSpy).toHaveBeenCalledWith('chat:clear-notifications');
    expect(pushSubscriptionService.reset).toHaveBeenCalledTimes(1);

    const types = dispatchSpy.mock.calls.map(([a]) => a.type);
    // Code order is setLogoutState → clearHeap → chat/logout.
    expect(types).toEqual([
      'roomMessages/setLogoutState',
      'roomHeapStore/clearHeap',
      'chat/logout',
    ]);

    emitSpy.mockRestore();
  });
});
