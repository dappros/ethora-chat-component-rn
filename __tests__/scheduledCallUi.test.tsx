/**
 * The scheduled-call UI: the invite card in the message list (one card per
 * slug, Join gated by the time window, no media before the tap), the
 * Schedule button's gating, the schedule sheet, and the pre-join screen.
 */

const mockStartRoomCall = jest.fn();
jest.mock('../src/booking/startRoomCall', () => ({
  __esModule: true,
  startRoomCall: (...args: unknown[]) => mockStartRoomCall(...args),
}));

const mockApi = {
  getScheduledCall: jest.fn(),
  createScheduledCall: jest.fn(),
  updateScheduledCall: jest.fn(),
  cancelScheduledCall: jest.fn(),
};
jest.mock('../src/networking/api-requests/scheduledCalls.api', () => ({
  __esModule: true,
  getScheduledCall: (...a: unknown[]) => mockApi.getScheduledCall(...a),
  createScheduledCall: (...a: unknown[]) => mockApi.createScheduledCall(...a),
  updateScheduledCall: (...a: unknown[]) => mockApi.updateScheduledCall(...a),
  cancelScheduledCall: (...a: unknown[]) => mockApi.cancelScheduledCall(...a),
  isScheduledCallApiError: () => false,
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Linking } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { setConfig, setUser } from '../src/roomStore/chatSettingsSlice';
import { addRoom, deleteAllRooms, setCurrentRoom, updateRoom } from '../src/roomStore/roomsSlice';
import { MessageContainer } from '../src/components/MainComponents/MessageContainer';
import { ScheduleCallButton } from '../src/components/Booking/ScheduleCallButton';
import { ScheduleCallSheet } from '../src/components/Booking/ScheduleCallSheet';
import { ScheduledCallPreJoin } from '../src/components/Booking/ScheduledCallPreJoin';
import { scheduledCallUi } from '../src/booking/scheduledCallStore';
import { __resetScheduledCallDetailCacheForTests } from '../src/booking/scheduledCallActions';
import { JOIN_WINDOW_BEFORE_MS } from '../src/booking/scheduledCall';

const ROOM = 'app_room1@conference.xmpp.test';
const SLUG = 'Zq8x_LmN3pRtV-w2YkA9bc';
const MIN = 60_000;

const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

const inviteMessage = (startMs: number, over: Record<string, unknown> = {}, id = '1760000000000001') =>
  ({
    id,
    date: new Date(1760000000000).toISOString(),
    roomJid: ROOM,
    body: 'Scheduled call: Sync',
    isSystemMessage: 'true',
    user: { id: 'system' },
    type: 'scheduledCall',
    scheduledCallSlug: SLUG,
    scheduledCallTitle: 'Sync',
    scheduledCallStartAt: new Date(startMs).toISOString(),
    scheduledCallDurationMinutes: '30',
    scheduledCallKind: 'video',
    scheduledCallStatus: 'scheduled',
    scheduledCallJoinUrl: `https://app.chat.ethora.com/call/${SLUG}`,
    scheduledCallIcsUrl: 'https://api.chat.ethora.com/v1/calls/scheduled/x.ics',
    scheduledCallGoogleUrl: 'https://calendar.google.com/calendar/render?x=1',
    scheduledCallOutlookUrl: 'https://outlook.live.com/calendar/0/deeplink/compose?x=1',
    ...over,
  }) as any;

const seedRoom = (messages: any[], type: 'private' | 'group' = 'group') => {
  store.dispatch(
    addRoom({
      roomData: {
        jid: ROOM,
        name: 'room1',
        title: 'Room',
        type,
        messages,
      } as any,
    } as any)
  );
};

const mounted: renderer.ReactTestRenderer[] = [];
const mount = async (node: React.ReactElement) => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<Provider store={store}>{node}</Provider>);
  });
  mounted.push(tree);
  await flush();
  return tree;
};

const exists = (tree: renderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id).length > 0;

const press = async (tree: renderer.ReactTestRenderer, id: string) => {
  const node = tree.root.findAll(
    (n) => n.props?.testID === id && typeof n.props.onPress === 'function'
  )[0];
  expect(node).toBeDefined();
  await act(async () => {
    node.props.onPress();
  });
  await flush();
};

const textOf = (tree: renderer.ReactTestRenderer) =>
  JSON.stringify(tree.toJSON());

const renderMessage = (message: any) => (
  <MessageContainer
    message={message}
    walletAddress="me"
    isReply={false}
    showDateLabel={false}
    config={store.getState().chatSettingStore.config}
  />
);

beforeEach(() => {
  store.dispatch(deleteAllRooms());
  scheduledCallUi.reset();
  __resetScheduledCallDetailCacheForTests();
  Object.values(mockApi).forEach((fn) => fn.mockReset());
  mockStartRoomCall.mockReset();
  mockStartRoomCall.mockResolvedValue('started');
  // Cards ask for the call's creator; by default nobody answers.
  mockApi.getScheduledCall.mockRejectedValue(new Error('offline'));
  store.dispatch(
    setConfig({
      baseUrl: 'https://api.test',
      videoCalls: { enabled: true, livekitUrl: 'wss://lk.test', enableAudioCalls: true },
    } as any)
  );
  store.dispatch(setUser({ token: 'tok', _id: 'me-id', xmppUsername: 'me' } as any));
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);
});

afterEach(async () => {
  // Unmount first: later dispatches must not reach a finished test's tree.
  await act(async () => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
  jest.restoreAllMocks();
});

describe('invite card', () => {
  it('is a card, not a system pill', async () => {
    const message = inviteMessage(Date.now() + 120 * MIN);
    seedRoom([message]);
    const tree = await mount(renderMessage(message));
    expect(exists(tree, `scheduled-call-card-${SLUG}`)).toBe(true);
    expect(textOf(tree)).toContain('Sync');
  });

  it('upcoming: Join is disabled and says when it opens; calendar buttons open the backend links', async () => {
    const message = inviteMessage(Date.now() + 120 * MIN);
    seedRoom([message]);
    const tree = await mount(renderMessage(message));
    const join = tree.root.findAll((n) => n.props?.testID === 'scheduled-call-join')[0];
    expect(join.props.disabled).toBe(true);
    expect(textOf(tree)).toContain('You can join from');

    await press(tree, 'scheduled-call-calendar-google');
    expect(Linking.openURL).toHaveBeenLastCalledWith('https://calendar.google.com/calendar/render?x=1');
    await press(tree, 'scheduled-call-calendar-outlook');
    expect(Linking.openURL).toHaveBeenLastCalledWith('https://outlook.live.com/calendar/0/deeplink/compose?x=1');
    await press(tree, 'scheduled-call-calendar-ics');
    expect(Linking.openURL).toHaveBeenLastCalledWith('https://api.chat.ethora.com/v1/calls/scheduled/x.ics');
    // Calendar buttons never start a call.
    expect(mockStartRoomCall).not.toHaveBeenCalled();
  });

  it('joinable: Join starts the room call only when tapped', async () => {
    const message = inviteMessage(Date.now() + 5 * MIN);
    seedRoom([message]);
    const tree = await mount(renderMessage(message));
    expect(mockStartRoomCall).not.toHaveBeenCalled();
    const join = tree.root.findAll((n) => n.props?.testID === 'scheduled-call-join')[0];
    expect(join.props.disabled).toBe(false);
    await press(tree, 'scheduled-call-join');
    expect(mockStartRoomCall).toHaveBeenCalledWith(ROOM, 'video');
  });

  it('opens the join window by itself when the clock gets there', async () => {
    jest.useFakeTimers();
    try {
      const start = Date.now() + JOIN_WINDOW_BEFORE_MS + 60_000;
      const message = inviteMessage(start);
      seedRoom([message]);
      const tree = await mount(renderMessage(message));
      const join = () =>
        tree.root.findAll((n) => n.props?.testID === 'scheduled-call-join')[0];
      expect(join().props.disabled).toBe(true);
      await act(async () => {
        jest.advanceTimersByTime(61_000);
      });
      expect(join().props.disabled).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ended: greyed, no Join', async () => {
    const message = inviteMessage(Date.now() - 120 * MIN);
    seedRoom([message]);
    const tree = await mount(renderMessage(message));
    expect(exists(tree, 'scheduled-call-join')).toBe(false);
    expect(textOf(tree)).toContain('Ended');
  });

  it('cancelled: struck through, no Join, no calendar buttons', async () => {
    const message = inviteMessage(Date.now() + 60 * MIN, { scheduledCallStatus: 'cancelled' });
    seedRoom([message]);
    const tree = await mount(renderMessage(message));
    expect(exists(tree, 'scheduled-call-join')).toBe(false);
    expect(exists(tree, 'scheduled-call-calendar-google')).toBe(false);
    expect(textOf(tree)).toContain('Cancelled');
    const title = tree.root.findAll((n) => n.props?.testID === 'scheduled-call-title')[0];
    expect(JSON.stringify(title.props.style)).toContain('line-through');
  });

  it('one card per slug: the older message draws nothing, the newer shows the latest status', async () => {
    const start = Date.now() + 60 * MIN;
    const first = inviteMessage(start, {}, '1760000000000001');
    const cancelled = inviteMessage(start, { scheduledCallStatus: 'cancelled' }, '1760000900000001');
    seedRoom([first, cancelled]);

    const older = await mount(renderMessage(first));
    expect(older.toJSON()).toBeNull();

    const newer = await mount(renderMessage(cancelled));
    expect(exists(newer, `scheduled-call-card-${SLUG}`)).toBe(true);
    expect(textOf(newer)).toContain('Cancelled');
  });

  const detailOf = (message: any, createdBy: string) => ({
    scheduledCall: {
      slug: SLUG,
      chatName: 'app_room1',
      title: 'Sync',
      startAt: message.scheduledCallStartAt,
      durationMinutes: 30,
      kind: 'video',
      status: 'scheduled',
      createdBy,
    },
    links: { join: '' },
  });

  it('shows Edit and Cancel to the creator named in the invite, with no API request', async () => {
    const message = inviteMessage(Date.now() + 60 * MIN, { scheduledCallCreatedBy: 'me-id' });
    seedRoom([message]);
    const tree = await mount(renderMessage(message));
    expect(exists(tree, 'scheduled-call-edit')).toBe(true);
    expect(exists(tree, 'scheduled-call-cancel')).toBe(true);
    expect(mockApi.getScheduledCall).not.toHaveBeenCalled();
  });

  it('Edit fetches the full record when tapped, then opens the editor', async () => {
    const message = inviteMessage(Date.now() + 60 * MIN, { scheduledCallCreatedBy: 'me-id' });
    seedRoom([message]);
    mockApi.getScheduledCall.mockResolvedValue(detailOf(message, 'me-id'));
    const tree = await mount(renderMessage(message));
    expect(mockApi.getScheduledCall).not.toHaveBeenCalled();
    await press(tree, 'scheduled-call-edit');
    expect(mockApi.getScheduledCall).toHaveBeenCalledWith(SLUG);
    expect(scheduledCallUi.getState().editor).toMatchObject({ mode: 'edit', roomJid: ROOM });
  });

  it('hides Edit and Cancel from someone else', async () => {
    const message = inviteMessage(Date.now() + 60 * MIN, { scheduledCallCreatedBy: 'someone-else' });
    seedRoom([message]);
    const tree = await mount(renderMessage(message));
    expect(exists(tree, 'scheduled-call-edit')).toBe(false);
    expect(exists(tree, 'scheduled-call-cancel')).toBe(false);
    expect(mockApi.getScheduledCall).not.toHaveBeenCalled();
  });

  it('shows them to a room moderator from the locally known role', async () => {
    const message = inviteMessage(Date.now() + 60 * MIN, { scheduledCallCreatedBy: 'someone-else' });
    seedRoom([message]);
    store.dispatch(updateRoom({ jid: ROOM, updates: { role: 'moderator' } } as any));
    const tree = await mount(renderMessage(message));
    expect(exists(tree, 'scheduled-call-edit')).toBe(true);
    expect(mockApi.getScheduledCall).not.toHaveBeenCalled();
  });

  it('an invite without scheduledCallCreatedBy still looks the creator up', async () => {
    const message = inviteMessage(Date.now() + 60 * MIN);
    seedRoom([message]);
    mockApi.getScheduledCall.mockResolvedValue(detailOf(message, 'me-id'));
    const tree = await mount(renderMessage(message));
    expect(mockApi.getScheduledCall).toHaveBeenCalledTimes(1);
    expect(exists(tree, 'scheduled-call-edit')).toBe(true);
  });
});

describe('config.scheduledCalls.enabled = false', () => {
  beforeEach(() => {
    store.dispatch(
      setConfig({
        baseUrl: 'https://api.test',
        videoCalls: { enabled: true, livekitUrl: 'x' },
        scheduledCalls: { enabled: false },
      } as any)
    );
  });

  it('hides the Schedule button', async () => {
    seedRoom([], 'private');
    store.dispatch(setCurrentRoom({ roomJID: ROOM }));
    expect((await mount(<ScheduleCallButton />)).toJSON()).toBeNull();
  });

  it('keeps an invite readable but without Join', async () => {
    const message = inviteMessage(Date.now() + 5 * MIN);
    seedRoom([message]);
    const tree = await mount(renderMessage(message));
    expect(exists(tree, `scheduled-call-card-${SLUG}`)).toBe(true);
    expect(exists(tree, 'scheduled-call-join')).toBe(false);
  });
});

describe('Schedule button', () => {
  const withRoom = (type: 'private' | 'group') => {
    seedRoom([], type);
    store.dispatch(setCurrentRoom({ roomJID: ROOM }));
  };

  it('shows for a private room when calls are on and opens the sheet', async () => {
    withRoom('private');
    const tree = await mount(<ScheduleCallButton />);
    expect(exists(tree, 'schedule-call-button')).toBe(true);
    await press(tree, 'schedule-call-button');
    expect(scheduledCallUi.getState().editor).toEqual({ mode: 'create', roomJid: ROOM });
  });

  it('is absent when calls are off', async () => {
    withRoom('private');
    store.dispatch(setConfig({ baseUrl: 'https://api.test' } as any));
    const tree = await mount(<ScheduleCallButton />);
    expect(tree.toJSON()).toBeNull();
  });

  it('shows for a group room by default and follows videoCalls.allowedRoomTypes', async () => {
    withRoom('group');
    const tree = await mount(<ScheduleCallButton />);
    expect(exists(tree, 'schedule-call-button')).toBe(true);
    await act(async () => {
      store.dispatch(
        setConfig({
          baseUrl: 'https://api.test',
          videoCalls: { enabled: true, livekitUrl: 'x', allowedRoomTypes: ['private'] },
        } as any)
      );
    });
    expect(tree.toJSON()).toBeNull();
  });
});

describe('schedule sheet', () => {
  it('creates a call for the room with the chosen values', async () => {
    mockApi.createScheduledCall.mockResolvedValue({ scheduledCall: {}, links: {} });
    scheduledCallUi.openCreate(ROOM);
    const tree = await mount(<ScheduleCallSheet />);

    const title = tree.root.findAll((n) => n.props?.testID === 'schedule-call-title')[0];
    await act(async () => {
      title.props.onChangeText('Weekly sync');
    });
    await press(tree, 'schedule-call-date-forward');
    await press(tree, 'schedule-call-duration-60');
    await press(tree, 'schedule-call-kind-audio');
    await press(tree, 'schedule-call-submit');

    expect(mockApi.createScheduledCall).toHaveBeenCalledTimes(1);
    const body = mockApi.createScheduledCall.mock.calls[0][0];
    expect(body).toMatchObject({
      chatName: 'app_room1',
      title: 'Weekly sync',
      durationMinutes: 60,
      kind: 'audio',
    });
    expect(Date.parse(body.startAt)).toBeGreaterThan(Date.now() + 23 * 60 * MIN);
    expect(scheduledCallUi.getState().editor).toBeNull();
  });

  it('falls back to the localized default title', async () => {
    mockApi.createScheduledCall.mockResolvedValue({ scheduledCall: {}, links: {} });
    scheduledCallUi.openCreate(ROOM);
    const tree = await mount(<ScheduleCallSheet />);
    await press(tree, 'schedule-call-submit');
    expect(mockApi.createScheduledCall.mock.calls[0][0].title).toBe('Call');
  });

  it('refuses a start in the past without calling the server', async () => {
    scheduledCallUi.openCreate(ROOM);
    const tree = await mount(<ScheduleCallSheet />);
    for (let i = 0; i < 6; i++) {await press(tree, 'schedule-call-date-back');}
    await press(tree, 'schedule-call-submit');
    expect(mockApi.createScheduledCall).not.toHaveBeenCalled();
    expect(exists(tree, 'schedule-call-error')).toBe(true);
  });

  it('keeps the sheet open and says so when the server refuses', async () => {
    mockApi.createScheduledCall.mockRejectedValue(new Error('boom'));
    scheduledCallUi.openCreate(ROOM);
    const tree = await mount(<ScheduleCallSheet />);
    await press(tree, 'schedule-call-submit');
    expect(exists(tree, 'schedule-call-error')).toBe(true);
    expect(scheduledCallUi.getState().editor).not.toBeNull();
  });

  it('says "pick a future time" when the server finds the start in the past', async () => {
    mockApi.createScheduledCall.mockRejectedValue({ serverCode: 'START_IN_PAST' });
    scheduledCallUi.openCreate(ROOM);
    const tree = await mount(<ScheduleCallSheet />);
    await press(tree, 'schedule-call-submit');
    expect(textOf(tree)).toContain('Pick a time in the future');
  });

  it('edits through PATCH', async () => {
    mockApi.updateScheduledCall.mockResolvedValue({ scheduledCall: {}, links: {} });
    const start = Date.now() + 60 * MIN;
    scheduledCallUi.openEdit(ROOM, {
      scheduledCall: {
        slug: SLUG,
        chatName: 'app_room1',
        title: 'Old',
        startAt: new Date(start).toISOString(),
        durationMinutes: 45,
        kind: 'video',
        status: 'scheduled',
      },
      links: { join: '' },
    });
    const tree = await mount(<ScheduleCallSheet />);
    const title = tree.root.findAll((n) => n.props?.testID === 'schedule-call-title')[0];
    expect(title.props.value).toBe('Old');
    await act(async () => {
      title.props.onChangeText('New');
    });
    await press(tree, 'schedule-call-submit');
    expect(mockApi.updateScheduledCall).toHaveBeenCalledWith(
      SLUG,
      expect.objectContaining({ title: 'New', durationMinutes: 45, kind: 'video' })
    );
    expect(mockApi.createScheduledCall).not.toHaveBeenCalled();
  });
});

describe('pre-join', () => {
  const detail = (startMs: number, over: any = {}) => ({
    scheduledCall: {
      slug: SLUG,
      chatName: 'app_room1',
      title: 'Sync',
      startAt: new Date(startMs).toISOString(),
      durationMinutes: 30,
      kind: 'video' as const,
      status: 'scheduled' as const,
      createdBy: 'someone-else',
      ...over,
    },
    links: {
      join: `https://app.chat.ethora.com/call/${SLUG}`,
      google: 'https://calendar.google.com/x',
      ics: 'https://api.chat.ethora.com/x.ics',
    },
    chat: { name: 'app_room1', jid: ROOM, type: 'group' },
  });

  it('starts no media on its own and joins on tap', async () => {
    scheduledCallUi.showPreJoin({ phase: 'ready', slug: SLUG, detail: detail(Date.now() + 5 * MIN) });
    const tree = await mount(<ScheduledCallPreJoin />);
    expect(textOf(tree)).toContain('Sync');
    expect(mockStartRoomCall).not.toHaveBeenCalled();
    await press(tree, 'prejoin-join');
    expect(mockStartRoomCall).toHaveBeenCalledWith(ROOM, 'video');
    expect(scheduledCallUi.getState().preJoin).toBeNull();
  });

  it('keeps Join disabled before the window opens', async () => {
    scheduledCallUi.showPreJoin({ phase: 'ready', slug: SLUG, detail: detail(Date.now() + 3 * 60 * MIN) });
    const tree = await mount(<ScheduledCallPreJoin />);
    const join = tree.root.findAll((n) => n.props?.testID === 'prejoin-join')[0];
    expect(join.props.disabled).toBe(true);
  });

  it('keeps the sheet open when the call could not start', async () => {
    mockStartRoomCall.mockResolvedValue('busy');
    scheduledCallUi.showPreJoin({ phase: 'ready', slug: SLUG, detail: detail(Date.now() + 5 * MIN) });
    const tree = await mount(<ScheduledCallPreJoin />);
    await press(tree, 'prejoin-join');
    expect(scheduledCallUi.getState().preJoin).not.toBeNull();
  });

  it.each([
    ['not-a-member', 'You are not a member of this chat'],
    ['not-found', 'Call not found'],
    ['cancelled', 'This call was cancelled'],
  ] as const)('shows the %s screen', async (reason, text) => {
    scheduledCallUi.showPreJoin({ phase: 'error', slug: SLUG, reason });
    const tree = await mount(<ScheduledCallPreJoin />);
    expect(textOf(tree)).toContain(text);
    expect(exists(tree, 'prejoin-join')).toBe(false);
    await press(tree, 'prejoin-close');
    expect(scheduledCallUi.getState().preJoin).toBeNull();
  });
});
