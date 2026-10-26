/**
 * The group call screen and the video surfaces behind it: a grid of
 * everyone in the room, the speaker outlined, a mic-off badge on anyone
 * muted, cameras for a bounded number of people.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

const mockVideoTrack = jest.fn((_props: any) => null);
const mockRTCView = jest.fn((_props: any) => null);

jest.mock('../src/components/VideoCalls/livekitRuntime', () => ({
  __esModule: true,
  loadLiveKit: () => ({
    VideoTrack: (props: any) => mockVideoTrack(props),
    AudioSession: {},
  }),
  ensureLiveKitGlobals: jest.fn(),
  isLiveKitAvailable: () => true,
}));
jest.mock('../src/calls/p2p/webrtcRuntime', () => ({
  __esModule: true,
  loadWebRTC: () => ({ RTCView: (props: any) => mockRTCView(props) }),
  isP2PAvailable: () => true,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../src/networking/callTokenStanza', () => ({
  __esModule: true,
  sendCallStateSignal: jest.fn(),
  sendCallInviteSignal: jest.fn(),
}));

import { Provider as ReduxProvider } from 'react-redux';
import { store } from '../src/roomStore';
import { CallVideo } from '../src/components/VideoCalls/CallVideo';
import { GroupCallView } from '../src/components/VideoCalls/GroupCallView';
import { VideoCallSession } from '../src/components/VideoCalls/VideoCallSession';
import {
  CallParticipantView,
  CallSessionSnapshot,
  IDLE_SESSION,
} from '../src/components/VideoCalls/callSessionTypes';

const person = (
  identity: string,
  over: Partial<CallParticipantView> = {}
): CallParticipantView => ({
  identity,
  name: `Name ${identity}`,
  isLocal: false,
  video: null,
  micMuted: false,
  speaking: false,
  ...over,
});

const session = (over: Partial<CallSessionSnapshot> = {}): CallSessionSnapshot => ({
  ...IDLE_SESSION,
  active: true,
  connected: true,
  isGroup: true,
  ...over,
});

const mounted: renderer.ReactTestRenderer[] = [];
const render = async (node: React.ReactElement) => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<ReduxProvider store={store}>{node}</ReduxProvider>);
  });
  mounted.push(tree);
  return tree;
};

// Unmount so the call timer's interval does not outlive the test.
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
});

const texts = (tree: renderer.ReactTestRenderer): string[] =>
  tree.root
    .findAll((n) => (n.type as unknown) === 'Text')
    .map((n) => [n.props.children].flat().join(''));

const tiles = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAll((n) => n.props.testID === 'group-call-tile' && typeof n.type === 'string');

beforeEach(() => jest.clearAllMocks());

describe('CallVideo', () => {
  it('draws a LiveKit track reference with VideoTrack', async () => {
    const ref = { participant: {}, publication: {}, source: 'camera' };
    await render(<CallVideo source={ref} objectFit="cover" mirror zOrder={1} />);
    expect(mockVideoTrack).toHaveBeenCalledWith(
      expect.objectContaining({ trackRef: ref, objectFit: 'cover', mirror: true, zOrder: 1 })
    );
    expect(mockRTCView).not.toHaveBeenCalled();
  });

  it('draws a p2p stream handle with RTCView', async () => {
    await render(
      <CallVideo source={{ streamURL: 'stream-1', key: 'k' }} objectFit="contain" />
    );
    expect(mockRTCView).toHaveBeenCalledWith(
      expect.objectContaining({ streamURL: 'stream-1', objectFit: 'contain' })
    );
    expect(mockVideoTrack).not.toHaveBeenCalled();
  });

  it('draws nothing without a source', async () => {
    await render(<CallVideo source={null} />);
    expect(mockVideoTrack).not.toHaveBeenCalled();
    expect(mockRTCView).not.toHaveBeenCalled();
  });
});

describe('GroupCallView', () => {
  const people = [
    person('me', { isLocal: true, name: 'Me' }),
    person('ann', { speaking: true }),
    person('bob', { micMuted: true }),
  ];

  it('shows one tile per participant, us as You, the others by name', async () => {
    const tree = await render(
      <GroupCallView
        session={session({ participants: people })}
        kind="audio"
        title="Design team"
        primaryColor="#0052CD"
        onHangup={jest.fn()}
      />
    );
    expect(tiles(tree)).toHaveLength(3);
    const all = texts(tree);
    expect(all).toContain('You');
    expect(all).toContain('Name ann');
    expect(all).toContain('Name bob');
    expect(all).toContain('Design team');
  });

  it('says who is speaking and outlines their tile in the accent colour', async () => {
    const tree = await render(
      <GroupCallView
        session={session({ participants: people })}
        kind="audio"
        title="Design team"
        primaryColor="#0052CD"
        onHangup={jest.fn()}
      />
    );
    expect(texts(tree)).toContain('Speaking: Name ann');
    const flat = tiles(tree).map((t) => StyleSheet.flatten(t.props.style));
    expect(flat.map((s) => s.borderColor)).toEqual([
      'rgba(255, 255, 255, 0.12)',
      '#0052CD',
      'rgba(255, 255, 255, 0.12)',
    ]);
    expect(flat[1].borderWidth).toBe(3);
  });

  it('flags a muted participant with a labelled badge', async () => {
    const tree = await render(
      <GroupCallView
        session={session({ participants: people })}
        kind="audio"
        title="x"
        primaryColor="#0052CD"
        onHangup={jest.fn()}
      />
    );
    const badges = tree.root.findAll(
      (n) => n.props.accessibilityLabel === 'Microphone is off' && typeof n.type === 'string'
    );
    expect(badges).toHaveLength(1);
  });

  it('counts the people and the time once the call is on, waits for others while alone', async () => {
    const connected = await render(
      <GroupCallView
        session={session({ participants: people, anchorAt: Date.now() - 65_000 })}
        kind="audio"
        title="x"
        primaryColor="#0052CD"
        onHangup={jest.fn()}
      />
    );
    expect(texts(connected).some((t) => /^3 participants · 01:0\d$/.test(t))).toBe(true);

    const alone = await render(
      <GroupCallView
        session={session({ participants: [people[0]] })}
        kind="audio"
        title="x"
        primaryColor="#0052CD"
        onHangup={jest.fn()}
      />
    );
    expect(texts(alone)).toContain('Waiting for others...');
  });

  it('falls back to a neutral heading when the room has no name', async () => {
    const tree = await render(
      <GroupCallView
        session={session({ participants: people })}
        kind="video"
        title={null}
        primaryColor="#0052CD"
        onHangup={jest.fn()}
      />
    );
    expect(texts(tree)).toContain('Group video call');
  });

  it('draws cameras only for a video call, and only for people whose camera is live', async () => {
    const live = { participant: {}, publication: {}, source: 'camera' };
    const withVideo = [
      person('me', { isLocal: true, video: live }),
      person('ann', { video: live }),
      person('bob'),
    ];
    await render(
      <GroupCallView
        session={session({ participants: withVideo })}
        kind="video"
        title="x"
        primaryColor="#0052CD"
        onHangup={jest.fn()}
      />
    );
    expect(mockVideoTrack).toHaveBeenCalledTimes(2);

    jest.clearAllMocks();
    await render(
      <GroupCallView
        session={session({ participants: withVideo })}
        kind="audio"
        title="x"
        primaryColor="#0052CD"
        onHangup={jest.fn()}
      />
    );
    expect(mockVideoTrack).not.toHaveBeenCalled();
  });

  it('never draws more than nine cameras in a big room', async () => {
    const live = { participant: {}, publication: {}, source: 'camera' };
    const crowd = Array.from({ length: 30 }, (_, i) =>
      person(`p${i}`, { video: live, isLocal: i === 0 })
    );
    const tree = await render(
      <GroupCallView
        session={session({ participants: crowd })}
        kind="video"
        title="x"
        primaryColor="#0052CD"
        onHangup={jest.fn()}
      />
    );
    expect(tiles(tree)).toHaveLength(30);
    expect(mockVideoTrack).toHaveBeenCalledTimes(9);
  });

  it('hang up and minimize reach their handlers', async () => {
    const onHangup = jest.fn();
    const onToggleMinimize = jest.fn();
    const tree = await render(
      <GroupCallView
        session={session({ participants: people })}
        kind="audio"
        title="x"
        primaryColor="#0052CD"
        onHangup={onHangup}
        onToggleMinimize={onToggleMinimize}
      />
    );
    const press = (label: string) =>
      act(async () => {
        tree.root
          .find((n) => n.props.accessibilityLabel === label && !!n.props.onPress)
          .props.onPress();
      });
    await press('Hang up');
    await press('Minimize call');
    expect(onHangup).toHaveBeenCalledTimes(1);
    expect(onToggleMinimize).toHaveBeenCalledTimes(1);
  });
});

describe('VideoCallSession', () => {
  it('lays a group call out as the grid, not the 1:1 stage', async () => {
    // useCallSession() reads the real (idle) session here, so the grid shows
    // its empty state; what matters is which layout was chosen.
    const group = await render(<VideoCallSession kind="audio" isGroup onHangup={jest.fn()} />);
    expect(
      group.root.findAll((n) => n.props.testID === 'group-call-grid')
    ).not.toHaveLength(0);

    const oneToOne = await render(<VideoCallSession kind="audio" onHangup={jest.fn()} />);
    expect(
      oneToOne.root.findAll((n) => n.props.testID === 'group-call-grid')
    ).toHaveLength(0);
  });
});
